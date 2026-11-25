/**
 * Associates an inline error element with a drawer input/textarea control and
 * clears that association when the field becomes valid or is edited.
 */
export function setDrawerFieldError(
  control: HTMLElement,
  errorEl: HTMLElement,
  message: string
): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
  control.setAttribute("aria-invalid", "true");
  if (!errorEl.id) return;
  const described = (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (!described.includes(errorEl.id)) {
    control.setAttribute(
      "aria-describedby",
      [...described, errorEl.id].join(" ")
    );
  }
}

export function clearDrawerFieldError(
  control: HTMLElement,
  errorEl: HTMLElement
): void {
  errorEl.textContent = "";
  errorEl.hidden = true;
  control.removeAttribute("aria-invalid");
  if (!errorEl.id) return;
  const remaining = (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter((id) => Boolean(id) && id !== errorEl.id);
  if (remaining.length > 0) {
    control.setAttribute("aria-describedby", remaining.join(" "));
  } else {
    control.removeAttribute("aria-describedby");
  }
}
