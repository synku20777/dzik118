import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEffectiveTheme,
  getStoredTheme,
  getSystemTheme,
  initTheme,
  setTheme,
  updateToggleButtons,
} from "../../src/lib/ui/theme";

describe("theme management", () => {
  let store: Record<string, string> = {};
  let rootAttributes: Record<string, string> = {};
  let buttonAttributes: Record<string, string> = {};
  let buttonDataset: Record<string, string> = {};
  let metaAttributes: Record<string, string> = {};
  let clickListener: (() => void) | null = null;
  let mediaListener: ((e: { matches: boolean }) => void) | null = null;

  beforeEach(() => {
    store = {};
    rootAttributes = {};
    buttonAttributes = {};
    buttonDataset = {
      labelLight: "Switch to light theme",
      labelDark: "Switch to dark theme",
    };
    metaAttributes = {};
    clickListener = null;
    mediaListener = null;

    const mockStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    };

    const mockMeta = {
      get content() {
        return metaAttributes["content"] ?? "";
      },
      set content(val: string) {
        metaAttributes["content"] = val;
      },
      setAttribute(name: string, val: string) {
        metaAttributes[name] = val;
      },
      getAttribute(name: string) {
        return metaAttributes[name] ?? null;
      },
    };

    const mockButton = {
      dataset: buttonDataset,
      setAttribute(name: string, val: string) {
        buttonAttributes[name] = val;
      },
      getAttribute(name: string) {
        return buttonAttributes[name] ?? null;
      },
      addEventListener(event: string, handler: () => void) {
        if (event === "click") clickListener = handler;
      },
    };

    const mockRoot = {
      lang: "en",
      getAttribute(name: string) {
        return rootAttributes[name] ?? null;
      },
      setAttribute(name: string, val: string) {
        rootAttributes[name] = val;
      },
    };

    const mockDoc = {
      documentElement: mockRoot,
      querySelector(sel: string) {
        if (sel.includes("color-scheme")) return mockMeta;
        return null;
      },
      querySelectorAll(sel: string) {
        if (sel.includes("data-theme-toggle")) return [mockButton];
        return [];
      },
    };

    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener(
        _event: string,
        handler: (e: { matches: boolean }) => void
      ) {
        mediaListener = handler;
      },
      removeEventListener: vi.fn(),
    }));

    vi.stubGlobal("localStorage", mockStorage);
    vi.stubGlobal("document", mockDoc);
    vi.stubGlobal("window", {
      matchMedia: mockMatchMedia,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads stored theme from localStorage", () => {
    expect(getStoredTheme()).toBeNull();
    store["color-scheme"] = "dark";
    expect(getStoredTheme()).toBe("dark");
    store["color-scheme"] = "light";
    expect(getStoredTheme()).toBe("light");
    store["color-scheme"] = "invalid";
    expect(getStoredTheme()).toBeNull();
  });

  it("determines system theme via matchMedia", () => {
    expect(getSystemTheme()).toBe("light");
    (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      matches: true,
    });
    expect(getSystemTheme()).toBe("dark");
  });

  it("determines effective theme from document attribute, then storage, then system", () => {
    // 1. System is light, no attr, no storage
    expect(getEffectiveTheme()).toBe("light");

    // 2. Storage set to dark
    store["color-scheme"] = "dark";
    expect(getEffectiveTheme()).toBe("dark");

    // 3. Document attribute takes priority
    rootAttributes["data-theme"] = "light";
    expect(getEffectiveTheme()).toBe("light");
  });

  it("sets theme, updates localStorage, document attribute, meta tag, and button labels", () => {
    setTheme("dark");
    expect(rootAttributes["data-theme"]).toBe("dark");
    expect(store["color-scheme"]).toBe("dark");
    expect(metaAttributes["content"]).toBe("dark");
    expect(buttonAttributes["aria-label"]).toBe("Switch to light theme");
  });

  it("localizes button labels for Latvian locale", () => {
    buttonDataset.labelLight = "Pārslēgt uz gaišo motīvu";
    buttonDataset.labelDark = "Pārslēgt uz tumšo motīvu";
    updateToggleButtons("light");
    expect(buttonAttributes["aria-label"]).toBe("Pārslēgt uz tumšo motīvu");
    updateToggleButtons("dark");
    expect(buttonAttributes["aria-label"]).toBe("Pārslēgt uz gaišo motīvu");
  });

  it("initializes theme toggle click handler and toggles between light and dark", () => {
    initTheme();
    expect(clickListener).not.toBeNull();

    // Default effective theme is light -> click should toggle to dark
    clickListener!();
    expect(rootAttributes["data-theme"]).toBe("dark");
    expect(store["color-scheme"]).toBe("dark");

    // Now current is dark -> click should toggle to light
    clickListener!();
    expect(rootAttributes["data-theme"]).toBe("light");
    expect(store["color-scheme"]).toBe("light");
  });

  it("updates toggle buttons when OS theme changes and user has no preference", () => {
    initTheme();
    expect(mediaListener).not.toBeNull();
    mediaListener!({ matches: true });
    expect(buttonAttributes["aria-label"]).toBe("Switch to light theme");
    mediaListener!({ matches: false });
    expect(buttonAttributes["aria-label"]).toBe("Switch to dark theme");
  });
});
