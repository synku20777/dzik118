import assert from "node:assert/strict";

const app = "https://app.namkopa.com";
const legacy = "https://property-billing.nestor-kulik.workers.dev";
for (const path of [
  "/",
  "/login",
  "/auth/confirm?token_hash=domain-smoke&type=email",
]) {
  const response = await fetch(legacy + path, { redirect: "manual" });
  assert.equal(response.status, 308, `Legacy redirect failed for ${path}`);
  assert.equal(response.headers.get("location"), app + path);
}
for (const path of ["/", "/login", "/api/health"]) {
  const response = await fetch(app + path, { redirect: "manual" });
  assert.equal(response.status, 200, `App request failed for ${path}`);
  if (path === "/api/health")
    assert.equal((await response.json()).status, "ok");
}
console.log("App domain, database health, and legacy redirects passed.");
