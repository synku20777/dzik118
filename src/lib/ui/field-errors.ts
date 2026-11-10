import { onPageLoad } from "./page-lifecycle";

/**
 * Connects every rendered field error (`.field-error`, id "<control>-error")
 * to its control: aria-invalid plus aria-describedby. FieldError cannot do
 * this itself because the control is rendered by the page. Returns the
 * controls that were marked, in document order.
 */
export function linkFieldErrors(root: ParentNode = document): HTMLElement[] {
  const fields: HTMLElement[] = [];
  for (const error of root.querySelectorAll<HTMLElement>(
    '.field-error[id$="-error"]'
  )) {
    const base = error.id.slice(0, -"-error".length);
    const control =
      document.getElementById(base) ??
      document.getElementById(`meter-${base}`) ??
      error.closest("form")?.querySelector<HTMLElement>(`[name="${base}"]`);
    if (!control) continue;
    control.setAttribute("aria-invalid", "true");
    const described = (control.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    if (!described.includes(error.id)) {
      control.setAttribute(
        "aria-describedby",
        [...described, error.id].join(" ")
      );
    }
    fields.push(control);
  }
  return fields;
}

onPageLoad(() => {
  linkFieldErrors();
});
