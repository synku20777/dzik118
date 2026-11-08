type Cleanup = () => void;

/** Bind on ordinary page loads as well as Astro client navigations. */
export function onPageLoad(setup: () => void | Cleanup): void {
  let cleanup: Cleanup | undefined;
  const run = () => {
    cleanup?.();
    cleanup = setup() || undefined;
  };
  document.addEventListener("astro:page-load", run);
  document.addEventListener("astro:before-swap", () => {
    cleanup?.();
    cleanup = undefined;
  });

  // ClientRouter emits astro:page-load for the initial document. Pages
  // without it (resident/auth/reference) need their native load instead.
  if (!document.querySelector('[name="astro-view-transitions-enabled"]')) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  }
}
