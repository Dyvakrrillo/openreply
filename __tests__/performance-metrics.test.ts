import { describe, expect, it } from "vitest";
import {
  bestSlots,
  engagementNumerator,
  engagementRate,
  overallRate,
  percent,
  shareability,
  shareabilityNumerator,
  type PerfPost,
} from "@/lib/performance/metrics";

const post = (over: Partial<PerfPost> = {}): PerfPost => ({
  id: "1",
  timestamp: "2026-11-02T17:30:00+0000", // Monday 18:30 in Paris
  reach: 1000,
  likes: 50,
  comments: 10,
  saved: 30,
  shares: 10,
  ...over,
});

describe("performance metrics", () => {
  it("computes percentages and refuses to divide by nothing", () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(5, 0)).toBeNull();
    expect(percent(5, null)).toBeNull();
  });

  it("engagement counts likes, comments, saves and shares over reach", () => {
    expect(engagementRate(post())).toBe(10);
    expect(engagementRate(post({ reach: null }))).toBeNull();
    expect(engagementRate(post({ saved: null, shares: null }))).toBe(6);
  });

  it("shareability is saves and shares over reach, unknown without insights", () => {
    expect(shareability(post())).toBe(4);
    expect(shareability(post({ saved: null, shares: null }))).toBeNull();
    expect(shareability(post({ saved: 0, shares: null }))).toBe(0);
  });

  it("weights the account-wide rate by reach and skips posts without reach", () => {
    const posts = [
      post({ reach: 1000, likes: 100, comments: 0, saved: 0, shares: 0 }),
      post({ reach: 9000, likes: 0, comments: 0, saved: 0, shares: 0 }),
      post({ reach: null, likes: 999 }),
    ];
    expect(overallRate(posts, engagementNumerator)).toBe(1);
    expect(overallRate([post({ saved: null, shares: null })], shareabilityNumerator)).toBeNull();
  });

  it("finds the best weekday and 3-hour band in Paris time, ignoring one-off slots", () => {
    const posts = [
      post({ id: "a", timestamp: "2026-11-02T17:30:00+0000", reach: 10000 }), // Mon 18:30
      post({ id: "b", timestamp: "2026-11-09T17:00:00+0000", reach: 6000 }), // Mon 18:00
      post({ id: "c", timestamp: "2026-11-04T07:00:00+0000", reach: 500 }), // Wed 08:00
      post({ id: "d", timestamp: "2026-11-11T07:30:00+0000", reach: 700 }), // Wed 08:30
      post({ id: "e", timestamp: "2026-11-07T12:00:00+0000", reach: 99999 }), // Sat, alone
    ];
    const { days, hours } = bestSlots(posts);
    expect(days.map((d) => d.key)).toEqual([0, 2]);
    expect(days[0]).toEqual({ key: 0, avgReach: 8000, posts: 2 });
    expect(hours[0]).toEqual({ key: 18, avgReach: 8000, posts: 2 });
    expect(hours.map((h) => h.key)).toEqual([18, 6]);
  });
});
