// Phase D (Organizations/dwellings) - shared helper for action handlers
// that need to distinguish between an absent form field (leave column unchanged)
// and a blank/whitespace form field (clear column to SQL NULL).
//
// Astro's handleFormDataGet collapses both missing keys and blank values to
// undefined whenever an input schema field is wrapped in ZodOptional (e.g.
// .nullable().optional()). This helper reads the raw cloned FormData to recover
// that distinction.

export async function readClearableTextFields<K extends string>(
  request: Request,
  keys: readonly K[]
): Promise<Record<K, string | null | undefined>> {
  const formData = await request.clone().formData();
  const result = {} as Record<K, string | null | undefined>;

  for (const key of keys) {
    if (!formData.has(key)) {
      result[key] = undefined;
    } else {
      const raw = formData.get(key);
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        result[key] = trimmed === "" ? null : trimmed;
      } else {
        result[key] = null;
      }
    }
  }

  return result;
}

// Astro validates a field's raw, untrimmed FormData value (via z.email() etc.)
// before the handler ever runs -- see readClearableTextFields above -- so a
// whitespace-only or padded email would fail validation before
// readClearableTextFields gets a chance to normalize it. Wrapping the
// z.email() schema in z.preprocess(trimmedEmailOrNull, ...) moves the
// trim/blank-to-null normalization before validation runs, without changing
// what readClearableTextFields itself does for the actual DB write.
export function trimmedEmailOrNull(value: unknown): unknown {
  return typeof value === "string" ? value.trim() || null : value;
}
