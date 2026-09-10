// Phase E (Periods/meters/readings) - exact subtraction for numeric(14,3)
// columns (spec Section 17: "Do not use JS binary floating-point for
// persisted calculations"). Postgres numeric(14,3) always returns a string
// with exactly 3 decimal places, so scaling to an integer via string
// manipulation (not Number()) and using BigInt keeps this exact. A full
// Decimal library belongs to Phase F's billing calculation engine, which
// needs multiplication/rounding modes this narrow subtraction doesn't.
// Matches the meter_readings numeric(14,3) column exactly: at most 11
// integer digits (14 total precision - 3 scale) and at most 3 decimals.
// Shared by the action-layer zod schema and this module's own callers so
// a value that passes validation can never overflow the DB column.
export const DECIMAL3_PATTERN = /^\d{1,11}(\.\d{1,3})?$/;

function toThousandths(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const paddedFraction = (fraction + "000").slice(0, 3);
  const scaled = BigInt(whole + paddedFraction);
  return negative ? -scaled : scaled;
}

function fromThousandths(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / 1000n;
  const fraction = (abs % 1000n).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function subtractDecimal3(current: string, previous: string): string {
  return fromThousandths(toThousandths(current) - toThousandths(previous));
}

export function compareDecimal3(a: string, b: string): number {
  const diff = toThousandths(a) - toThousandths(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}
