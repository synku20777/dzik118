import { describe, expect, it } from "vitest";
import { readClearableTextFields } from "../../src/actions/_clearable-fields";

function createFormRequest(entries: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.append(key, value);
  }
  return new Request("http://localhost/action", {
    method: "POST",
    body: formData,
  });
}

describe("readClearableTextFields", () => {
  it("returns undefined when key is genuinely absent from FormData", async () => {
    const request = createFormRequest({ otherField: "value" });
    const result = await readClearableTextFields(request, [
      "missingField",
    ] as const);

    expect(result.missingField).toBeUndefined();
  });

  it("returns null when key is present but blank (empty string)", async () => {
    const request = createFormRequest({ billingName: "" });
    const result = await readClearableTextFields(request, [
      "billingName",
    ] as const);

    expect(result.billingName).toBeNull();
  });

  it("returns null when key is present but whitespace-only", async () => {
    const request = createFormRequest({ billingName: "   \t \n  " });
    const result = await readClearableTextFields(request, [
      "billingName",
    ] as const);

    expect(result.billingName).toBeNull();
  });

  it("returns trimmed string when key is present with a value", async () => {
    const request = createFormRequest({ billingName: "  Acme Corp  " });
    const result = await readClearableTextFields(request, [
      "billingName",
    ] as const);

    expect(result.billingName).toBe("Acme Corp");
  });

  it("handles multiple keys with mixed states in a single request", async () => {
    const request = createFormRequest({
      blank: "",
      whitespace: "   ",
      trimmed: "  valid text  ",
      normal: "hello",
    });

    const result = await readClearableTextFields(request, [
      "absent",
      "blank",
      "whitespace",
      "trimmed",
      "normal",
    ] as const);

    expect(result).toEqual({
      absent: undefined,
      blank: null,
      whitespace: null,
      trimmed: "valid text",
      normal: "hello",
    });
  });

  it("does not prevent subsequent request.clone() calls", async () => {
    const request = createFormRequest({ field: "value" });
    await readClearableTextFields(request, ["field"] as const);

    const secondClone = await request.clone().formData();
    expect(secondClone.get("field")).toBe("value");
  });
});
