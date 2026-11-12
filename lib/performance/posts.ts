import {
  getAllUserMedia,
  getMediaInsights,
  PermissionError,
  type InstagramContext,
  type InstagramMedia,
} from "@/lib/instagram/provider";

// Safety ceiling for "all time": bounds pagination and the number of
// per-media insight requests so we can't hammer the API or time out.
export const MAX_POSTS = 500;

// How many insight requests to run at once.
const INSIGHTS_CONCURRENCY = 8;

/** Map over items with a bounded number of in-flight async operations. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return results;
}

export interface OverviewPost {
  id: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  mediaType: string;
  timestamp: string;
  views: number | null;
  reach: number | null;
  likes: number;
  comments: number;
  saved: number | null;
  shares: number | null;
}

function isVideoLike(media: InstagramMedia): boolean {
  return media.media_product_type === "REELS" || media.media_type === "VIDEO";
}

/**
 * The account's latest posts with their insights. Likes and comments come free
 * with the media fields; views / reach / saved / shares need the insights
 * permission, so they are fetched per media (bounded concurrency) and degrade
 * to null if the token was granted before that scope.
 */
export async function loadPostsWithInsights(
  context: InstagramContext,
  count: number,
  { zernio25Cap = false }: { zernio25Cap?: boolean } = {}
): Promise<{
  posts: OverviewPost[];
  truncated: boolean;
  insightsAvailable: boolean;
}> {
  const target = Math.min(Math.max(count, 1), MAX_POSTS);
  const media = await getAllUserMedia({ context, max: target });
  const truncated =
    media.length >= MAX_POSTS || (zernio25Cap && media.length >= 25);

  let insightsAvailable = false;
  let permissionDenied = false;

  const insights = await mapWithConcurrency(
    media,
    INSIGHTS_CONCURRENCY,
    async (m) => {
      const metrics = isVideoLike(m)
        ? ["views", "reach", "saved", "shares", "total_interactions"]
        : ["reach", "saved", "shares", "total_interactions"];
      try {
        const data = await getMediaInsights({
          context,
          mediaId: m.id,
          metrics,
        });
        insightsAvailable = true;
        return data;
      } catch (err) {
        if (err instanceof PermissionError) permissionDenied = true;
        return null;
      }
    }
  );

  const posts: OverviewPost[] = media.map((m, i) => {
    const ins = insights[i];
    return {
      id: m.id,
      caption: m.caption?.trim().slice(0, 120) ?? null,
      permalink: m.permalink ?? null,
      thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
      mediaType: m.media_product_type ?? m.media_type,
      timestamp: m.timestamp,
      views: ins?.views ?? null,
      reach: ins?.reach ?? null,
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      saved: ins?.saved ?? null,
      shares: ins?.shares ?? null,
    };
  });

  return { posts, truncated, insightsAvailable: insightsAvailable && !permissionDenied };
}
