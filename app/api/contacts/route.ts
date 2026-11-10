import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export type ContactRow = {
  id: string;
  igUserId: string;
  igUsername: string | null;
  email: string;
  firstName: string | null;
  account: string;
  campaigns: string[];
  firstCapturedAt: string | null;
  lastCapturedAt: string | null;
  crmSynced: boolean;
  crmError: string | null;
};

// People who gave an email in a DM, one row per person and Instagram account
// (a person can come through several campaigns). Newest first.
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const accountId = request.nextUrl.searchParams.get("instagramAccountId");
  const accountFilter = accountId && accountId !== "all" ? { instagramAccountId: accountId } : {};

  const [captures, awaiting] = await Promise.all([
    prisma.emailCapture.findMany({
      where: { workspaceId, status: "CAPTURED", email: { not: null }, ...accountFilter },
      orderBy: { capturedAt: "desc" },
      take: 10_000,
      select: {
        id: true,
        igUserId: true,
        igUsername: true,
        email: true,
        firstName: true,
        capturedAt: true,
        crmSyncedAt: true,
        crmError: true,
        instagramAccountId: true,
        automation: { select: { name: true, crmWebhookUrl: true } },
        instagramAccount: { select: { username: true } },
      },
    }),
    prisma.emailCapture.count({ where: { workspaceId, status: "AWAITING", ...accountFilter } }),
  ]);

  const byPerson = new Map<string, ContactRow>();
  for (const capture of captures) {
    const key = `${capture.instagramAccountId}:${capture.igUserId}`;
    const capturedAt = capture.capturedAt?.toISOString() ?? null;
    // A campaign with no CRM webhook has nothing to sync: not an error.
    const synced = Boolean(capture.crmSyncedAt) || !capture.automation.crmWebhookUrl;
    const row = byPerson.get(key);
    if (!row) {
      byPerson.set(key, {
        id: capture.id,
        igUserId: capture.igUserId,
        igUsername: capture.igUsername,
        email: capture.email!,
        firstName: capture.firstName,
        account: capture.instagramAccount.username,
        campaigns: [capture.automation.name],
        firstCapturedAt: capturedAt,
        lastCapturedAt: capturedAt,
        crmSynced: synced,
        crmError: synced ? null : capture.crmError,
      });
      continue;
    }
    if (!row.campaigns.includes(capture.automation.name)) row.campaigns.push(capture.automation.name);
    row.igUsername ??= capture.igUsername;
    row.firstName ??= capture.firstName;
    if (capturedAt) row.firstCapturedAt = capturedAt;
    if (!synced) {
      row.crmSynced = false;
      row.crmError ??= capture.crmError;
    }
  }

  return NextResponse.json({
    success: true,
    data: { contacts: [...byPerson.values()], awaiting },
  });
}
