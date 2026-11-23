import { ActionError, isActionError, isInputError } from "astro:actions";
import { describe, expect, it, vi } from "vitest";
import { fieldErrorAttrs } from "../../src/lib/ui/field-error-attrs";

vi.mock("astro:actions", async () => {
  const client =
    await import("../../node_modules/astro/dist/actions/runtime/client.js");
  return {
    ActionError: client.ActionError,
    isActionError: client.isActionError,
    isInputError: client.isInputError,
  };
});

describe("fieldErrorAttrs", () => {
  it("returns no ARIA error attributes when error is absent or unrelated to the field", () => {
    expect(fieldErrorAttrs(undefined, "year")).toEqual({});

    const inputError = ActionError.fromJson({
      type: "AstroActionInputError",
      issues: [{ code: "custom", path: ["month"], message: "Invalid month" }],
    });
    expect(fieldErrorAttrs(inputError, "year")).toEqual({});
  });

  it("preserves hint aria-describedby IDs when valid and appends errorId when invalid", () => {
    expect(
      fieldErrorAttrs(undefined, "reference", {
        errorId: "manual-reference-error",
        describedBy: "manual-reference-hint",
      })
    ).toEqual({
      "aria-describedby": "manual-reference-hint",
    });

    const inputError = ActionError.fromJson({
      type: "AstroActionInputError",
      issues: [
        { code: "custom", path: ["reference"], message: "Reference required" },
      ],
    });
    expect(
      fieldErrorAttrs(inputError, "reference", {
        errorId: "manual-reference-error",
        describedBy: "manual-reference-hint",
      })
    ).toEqual({
      "aria-invalid": "true",
      "aria-describedby": "manual-reference-hint manual-reference-error",
    });
  });

  it("defaults errorId to <name>-error and deduplicates matching describedBy IDs", () => {
    const inputError = ActionError.fromJson({
      type: "AstroActionInputError",
      issues: [{ code: "custom", path: ["unitPrice"], message: "Bad price" }],
    });
    expect(
      fieldErrorAttrs(inputError, "unitPrice", {
        describedBy: "unitPrice-error",
      })
    ).toEqual({
      "aria-invalid": "true",
      "aria-describedby": "unitPrice-error",
    });
  });

  it("ignores non-input ActionError objects", () => {
    const plainError = new ActionError({
      code: "BAD_REQUEST",
      message: "Period is locked",
    });
    expect(isActionError(plainError)).toBe(true);
    expect(isInputError(plainError)).toBe(false);
    expect(fieldErrorAttrs(plainError, "year")).toEqual({});
  });
});
