// A page POST that carries an uploaded file must come from this site. Astro's
// own checkOrigin stays on; this adds the two rules the older import pages
// lack: a missing Origin header is not enough on its own (it needs
// Sec-Fetch-Site: same-origin), and a present Origin must match exactly.
export function isSameOriginRequest(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === url.origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}
