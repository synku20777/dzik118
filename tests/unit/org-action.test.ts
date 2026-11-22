// orgAction is the guard in front of every organization action.
import { describe, expect, it, vi } from "vitest";

vi.mock("astro:actions", () => ({
  defineAction: (config: unknown) => config,
  ActionError: class extends Error {
    code: string;
    constructor({ code, message }: { code: string; message: string }) {
      super(message);
      this.code = code;
    }
  },
}));

import { z } from "astro/zod";
import { orgAction } from "../../src/actions/_org-action";

type Handler = (input: unknown, context: unknown) => Promise<unknown>;

function call(action: unknown, auth: unknown) {
  return (action as { handler: Handler }).handler(
    { organizationId: "org-1" },
    { locals: { auth } }
  );
}

const input = z.object({ organizationId: z.string() });
const active = { organizationIds: ["org-1"], archivedOrganizationIds: [] };
const archived = {
  organizationIds: ["org-1"],
  archivedOrganizationIds: ["org-1"],
};

describe("orgAction", () => {
  it("runs the handler for an admin of an active organization", async () => {
    const action = orgAction({ input, handler: async () => "ran" });
    expect(await call(action, active)).toBe("ran");
  });

  it("refuses a user outside the organization and an archived organization", async () => {
    const handler = vi.fn(async () => "ran");
    const action = orgAction({ input, handler });
    await expect(call(action, null)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      call(action, { organizationIds: ["org-2"], archivedOrganizationIds: [] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call(action, archived)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("allowArchived still requires access but lets an archived organization through", async () => {
    const action = orgAction({
      input,
      allowArchived: true,
      handler: async () => "ran",
    });
    expect(await call(action, archived)).toBe("ran");
    await expect(call(action, null)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
