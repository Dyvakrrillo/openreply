import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { hashRecipientId } from "@/lib/tracking/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import type { FlowStepStats } from "@/lib/flows/stats";

export const dynamic = "force-dynamic";

/**
 * Per-card numbers for a campaign's canvas, counted in people (not events):
 * how many got the step, how many tapped or clicked any of its buttons, how
 * many per button, and how many answered (email / first name).
 */
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing campaign ID" }, { status: 400 });
  }
  const campaign = await prisma.automation.findFirst({
    where: { id, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!campaign) {
    return NextResponse.json({ success: false, error: "Campaign not found" }, { status: 404 });
  }

  const events = await prisma.flowEvent.findMany({
    where: { automationId: id, workspaceId: context.workspaceId },
    select: { stepId: true, kind: true, buttonId: true, igUserId: true, recipientHash: true },
  });

  // A tap knows the user id, a link click only its hash: compare on the hash.
  const person = (e: { igUserId: string | null; recipientHash: string | null }) =>
    e.recipientHash ?? (e.igUserId ? hashRecipientId(e.igUserId) : null);

  const sets = new Map<string, { sent: Set<string>; acted: Set<string>; replied: Set<string>; buttons: Map<string, Set<string>> }>();
  for (const e of events) {
    const who = person(e);
    if (!who) continue;
    let s = sets.get(e.stepId);
    if (!s) {
      s = { sent: new Set(), acted: new Set(), replied: new Set(), buttons: new Map() };
      sets.set(e.stepId, s);
    }
    if (e.kind === "sent") s.sent.add(who);
    if (e.kind === "reply") s.replied.add(who);
    if ((e.kind === "button" || e.kind === "click") && e.buttonId) {
      s.acted.add(who);
      const b = s.buttons.get(e.buttonId) ?? new Set<string>();
      b.add(who);
      s.buttons.set(e.buttonId, b);
    }
  }

  const steps: Record<string, FlowStepStats> = {};
  for (const [stepId, s] of sets) {
    steps[stepId] = {
      sent: s.sent.size,
      clicked: s.acted.size,
      replied: s.replied.size,
      buttons: Object.fromEntries([...s.buttons].map(([buttonId, who]) => [buttonId, who.size])),
    };
  }

  return NextResponse.json({ success: true, data: { steps } });
}
