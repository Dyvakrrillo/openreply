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

/** The first name this person gave this Instagram account, through any campaign. */
export async function findKnownFirstName(
  instagramAccountId: string,
  igUserId: string,
): Promise<string | null> {
  const capture = await prisma.emailCapture.findFirst({
    where: { instagramAccountId, igUserId, firstName: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { firstName: true },
  });
  return capture?.firstName ?? null;
}

/**
 * Claim the right to ask this person their first name, once per person and
 * account: false when they already gave it, were already asked, or have no
 * captured email on this campaign. The claim marks the capture as waiting for
 * their next DM.
 */
export async function claimFirstNameQuestion(
  automationId: string,
  instagramAccountId: string,
  igUserId: string,
): Promise<boolean> {
  const alreadyAsked = await prisma.emailCapture.findFirst({
    where: {
      instagramAccountId,
      igUserId,
      OR: [{ firstName: { not: null } }, { firstNameAskedAt: { not: null } }],
    },
    select: { id: true },
  });
  if (alreadyAsked) return false;
  const claimed = await prisma.emailCapture.updateMany({
    where: { automationId, igUserId, status: "CAPTURED", firstNameAskedAt: null },
    data: { firstNameAskedAt: new Date(), firstNameAwaiting: true },
  });
  return claimed.count > 0;
}

/** The capture waiting for this person's first name, inside the messaging window. */
export async function findFirstNameAwaiting(instagramAccountId: string, igUserId: string) {
  return prisma.emailCapture.findFirst({
    where: {
      instagramAccountId,
      igUserId,
      firstNameAwaiting: true,
      firstNameAskedAt: { gte: new Date(Date.now() - EMAIL_CAPTURE_WINDOW_MS) },
    },
    orderBy: { firstNameAskedAt: "desc" },
  });
}

/**
 * An address this person already gave the same Instagram account, through any
 * campaign, or that was imported for their username (e.g. from a ManyChat
 * export). They are not asked twice: the flow moves straight on.
 */
export async function findCapturedEmail(
  instagramAccountId: string,
  igUserId: string,
  igUsername?: string | null,
): Promise<string | null> {
  const capture = await prisma.emailCapture.findFirst({
    where: { instagramAccountId, igUserId, status: "CAPTURED", email: { not: null } },
    orderBy: { capturedAt: "desc" },
    select: { email: true },
  });
  if (capture?.email) return capture.email;
  if (!igUsername) return null;
  const known = await prisma.knownContact.findFirst({
    where: {
      instagramAccountId,
      igUsername: { equals: igUsername.replace(/^@/, ""), mode: "insensitive" },
    },
    select: { email: true },
  });
  return known?.email ?? null;
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
  const firstName =
    capture.firstName ?? (await findKnownFirstName(capture.instagramAccountId, capture.igUserId));
  try {
    await pushContactToCrm(automation.crmWebhookUrl, {
      email: capture.email,
      instagramUsername: capture.igUsername,
      instagramUserId: capture.igUserId,
      sourceAccount: automation.instagramAccount.username,
      campaignName: automation.name,
      firstName,
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
