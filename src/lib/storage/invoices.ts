// Phase G (Invoices/delivery) - private invoice PDF storage (spec Section
// 3.4/22: private bucket, no public object URLs, preferred key layout
// invoices/{organizationId}/{year}/{month}/{invoiceId}/v1.pdf).
import type { createSupabaseAdminClient } from "../supabase/admin";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

const BUCKET = "invoices";

export function invoicePdfObjectKey(
  organizationId: string,
  year: number,
  month: number,
  invoiceId: string,
  version: number
): string {
  return `${organizationId}/${year}/${String(month).padStart(2, "0")}/${invoiceId}/v${version}.pdf`;
}

// Uploads (or overwrites, for a version bump while still DRAFT) the
// canonical PDF. Never made public -- callers must always go through an
// authenticated/token-checked download path (src/pages/invoice/access,
// the admin download route), never a direct bucket URL.
export async function uploadInvoicePdf(
  supabaseAdmin: SupabaseAdmin,
  objectKey: string,
  pdfBytes: Uint8Array
): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(objectKey, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) throw error;
}

export async function downloadInvoicePdf(
  supabaseAdmin: SupabaseAdmin,
  objectKey: string
): Promise<Blob> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(objectKey);
  if (error || !data) throw error ?? new Error("PDF not found in storage");
  return data;
}

function pdfBytesResponse(
  pdfBytes: BodyInit,
  invoiceNumber: string,
  filenameSuffix: string,
  extraHeaders?: Record<string, string>
): Response {
  const safeFilename =
    encodeURIComponent(invoiceNumber.replace(/[\r\n"]/g, "")) + filenameSuffix;
  return new Response(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFilename}.pdf"; filename*=UTF-8''${safeFilename}.pdf`,
      ...extraHeaders,
    },
  });
}

// Shared by every route that serves an invoice's canonical (Latvian)
// PDF -- admin, resident, and the public token-access download -- each
// only differs in how it authorizes and resolves the invoice beforehand.
// This is the one persisted artifact (invoices.pdf_object_key/pdf_sha256);
// it is never regenerated or overwritten once it exists (spec Section 21).
export async function invoicePdfResponse(
  supabaseAdmin: SupabaseAdmin,
  invoice: { pdfObjectKey: string | null; invoiceNumber: string },
  options: {
    notReadyMessage?: string;
    extraHeaders?: Record<string, string>;
  } = {}
): Promise<Response> {
  if (!invoice.pdfObjectKey) {
    return invoicePdfNotReadyResponse(options.notReadyMessage);
  }
  const pdf = await downloadInvoicePdf(supabaseAdmin, invoice.pdfObjectKey);
  return pdfBytesResponse(pdf, invoice.invoiceNumber, "", options.extraHeaders);
}

// Shared 404 for "no canonical PDF yet" -- also gates EN/RU on-demand
// copies (see invoiceCopyPdfResponse's callers), so a translated copy can
// never be downloaded before the invoice has actually been through the
// send pipeline at least once, matching every page's own "Download PDF"
// visibility condition (`invoice.pdfObjectKey`). Before that point,
// recipient/organization data may still be incomplete, so nothing renders
// a PDF in any language.
export function invoicePdfNotReadyResponse(message?: string): Response {
  return new Response(message ?? "PDF not generated yet", { status: 404 });
}

// EN/RU are optional derived COPIES of the same financial invoice's
// canonical (Latvian) content, generated fresh on every request -- never
// uploaded to storage, never touching pdf_object_key/pdf_sha256. There is
// deliberately no second persisted artifact per language: the canonical
// Latvian PDF stays the org's one stored/immutable file, and a translated
// copy is only ever a render of it, exactly like the HTML preview already
// is. The filename suffix keeps a saved copy from silently overwriting a
// previously downloaded canonical PDF of the same invoice.
export function invoiceCopyPdfResponse(
  pdfBytes: Uint8Array,
  invoiceNumber: string,
  locale: "en" | "ru",
  extraHeaders?: Record<string, string>
): Response {
  // Uint8Array<ArrayBufferLike> (renderPdf's return type) vs the DOM lib's
  // BodyInit-compatible Uint8Array<ArrayBuffer> is a structural TS typing
  // mismatch, not a real runtime one -- both are plain byte arrays.
  return pdfBytesResponse(
    pdfBytes as BodyInit,
    invoiceNumber,
    `-${locale}`,
    extraHeaders
  );
}
