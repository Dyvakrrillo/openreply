import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { computeFunnel } from "@/lib/performance/funnel";

export const dynamic = "force-dynamic";

export type { FunnelResponse, UnassignedCampaign } from "@/lib/performance/funnel";

// Database only, so it answers instantly next to the slow Instagram insights
// calls.
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
  const data = await computeFunnel(workspaceId, account);
  return NextResponse.json({ success: true, data });
}
