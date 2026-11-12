import { bestSlots, engagementRate, overallRate, engagementNumerator, shareability, shareabilityNumerator, type PerfPost } from "@/lib/performance/metrics";
import { withShares } from "@/lib/performance/audience-math";
import type { AudienceSnapshot } from "@/lib/performance/audience";
import type { FunnelResponse } from "@/lib/performance/funnel";
import type { OverviewPost } from "@/lib/performance/posts";

// What the model is given: a compact, numbers-first picture of the account.
// Nothing here is a comment, a DM or a person's data: only the account's own
// captions and aggregate counts.

export interface AdviceInput {
  account: {
    username: string;
    followers: number | null;
    /** Net follower change over the days Cindy's history covers (about 30 when available). */
    followersChange: { days: number; delta: number } | null;
  };
  last30Days: AudienceSnapshot["account"] | null;
  audience: {
    gender: Array<{ label: string; pct: number }>;
    age: Array<{ label: string; pct: number }>;
    countries: Array<{ label: string; pct: number }>;
  } | null;
  totals: {
    posts: number;
    engagementRatePct: number | null;
    shareabilityPct: number | null;
    peopleServed: number;
    emailsCollected: number;
    linkClicks: number;
  };
  typicalReachByFormat: Array<{ format: string; posts: number; medianReach: number }>;
  bestSlots: { weekdays: Array<{ day: string; medianReach: number; posts: number }>; hours: Array<{ from: string; medianReach: number; posts: number }> };
  posts: Array<{
    date: string;
    format: string;
    caption: string;
    reach: number | null;
    views: number | null;
    likes: number;
    comments: number;
    saves: number | null;
    shares: number | null;
    engagementPct: number | null;
    shareabilityPct: number | null;
    funnel: { campaigns: string[]; peopleServed: number; emails: number; linkClicks: number } | null;
  }>;
  campaignsWithoutKnownPost: Array<{ campaign: string; peopleServed: number; emails: number; linkClicks: number }>;
  strategyBrief: string;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MAX_POSTS_IN_PROMPT = 30;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function topShares(rows: Array<{ label: string; value: number }>, limit: number) {
  return withShares(rows).slice(0, limit).map((r) => ({ label: r.label, pct: r.share }));
}

export function buildAdviceInput({
  username,
  followers,
  followerHistory,
  posts,
  funnel,
  audience,
  strategyBrief,
}: {
  username: string;
  followers: number | null;
  followerHistory: Array<{ date: string; followers: number }>;
  posts: OverviewPost[];
  funnel: FunnelResponse;
  audience: AudienceSnapshot | null;
  strategyBrief: string | null;
}): AdviceInput {
  const perf: PerfPost[] = posts;
  const sumFunnel = (pick: (f: { people: number; emails: number; clicks: number }) => number) =>
    Object.values(funnel.byPost).reduce((t, f) => t + pick(f), 0) +
    funnel.unassigned.reduce((t, c) => t + pick(c), 0);

  // The point closest to 30 days ago, so the change is stated over the days it
  // really covers.
  const latest = followerHistory[followerHistory.length - 1];
  const dayMs = 86_400_000;
  const target = Date.now() - 30 * dayMs;
  const baseline = [...followerHistory]
    .slice(0, -1)
    .sort((a, b) => Math.abs(new Date(a.date).getTime() - target) - Math.abs(new Date(b.date).getTime() - target))[0];
  const followersChange =
    baseline && latest
      ? {
          days: Math.round((new Date(latest.date).getTime() - new Date(baseline.date).getTime()) / dayMs),
          delta: latest.followers - baseline.followers,
        }
      : null;

  const slots = bestSlots(perf);
  const formats = new Map<string, number[]>();
  for (const post of posts) {
    if (post.reach === null) continue;
    formats.set(post.mediaType, [...(formats.get(post.mediaType) ?? []), post.reach]);
  }

  return {
    account: { username, followers, followersChange },
    last30Days: audience?.account ?? null,
    audience:
      audience && (audience.gender.length || audience.age.length || audience.country.length)
        ? {
            gender: topShares(audience.gender, 3),
            age: topShares(audience.age, 5),
            countries: topShares(audience.country, 5),
          }
        : null,
    totals: {
      posts: posts.length,
      engagementRatePct: overallRate(perf, engagementNumerator),
      shareabilityPct: overallRate(perf, shareabilityNumerator),
      peopleServed: sumFunnel((f) => f.people),
      emailsCollected: sumFunnel((f) => f.emails),
      linkClicks: sumFunnel((f) => f.clicks),
    },
    typicalReachByFormat: [...formats].map(([format, reaches]) => ({
      format,
      posts: reaches.length,
      medianReach: median(reaches),
    })),
    bestSlots: {
      weekdays: slots.days.map((s) => ({ day: WEEKDAYS[s.key], medianReach: s.medianReach, posts: s.posts })),
      hours: slots.hours.map((s) => ({ from: `${s.key}h-${s.key + 3}h (Paris)`, medianReach: s.medianReach, posts: s.posts })),
    },
    posts: posts.slice(0, MAX_POSTS_IN_PROMPT).map((post) => {
      const f = funnel.byPost[post.id];
      return {
        date: post.timestamp.slice(0, 10),
        format: post.mediaType,
        caption: (post.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
        reach: post.reach,
        views: post.views,
        likes: post.likes,
        comments: post.comments,
        saves: post.saved,
        shares: post.shares,
        engagementPct: engagementRate(post),
        shareabilityPct: shareability(post),
        funnel: f ? { campaigns: f.campaigns, peopleServed: f.people, emails: f.emails, linkClicks: f.clicks } : null,
      };
    }),
    campaignsWithoutKnownPost: funnel.unassigned.map((c) => ({
      campaign: c.name,
      peopleServed: c.people,
      emails: c.emails,
      linkClicks: c.clicks,
    })),
    strategyBrief: (strategyBrief ?? "").trim().slice(0, 3000),
  };
}
