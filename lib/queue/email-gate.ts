import { prisma } from "@/lib/db/client";
import {
  CrmSyncError,
  EMAIL_CAPTURE_WINDOW_MS,
  pushContactToCrm,
} from "@/lib/email-capture";

// Persistence side of the email gate. Sending lives in dm-worker.ts; this file
// only records who we asked, what they answered, and the CRM hand-off.

export type EmailGateAutomation = {
  id: string;
  name: string;
  workspaceId: string;
  instagramAccountId: string;
  crmWebhookUrl: string | null;
  instagramAccount: { username: string };
};

/**
 * An address this person already gave the same Instagram account, through any
 * campaign. They are not asked twice: the link goes straight out.
 */
export async function findCapturedEmail(
  instagramAccountId: string,
  igUserId: string,
): Promise<string | null> {
  const capture = await prisma.emailCapture.findFirst({
    where: { instagramAccountId, igUserId, status: "CAPTURED", email: { not: null } },
    orderBy: { capturedAt: "desc" },
    select: { email: true },
  });
  return capture?.email ?? null;
}

/** Record that we asked this person for their address on this campaign. */
export async function markEmailAwaiting(
  automation: EmailGateAutomation,
  igUserId: string,
  igUsername: string | null,
): Promise<void> {
  await prisma.emailCapture.upsert({
    where: { automationId_igUserId: { automationId: automation.id, igUserId } },
    create: {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      igUserId,
      igUsername,
      status: "AWAITING",
    },
    update: {
      status: "AWAITING",
      invalidAttempts: 0,
      ...(igUsername ? { igUsername } : {}),
    },
  });
}

/** The newest campaign still waiting for this person to type an address. */
export async function findAwaitingCapture(instagramAccountId: string, igUserId: string) {
  return prisma.emailCapture.findFirst({
    where: {
      instagramAccountId,
      igUserId,
      status: "AWAITING",
      updatedAt: { gte: new Date(Date.now() - EMAIL_CAPTURE_WINDOW_MS) },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Store an address for a campaign the person had already given it for
 * elsewhere, so this campaign's CRM list and tags get them too.
 */
export async function recordKnownEmail(
  automation: EmailGateAutomation,
  igUserId: string,
  igUsername: string | null,
  email: string,
): Promise<void> {
  const capture = await prisma.emailCapture.upsert({
    where: { automationId_igUserId: { automationId: automation.id, igUserId } },
    create: {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      igUserId,
      igUsername,
      email,
      status: "CAPTURED",
      capturedAt: new Date(),
    },
    update: {},
    select: { id: true, crmSyncedAt: true },
  });
  if (!capture.crmSyncedAt) await syncCaptureToCrm(capture.id, automation);
}

/**
 * Push a captured contact to the campaign's CRM webhook. Best-effort: a CRM
 * outage never blocks the link, it is recorded on the capture and as an
 * operational event so it can be replayed by hand.
 */
export async function syncCaptureToCrm(
  captureId: string,
  automation: EmailGateAutomation,
): Promise<void> {
  if (!automation.crmWebhookUrl) return;
  const capture = await prisma.emailCapture.findUnique({ where: { id: captureId } });
  if (!capture?.email) return;
  try {
    await pushContactToCrm(automation.crmWebhookUrl, {
      email: capture.email,
      instagramUsername: capture.igUsername,
      instagramUserId: capture.igUserId,
      sourceAccount: automation.instagramAccount.username,
      campaignName: automation.name,
    });
    await prisma.emailCapture.update({
      where: { id: captureId },
      data: { crmSyncedAt: new Date(), crmError: null },
    });
  } catch (error) {
    const message =
      error instanceof CrmSyncError || error instanceof Error ? error.message : "Unknown error";
    await prisma.emailCapture
      .update({ where: { id: captureId }, data: { crmError: message } })
      .catch(() => {});
    await prisma.operationalEvent
      .create({
        data: {
          workspaceId: automation.workspaceId,
          source: "WORKER",
          level: "ERROR",
          message: "CRM sync failed for a captured email",
          payload: { automationId: automation.id, captureId, error: message },
        },
      })
      .catch(() => {});
  }
}
