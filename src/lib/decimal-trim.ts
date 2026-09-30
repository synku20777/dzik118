// A stored decimal such as "1.0000" shown without trailing zeros, but with at
// least `minDecimals` places ("15.0000" with 2 gives "15.00"). The value is
// never rounded, and the decimal separator stays a dot. Values that are not
// plain decimals come back unchanged.
export function trimDecimal(
  value: string | null | undefined,
  minDecimals = 0
): string {
  if (value == null || value === "") return "";
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const [whole, fraction = ""] = value.split(".");
  let digits = fraction.replace(/0+$/, "");
  while (digits.length < minDecimals) digits += "0";
  return digits ? `${whole}.${digits}` : whole;
}
