// Per-post performance maths for the Performance page. Pure functions: the
// numbers come from Instagram insights (reach, likes...) and from OpenReply's
// own funnel (people served, emails, clicks) and are only combined here.

export interface PerfPost {
  id: string;
  timestamp: string;
  reach: number | null;
  likes: number;
  comments: number;
  saved: number | null;
  shares: number | null;
}

export interface PostFunnel {
  campaigns: string[];
  /** Distinct people whose DM was sent. */
  people: number;
  /** Distinct people who gave an email. */
  emails: number;
  /** Unique link clicks. */
  clicks: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** A percentage with one decimal, or null when there is nothing to divide by. */
export function percent(part: number, whole: number | null | undefined): number | null {
  if (!whole || whole <= 0) return null;
  return round1((part / whole) * 100);
}

/** Likes, comments, saves and shares over reach. */
export function engagementRate(post: PerfPost): number | null {
  return percent(post.likes + post.comments + (post.saved ?? 0) + (post.shares ?? 0), post.reach);
}

/** Shares and saves over reach: what people found worth keeping or passing on. */
export function shareability(post: PerfPost): number | null {
  if (post.saved === null && post.shares === null) return null;
  return percent((post.saved ?? 0) + (post.shares ?? 0), post.reach);
}

/**
 * Account-wide rate over several posts: total numerator over total reach, so a
 * tiny post does not weigh as much as a big one. Posts without reach are left out.
 */
export function overallRate(
  posts: PerfPost[],
  numerator: (post: PerfPost) => number | null
): number | null {
  let top = 0;
  let reach = 0;
  for (const post of posts) {
    const n = numerator(post);
    if (!post.reach || n === null) continue;
    top += n;
    reach += post.reach;
  }
  return percent(top, reach);
}

export const engagementNumerator = (p: PerfPost) =>
  p.likes + p.comments + (p.saved ?? 0) + (p.shares ?? 0);
export const shareabilityNumerator = (p: PerfPost) =>
  p.saved === null && p.shares === null ? null : (p.saved ?? 0) + (p.shares ?? 0);

export interface Slot {
  /** Weekday (0 = Monday ... 6 = Sunday) or the first hour of a 3-hour band. */
  key: number;
  /** Median reach of the posts in the slot: one viral post cannot carry it. */
  medianReach: number;
  posts: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const HOUR_BAND = 3;

function localParts(iso: string, timeZone: string): { weekday: number; hour: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (weekday < 0 || !Number.isFinite(hour)) return null;
  return { weekday, hour: hour % 24 };
}

function topSlots(groups: Map<number, number[]>, minPosts: number, limit: number): Slot[] {
  return [...groups]
    .filter(([, reaches]) => reaches.length >= minPosts)
    .map(([key, reaches]) => ({
      key,
      medianReach: median(reaches),
      posts: reaches.length,
    }))
    .sort((a, b) => b.medianReach - a.medianReach)
    .slice(0, limit);
}

/**
 * Best weekdays and 3-hour bands to publish, from the median reach of the
 * account's own posts. A slot needs at least `minPosts` posts to count, so one
 * lucky post cannot pose as a rule.
 */
export function bestSlots(
  posts: PerfPost[],
  { timeZone = "Europe/Paris", minPosts = 2, limit = 3 } = {}
): { days: Slot[]; hours: Slot[] } {
  const days = new Map<number, number[]>();
  const hours = new Map<number, number[]>();
  for (const post of posts) {
    if (post.reach === null) continue;
    const local = localParts(post.timestamp, timeZone);
    if (!local) continue;
    const band = Math.floor(local.hour / HOUR_BAND) * HOUR_BAND;
    days.set(local.weekday, [...(days.get(local.weekday) ?? []), post.reach]);
    hours.set(band, [...(hours.get(band) ?? []), post.reach]);
  }
  return { days: topSlots(days, minPosts, limit), hours: topSlots(hours, minPosts, limit) };
}
