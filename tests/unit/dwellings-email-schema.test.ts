import { describe, expect, it } from "vitest";
import { z } from "astro/zod";
import { trimmedEmailOrNull } from "../../src/actions/_clearable-fields";

describe("trimmedEmailOrNull", () => {
  it("trims a padded value", () => {
    expect(trimmedEmailOrNull("  test@example.com  ")).toBe("test@example.com");
  });

  it("turns blank into null", () => {
    expect(trimmedEmailOrNull("")).toBeNull();
  });

  it("turns whitespace-only into null", () => {
    expect(trimmedEmailOrNull("   \t \n  ")).toBeNull();
  });

  it("leaves non-string values (e.g. undefined) untouched", () => {
    expect(trimmedEmailOrNull(undefined)).toBeUndefined();
  });
});

// Mirrors the exact billingEmail field shape in dwellings.ts's update action
// schema, to prove trimming happens before z.email() validation runs.
const billingEmailSchema = z
  .preprocess(trimmedEmailOrNull, z.email().max(320).nullable())
  .optional();

describe("update action's billingEmail schema", () => {
  it("accepts a blank value as null", () => {
    const result = billingEmailSchema.safeParse("");
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it("accepts a whitespace-only value as null", () => {
    const result = billingEmailSchema.safeParse("   ");
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it("trims and accepts a padded valid email", () => {
    const result = billingEmailSchema.safeParse("  test@example.com  ");
    expect(result.success).toBe(true);
    expect(result.data).toBe("test@example.com");
  });

  it("rejects invalid nonblank email text", () => {
    const result = billingEmailSchema.safeParse("not-an-email");
    expect(result.success).toBe(false);
  });

  it("leaves an absent field as undefined", () => {
    const result = billingEmailSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });
});
