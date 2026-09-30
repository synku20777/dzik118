// Domain errors reach the screen through friendlyActionErrorMessage, which
// looks the exact English message up in the LV and RU dictionaries. A message
// without a key shows in English to a Latvian or Russian user.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translate } from "../../src/lib/ui/i18n";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

// throw new SomethingError("literal message")  (also over several lines).
// Messages built with template strings or variables are not checked.
const THROW_LITERAL =
  /throw new \w*Error\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*[,)]/g;

// const SOME_MESSAGE = "literal"  /  const SOME_ERROR = "literal": a message
// kept in a constant and thrown or returned by name. Domain code and action
// input messages both reach the screen.
const MESSAGE_CONSTANT =
  /const [A-Z][A-Z_]*(?:MESSAGE|ERROR)[A-Z_]* =\s*("(?:[^"\\]|\\.)*")/g;

function unquote(raw: string): string {
  return raw.startsWith("'")
    ? raw.slice(1, -1).replace(/\\'/g, "'")
    : (JSON.parse(raw) as string);
}

function literalMessages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(join(process.cwd(), "src", "domain"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(THROW_LITERAL)) {
      found.set(unquote(match[1]), file);
    }
    for (const match of text.matchAll(MESSAGE_CONSTANT)) {
      found.set(unquote(match[1]), file);
    }
  }
  for (const file of sourceFiles(join(process.cwd(), "src", "actions"))) {
    for (const match of readFileSync(file, "utf8").matchAll(MESSAGE_CONSTANT)) {
      found.set(unquote(match[1]), file);
    }
  }
  return found;
}

describe("domain error messages", () => {
  const messages = literalMessages();

  it("finds the thrown messages", () => {
    expect(messages.size).toBeGreaterThan(50);
  });

  it("has a Latvian and a Russian translation for each one", () => {
    const missing: string[] = [];
    for (const [message, file] of messages) {
      for (const locale of ["lv", "ru"] as const) {
        if (translate(locale, message) === message) {
          missing.push(`${locale}: ${message} (${file})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
