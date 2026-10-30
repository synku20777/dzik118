// Cell value parsers for the Migration Center. Code parses numbers, dates and
// words; the AI model is never asked to read a value (ADR 0013). Every parser
// returns a result object instead of throwing, so a bad cell becomes a row
// error the admin can read.
export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const NBSP = /[\u00A0\u202F\u2009\u2007]/g;

// Folds text for matching: lowercase, no diacritics, single spaces. Cyrillic
// stays Cyrillic (the same folding is applied to the aliases).
export function foldText(text: string): string {
  return text
    .replace(/№/g, " nr ")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Which character this column uses as the decimal mark, judged from all of its
// values: a separator followed by one or two digits (or four or more) is a
// decimal mark. "1,234" alone is ambiguous, so it stays null.
//
// When the values give no evidence (every number has three decimals, as water
// meter readings do), the file's delimiter decides: Excel writes ";" exactly
// when the decimal mark is a comma, and a "," delimiter cannot hold unquoted
// decimal commas.
export function detectDecimalSeparator(
  samples: string[],
  delimiter?: string
): "," | "." | null {
  const found = detectFromValues(samples);
  if (found) return found;
  if (delimiter === ";") return ",";
  if (delimiter === ",") return ".";
  return null;
}

function detectFromValues(samples: string[]): "," | "." | null {
  let comma = 0;
  let dot = 0;
  for (const raw of samples) {
    const s = raw.replace(NBSP, " ").trim();
    const both = s.includes(",") && s.includes(".");
    if (both) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) comma++;
      else dot++;
      continue;
    }
    const m = /([.,])(\d+)\D*$/.exec(s);
    if (!m) continue;
    const digits = m[2].length;
    if (digits === 3) continue;
    if (m[1] === ",") comma++;
    else dot++;
  }
  if (comma > 0 && dot === 0) return ",";
  if (dot > 0 && comma === 0) return ".";
  return null;
}

// Parses "1 234,50", "1.234,50", "1,234.50", "-12,5", "12,50-", "(12.50)",
// "€ 12,50" and "12.50 EUR" into a canonical "-1234.50" string with a dot.
// `decimalSeparator` is the column's detected mark; without it a lone
// separator followed by exactly three digits is refused as ambiguous.
export function parseDecimal(
  input: string,
  decimalSeparator: "," | "." | null = null
): Parsed<string> {
  let s = input.replace(NBSP, " ").replace(/−|–|—/g, "-").trim();
  if (s === "") return { ok: false, reason: "empty" };
  s = s
    .replace(/\b(eur|euro|euros)\b/gi, "")
    .replace(/[€$£]/g, "")
    .trim();

  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(/ /g, "");
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) {
    return { ok: false, reason: "not a number" };
  }

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let decimalMark: "," | "." | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalMark = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0 || lastDot >= 0) {
    const mark = lastComma >= 0 ? "," : ".";
    const count = s.split(mark).length - 1;
    const tail = s.length - s.lastIndexOf(mark) - 1;
    if (count > 1) {
      // 1.234.567: only a thousands mark.
      decimalMark = null;
    } else if (decimalSeparator === mark) {
      decimalMark = mark;
    } else if (decimalSeparator && decimalSeparator !== mark) {
      decimalMark = null; // the other mark is the decimal one here
    } else if (tail === 3) {
      return { ok: false, reason: "ambiguous number" };
    } else {
      decimalMark = mark;
    }
  }

  let whole = s;
  let fraction = "";
  if (decimalMark) {
    const at = s.lastIndexOf(decimalMark);
    whole = s.slice(0, at);
    fraction = s.slice(at + 1);
  }
  // Thousands marks: groups of exactly three digits after the first ("1,2,3"
  // is not a number).
  const groups = whole.split(/[.,]/);
  if (
    groups.length > 1 &&
    !(groups[0].length <= 3 && groups.slice(1).every((g) => g.length === 3))
  ) {
    return { ok: false, reason: "not a number" };
  }
  whole = whole.replace(/[.,]/g, "");
  if (whole === "") whole = "0";
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) {
    return { ok: false, reason: "not a number" };
  }
  whole = whole.replace(/^0+(?=\d)/, "");
  const value = `${negative ? "-" : ""}${whole}${fraction ? "." + fraction : ""}`;
  return { ok: true, value: value === "-0" ? "0" : value };
}

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last;
}

// `YYYY-MM-DD`, `DD.MM.YYYY`, `D.M.YYYY`, `DD/MM/YYYY`, `DD-MM-YYYY`, with an
// optional time that is ignored. Day first, as in Latvia. Two-digit years are
// refused: a balance date must not be guessed.
export function parseDate(input: string): Parsed<string> {
  const s = input
    .replace(NBSP, " ")
    .trim()
    .replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
    if (!match) return { ok: false, reason: "not a date" };
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (!validDate(y, m, d)) return { ok: false, reason: "not a real date" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return { ok: true, value: `${y}-${pad(m)}-${pad(d)}` };
}

export type MeterTypeName =
  "COLD_WATER" | "HOT_WATER" | "ELECTRICITY" | "GAS" | "HEAT" | "OTHER";

// Folded token prefixes (see parseDelivery). Plain "water" or "ūdens" with no
// temperature fits none of them, so it is refused instead of guessed.
const METER_TYPE_PREFIXES: [MeterTypeName, string[]][] = [
  ["COLD_WATER", ["aukst", "cold", "холодн", "хвс"]],
  ["HOT_WATER", ["karst", "hot", "горяч", "гвс"]],
  ["ELECTRICITY", ["elektr", "electr", "электр"]],
  ["GAS", ["gaz", "gas", "газ"]],
  ["HEAT", ["siltum", "apkur", "heat", "тепл", "отоплен"]],
  ["OTHER", ["other", "cits", "друг"]],
];

export function parseMeterType(input: string): Parsed<MeterTypeName> {
  const tokens = foldText(input).split(" ").filter(Boolean);
  if (tokens.length === 0) return { ok: false, reason: "empty" };
  const found = METER_TYPE_PREFIXES.filter(([, prefixes]) =>
    tokens.some((t) => prefixes.some((p) => t.startsWith(p)))
  ).map(([type]) => type);
  if (found.length === 1) return { ok: true, value: found[0] };
  return {
    ok: false,
    reason: found.length === 0 ? "unknown meter type" : "ambiguous meter type",
  };
}

export interface DeliveryPreference {
  invoiceByEmail: boolean;
  invoiceByPaper: boolean;
}

// "e-pasts", "email", "эл. почта" -> email. "papīrs", "pasts" (post), "paper",
// "бумажный", "почтой" -> paper. Both words present, or "abi" / "both" / "оба"
// -> both. In Latvian "pasts" alone is the postal mail; "e-pasts" is email.
// Matching works on folded tokens ("й" folds to "и"), so the word lists below
// are already folded.
// A bare "почта" is not listed: it means mail in both senses.
const EMAIL_PREFIXES = ["epast", "email", "elektronisk", "электрон"];
const PAPER_PREFIXES = [
  "papir",
  "pasts",
  "paper",
  "print",
  "druk",
  "бумаж",
  "почтои",
  "печат",
];
const BOTH_WORDS = new Set(["abi", "both", "оба", "beide"]);

export function parseDelivery(input: string): Parsed<DeliveryPreference> {
  // "e-pasts" folds to "e pasts": join it so it is not read as postal mail.
  const f = foldText(input)
    .replace(/\be pasts\b/g, "epasts")
    .replace(/\be mail\b/g, "email")
    // \b does not see Cyrillic letters as word characters.
    .replace(/(^| )эл почта(?= |$)/g, "$1электрон");
  if (f === "") return { ok: false, reason: "empty" };
  const tokens = f.split(" ");
  const has = (prefixes: string[]) =>
    tokens.some((t) => prefixes.some((p) => t.startsWith(p)));
  const email = has(EMAIL_PREFIXES);
  const paper = has(PAPER_PREFIXES);
  if (tokens.some((t) => BOTH_WORDS.has(t)) || (email && paper)) {
    return { ok: true, value: { invoiceByEmail: true, invoiceByPaper: true } };
  }
  if (email) {
    return { ok: true, value: { invoiceByEmail: true, invoiceByPaper: false } };
  }
  if (paper) {
    return { ok: true, value: { invoiceByEmail: false, invoiceByPaper: true } };
  }
  return { ok: false, reason: "unknown delivery method" };
}
