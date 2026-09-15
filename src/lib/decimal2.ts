// Phase F (Billing) - exact fixed-point money arithmetic (spec Section 18:
// "Use one centralized Decimal implementation and test it heavily").
// BigInt-based, not a library: every operation invoicing needs is
// multiply-then-round-half-up-to-2-decimals, a percentage-of, and exact
// addition -- well within what a few dozen tested lines can do correctly,
// the same reasoning as decimal3.ts's exact subtraction for meter readings.
// Round-half-up (not banker's rounding) matches standard invoicing/tax
// convention: 0.005 rounds to 0.01, not 0.00.
function parseDecimal(value: string): {
  negative: boolean;
  unscaled: bigint;
  scale: number;
} {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  return {
    negative,
    unscaled: BigInt((whole || "0") + fraction),
    scale: fraction.length,
  };
}

function formatUnscaled(
  negative: boolean,
  unscaled: bigint,
  scale: number
): string {
  const str = unscaled.toString().padStart(scale + 1, "0");
  const whole = str.slice(0, str.length - scale) || "0";
  const fraction = scale > 0 ? str.slice(str.length - scale) : "";
  const sign = negative && unscaled !== 0n ? "-" : "";
  return `${sign}${whole}${fraction ? "." + fraction : ""}`;
}

// Rescales an unscaled bigint from `fromScale` decimal places to `toScale`,
// rounding half-up when narrowing.
function rescale(unscaled: bigint, fromScale: number, toScale: number): bigint {
  if (toScale >= fromScale) {
    return unscaled * 10n ** BigInt(toScale - fromScale);
  }
  const divisor = 10n ** BigInt(fromScale - toScale);
  const quotient = unscaled / divisor;
  const remainder = unscaled % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

// net = ROUND(quantity x unit_price, 2) -- and the general
// multiply-and-round-to-`scale` this and percentOf share.
export function multiplyAndRound(a: string, b: string, scale: number): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const negative = pa.negative !== pb.negative;
  const rawUnscaled = pa.unscaled * pb.unscaled;
  const rounded = rescale(rawUnscaled, pa.scale + pb.scale, scale);
  return formatUnscaled(negative, rounded, scale);
}

// vat = ROUND(net x vat_rate / 100, 2). vat_rate is a percentage (21.0000
// means 21%), so this is multiplyAndRound with two extra scale places
// absorbed for the implicit "/100" instead of a real division.
export function percentOf(
  base: string,
  percentValue: string,
  scale: number
): string {
  const pa = parseDecimal(base);
  const pb = parseDecimal(percentValue);
  const negative = pa.negative !== pb.negative;
  const rawUnscaled = pa.unscaled * pb.unscaled;
  const rounded = rescale(rawUnscaled, pa.scale + pb.scale + 2, scale);
  return formatUnscaled(negative, rounded, scale);
}

// Exact addition (both operands already share the same 2-decimal scale for
// every call site in this codebase, but this handles differing scales too).
export function addExact(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.scale, pb.scale);
  const va =
    pa.unscaled * 10n ** BigInt(scale - pa.scale) * (pa.negative ? -1n : 1n);
  const vb =
    pb.unscaled * 10n ** BigInt(scale - pb.scale) * (pb.negative ? -1n : 1n);
  const sum = va + vb;
  return formatUnscaled(sum < 0n, sum < 0n ? -sum : sum, scale);
}

export function negateExact(value: string): string {
  const parsed = parseDecimal(value);
  return formatUnscaled(!parsed.negative, parsed.unscaled, parsed.scale);
}

export function subtractExact(a: string, b: string): string {
  return addExact(a, negateExact(b));
}

export function compareExact(a: string, b: string): -1 | 0 | 1 {
  const difference = parseDecimal(subtractExact(a, b));
  if (difference.unscaled === 0n) return 0;
  return difference.negative ? -1 : 1;
}

export function minExact(a: string, b: string): string {
  return compareExact(a, b) <= 0 ? a : b;
}

export function maxExact(a: string, b: string): string {
  return compareExact(a, b) >= 0 ? a : b;
}

// ROUND(base × daily percentage × days / 100, scale), with one rounding
// step so long accrual periods do not compound an intermediate rounded value.
export function percentForDays(
  base: string,
  dailyPercent: string,
  days: number,
  scale: number
): string {
  const pa = parseDecimal(base);
  const pb = parseDecimal(dailyPercent);
  const negative = (pa.negative !== pb.negative) !== days < 0;
  const rawUnscaled = pa.unscaled * pb.unscaled * BigInt(Math.abs(days));
  const rounded = rescale(rawUnscaled, pa.scale + pb.scale + 2, scale);
  return formatUnscaled(negative, rounded, scale);
}

export function sumExact(values: string[]): string {
  return values.reduce((acc, v) => addExact(acc, v), "0.00");
}
