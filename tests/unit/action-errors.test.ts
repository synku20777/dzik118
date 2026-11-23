import { isActionError, isInputError } from "astro:actions";
import { describe, expect, it, vi } from "vitest";
import { toActionError } from "../../src/actions/_errors";
import { ValidationError } from "../../src/domain/errors";

vi.mock("astro:actions", async () => {
  const client =
    await import("../../node_modules/astro/dist/actions/runtime/client.js");
  return {
    ActionError: client.ActionError,
    isActionError: client.isActionError,
    isInputError: client.isInputError,
  };
});

describe("toActionError", () => {
  it("maps ValidationError with a field onto an Astro ActionInputError with fields populated", () => {
    const err = new ValidationError(
      "This rule requires a unit price (it would otherwise always bill 0)",
      { field: "unitPrice" }
    );
    const mapped = toActionError(err);

    // Astro's isActionError() is false for ActionInputError (type differs), so
    // the input-error guard is the meaningful check here.
    expect(isInputError(mapped)).toBe(true);
    if (!isInputError(mapped)) {
      throw new Error("Expected ActionInputError");
    }
    expect(mapped.code).toBe("BAD_REQUEST");
    expect(mapped.fields.unitPrice).toEqual([
      "This rule requires a unit price (it would otherwise always bill 0)",
    ]);
  });

  it("maps ValidationError with multiple fields onto ActionInputError", () => {
    const err = new ValidationError("Multiple problems", {
      fields: {
        meterType: ["Meter type required"],
        dwellingIds: ["Select at least one dwelling"],
      },
    });
    const mapped = toActionError(err);

    expect(isInputError(mapped)).toBe(true);
    if (!isInputError(mapped)) {
      throw new Error("Expected ActionInputError");
    }
    expect(mapped.fields.meterType).toEqual(["Meter type required"]);
    expect(mapped.fields.dwellingIds).toEqual(["Select at least one dwelling"]);
  });

  it("maps plain ValidationError without fields onto a non-input BAD_REQUEST ActionError", () => {
    const err = new ValidationError(
      "A rule that applies to all dwellings cannot also have specific dwelling assignments"
    );
    const mapped = toActionError(err);

    expect(isActionError(mapped)).toBe(true);
    expect(isInputError(mapped)).toBe(false);
    expect(mapped.code).toBe("BAD_REQUEST");
    expect(mapped.message).toBe(err.message);
  });
});
