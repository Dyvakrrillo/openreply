import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { campaignToFlow } from "@/lib/flows/from-campaign";
import { flowSchema, parseFlow } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/types";
import { syncFlowLinks } from "@/lib/flows/links";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

/**
 * The canvas version of a campaign. A campaign never saved from the canvas
 * gets its flow drawn from its form fields (`derived: true`); nothing is
 * written until the canvas saves.
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
    include: {
      instagramAccount: { select: { id: true, username: true } },
      trackedLinks: {
        select: { destinationUrl: true, label: true, position: true },
        orderBy: TRACKED_LINK_ORDER,
      },
    },
  });
  if (!campaign) {
    return NextResponse.json({ success: false, error: "Campaign not found" }, { status: 404 });
  }

  const saved = campaign.flow ? parseFlow(campaign.flow) : null;
  // Always sent so the canvas can redraw from the form at any time.
  const formFlow = campaignToFlow(campaign);
  const flow = saved ?? formFlow;

  return NextResponse.json({
    success: true,
    data: {
      flow,
      formFlow,
      derived: !saved,
      flowEnabled: campaign.flowEnabled,
      flowSavedAt: campaign.flowSavedAt,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        isActive: campaign.isActive,
        instagramAccountId: campaign.instagramAccountId,
        username: campaign.instagramAccount?.username ?? null,
        keywords: campaign.keywords,
        matchAnyWord: campaign.matchAnyWord,
        matchAnyPost: campaign.matchAnyPost,
        pendingNextReel: campaign.pendingNextReel,
        postId: campaign.postId,
        dmTriggerEnabled: campaign.dmTriggerEnabled,
        publicReplyEnabled: campaign.publicReplyEnabled,
        publicReplyMessages: campaign.publicReplyMessages,
      },
    },
  });
}

/**
 * Save the canvas (`{ flow }`) or switch the step engine (`{ flowEnabled }`).
 * Saving writes only `flow` and `flowSavedAt`: the form fields are never
 * touched, so turning the engine off returns the campaign to exactly what it
 * did before.
 */
export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can edit campaigns" },
      { status: 403 }
    );
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing campaign ID" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);

  // Switching the step engine on or off. On needs a valid saved flow; off
  // hands the campaign back to its form settings, which were never changed.
  if (typeof body?.flowEnabled === "boolean" && body.flow === undefined) {
    const campaign = await prisma.automation.findFirst({
      where: { id, workspaceId: context.workspaceId },
      select: { flow: true },
    });
    if (!campaign) {
      return NextResponse.json({ success: false, error: "Campaign not found" }, { status: 404 });
    }
    if (body.flowEnabled) {
      const saved = campaign.flow ? parseFlow(campaign.flow) : null;
      const problems = saved ? validateFlow(saved) : ["Save the canvas before switching it on."];
      if (!saved || problems.length > 0) {
        return NextResponse.json({ success: false, error: problems[0], problems }, { status: 400 });
      }
      // Canvases saved before link tracking get their links now.
      await syncFlowLinks({ workspaceId: context.workspaceId, automationId: id, flow: saved });
    }
    await prisma.automation.updateMany({
      where: { id, workspaceId: context.workspaceId },
      data: { flowEnabled: body.flowEnabled },
    });
    return NextResponse.json({ success: true, flowEnabled: body.flowEnabled });
  }

  const parsed = flowSchema.safeParse(body?.flow);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid flow" }, { status: 400 });
  }
  const problems = validateFlow(parsed.data);
  if (problems.length > 0) {
    return NextResponse.json({ success: false, error: problems[0], problems }, { status: 400 });
  }

  const updated = await prisma.automation.updateMany({
    where: { id, workspaceId: context.workspaceId },
    data: { flow: parsed.data, flowSavedAt: new Date() },
  });
  if (updated.count === 0) {
    return NextResponse.json({ success: false, error: "Campaign not found" }, { status: 404 });
  }
  await syncFlowLinks({ workspaceId: context.workspaceId, automationId: id, flow: parsed.data });
  return NextResponse.json({ success: true });
}
