// Pure helpers for the Audience page: no database, safe to import in the browser.
import type { InsightBreakdownRow } from "@/lib/meta/client";

/** Share of each row in the total, as a rounded percentage. */
export function withShares(rows: InsightBreakdownRow[]): Array<InsightBreakdownRow & { share: number }> {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return rows.map((row) => ({
    ...row,
    share: total > 0 ? Math.round((row.value / total) * 1000) / 10 : 0,
  }));
}

/** The `limit` best consecutive-hour bands, e.g. 18h-21h, by followers online. */
export function bestOnlineBands(
  hours: number[],
  { band = 3, limit = 2 } = {}
): Array<{ start: number; average: number }> {
  const bands = Array.from({ length: Math.floor(24 / band) }, (_, i) => {
    const start = i * band;
    const slice = hours.slice(start, start + band);
    return { start, average: Math.round(slice.reduce((a, b) => a + b, 0) / band) };
  });
  return bands.sort((a, b) => b.average - a.average).slice(0, limit);
}
