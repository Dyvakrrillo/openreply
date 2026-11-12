import { prisma } from "@/lib/db/client";
import { CLICK_ROW_SELECT, countUniqueClicksBy } from "@/lib/tracking/analytics";
import { hashRecipientId } from "@/lib/tracking/server";
import type { PostFunnel } from "@/lib/performance/metrics";

export interface UnassignedCampaign {
  id: string;
  name: string;
  people: number;
  emails: number;
  clicks: number;
}

export interface FunnelResponse {
  /** Funnel per Instagram media id. */
  byPost: Record<string, PostFunnel>;
  /** What could not be credited to a post, per campaign. */
  unassigned: UnassignedCampaign[];
  /** Comment-triggered DMs still without a known post (older ones). */
  missingPost: number;
}

interface Target {
  postId: string | null;
  automationIds: Set<string>;
  people: Set<string>;
  emails: Set<string>;
}

/**
 * What each post brought: people who got the DM, who gave an email, who
 * clicked. A person is credited to the post they commented on (stored on the
 * DM log), falling back to the post their campaign is attached to.
 */
export async function computeFunnel(
  workspaceId: string,
  account: { id: string }
): Promise<FunnelResponse> {
  const automations = await prisma.automation.findMany({
    where: { workspaceId, instagramAccountId: account.id },
    select: { id: true, name: true, postId: true },
  });
  const byId = new Map(automations.map((a) => [a.id, a]));
  const ids = automations.map((a) => a.id);

  const [logs, captures, clicks, missingPost] = await Promise.all([
    prisma.dmLog.findMany({
      where: { automationId: { in: ids }, status: "SENT" },
      select: { automationId: true, commenterId: true, mediaId: true },
    }),
    prisma.emailCapture.findMany({
      where: { automationId: { in: ids }, status: "CAPTURED" },
      select: { automationId: true, igUserId: true },
    }),
    prisma.linkClick.findMany({
      where: { automationId: { in: ids } },
      select: CLICK_ROW_SELECT,
    }),
    prisma.dmLog.count({
      where: {
        instagramAccountId: account.id,
        status: "SENT",
        mediaId: null,
        // Comment-triggered only: DMs, button taps and email answers have no post.
        commentText: { not: { startsWith: "(" } },
        NOT: [{ commentId: { startsWith: "dm:" } }, { commentId: { startsWith: "email:" } }],
        automation: { postId: null },
      },
    }),
  ]);

  const mediaByPerson = new Map<string, string>();
  const hashToPerson = new Map<string, string>();
  for (const log of logs) {
    if (log.mediaId) mediaByPerson.set(`${log.automationId}:${log.commenterId}`, log.mediaId);
    hashToPerson.set(`${log.automationId}:${hashRecipientId(log.commenterId)}`, log.commenterId);
  }

  const postOf = (automationId: string, personId: string | null): string | null =>
    (personId ? mediaByPerson.get(`${automationId}:${personId}`) : null) ??
    byId.get(automationId)?.postId ??
    null;
  const targetKey = (automationId: string, postId: string | null) =>
    postId ?? `u:${automationId}`;

  const targets = new Map<string, Target>();
  const target = (automationId: string, postId: string | null): Target => {
    const key = targetKey(automationId, postId);
    let entry = targets.get(key);
    if (!entry) {
      entry = { postId, automationIds: new Set(), people: new Set(), emails: new Set() };
      targets.set(key, entry);
    }
    entry.automationIds.add(automationId);
    return entry;
  };

  for (const log of logs) {
    target(log.automationId, log.mediaId ?? byId.get(log.automationId)?.postId ?? null).people.add(
      log.commenterId
    );
  }
  for (const capture of captures) {
    target(capture.automationId, postOf(capture.automationId, capture.igUserId)).emails.add(
      capture.igUserId
    );
  }
  const clicksBy = countUniqueClicksBy(clicks, (click) => {
    const person = click.recipientHash
      ? (hashToPerson.get(`${click.automationId}:${click.recipientHash}`) ?? null)
      : null;
    const key = targetKey(click.automationId, postOf(click.automationId, person));
    target(click.automationId, postOf(click.automationId, person));
    return key;
  });

  const byPost: Record<string, PostFunnel> = {};
  const unassigned: UnassignedCampaign[] = [];
  for (const [key, entry] of targets) {
    const clickCount = clicksBy.get(key) ?? 0;
    if (entry.postId) {
      const existing = byPost[entry.postId] ?? { campaigns: [], people: 0, emails: 0, clicks: 0 };
      for (const id of entry.automationIds) {
        const name = byId.get(id)?.name;
        if (name && !existing.campaigns.includes(name)) existing.campaigns.push(name);
      }
      existing.people = entry.people.size;
      existing.emails = entry.emails.size;
      existing.clicks += clickCount;
      byPost[entry.postId] = existing;
    } else {
      const id = [...entry.automationIds][0];
      unassigned.push({
        id,
        name: byId.get(id)?.name ?? "",
        people: entry.people.size,
        emails: entry.emails.size,
        clicks: clickCount,
      });
    }
  }

  return {
    byPost,
    unassigned: unassigned.filter((c) => c.people > 0 || c.emails > 0 || c.clicks > 0),
    missingPost,
  };
}
