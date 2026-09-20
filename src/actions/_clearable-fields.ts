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
