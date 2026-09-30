// Verifies that an Amazon SNS message really comes from SNS, as AWS
// documents: build the string to sign from named fields, fetch the signing
// certificate from an amazonaws.com address, and check the RSA signature.
// Without this check anyone who can reach the endpoint could forge an event.
//
// WebCrypto imports a public key in SPKI form, not a whole X.509
// certificate, so a small DER reader cuts the key out of the certificate.

export interface SnsMessage {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Message?: string;
  Subject?: string;
  Timestamp?: string;
  Token?: string;
  SubscribeURL?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
}

// Field order is fixed by AWS. Subject is only signed when it is present.
const NOTIFICATION_FIELDS = [
  "Message",
  "MessageId",
  "Subject",
  "Timestamp",
  "TopicArn",
  "Type",
] as const;
const CONFIRMATION_FIELDS = [
  "Message",
  "MessageId",
  "SubscribeURL",
  "Timestamp",
  "Token",
  "TopicArn",
  "Type",
] as const;

export function snsStringToSign(message: SnsMessage): string | null {
  const fields =
    message.Type === "Notification"
      ? NOTIFICATION_FIELDS
      : message.Type === "SubscriptionConfirmation" ||
          message.Type === "UnsubscribeConfirmation"
        ? CONFIRMATION_FIELDS
        : null;
  if (!fields) return null;
  let out = "";
  for (const field of fields) {
    const value = message[field];
    if (value === undefined) {
      if (field === "Subject") continue;
      return null;
    }
    out += `${field}\n${value}\n`;
  }
  return out;
}

// The certificate must come from SNS itself, or an attacker could point the
// check at a certificate they control.
export function isAllowedSigningCertUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname) &&
    url.pathname.endsWith(".pem")
  );
}

interface DerElement {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
}

function readDer(bytes: Uint8Array, offset: number): DerElement {
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let headerLength = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count < 1 || count > 4) throw new Error("Unsupported DER length");
    length = 0;
    for (let i = 0; i < count; i++) {
      length = length * 256 + bytes[offset + 2 + i];
    }
    headerLength = 2 + count;
  }
  const contentStart = offset + headerLength;
  const end = contentStart + length;
  if (end > bytes.length) throw new Error("Truncated DER");
  return { tag, start: offset, contentStart, end };
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function spkiFromCertificatePem(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  const der = base64ToBytes(base64);

  const certificate = readDer(der, 0);
  const tbs = readDer(der, certificate.contentStart);
  let offset = tbs.contentStart;
  // [0] EXPLICIT version is present for v3 certificates.
  if (der[offset] === 0xa0) offset = readDer(der, offset).end;
  // serial, signature algorithm, issuer, validity, subject
  for (let i = 0; i < 5; i++) offset = readDer(der, offset).end;
  const spki = readDer(der, offset);
  if (spki.tag !== 0x30) throw new Error("Public key not found");
  return der.slice(spki.start, spki.end);
}

const certificateCache = new Map<string, Promise<string>>();

async function fetchCertificate(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Signing certificate not available");
  return response.text();
}

export async function verifySnsSignature(
  message: SnsMessage,
  loadCertificate: (url: string) => Promise<string> = (url) => {
    let cached = certificateCache.get(url);
    if (!cached) {
      cached = fetchCertificate(url);
      certificateCache.set(url, cached);
      // Do not keep a failed fetch.
      cached.catch(() => certificateCache.delete(url));
    }
    return cached;
  }
): Promise<boolean> {
  try {
    if (!message.Signature || !message.SigningCertURL) return false;
    if (!isAllowedSigningCertUrl(message.SigningCertURL)) return false;
    const hash =
      message.SignatureVersion === "1"
        ? "SHA-1"
        : message.SignatureVersion === "2"
          ? "SHA-256"
          : null;
    if (!hash) return false;
    const toSign = snsStringToSign(message);
    if (toSign === null) return false;

    const pem = await loadCertificate(message.SigningCertURL);
    const key = await crypto.subtle.importKey(
      "spki",
      spkiFromCertificatePem(pem),
      { name: "RSASSA-PKCS1-v1_5", hash },
      false,
      ["verify"]
    );
    const signature = base64ToBytes(message.Signature);
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      new TextEncoder().encode(toSign)
    );
  } catch {
    return false;
  }
}
