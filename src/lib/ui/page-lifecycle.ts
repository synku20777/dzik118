type Cleanup = () => void;

/** Run page-specific client code after every Astro navigation. */
export function onPageLoad(setup: () => void | Cleanup): void {
  let cleanup: Cleanup | undefined;

  document.addEventListener("astro:page-load", () => {
    cleanup?.();
    cleanup = setup() || undefined;
  });
  document.addEventListener("astro:before-swap", () => {
    cleanup?.();
    cleanup = undefined;
  });
}
