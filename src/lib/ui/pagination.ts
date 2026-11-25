export interface PaginationLinksOptions {
  page: number;
  hasNext: boolean;
  buildHref: (targetPage: number) => string;
}

export interface PaginationLinks {
  previousHref: string | null;
  nextHref: string | null;
}

/**
 * Computes active pagination boundary links so first/last/single pages emit
 * `null` for unavailable directions and never render focusable dead anchors.
 */
export function resolvePaginationLinks({
  page,
  hasNext,
  buildHref,
}: PaginationLinksOptions): PaginationLinks {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  return {
    previousHref: safePage > 1 ? buildHref(safePage - 1) : null,
    nextHref: hasNext ? buildHref(safePage + 1) : null,
  };
}
