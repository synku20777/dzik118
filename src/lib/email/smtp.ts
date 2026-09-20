// Phase G (Invoices/delivery) - minimal SMTP client for local dev only.
// Mailpit (the local email-testing server, spec's local dev stack) has no
// HTTP "send" API -- it IS an SMTP server, so verifying the send pipeline
// against it for real means speaking real SMTP. No auth/STARTTLS: local
// Mailpit accepts plain connections, and production never uses this file
// at all (src/lib/email/index.ts selects src/lib/email/ses.ts whenever
// real AWS credentials are configured).
import { connect, type Socket } from "node:net";
import {
  invoiceEmailHtml,
  invoiceEmailSubject,
  invoiceEmailText,
  sanitizeHeader,
  type EmailDeliveryResult,
  type EmailService,
  type SendInvoiceEmailInput,
} from "./service";

export interface SmtpConfig {
  host: string;
  port: number;
  fromAddress: string;
}

// SMTP multi-line responses use "250-" for continuation lines and "250 "
// (space) for the final line of a reply -- read until a final line shows up.
function readResponse(socket: Socket): Promise<string> {
  if (socket.destroyed) {
    return Promise.reject(new Error("SMTP socket is already closed"));
  }
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("SMTP connection closed unexpectedly"));
    };
    function cleanup() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    }
    socket.on("data", onData);
    socket.on("error", onError);
    socket.once("close", onClose);
  });
}

async function sendLine(socket: Socket, line: string): Promise<string> {
  const responsePromise = readResponse(socket);
  socket.write(`${line}\r\n`);
  return responsePromise;
}

// RFC 5321 dot-stuffing: any line starting with "." gets an extra "."
// prepended, since a lone "." on its own line ends the DATA block.
function dotStuff(body: string): string {
  return body
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

export function createSmtpEmailService(config: SmtpConfig): EmailService {
  return {
    async sendInvoice(
      input: SendInvoiceEmailInput
    ): Promise<EmailDeliveryResult> {
      const socket = connect(config.port, config.host);
      socket.on("error", () => {}); // Prevent unhandled error event if socket errors outside an active listener
      const safeFrom = sanitizeHeader(config.fromAddress).replace(/[<>]/g, "");
      const safeTo = sanitizeHeader(input.to).replace(/[<>]/g, "");

      try {
        // Pre-DATA phase: connecting, greeting, EHLO, MAIL FROM, RCPT TO, DATA command.
        // If anything fails here, nothing potentially deliverable has been transmitted -> DEFINITIVE.
        try {
          await new Promise<void>((resolve, reject) => {
            const onConnect = () => {
              cleanup();
              resolve();
            };
            const onError = (err: Error) => {
              cleanup();
              reject(err);
            };
            const onClose = () => {
              cleanup();
              reject(new Error("SMTP connection closed before connect"));
            };
            function cleanup() {
              socket.off("connect", onConnect);
              socket.off("error", onError);
              socket.off("close", onClose);
            }
            socket.once("connect", onConnect);
            socket.once("error", onError);
            socket.once("close", onClose);
          });
          const greeting = await readResponse(socket); // 220 greeting
          if (!/^2\d\d[ -]/m.test(greeting)) {
            return {
              success: false,
              provider: "smtp",
              errorCode: "SMTP_REJECTED",
              failureClassification: "DEFINITIVE",
            };
          }
          const ehloResp = await sendLine(socket, "EHLO localhost");
          if (!/^2\d\d[ -]/m.test(ehloResp)) {
            return {
              success: false,
              provider: "smtp",
              errorCode: "SMTP_REJECTED",
              failureClassification: "DEFINITIVE",
            };
          }
          const mailResp = await sendLine(socket, `MAIL FROM:<${safeFrom}>`);
          if (!/^2\d\d[ -]/m.test(mailResp)) {
            return {
              success: false,
              provider: "smtp",
              errorCode: "SMTP_REJECTED",
              failureClassification: "DEFINITIVE",
            };
          }
          const rcptResp = await sendLine(socket, `RCPT TO:<${safeTo}>`);
          if (!/^2\d\d[ -]/m.test(rcptResp)) {
            return {
              success: false,
              provider: "smtp",
              errorCode: "SMTP_REJECTED",
              failureClassification: "DEFINITIVE",
            };
          }
          const dataResp = await sendLine(socket, "DATA");
          if (!/^3\d\d[ -]/m.test(dataResp)) {
            return {
              success: false,
              provider: "smtp",
              errorCode: "SMTP_REJECTED",
              failureClassification: "DEFINITIVE",
            };
          }
        } catch {
          return {
            success: false,
            provider: "smtp",
            errorCode: "SMTP_CONNECTION_FAILED",
            failureClassification: "DEFINITIVE",
          };
        }

        // DATA phase: message payload is transmitted. Any error during write or waiting
        // for the final reply is AMBIGUOUS because the server may have accepted the message.
        const boundary = `part-${crypto.randomUUID()}`;
        const body = [
          `From: ${safeFrom}`,
          `To: ${safeTo}`,
          `Subject: ${invoiceEmailSubject(input)}`,
          "MIME-Version: 1.0",
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          "",
          `--${boundary}`,
          "Content-Type: text/plain; charset=UTF-8",
          "",
          invoiceEmailText(input),
          "",
          `--${boundary}`,
          "Content-Type: text/html; charset=UTF-8",
          "",
          invoiceEmailHtml(input),
          "",
          `--${boundary}--`,
        ].join("\r\n");

        let finalResponse: string;
        try {
          finalResponse = await sendLine(socket, `${dotStuff(body)}\r\n.`);
        } catch {
          return {
            success: false,
            provider: "smtp",
            errorCode: "SMTP_RESPONSE_UNCERTAIN",
            failureClassification: "AMBIGUOUS",
          };
        }

        try {
          await sendLine(socket, "QUIT");
        } catch {
          // Best effort QUIT shutdown; do not overwrite finalResponse status
        }

        return /^250[ -]/m.test(finalResponse)
          ? { success: true, provider: "smtp" }
          : {
              success: false,
              provider: "smtp",
              errorCode: "SMTP_REJECTED",
              failureClassification: "DEFINITIVE",
            };
      } finally {
        socket.destroy();
      }
    },
  };
}
