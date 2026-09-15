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
  const isLv = document.documentElement.lang === "lv";
  const nextActionLabel = isDark
    ? isLv
      ? "Pārslēgt uz gaišo motīvu"
      : "Switch to light theme"
    : isLv
      ? "Pārslēgt uz tumšo motīvu"
      : "Switch to dark theme";

  document
    .querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")
    .forEach((button) => {
      button.setAttribute("aria-label", nextActionLabel);
      button.setAttribute("title", nextActionLabel);
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
}

declare global {
  interface Window {
    __themeMediaBound?: boolean;
  }
}
