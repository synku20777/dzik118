import { translate, type Locale } from "./i18n";

// Client-side saves (mutate-form) show the action's message, which is the
// domain's English sentence. A page passes the source text of the domain
// modules its forms call (imported with Vite's `?raw`); this collects the
// literal messages they can throw and returns the ones the dictionary
// translates, so the client gets only what it needs and the list follows the
// code. Same extraction rules as tests/unit/i18n-errors.test.ts.
const THROW_LITERAL =
  /throw new \w*Error\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*[,)]/g;
const MESSAGE_CONSTANT =
  /const [A-Z][A-Z_]*(?:MESSAGE|ERROR)[A-Z_]* =\s*("(?:[^"\\]|\\.)*")/g;

function unquote(raw: string): string {
  return raw.startsWith("'")
    ? raw.slice(1, -1).replace(/\\'/g, "'")
    : (JSON.parse(raw) as string);
}

// `messages` adds texts that are not thrown literals, such as a Zod message
// produced by an action's input schema.
export function errorTranslations(
  sources: string[],
  locale: Locale,
  messages: string[] = []
): Record<string, string> {
  const map: Record<string, string> = {};
  if (locale === "en") return map;
  for (const message of messages) {
    const translated = translate(locale, message);
    if (translated !== message) map[message] = translated;
  }
  for (const source of sources) {
    for (const pattern of [THROW_LITERAL, MESSAGE_CONSTANT]) {
      for (const match of source.matchAll(pattern)) {
        const message = unquote(match[1]);
        const translated = translate(locale, message);
        if (translated !== message) map[message] = translated;
      }
    }
  }
  return map;
}
