// Phase G (Invoices/delivery) - PDF rendering via Cloudflare Browser
// Rendering (spec Section 3.4/3.5/22: "Cloudflare Browser Run /pdf").
//
// NOT verified end-to-end in this local dev environment: `wrangler dev`
// downloads a local Chromium for this binding, but the DevTools protocol
// connection between the Workers sandbox and that spawned browser times
// out here (confirmed via a throwaway debug route -- the browser process
// itself does launch, per Task Manager, so this looks like a
// sandbox/networking restriction of this specific environment, not a
// code defect). Confirmed further: merely declaring the "browser" binding
// in wrangler.jsonc makes wrangler dev hang on EVERY request, including
// ones that never touch this file -- removing the binding entirely made
// the plain "/" route respond in ~100ms again. This function's OTHER
// callers (ensureCanonicalPdf's PDF-bytes-in/PDF-bytes-out contract) are
// exercised via a stub in tests/integration/invoice-delivery.test.ts. The
// call below matches Cloudflare's documented API exactly; it should be
// re-verified against a real `wrangler dev --remote` session or an actual
// deployment before relying on it in production.
import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";

export async function renderPdf(
  browserBinding: BrowserWorker,
  html: string
): Promise<Uint8Array> {
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    // setContent, not goto(): the HTML is already fully inline (spec
    // Section 22: "do not render arbitrary user-provided remote URLs"),
    // so there is no URL to navigate to and nothing external to fetch.
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "a4", printBackground: true });
    return pdf;
  } finally {
    await browser.close();
  }
}
