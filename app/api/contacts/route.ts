import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { extractEmail } from "@/lib/email-capture";
import { normalizeUsername } from "@/lib/email-capture/known-contacts";
import { syncCaptureToCrm } from "@/lib/queue/email-gate";

export const dynamic = "force-dynamic";

export type ContactRow = {
  id: string;
  // "capture": gave the email in a DM. "known": imported or added by hand,
  // not reached by a campaign yet.
  source: "capture" | "known";
  instagramAccountId: string;
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

  const [captures, awaiting, known] = await Promise.all([
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
    prisma.knownContact.findMany({
      where: { workspaceId, ...accountFilter },
      orderBy: { createdAt: "desc" },
      take: 10_000,
      select: {
        id: true,
        igUsername: true,
        email: true,
        firstName: true,
        createdAt: true,
        instagramAccountId: true,
        instagramAccount: { select: { username: true } },
      },
    }),
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
        source: "capture",
        instagramAccountId: capture.instagramAccountId,
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

  // Imported or hand-added people: shown once, unless a campaign already
  // reached them (their DM row wins, and borrows a hand-typed first name).
  const knownByUsername = new Map(
    known.map((contact) => [`${contact.instagramAccountId}:${contact.igUsername.toLowerCase()}`, contact])
  );
  for (const row of byPerson.values()) {
    if (!row.igUsername) continue;
    const match = knownByUsername.get(`${row.instagramAccountId}:${row.igUsername.toLowerCase()}`);
    if (!match) continue;
    row.firstName ??= match.firstName;
    knownByUsername.delete(`${row.instagramAccountId}:${row.igUsername.toLowerCase()}`);
  }
  const knownRows: ContactRow[] = [...knownByUsername.values()].map((contact) => ({
    id: contact.id,
    source: "known",
    instagramAccountId: contact.instagramAccountId,
    igUserId: "",
    igUsername: contact.igUsername,
    email: contact.email,
    firstName: contact.firstName,
    account: contact.instagramAccount.username,
    campaigns: [],
    firstCapturedAt: contact.createdAt.toISOString(),
    lastCapturedAt: contact.createdAt.toISOString(),
    crmSynced: true,
    crmError: null,
  }));

  return NextResponse.json({
    success: true,
    data: { contacts: [...byPerson.values(), ...knownRows], awaiting },
  });
}

const firstNameField = z
  .string()
  .max(60)
  .nullable()
  .optional()
  .transform((value) => value?.trim() || null);

const editSchema = z.object({
  source: z.enum(["capture", "known"]),
  id: z.string().min(1),
  email: z.string().max(254),
  firstName: firstNameField,
});

const addSchema = z.object({
  instagramAccountId: z.string().min(1),
  igUsername: z.string().min(1).max(100),
  email: z.string().max(254),
  firstName: firstNameField,
});

function invalid(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Add someone by hand (e.g. an email they gave on ManyChat): campaigns that
 * ask for an email skip the question for them, and their first name is used.
 */
export async function POST(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return invalid("Unauthorized", 401);
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid input");
  const igUsername = normalizeUsername(parsed.data.igUsername);
  if (!igUsername) return invalid("Invalid Instagram username");
  const email = extractEmail(parsed.data.email);
  if (!email || email !== parsed.data.email.trim().toLowerCase()) return invalid("Invalid email address");

  const account = await prisma.instagramAccount.findFirst({
    where: { id: parsed.data.instagramAccountId, workspaceId },
    select: { id: true },
  });
  if (!account) return invalid("Instagram account not found", 404);

  // Someone a campaign already reached: correct their row instead.
  const capture = await prisma.emailCapture.findFirst({
    where: {
      instagramAccountId: account.id,
      status: "CAPTURED",
      igUsername: { equals: igUsername, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (capture) {
    return editCapture(workspaceId, capture.id, email, parsed.data.firstName);
  }

  await prisma.knownContact.upsert({
    where: { instagramAccountId_igUsername: { instagramAccountId: account.id, igUsername } },
    create: {
      workspaceId,
      instagramAccountId: account.id,
      igUsername,
      email,
      firstName: parsed.data.firstName,
      source: "manual",
    },
    update: { email, firstName: parsed.data.firstName },
  });
  return NextResponse.json({ success: true });
}

/** Correct a contact's email and/or first name. */
export async function PATCH(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return invalid("Unauthorized", 401);
  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid input");
  const email = extractEmail(parsed.data.email);
  if (!email || email !== parsed.data.email.trim().toLowerCase()) return invalid("Invalid email address");

  if (parsed.data.source === "known") {
    const updated = await prisma.knownContact.updateMany({
      where: { id: parsed.data.id, workspaceId },
      data: { email, firstName: parsed.data.firstName },
    });
    if (updated.count === 0) return invalid("Contact not found", 404);
    return NextResponse.json({ success: true });
  }
  return editCapture(workspaceId, parsed.data.id, email, parsed.data.firstName);
}

/**
 * Apply the change to every campaign this person came through on that
 * Instagram account, then send the corrected contact to each campaign's CRM.
 */
async function editCapture(
  workspaceId: string,
  captureId: string,
  email: string,
  firstName: string | null
) {
  const capture = await prisma.emailCapture.findFirst({
    where: { id: captureId, workspaceId },
    select: { instagramAccountId: true, igUserId: true, igUsername: true },
  });
  if (!capture) return invalid("Contact not found", 404);

  const where = {
    workspaceId,
    instagramAccountId: capture.instagramAccountId,
    igUserId: capture.igUserId,
    status: "CAPTURED" as const,
  };
  const rows = await prisma.emailCapture.findMany({ where, select: { id: true, email: true, firstName: true } });
  const changed = rows.filter((row) => row.email !== email || row.firstName !== firstName);
  if (changed.length === 0) return NextResponse.json({ success: true });

  await prisma.emailCapture.updateMany({
    where: { id: { in: changed.map((row) => row.id) } },
    data: { email, firstName, crmSyncedAt: null, crmError: null },
  });
  if (capture.igUsername) {
    // Keep a hand-added entry for the same username in step.
    await prisma.knownContact.updateMany({
      where: {
        instagramAccountId: capture.instagramAccountId,
        igUsername: { equals: capture.igUsername, mode: "insensitive" },
      },
      data: { email, firstName },
    });
  }

  const automations = await prisma.emailCapture.findMany({
    where: { id: { in: changed.map((row) => row.id) } },
    select: {
      id: true,
      automation: {
        select: {
          id: true,
          name: true,
          workspaceId: true,
          instagramAccountId: true,
          crmWebhookUrl: true,
          instagramAccount: { select: { username: true } },
        },
      },
    },
  });
  // Best effort, like after a DM: a CRM outage is recorded on the row.
  await Promise.all(
    automations.map((row) => syncCaptureToCrm(row.id, row.automation).catch(() => {}))
  );
  return NextResponse.json({ success: true });
}
