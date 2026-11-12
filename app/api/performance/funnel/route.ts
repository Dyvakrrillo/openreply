import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { CLICK_ROW_SELECT, countUniqueClicksBy } from "@/lib/tracking/analytics";
import type { PostFunnel } from "@/lib/performance/metrics";

export const dynamic = "force-dynamic";

export interface UnassignedCampaign {
  id: string;
  name: string;
  people: number;
  emails: number;
  clicks: number;
}

export interface FunnelResponse {
  /** Funnel per Instagram media id, for campaigns attached to one post. */
  byPost: Record<string, PostFunnel>;
  /** Campaigns on any post or the next reel: no single post to credit. */
  unassigned: UnassignedCampaign[];
}

// What each campaign brought: people who got the DM, who gave an email, who
// clicked. Database only, so it answers instantly next to the slow Instagram
// insights calls.
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }

  const automations = await prisma.automation.findMany({
    where: { workspaceId, instagramAccountId: account.id },
    select: { id: true, name: true, postId: true },
  });
  const ids = automations.map((a) => a.id);

  const [logs, captures, clicks] = await Promise.all([
    prisma.dmLog.findMany({
      where: { automationId: { in: ids }, status: "SENT" },
      select: { automationId: true, commenterId: true },
    }),
    prisma.emailCapture.findMany({
      where: { automationId: { in: ids }, status: "CAPTURED" },
      select: { automationId: true, igUserId: true },
    }),
    prisma.linkClick.findMany({
      where: { automationId: { in: ids } },
      select: CLICK_ROW_SELECT,
    }),
  ]);

  const peopleBy = new Map<string, Set<string>>();
  for (const log of logs) {
    const set = peopleBy.get(log.automationId) ?? new Set<string>();
    set.add(log.commenterId);
    peopleBy.set(log.automationId, set);
  }
  const emailsBy = new Map<string, Set<string>>();
  for (const capture of captures) {
    const set = emailsBy.get(capture.automationId) ?? new Set<string>();
    set.add(capture.igUserId);
    emailsBy.set(capture.automationId, set);
  }
  const clicksBy = countUniqueClicksBy(clicks, (click) => click.automationId);

  const byPost: Record<string, PostFunnel & { peopleSet: Set<string>; emailSet: Set<string> }> = {};
  const unassigned: UnassignedCampaign[] = [];

  for (const automation of automations) {
    const people = peopleBy.get(automation.id) ?? new Set<string>();
    const emails = emailsBy.get(automation.id) ?? new Set<string>();
    const clickCount = clicksBy.get(automation.id) ?? 0;
    if (!automation.postId) {
      unassigned.push({
        id: automation.id,
        name: automation.name,
        people: people.size,
        emails: emails.size,
        clicks: clickCount,
      });
      continue;
    }
    const entry = (byPost[automation.postId] ??= {
      campaigns: [],
      people: 0,
      emails: 0,
      clicks: 0,
      peopleSet: new Set<string>(),
      emailSet: new Set<string>(),
    });
    entry.campaigns.push(automation.name);
    people.forEach((p) => entry.peopleSet.add(p));
    emails.forEach((p) => entry.emailSet.add(p));
    entry.clicks += clickCount;
  }

  // Several campaigns on one post count each person once.
  const clean: Record<string, PostFunnel> = {};
  for (const [postId, entry] of Object.entries(byPost)) {
    clean[postId] = {
      campaigns: entry.campaigns,
      people: entry.peopleSet.size,
      emails: entry.emailSet.size,
      clicks: entry.clicks,
    };
  }

  const data: FunnelResponse = {
    byPost: clean,
    unassigned: unassigned.filter((c) => c.people > 0 || c.emails > 0 || c.clicks > 0),
  };
  return NextResponse.json({ success: true, data });
}
