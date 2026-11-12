import { prisma } from "@/lib/db/client";
import {
  getAccountTotalInsight,
  getOnlineFollowersByHour,
  type InsightBreakdownRow,
} from "@/lib/meta/client";

// Who the account's audience is and when it is online, from Instagram account
// insights. Every call is independent and may fail on its own (too few
// followers, missing permission, metric renamed by Meta): a failure is recorded
// in `errors` and the rest still comes back.

export interface AudienceSnapshot {
  gender: InsightBreakdownRow[];
  age: InsightBreakdownRow[];
  country: InsightBreakdownRow[];
  city: InsightBreakdownRow[];
  /** Followers online per hour (index = hour 0-23), or null. */
  onlineByHour: number[] | null;
  /** Last 30 days, account level. */
  account: {
    reach: number | null;
    views: number | null;
    accountsEngaged: number | null;
    profileLinksTaps: number | null;
  };
  errors: Record<string, string>;
  fetchedAt: string;
}

// Demographics need a timeframe; Meta has renamed these, so try a few.
const DEMOGRAPHIC_TIMEFRAMES = ["last_30_days", "this_month", "last_90_days"];

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

export async function fetchAudienceSnapshot(
  accessToken: string,
  instagramAccountId: string
): Promise<AudienceSnapshot> {
  const errors: Record<string, string> = {};

  async function demographic(breakdown: string): Promise<InsightBreakdownRow[]> {
    let lastError: unknown;
    for (const timeframe of DEMOGRAPHIC_TIMEFRAMES) {
      try {
        const { results } = await getAccountTotalInsight(accessToken, instagramAccountId, {
          metric: "follower_demographics",
          period: "lifetime",
          breakdown,
          timeframe,
        });
        return results.sort((a, b) => b.value - a.value);
      } catch (error) {
        lastError = error;
      }
    }
    errors[breakdown] = shortError(lastError);
    return [];
  }

  async function counter(metric: string): Promise<number | null> {
    try {
      const { total } = await getAccountTotalInsight(accessToken, instagramAccountId, {
        metric,
        sinceDaysAgo: 30,
      });
      return total;
    } catch (error) {
      errors[metric] = shortError(error);
      return null;
    }
  }

  const [gender, age, country, city, online, reach, views, accountsEngaged, profileLinksTaps] =
    await Promise.all([
      demographic("gender"),
      demographic("age"),
      demographic("country"),
      demographic("city"),
      getOnlineFollowersByHour(accessToken, instagramAccountId).catch((error) => {
        errors.online_followers = shortError(error);
        return null;
      }),
      counter("reach"),
      counter("views"),
      counter("accounts_engaged"),
      counter("profile_links_taps"),
    ]);

  return {
    gender,
    age,
    country,
    city,
    onlineByHour: online?.hours ?? null,
    account: { reach, views, accountsEngaged, profileLinksTaps },
    errors,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Keep today's audience snapshot (one per account per day, the latest of the
 * day wins). Skipped when nothing came back, so an outage never overwrites a
 * good day with an empty one.
 */
export async function recordAudienceSnapshot(
  instagramAccountId: string,
  snapshot: AudienceSnapshot
): Promise<boolean> {
  const hasData =
    snapshot.gender.length > 0 ||
    snapshot.age.length > 0 ||
    snapshot.onlineByHour !== null ||
    snapshot.account.reach !== null;
  if (!hasData) return false;
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  await prisma.insightsSnapshot.upsert({
    where: { instagramAccountId_date: { instagramAccountId, date } },
    create: { instagramAccountId, date, payload: JSON.parse(JSON.stringify(snapshot)) },
    update: { payload: JSON.parse(JSON.stringify(snapshot)) },
  });
  return true;
}
