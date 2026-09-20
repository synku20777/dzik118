export function getStoredTheme(): "light" | "dark" | null {
  try {
    const val = localStorage.getItem("color-scheme");
    return val === "light" || val === "dark" ? val : null;
  } catch (err) {
    void err;
    return null;
  }
}

export function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getEffectiveTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return getStoredTheme() ?? getSystemTheme();
}

export function setTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // A short-lived attribute rather than a permanent transition on every
  // element: global.css only turns on the color transition while this
  // attribute is present, so the theme flip animates smoothly without
  // making unrelated hover/focus/disabled state changes feel laggy.
  const animate =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
  if (animate) {
    root.dataset.themeTransition = "";
    void root.offsetWidth; // force a reflow so the transition applies before the swap below
  }
  root.setAttribute("data-theme", theme);
  if (animate) {
    window.setTimeout(() => delete root.dataset.themeTransition, 180);
  }
  try {
    localStorage.setItem("color-scheme", theme);
  } catch (err) {
    void err;
  }
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="color-scheme"]'
  );
  if (meta) {
    meta.content = theme;
  }
  updateToggleButtons(theme);
}

export function updateToggleButtons(theme?: "light" | "dark") {
  if (typeof document === "undefined") return;
  const current = theme ?? getEffectiveTheme();
  const isDark = current === "dark";

  document
    .querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")
    .forEach((button) => {
      // Pre-translated server-side (ThemeToggle.astro already has the
      // request's locale via t()) and read back here instead of
      // re-translating client-side -- a previous version hand-rolled an
      // EN/LV-only ternary in this file, which left Russian (and any
      // future locale) stuck on the English string, and importing the
      // full i18n dictionary into this client bundle just for two labels
      // would be its own regression.
      const label = isDark
        ? button.dataset.labelLight
        : button.dataset.labelDark;
      if (!label) return;
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    });
}

export function initTheme() {
  if (typeof window === "undefined") return;

  const currentTheme = getEffectiveTheme();
  updateToggleButtons(currentTheme);

  document
    .querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")
    .forEach((button) => {
      if (button.dataset.themeBound) return;
      button.dataset.themeBound = "true";
      button.addEventListener("click", () => {
        const current = getEffectiveTheme();
        const next = current === "dark" ? "light" : "dark";
        setTheme(next);
      });
    });

  if (!window.__themeMediaBound) {
    window.__themeMediaBound = true;
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
        if (!getStoredTheme()) {
          updateToggleButtons(e.matches ? "dark" : "light");
        }
      });
  }

  // AdminLayout's ClientRouter swaps in each new page's freshly
  // server-rendered <html>, which never has data-theme on it (only the
  // very first hard load's is:inline head script sets that, and it doesn't
  // re-run on soft navigations) -- without this, every in-app navigation
  // would flash to the OS/browser default theme until this same handler's
  // updateToggleButtons() above ran, and even then nothing here writes the
  // attribute back. Copying it onto the incoming document during
  // astro:before-swap applies it before the swap is even visible, so
  // there's no flash at all.
  if (!window.__themeBeforeSwapBound) {
    window.__themeBeforeSwapBound = true;
    document.addEventListener("astro:before-swap", (event) => {
      const theme = document.documentElement.getAttribute("data-theme");
      if (!theme) return;
      const { newDocument } = event as unknown as { newDocument: Document };
      newDocument.documentElement.setAttribute("data-theme", theme);
    });
  }
}

declare global {
  interface Window {
    __themeMediaBound?: boolean;
    __themeBeforeSwapBound?: boolean;
  }
}
