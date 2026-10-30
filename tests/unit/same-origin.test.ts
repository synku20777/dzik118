import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "../../src/lib/http/same-origin";

const url = new URL("https://app.namkopa.com/admin/o/x/migration/dwellings");
const request = (headers: Record<string, string>) =>
  new Request(url, { method: "POST", headers });

describe("isSameOriginRequest", () => {
  it("accepts a matching Origin", () => {
    expect(
      isSameOriginRequest(request({ origin: "https://app.namkopa.com" }), url)
    ).toBe(true);
  });

  it("refuses another or a null Origin", () => {
    expect(
      isSameOriginRequest(request({ origin: "https://evil.example" }), url)
    ).toBe(false);
    expect(isSameOriginRequest(request({ origin: "null" }), url)).toBe(false);
  });

  it("without Origin needs Sec-Fetch-Site: same-origin", () => {
    expect(
      isSameOriginRequest(request({ "sec-fetch-site": "same-origin" }), url)
    ).toBe(true);
    expect(
      isSameOriginRequest(request({ "sec-fetch-site": "cross-site" }), url)
    ).toBe(false);
    expect(isSameOriginRequest(request({}), url)).toBe(false);
  });
});
