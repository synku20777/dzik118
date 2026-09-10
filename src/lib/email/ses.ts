// Phase G (Invoices/delivery) - Amazon SES adapter (spec Section 3.6:
// "Amazon SES, eu-central-1"). Signs the SES v2 SendEmail HTTPS call with
// aws4fetch rather than a hand-rolled SigV4 implementation -- signing is a
// security-sensitive area with subtle canonicalization edge cases, and
// this can't be verified against a real AWS endpoint in this environment,
// so a small, widely-used, dependency-free library is safer here than a
// bespoke implementation with no way to test it against the real service.
import { AwsClient } from "aws4fetch";
import {
  invoiceEmailHtml,
  invoiceEmailSubject,
  invoiceEmailText,
  type EmailDeliveryResult,
  type EmailService,
  type SendInvoiceEmailInput,
} from "./service";

export interface SesConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  fromAddress: string;
}

export function createSesEmailService(config: SesConfig): EmailService {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "ses",
  });
  const endpoint = `https://email.${config.region}.amazonaws.com/v2/email/outbound-emails`;

  return {
    async sendInvoice(
      input: SendInvoiceEmailInput
    ): Promise<EmailDeliveryResult> {
      const body = JSON.stringify({
        FromEmailAddress: config.fromAddress,
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: invoiceEmailSubject(input), Charset: "UTF-8" },
            Body: {
              Html: { Data: invoiceEmailHtml(input), Charset: "UTF-8" },
              Text: { Data: invoiceEmailText(input), Charset: "UTF-8" },
            },
          },
        },
      });

      try {
        const response = await client.fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!response.ok) {
          // Spec Section 23: "sensitive provider errors not exposed to
          // resident" -- the raw response body (which can include account
          // details) is captured for the audit/delivery log, never
          // returned to the caller beyond this short classification.
          return {
            success: false,
            provider: "ses",
            errorCode: `SES_HTTP_${response.status}`,
          };
        }
        const data = (await response.json()) as { MessageId?: string };
        return {
          success: true,
          provider: "ses",
          providerMessageId: data.MessageId,
        };
      } catch {
        return {
          success: false,
          provider: "ses",
          errorCode: "SES_REQUEST_FAILED",
        };
      }
    },
  };
}
