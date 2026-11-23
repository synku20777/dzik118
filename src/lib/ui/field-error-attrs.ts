import { isInputError } from "astro:actions";

export interface FieldErrorAttrsOptions {
  errorId?: string;
  describedBy?: string;
}

/**
 * Returns accessibility attributes linking an SSR form control to its
 * rendered `<FieldError>` when validation fails, without leaving dangling
 * `aria-describedby` IDs on valid initial renders (with or without JS).
 */
export function fieldErrorAttrs(
  error: unknown,
  name: string,
  options: FieldErrorAttrsOptions = {}
): Record<string, string> {
  const messages = isInputError(error) ? error.fields[name] : undefined;
  const hasError = Array.isArray(messages) && messages.length > 0;
  const errorId = options.errorId ?? `${name}-error`;
  const baseIds = (options.describedBy ?? "").split(/\s+/).filter(Boolean);

  if (!hasError) {
    return baseIds.length > 0 ? { "aria-describedby": baseIds.join(" ") } : {};
  }

  const ids = baseIds.includes(errorId) ? baseIds : [...baseIds, errorId];
  return {
    "aria-invalid": "true",
    "aria-describedby": ids.join(" "),
  };
}
