import { describe, expect, it } from "vitest";

import { bestOnlineBands, withShares } from "@/lib/performance/audience-math";

describe("audience helpers", () => {
  it("turns counts into shares of the total", () => {
    const rows = withShares([
      { label: "F", value: 1008 },
      { label: "M", value: 538 },
      { label: "U", value: 401 },
    ]);
    expect(rows.map((r) => r.share)).toEqual([51.8, 27.6, 20.6]);
    expect(withShares([])).toEqual([]);
    expect(withShares([{ label: "F", value: 0 }])[0].share).toBe(0);
  });

  it("finds the busiest 3-hour bands", () => {
    const hours = Array.from({ length: 24 }, (_, h) => (h >= 18 && h < 21 ? 300 : h >= 12 && h < 15 ? 200 : 50));
    expect(bestOnlineBands(hours)).toEqual([
      { start: 18, average: 300 },
      { start: 12, average: 200 },
    ]);
  });
});
