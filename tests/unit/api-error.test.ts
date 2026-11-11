import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  rethrowUnexpected,
  skipKind,
} from "../../src/domain/errors";
import { toApiErrorResponse } from "../../src/lib/http/api-error";
import { runWithRequestContext } from "../../src/lib/logging/request-context";

afterEach(() => vi.restoreAllMocks());

async function body(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string };
  };
}

describe("toApiErrorResponse", () => {
  it("answers invalid input with 400 and a conflict with 409", async () => {
    const invalid = toApiErrorResponse(new ValidationError("Bad period"));
    expect(invalid.status).toBe(400);
    expect((await body(invalid)).error.message).toBe("Bad period");

    const conflict = toApiErrorResponse(new ConflictError("Period is locked"));
    expect(conflict.status).toBe(409);
    expect((await body(conflict)).error.code).toBe("CONFLICT");
  });

  it("reports the request ID of the request, not a new one", async () => {
    const response = runWithRequestContext(
      { requestId: "req_known", ipHash: null },
      () => toApiErrorResponse(new ForbiddenError())
    );
    expect(await response.json()).toMatchObject({
      error: { requestId: "req_known" },
    });
  });

  it("keeps 403 for no access and for a missing resource", () => {
    expect(toApiErrorResponse(new ForbiddenError()).status).toBe(403);
    expect(toApiErrorResponse(new NotFoundError("x")).status).toBe(403);
  });

  it("logs an unexpected error and hides its text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = toApiErrorResponse(new Error("select secret from t"));
    expect(response.status).toBe(500);
    expect((await body(response)).error.message).not.toContain("secret");
    expect(log).toHaveBeenCalledOnce();
  });
});

describe("rethrowUnexpected", () => {
  it("returns for a domain error and throws the rest without parameters", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => rethrowUnexpected(new NotFoundError("x"))).not.toThrow();
    expect(() =>
      rethrowUnexpected(new Error("Failed query: select 1\nparams: a@b.com"))
    ).toThrow("Failed query: select 1");
  });
});

describe("skipKind", () => {
  it("separates data to fix, routine skips and failures", () => {
    expect(skipKind(new ValidationError("x"))).toBe("NEEDS_ATTENTION");
    expect(skipKind(new ConflictError("x"))).toBe("ROUTINE");
    expect(skipKind(new Error("x"))).toBe("FAILED");
  });
});
