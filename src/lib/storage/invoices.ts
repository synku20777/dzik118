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

// Shared by every route that serves an invoice's canonical PDF (admin,
// resident, and the public token-access download) -- each only differs in
// how it authorizes and resolves the invoice beforehand.
export async function invoicePdfResponse(
  supabaseAdmin: SupabaseAdmin,
  invoice: { pdfObjectKey: string | null; invoiceNumber: string },
  options: {
    notReadyMessage?: string;
    extraHeaders?: Record<string, string>;
  } = {}
): Promise<Response> {
  if (!invoice.pdfObjectKey) {
    return new Response(options.notReadyMessage ?? "PDF not generated yet", {
      status: 404,
    });
  }
  const pdf = await downloadInvoicePdf(supabaseAdmin, invoice.pdfObjectKey);
  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      ...options.extraHeaders,
    },
  });
}
