// One shared tooltip for the whole app. It shows only where the interface has
// no visible words for something: icon-only buttons (their aria-label), text
// that is cut off (data-tip-clipped), and short codes or one-line explanations
// (data-tip). Controls with a visible label do not get one.
//
// It is a single element in the top layer (popover="manual"), so it also
// shows above dialogs and the mobile drawer, and is never clipped by an
// overflow: hidden ancestor. Mouse and keyboard focus only: touch has no hover.

const SHOW_DELAY = 400;
// After one tooltip, the next one in this window shows at once, so moving along
// a row of icon buttons feels continuous instead of re-waiting each time.
const WARM_WINDOW = 500;
const FADE_MS = 140;
const GRACE_MS = 120;
const GAP = 8;
const MARGIN = 8;

// A bare data-tip-clipped (no data-tip) tips the element's own text, so cut-off
// text needs no second copy of itself. The dots-only row menus say what they
// are in their aria-label.
const TARGET =
  "[data-tip], [data-tip-clipped], .icon-btn[aria-label], .row-menu > summary[aria-label]";

let tip: HTMLElement | null = null;
let current: Element | null = null;
let showTimer = 0;
let hideTimer = 0;
let graceTimer = 0;
let suppressed: Element | null = null;
// True while the person is moving with Tab. Focus that arrives any other way
// (a dialog taking focus after Enter, say) is not a request for a tooltip.
let keyNav = false;
let lastHidden = 0;
let installed = false;

function textFor(el: Element): string | null {
  const own = el.getAttribute("data-tip");
  const clipped = el.hasAttribute("data-tip-clipped");
  if (own !== null || clipped) {
    if (
      clipped &&
      el.scrollWidth <= el.clientWidth + 1 &&
      el.scrollHeight <= el.clientHeight + 1
    ) {
      return null;
    }
    return (own ?? el.textContent ?? "").trim() || null;
  }
  return el.getAttribute("aria-label")?.trim() || null;
}

function ensureTip(): HTMLElement {
  if (tip?.isConnected) return tip;
  // ClientRouter swaps the whole <body>, which drops the old element.
  tip = document.createElement("div");
  tip.id = "app-tooltip";
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("popover", "manual");
  // WCAG 1.4.13: the tooltip stays while the pointer is on it, so its text can
  // be read or magnified. Leaving either the trigger or the tooltip starts the
  // same short grace period.
  tip.addEventListener("pointerenter", () => window.clearTimeout(graceTimer));
  tip.addEventListener("pointerleave", () => hideSoon());
  document.body.appendChild(tip);
  return tip;
}

function place(target: Element, box: HTMLElement) {
  const anchor = target.getBoundingClientRect();
  // offset* ignore the entry transform (the box is still scaled down when it
  // is first placed), so the first tooltip lands where the later ones do.
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  const above = anchor.top - height - GAP >= MARGIN;
  const top = above ? anchor.top - height - GAP : anchor.bottom + GAP;
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - width / 2, MARGIN),
    Math.max(MARGIN, window.innerWidth - width - MARGIN)
  );
  box.style.top = `${Math.round(top)}px`;
  box.style.left = `${Math.round(left)}px`;
  box.dataset.placement = above ? "top" : "bottom";
}

function show(target: Element) {
  const text = textFor(target);
  if (!text) return;
  window.clearTimeout(hideTimer);
  // A grace period left over from the previous tooltip must not hide this one.
  window.clearTimeout(graceTimer);
  const box = ensureTip();
  if (current && current !== target) release(current);
  current = target;
  box.textContent = text;
  // Elements that already say it in their aria-label need no second reading.
  if (target.getAttribute("aria-label") !== text) {
    target.setAttribute("aria-describedby", box.id);
  }
  if (!box.matches(":popover-open")) box.showPopover();
  place(target, box);
  // Next frame: the element is placed, so the fade starts from its resting spot.
  requestAnimationFrame(() => {
    if (current === target) box.dataset.visible = "";
  });
}

function release(target: Element) {
  if (target.getAttribute("aria-describedby") === tip?.id) {
    target.removeAttribute("aria-describedby");
  }
}

function hideSoon() {
  window.clearTimeout(graceTimer);
  graceTimer = window.setTimeout(hide, GRACE_MS);
}

// `warm`: the next tooltip may show at once. A dismissal is not that: the
// person asked for quiet.
function hide(warm = true) {
  window.clearTimeout(showTimer);
  window.clearTimeout(graceTimer);
  if (!current || !tip) return;
  release(current);
  current = null;
  if (warm) lastHidden = Date.now();
  const box = tip;
  delete box.dataset.visible;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!current && box.matches(":popover-open")) box.hidePopover();
  }, FADE_MS);
}

// Click, Escape or activating the control dismisses the tooltip, and it stays
// away until the pointer or focus leaves that control (WCAG 1.4.13).
function dismiss(also?: Element | null) {
  window.clearTimeout(showTimer);
  suppressed = also ?? current;
  hide(false);
}

function schedule(target: Element, delay: number) {
  window.clearTimeout(showTimer);
  if (!textFor(target)) return;
  if (delay <= 0) show(target);
  else showTimer = window.setTimeout(() => show(target), delay);
}

export function installTooltips() {
  if (installed || typeof document === "undefined") return;
  if (!("showPopover" in HTMLElement.prototype)) return;
  installed = true;

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    const target = (event.target as Element).closest?.(TARGET);
    if (!target || target === suppressed) return;
    if (target === current) {
      window.clearTimeout(graceTimer);
      return;
    }
    // Moving on to another control: close this one now, so the next shows at
    // once (the warm window) instead of the grace timer cancelling it.
    if (current) hide();
    schedule(target, Date.now() - lastHidden < WARM_WINDOW ? 0 : SHOW_DELAY);
  });
  document.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse") return;
    const target = (event.target as Element).closest?.(TARGET);
    if (!target) return;
    if (target.contains(event.relatedTarget as Node | null)) return;
    window.clearTimeout(showTimer);
    if (target === suppressed) suppressed = null;
    if (target === current) hideSoon();
  });
  // Activating the control (Enter or Space; a mouse click already dismissed on
  // pointerdown). If that changed what it says, as the theme toggle does, the
  // tooltip follows the new label; otherwise it opened something, so it steps
  // out of the way.
  document.addEventListener("click", () => {
    if (!current || !tip) return;
    const text = textFor(current);
    if (text && tip.textContent !== text) {
      tip.textContent = text;
      place(current, tip);
    } else {
      dismiss();
    }
  });
  document.addEventListener("focusin", (event) => {
    const target = (event.target as Element).closest?.(TARGET);
    if (!keyNav || !target || target === suppressed) return;
    if (target.matches(":focus-visible")) schedule(target, 0);
  });
  document.addEventListener("focusout", (event) => {
    // Only when focus leaves the suppressed control itself: clicking it moves
    // focus here from somewhere else, and that must not lift the suppression.
    if (event.target === suppressed) suppressed = null;
    hide();
  });
  // Anything the person does elsewhere dismisses it.
  document.addEventListener(
    "pointerdown",
    (event) => {
      keyNav = false;
      dismiss((event.target as Element).closest?.(TARGET));
    },
    true
  );
  document.addEventListener("keydown", (event) => {
    keyNav = event.key === "Tab" || event.key === "Shift";
    if (event.key === "Escape") dismiss();
  });
  document.addEventListener("scroll", () => hide(), true);
  window.addEventListener("resize", () => hide());
  document.addEventListener("astro:before-swap", () => hide());
}
