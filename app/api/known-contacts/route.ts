import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { parseKnownContactsCsv } from "@/lib/email-capture/known-contacts";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

async function requireManager() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  if (!canManageWorkspace(context.role)) {
    return { error: NextResponse.json({ success: false, error: "Only owners and admins can manage contacts" }, { status: 403 }) };
  }
  return { context };
}

// Count and newest entries per Instagram account of this workspace.
export async function GET(request: NextRequest) {
  const { context, error } = await requireManager();
  if (error) return error;
  const accountId = request.nextUrl.searchParams.get("accountId");
  const where = {
    workspaceId: context.workspaceId,
    ...(accountId ? { instagramAccountId: accountId } : {}),
  };
  const [total, recent] = await Promise.all([
    prisma.knownContact.count({ where }),
    prisma.knownContact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { igUsername: true, email: true, instagramAccount: { select: { username: true } } },
    }),
  ]);
  return NextResponse.json({ success: true, data: { total, recent } });
}

const importSchema = z.object({
  instagramAccountId: z.string().min(1),
  csv: z.string().min(1).max(5_000_000),
});

export async function POST(request: NextRequest) {
  const { context, error } = await requireManager();
  if (error) return error;
  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid input" }, { status: 400 });
  }
  const account = await prisma.instagramAccount.findFirst({
    where: { id: parsed.data.instagramAccountId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ success: false, error: "Instagram account not found" }, { status: 404 });
  }

  const { contacts, skipped } = parseKnownContactsCsv(parsed.data.csv);
  let saved = 0;
  for (let i = 0; i < contacts.length; i += 200) {
    const batch = contacts.slice(i, i + 200);
    await prisma.$transaction(
      batch.map((contact) =>
        prisma.knownContact.upsert({
          where: {
            instagramAccountId_igUsername: {
              instagramAccountId: account.id,
              igUsername: contact.igUsername,
            },
          },
          create: {
            workspaceId: context.workspaceId,
            instagramAccountId: account.id,
            igUsername: contact.igUsername,
            email: contact.email,
          },
          update: { email: contact.email },
        })
      )
    );
    saved += batch.length;
  }
  return NextResponse.json({ success: true, data: { saved, skipped } });
}
