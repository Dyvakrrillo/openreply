import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { createInstagramContext } from "@/lib/instagram/provider";
import { fetchAudienceSnapshot, type AudienceSnapshot } from "@/lib/performance/audience";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface AudienceResponse {
  account: { id: string; username: string };
  accounts: Array<{ id: string; username: string }>;
  snapshot: AudienceSnapshot | null;
  /** Why there is no snapshot (e.g. Zernio accounts). */
  unavailable?: string;
}

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
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true, username: true },
  });

  const base = { account: { id: account.id, username: account.username }, accounts };
  try {
    const context = await createInstagramContext(account);
    if (context.provider !== "META") {
      const data: AudienceResponse = {
        ...base,
        snapshot: null,
        unavailable: "Audience insights are not available through Zernio.",
      };
      return NextResponse.json({ success: true, data });
    }
    const snapshot = await fetchAudienceSnapshot(context.accessToken, account.instagramId);
    const data: AudienceResponse = { ...base, snapshot };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Audience] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load audience" },
      { status: 500 }
    );
  }
}
