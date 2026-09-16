// Phase G (Invoices/delivery) - EPC069-12 v3.1 "EPC QR Code" payload for
// SEPA Credit Transfer initiation, rendered inline in the mandatory
// Payment block (invoice-html.ts). Scanning it with a compatible banking
// app prefills a transfer -- it never initiates one itself.
//
// Every input here comes from the exact same invoice/payment snapshot the
// adjacent human-readable payment text already prints (issuer name, IBAN,
// BIC, invoice.amountDue, invoice.invoiceNumber) -- there is no separate,
// independently editable "QR payment details" model, so the two can never
// disagree.
import qrcode from "qrcode-generator";
import { ValidationError } from "../errors";

// The library's default byte-encoder (qrcode.stringToBytes) keeps only the
// low 8 bits of every UTF-16 code unit -- NOT UTF-8 -- so any Latvian
// diacritic (the remittance text is always "Rēķins ...") would be encoded
// as garbage even though EPC069-12 field 3 below declares character set
// "1" (UTF-8). This override is global on the imported module object (the
// library keeps no per-call encoding option), applied once here rather
// than per-call, and makes every `addData` call in this process actually
// encode UTF-8, matching both our own byte-length validation (TextEncoder,
// below) and the field-3 declaration.
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));

// ISO 13616 / SWIFT IBAN registry lengths for every SEPA/EEA country (plus
// the European microstates that also issue IBANs) an organization using
// this app could realistically hold an account in. An unlisted country
// code is REJECTED outright, not skip-checked -- a checksum-valid string
// from an unrecognized/unassigned country (e.g. "ZZ00O") is not an actual
// IBAN.
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28,
  IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  VA: 22,
}; // prettier-ignore

function isValidIban(iban: string): boolean {
  // Two-letter ISO country code, two checksum digits, then the BBAN --
  // not just "any 4-34 alphanumeric characters", which would let a
  // non-IBAN-shaped string (e.g. "0001") slip through on checksum alone.
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(iban)) return false;
  const expectedLength = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expectedLength === undefined || iban.length !== expectedLength) {
    return false;
  }
  // Mod-97 checksum (ISO 7064 MOD 97-10): move the first 4 characters to
  // the end, convert letters to numbers (A=10..Z=35), the numeric result
  // mod 97 must equal 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : Number(ch);
    for (const digit of String(value)) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function isValidBic(bic: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
}

// Full C0/C1 control range, not just CR/LF/NUL -- a stray tab or other
// control character is still not valid "an"-type field content.
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/;

function assertPrintable(value: string, fieldName: string): void {
  if (CONTROL_CHARS.test(value)) {
    throw new ValidationError(
      `${fieldName} must not contain line breaks or control characters`
    );
  }
}

// EPC069-12 amount field: EUR-only, "EUR" + up to 12 numeric characters,
// range 0.01-999999999.99. Validated as a string (no floating point) since
// this app's amounts are always already-rounded 2-decimal strings
// (lib/decimal2.ts) -- this is deliberately narrower than every amount
// shape EPC069-12 itself permits (e.g. "EUR12.3"), not a general-purpose
// EPC amount parser.
function validateAmountDue(amountDue: string): string | null {
  if (!/^\d{1,9}\.\d{2}$/.test(amountDue)) return null;
  if (amountDue === "0.00") return null;
  return amountDue;
}

export interface SepaQrInput {
  beneficiaryName: string;
  iban: string;
  bic: string | null;
  currency: string;
  amountDue: string; // e.g. "123.45"
  invoiceNumber: string;
}

// Strict builder: throws ValidationError on any invalid or inapplicable
// input. Used directly by tests, and by the non-throwing renderer wrapper
// below (which is what invoice-html.ts actually calls).
export function buildSepaQrPayload(input: SepaQrInput): string {
  if (input.currency !== "EUR") {
    throw new ValidationError("SEPA QR codes are EUR-only");
  }
  if (!input.bic) {
    throw new ValidationError("A BIC is required to generate a SEPA QR code");
  }
  const bic = input.bic.replace(/\s+/g, "").toUpperCase();
  if (!isValidBic(bic)) {
    throw new ValidationError("Invalid BIC");
  }
  const iban = input.iban.replace(/\s+/g, "").toUpperCase();
  if (!isValidIban(iban)) {
    throw new ValidationError("Invalid IBAN");
  }
  const amountDue = validateAmountDue(input.amountDue);
  if (!amountDue) {
    throw new ValidationError(
      "Amount is out of the SEPA QR's representable range"
    );
  }

  const beneficiaryName = input.beneficiaryName.trim();
  if (!beneficiaryName) {
    throw new ValidationError("A beneficiary name is required");
  }
  // Rejected, never truncated -- truncating would make the QR pay a
  // beneficiary name that no longer matches the one printed in the
  // adjacent human-readable payment text.
  if (beneficiaryName.length > 70) {
    throw new ValidationError(
      "Beneficiary name exceeds the SEPA QR's 70-character limit"
    );
  }
  assertPrintable(beneficiaryName, "Beneficiary name");

  // Never truncated -- if this app ever generated an invoice number long
  // enough to blow the 140-char remittance field, surfacing an error here
  // is correct: silently truncating would make the QR pay a *different*
  // reference than the printed invoice number.
  const remittance = `Rēķins ${input.invoiceNumber}`;
  if (remittance.length > 140) {
    throw new ValidationError(
      "Remittance information exceeds the SEPA QR's 140-character limit"
    );
  }
  assertPrintable(remittance, "Remittance information");

  const fields = [
    "BCD",
    "002",
    "1",
    "SCT",
    bic,
    beneficiaryName,
    iban,
    `EUR${amountDue}`,
    "", // Purpose
    "", // Structured remittance reference -- always blank; never populated
    // alongside the unstructured field below.
    remittance,
    "", // Beneficiary-to-originator information
  ];
  // EPC069-12: no separator after the last populated element -- trailing
  // empty fields are omitted entirely rather than left as blank lines.
  while (fields.length > 0 && fields[fields.length - 1] === "") {
    fields.pop();
  }
  const payload = fields.join("\n");
  if (new TextEncoder().encode(payload).length > 331) {
    throw new ValidationError("SEPA QR payload exceeds the 331-byte limit");
  }
  return payload;
}

// EPC069-12 caps the QR at version 13 (69x69 modules); a payload needing
// more than that already violates the spec's own size limit.
const MAX_MODULE_COUNT = 69;

// The renderer's own entry point: never throws. A historical invoice with
// incomplete/malformed payment data, a zero-due invoice (EPC requires a
// minimum of EUR 0.01 -- it cannot represent "nothing owed"), or a
// non-EUR invoice all simply render without a QR; the adjacent
// human-readable payment section is unaffected either way.
export function tryBuildSepaQrSvg(input: SepaQrInput): string | null {
  // Everything -- payload validation AND the QR library calls below -- is
  // inside this one try/catch. An error from qrcode-generator itself
  // (addData/make/createSvgTag) must degrade the same way an invalid
  // payload does: no QR, never a broken render.
  try {
    const payload = buildSepaQrPayload(input);
    const qr = qrcode(0, "M");
    qr.addData(payload);
    qr.make();
    if (qr.getModuleCount() > MAX_MODULE_COUNT) return null;
    // margin: 16 = cellSize * 4, the library's own default proportion --
    // a quiet zone of 4 modules, the minimum for reliable scanning.
    // scalable: true suppresses the library's own pixel width/height
    // attributes so the width/height we inject below don't duplicate them.
    return qr
      .createSvgTag({ cellSize: 4, margin: 16, scalable: true })
      .replace("<svg ", '<svg width="30mm" height="30mm" ');
  } catch {
    return null;
  }
}
