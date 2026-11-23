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
  action: undefined as
    | { calledFrom: string; name: string; handler: () => Promise<unknown> }
    | undefined,
  cookie: undefined as string | undefined,
  cookieSets: [] as { name: string; value: string; options: unknown }[],
  cookieDeletes: [] as { name: string; options: unknown }[],
  results: [] as [string, unknown][],
}));

vi.mock("astro:actions", () => ({
  getActionContext: () => ({
    action: state.action,
    setActionResult: (name: string, result: unknown) =>
      state.results.push([name, result]),
    serializeActionResult: (result: unknown) => result,
  }),
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
  origin = "https://app.example.test",
  method = "GET"
): Promise<Response> {
  const url = new URL(path, origin);
  const context = {
    request: new Request(url, { method }),
    url,
    cookies: {
      has: () => true,
      get: (name: string) =>
        name === "action_result" && state.cookie
          ? { json: () => JSON.parse(state.cookie!) }
          : undefined,
      set: (name: string, value: string, options: unknown) =>
        state.cookieSets.push({ name, value, options }),
      delete: (name: string, options: unknown) =>
        state.cookieDeletes.push({ name, options }),
    },
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
  state.action = undefined;
  state.cookie = undefined;
  state.cookieSets = [];
  state.cookieDeletes = [];
  state.results = [];
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

  it("refuses an organization or dwelling the user has no access to", async () => {
    await signedIn(admin);
    expect(
      (await visit("/admin/o/org-2/dwellings")).headers.get("Location")
    ).toBe("/unauthorized");
    const api = await visit("/api/v1/admin/o/org-2/dwellings/export");
    expect(api.status).toBe(403);
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe(
      "FORBIDDEN"
    );
    expect(await (await visit("/admin/o/org-1/dwellings")).text()).toBe("page");
    expect(
      await (await visit("/api/v1/admin/o/org-1/dwellings/export")).text()
    ).toBe("page");

    await signedIn(resident);
    expect(
      (await visit("/portal/dwellings/dw-2/invoices")).headers.get("Location")
    ).toBe("/unauthorized");
    expect(await (await visit("/portal/dwellings/dw-1/invoices")).text()).toBe(
      "page"
    );
  });

  it("refuses the admin API to a visitor with no session", async () => {
    expect((await visit("/api/v1/admin/o/org-1/audit/export")).status).toBe(
      403
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

  it("redirects after a successful form action and carries the result", async () => {
    await signedIn(admin);
    const data = { type: "data", body: "{}" };
    state.action = {
      calledFrom: "form",
      name: "meters.create",
      handler: async () => data,
    };
    const post = await visit(
      "/admin/o/org-1/dwellings?tab=meters&_action=meters.create",
      undefined,
      "POST"
    );
    expect(post.status).toBe(303);
    expect(post.headers.get("Location")).toBe(
      "/admin/o/org-1/dwellings?tab=meters"
    );
    expect(state.cookieSets).toEqual([
      {
        name: "action_result",
        value: JSON.stringify({
          name: "meters.create",
          path: "/admin/o/org-1/dwellings",
          result: data,
        }),
        options: expect.objectContaining({
          path: "/admin/o/org-1/dwellings",
          httpOnly: true,
        }),
      },
    ]);

    state.action = undefined;
    state.cookie = state.cookieSets[0].value;
    const get = await visit("/admin/o/org-1/dwellings?tab=meters");
    expect(await get.text()).toBe("page");
    expect(state.results).toEqual([["meters.create", data]]);
    expect(state.cookieDeletes).toEqual([
      { name: "action_result", options: { path: "/admin/o/org-1/dwellings" } },
    ]);
  });

  it("restores a stored result only on its own page and only a success", async () => {
    await signedIn(admin);
    const data = { type: "data", body: "{}" };
    const path = "/admin/o/org-1/dwellings";
    state.cookie = JSON.stringify({
      name: "meters.create",
      path,
      result: data,
    });
    await visit(`${path}/dw-1`);
    expect(state.results).toEqual([]);
    expect(state.cookieDeletes).toEqual([]);

    state.cookie = JSON.stringify({
      name: "meters.create",
      path,
      result: { type: "error", body: "planted" },
    });
    await visit(path);
    expect(state.results).toEqual([]);
  });

  it("renders a failed form action in place", async () => {
    await signedIn(admin);
    const error = { type: "error", body: "{}" };
    state.action = {
      calledFrom: "form",
      name: "meters.create",
      handler: async () => error,
    };
    const post = await visit(
      "/admin/o/org-1/dwellings?_action=meters.create",
      undefined,
      "POST"
    );
    expect(await post.text()).toBe("page");
    expect(state.cookieSets).toEqual([]);
    expect(state.results).toEqual([["meters.create", error]]);
  });

  it("still redirects after an oversized success, without the result", async () => {
    await signedIn(admin);
    const big = { type: "data", body: "x".repeat(4000) };
    state.action = {
      calledFrom: "form",
      name: "meters.create",
      handler: async () => big,
    };
    const post = await visit(
      "/admin/o/org-1/dwellings?_action=meters.create",
      undefined,
      "POST"
    );
    expect(post.status).toBe(303);
    expect(state.cookieSets).toEqual([]);
    expect(state.results).toEqual([]);
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
