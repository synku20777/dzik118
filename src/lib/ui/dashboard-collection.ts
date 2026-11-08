export function collectionShare(paid: string, due: string): number | null {
  const received = Number(paid);
  const total = Number(due);
  return Number.isFinite(received) && Number.isFinite(total) && total > 0
    ? Math.min(1, Math.max(0, received / total))
    : null;
}

/** Never imply collection is complete merely because a percentage rounds up. */
export function formatCollectionShare(
  share: number | null,
  locale: string
): string {
  if (share === null) return "—";
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  if (share > 0 && share < 0.01) return `<${percent.format(0.01)}`;
  return percent.format(
    share === 1
      ? 1
      : Math.min(99, Math.floor(share * 100 + Number.EPSILON * 100)) / 100
  );
}
