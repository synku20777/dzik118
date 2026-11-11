// The middleware is the one gate in front of every admin and resident
// request. These tests pin its decisions; they do not test Supabase or the
// database, which are replaced below.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  auth: null as {
    organizationIds: string[];
    dwellingIds: string[];
    closedDwellingCount: number;
  } | null,
  aal: "aal1",
  requireAal2: false,
}));

vi.mock("astro:middleware", () => ({
  defineMiddleware: (handler: unknown) => handler,
}));
vi.mock("cloudflare:workers", () => ({
  env: { HYPERDRIVE: { connectionString: "postgres://test" } },
  tracing: { enterSpan: (_name: string, run: () => unknown) => run() },
}));
vi.mock("astro:env/server", () => ({
  get ADMIN_REQUIRE_AAL2() {
    return state.requireAal2;
  },
  APP_BASE_URL: "https://app.example.test",
  AUDIT_HASH_SECRET: "test-secret",
}));
vi.mock("../../src/db/client", () => ({
  createDb: async () => ({ $client: { end: async () => {} } }),
}));
vi.mock("../../src/domain/authorization/context", () => ({
  loadAuthContext: async () => state.auth,
}));
vi.mock("../../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: state.user } }),
        mfa: {
          getAuthenticatorAssuranceLevel: async () => ({
            data: { currentLevel: state.aal },
          }),
        },
      },
    },
    applyPendingHeaders: (response: Response) => response,
  }),
}));

import { onRequest } from "../../src/middleware";

const admin = {
  organizationIds: ["org-1"],
  dwellingIds: [],
  closedDwellingCount: 0,
};
const resident = {
  organizationIds: [],
  dwellingIds: ["dw-1"],
  closedDwellingCount: 0,
};

function visit(
  path: string,
  origin = "https://app.example.test"
): Promise<Response> {
  const url = new URL(path, origin);
  const context = {
    request: new Request(url),
    url,
    cookies: { has: () => true, set: () => {} },
    locals: { cfContext: { waitUntil: () => {} } },
    redirect: (to: string, status = 302) =>
      new Response(null, { status, headers: { Location: to } }),
  };
  return onRequest(
    context as never,
    (async () => new Response("page")) as never
  ) as Promise<Response>;
}

async function signedIn(auth: typeof state.auth) {
  state.user = { id: "user-1", email: "a@example.test" };
  state.auth = auth;
}

beforeEach(() => {
  state.user = null;
  state.auth = null;
  state.aal = "aal1";
  state.requireAal2 = false;
});

describe("middleware", () => {
  it("lets a public page through and sets the security headers", async () => {
    const response = await visit("/login");
    expect(await response.text()).toBe("page");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(response.headers.get("Strict-Transport-Security")).toBeTruthy();
  });

  it("sends a visitor with no session to the login page", async () => {
    for (const path of ["/admin/organizations", "/portal/dwellings"]) {
      expect((await visit(path)).headers.get("Location")).toBe("/login");
    }
  });

  it("tells a signed-in user with no app account apart from a visitor", async () => {
    await signedIn(null);
    expect((await visit("/admin/organizations")).headers.get("Location")).toBe(
      "/login?error=2"
    );
  });

  it("keeps a resident out of the admin area and an admin out of the portal", async () => {
    await signedIn(resident);
    expect((await visit("/admin/organizations")).headers.get("Location")).toBe(
      "/unauthorized"
    );
    await signedIn(admin);
    expect((await visit("/portal/dwellings")).headers.get("Location")).toBe(
      "/unauthorized"
    );
  });

  it("tells a resident of an archived organization why", async () => {
    await signedIn({ ...resident, dwellingIds: [], closedDwellingCount: 2 });
    expect((await visit("/portal/dwellings")).headers.get("Location")).toBe(
      "/closed"
    );
  });

  it("lets an admin and a resident into their own area", async () => {
    await signedIn(admin);
    expect(await (await visit("/admin/organizations")).text()).toBe("page");
    await signedIn(resident);
    expect(await (await visit("/portal/dwellings")).text()).toBe("page");
  });

  it("asks for the second factor on pages, actions and the admin API", async () => {
    state.requireAal2 = true;
    await signedIn(admin);
    for (const path of [
      "/admin/organizations",
      "/_actions/periods.create",
      "/api/v1/admin/o/org-1/dwellings/export",
    ]) {
      expect((await visit(path)).headers.get("Location")).toBe(
        "/unauthorized?reason=mfa"
      );
    }
    state.aal = "aal2";
    expect(await (await visit("/admin/organizations")).text()).toBe("page");
  });

  it("does not ask a resident for a second factor", async () => {
    state.requireAal2 = true;
    await signedIn(resident);
    expect(await (await visit("/portal/dwellings")).text()).toBe("page");
  });

  it("moves the workers.dev address to the real one", async () => {
    const response = await visit(
      "/login?x=1",
      "https://property-billing.nestor-kulik.workers.dev"
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(
      "https://app.example.test/login?x=1"
    );
  });
});
