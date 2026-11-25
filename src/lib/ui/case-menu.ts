/**
 * Positions native top-layer `.case-menu[popover]` dropdowns relative to
 * their `[popovertarget]` trigger button, clamping inside the viewport and
 * following scroll/resize until dismissed.
 */
const triggerMap = new WeakMap<HTMLElement, HTMLElement>();

function isWithinRoot(root: ParentNode, node: Node): boolean {
  if (root === document) return node.isConnected;
  return typeof (root as { contains?: unknown }).contains === "function"
    ? (root as Element).contains(node)
    : true;
}

function isClippedByScrollAncestor(trigger: HTMLElement): boolean {
  if (typeof getComputedStyle !== "function") return false;
  const anchor = trigger.getBoundingClientRect();
  let ancestor = trigger.parentElement;
  while (
    ancestor &&
    ancestor !== document.documentElement &&
    ancestor !== document.body
  ) {
    const style = getComputedStyle(ancestor);
    const clipsX = /(auto|scroll|clip|hidden)/.test(style.overflowX);
    const clipsY = /(auto|scroll|clip|hidden)/.test(style.overflowY);
    if (clipsX || clipsY) {
      const rect = ancestor.getBoundingClientRect();
      if (
        clipsX &&
        rect.width > 0 &&
        (anchor.right <= rect.left || anchor.left >= rect.right)
      ) {
        return true;
      }
      if (
        clipsY &&
        rect.height > 0 &&
        (anchor.bottom <= rect.top || anchor.top >= rect.bottom)
      ) {
        return true;
      }
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

export function getPopoverInvoker(
  menu: HTMLElement,
  root: ParentNode = document
): HTMLElement | null {
  const remembered = triggerMap.get(menu);
  if (remembered?.isConnected && !menu.contains(remembered)) return remembered;
  if (!menu.id) return null;
  const selector = `[popovertarget="${CSS.escape(menu.id)}"]:not([popovertargetaction="hide"])`;
  for (const trigger of root.querySelectorAll<HTMLElement>(selector)) {
    if (!menu.contains(trigger)) return trigger;
  }
  return root === document ? null : getPopoverInvoker(menu);
}

export function positionCaseMenu(
  menu: HTMLElement,
  explicitTrigger?: HTMLElement | null,
  root: ParentNode = document
): void {
  if (explicitTrigger?.isConnected && !menu.contains(explicitTrigger)) {
    triggerMap.set(menu, explicitTrigger);
  }
  const trigger = getPopoverInvoker(menu, root);
  if (!trigger) return;
  const anchor = trigger.getBoundingClientRect();
  if (
    anchor.bottom < 0 ||
    anchor.top > innerHeight ||
    anchor.right < 0 ||
    anchor.left > innerWidth ||
    isClippedByScrollAncestor(trigger)
  ) {
    menu.hidePopover?.();
    return;
  }
  menu.style.inset = "auto";
  menu.style.margin = "0";
  const width = menu.offsetWidth || menu.getBoundingClientRect().width;
  const height = menu.offsetHeight || menu.getBoundingClientRect().height;
  const gap = 6;
  const margin = 8;
  menu.style.left = `${Math.max(margin, Math.min(anchor.right - width, innerWidth - width - margin))}px`;
  const below = anchor.bottom + gap;
  const above = anchor.top - height - gap;
  const fitsBelow = below + height <= innerHeight - margin;
  const placeTop = !fitsBelow && above >= margin;
  menu.dataset.placement = placeTop ? "top" : "bottom";
  const top = placeTop ? above : below;
  menu.style.top = `${Math.max(margin, Math.min(top, innerHeight - height - margin))}px`;
}

export function initCaseMenus(
  options: { root?: ParentNode; signal?: AbortSignal } = {}
): () => void {
  const root = options.root ?? document;
  if (options.signal?.aborted) return () => {};
  const controller = new AbortController();
  const hiddenMenus = new Set<HTMLElement>();
  const cleanup = () => {
    for (const menu of hiddenMenus) {
      menu.style.visibility = "";
    }
    hiddenMenus.clear();
    controller.abort();
  };
  if (options.signal) {
    options.signal.addEventListener("abort", cleanup, {
      once: true,
      signal: controller.signal,
    });
  }
  const signal = controller.signal;
  const listenerOptions = { signal, capture: true };

  // Track which trigger activated a shared popover before ToggleEvent fires
  // (also covers browsers without ToggleEvent.source).
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const trigger = event.target.closest<HTMLElement>("[popovertarget]");
      if (!trigger || !isWithinRoot(root, trigger)) return;
      const targetId = trigger.getAttribute("popovertarget");
      if (!targetId) return;
      const menu = document.getElementById(targetId);
      if (
        menu instanceof HTMLElement &&
        menu.classList.contains("case-menu") &&
        isWithinRoot(root, menu) &&
        !menu.matches(":popover-open") &&
        !menu.contains(trigger) &&
        trigger.getAttribute("popovertargetaction") !== "hide"
      ) {
        triggerMap.set(menu, trigger);
      }
    },
    listenerOptions
  );

  const repositionAll = () =>
    root
      .querySelectorAll<HTMLElement>(".case-menu:popover-open")
      .forEach((menu) => positionCaseMenu(menu, undefined, root));

  // Hide before first paint in the top layer so the browser never flashes the
  // default centered [popover] box before toggle measures and places it.
  document.addEventListener(
    "beforetoggle",
    (event) => {
      if (event.defaultPrevented) return;
      const menu = event.target;
      if (
        !(menu instanceof HTMLElement) ||
        !menu.classList.contains("case-menu") ||
        !isWithinRoot(root, menu)
      ) {
        return;
      }
      const nextState = (event as Event & { newState?: string }).newState;
      if (nextState === "open") {
        const rawSource =
          "source" in event
            ? (event as Event & { source?: unknown }).source
            : null;
        if (rawSource instanceof HTMLElement && !menu.contains(rawSource)) {
          triggerMap.set(menu, rawSource);
        }
        hiddenMenus.add(menu);
        menu.style.visibility = "hidden";
      } else {
        hiddenMenus.delete(menu);
        menu.style.visibility = "";
      }
    },
    listenerOptions
  );

  document.addEventListener(
    "toggle",
    (event) => {
      const menu = event.target;
      if (
        !(menu instanceof HTMLElement) ||
        !menu.classList.contains("case-menu") ||
        !isWithinRoot(root, menu)
      ) {
        return;
      }
      if (!menu.matches(".case-menu:popover-open")) {
        hiddenMenus.delete(menu);
        menu.style.visibility = "";
        return;
      }
      const rawSource =
        "source" in event
          ? (event as Event & { source?: unknown }).source
          : null;
      const source = rawSource instanceof HTMLElement ? rawSource : null;
      positionCaseMenu(menu, source, root);
      hiddenMenus.delete(menu);
      menu.style.visibility = "";
    },
    listenerOptions
  );

  // Follow visible rows during viewport/table scroll; dismiss when the
  // invoker leaves the viewport. Ignore the menu's own internal scrolling.
  document.addEventListener(
    "scroll",
    (event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".case-menu")
      ) {
        repositionAll();
      }
    },
    listenerOptions
  );

  window.addEventListener("resize", repositionAll, { signal });

  return cleanup;
}
