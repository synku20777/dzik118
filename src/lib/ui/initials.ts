// Up to two initials for an avatar, first and last: "Anna Bērziņa" gives
// "AB", the email "anna.berzina@example.lv" gives "AB", "anna@example.lv" "A".
export function initials(nameOrEmail: string | null | undefined): string {
  const parts = (nameOrEmail ?? "")
    .trim()
    .split("@")[0]
    .split(/[\s._-]+/)
    .filter(Boolean);
  const picked = parts.length > 1 ? [parts[0], parts.at(-1)!] : parts;
  return picked.map((part) => part.charAt(0).toLocaleUpperCase()).join("");
}
