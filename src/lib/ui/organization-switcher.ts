const CLOSE_FALLBACK_MS = 300;

export function bindOrganizationSwitcher(
  details: HTMLDetailsElement
): () => void {
  let closing = false;
  let cancelPending: (() => void) | null = null;
  // Closing plays the menu's exit animation first; the <details> only closes
  // when it ends. Without motion (or if it never ends) it closes at once.
  const close = () => {
    if (!details.open || closing) return;
    const menu =
      typeof window !== "undefined"
        ? details.querySelector(".organization-menu")
        : null;
    if (
      !menu ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      details.open = false;
      return;
    }
    closing = true;
    details.dataset.closing = "";
    // Whichever of the animation end and the fallback comes first finishes
    // the close and cancels the other, so a stale timer can never cut short a
    // later close (close, reopen, close again).
    let timer = 0;
    const stop = () => {
      window.clearTimeout(timer);
      menu.removeEventListener("animationend", finish);
      cancelPending = null;
    };
    const finish = () => {
      stop();
      closing = false;
      delete details.dataset.closing;
      details.open = false;
    };
    timer = window.setTimeout(finish, CLOSE_FALLBACK_MS);
    menu.addEventListener("animationend", finish);
    cancelPending = stop;
  };
  const click = (event: MouseEvent) => {
    const target = event.target;
    if (!details.contains(target as Node)) {
      close();
      return;
    }
    if (!(target instanceof Element)) return;
    if (target.closest("a")) {
      close();
    } else if (details.open && target.closest("summary")) {
      // The summary would toggle the <details> shut instantly.
      event.preventDefault();
      close();
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && details.open) {
      event.preventDefault();
      close();
      details.querySelector("summary")?.focus();
    }
  };
  document.addEventListener("click", click);
  document.addEventListener("keydown", keydown);
  return () => {
    cancelPending?.();
    document.removeEventListener("click", click);
    document.removeEventListener("keydown", keydown);
  };
}
