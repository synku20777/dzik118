import { bindResidentComposerShortcut } from "./resident-composer";

export function bindResidentSpecimen(root: HTMLElement): void {
  const reading = root.querySelector<HTMLFormElement>(
    "[data-resident-reading]"
  )!;
  const input = reading.querySelector<HTMLInputElement>(
    '[name="currentValue"]'
  )!;
  const card = reading.closest(".resident-meter")!;
  const warning = card.querySelector<HTMLElement>(
    "[data-sample-reading-error]"
  )!;
  const received = card.querySelector<HTMLElement>("[data-reading-received]")!;

  input.addEventListener("input", () => {
    warning.hidden = true;
    input.removeAttribute("aria-invalid");
    input.setAttribute("aria-describedby", "specimen-reading-help");
  });
  reading.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = Number(input.value.replace(",", "."));
    if (!Number.isFinite(value) || value < 124.1) {
      warning.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute(
        "aria-describedby",
        "specimen-reading-help specimen-reading-error"
      );
      input.focus();
      return;
    }
    received.querySelector("[data-reading-value]")!.textContent =
      new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value);
    reading.hidden = true;
    received.classList.add("resident-enter");
    received.hidden = false;
    received.focus();
  });

  const composer = root.querySelector<HTMLFormElement>("[data-chat-form]")!;
  const field = composer.querySelector<HTMLTextAreaElement>("textarea")!;
  bindResidentComposerShortcut(composer, field);
  const log = root.querySelector<HTMLElement>(".resident-chat-log")!;
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = field.value.trim();
    if (!body) return;
    const previous = log.querySelector<HTMLElement>(
      '.resident-chat-msg[data-from="me"]'
    )!;
    const message = previous.cloneNode(true) as HTMLElement;
    message.classList.add("resident-enter");
    const messages = previous.parentElement!;
    if (messages.lastElementChild?.getAttribute("data-from") === "me")
      message.querySelector(".resident-chat-author")?.remove();
    message.querySelector(".resident-chat-bubble")!.textContent = body;
    message.querySelector(".resident-chat-time")!.textContent =
      new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date());
    messages.appendChild(message);
    log.scrollTop = 0;
    field.value = "";
    field.focus();
  });
}
