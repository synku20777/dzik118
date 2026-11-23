export interface DevFontPreviewAssets {
  regular: string;
  italic: string;
}

/**
 * Resolves optional local font preview assets for development builds only.
 * Production builds ignore preview flags so rendered typography always matches
 * Switzer + Overused Grotesk unless explicitly opted in during dev.
 */
export function resolveDevFontPreview(
  isDev: boolean,
  previewFlag: string | undefined
): DevFontPreviewAssets | null {
  if (!isDev) return null;
  if (previewFlag?.trim().toLowerCase() !== "medeo") return null;
  return {
    regular: "/src/fonts/MedeoSansVariable.woff2",
    italic: "/src/fonts/MedeoSansVariable-Italic.woff2",
  };
}
