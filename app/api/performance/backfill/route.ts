import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { createInstagramContext } from "@/lib/instagram/provider";
import { getCommentMediaId } from "@/lib/meta/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 60;
const CONCURRENCY = 5;

// Credits older comment-triggered DMs to their post. The post id was not
// stored on the DM log before; Instagram still knows it from the comment id.
// Works in batches: call again with `after` set to the returned `next` until
// it is null. Safe to repeat, rows that already have a post are skipped.
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can do this" },
      { status: 403 }
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    instagramAccountId?: string;
    after?: string;
  };
  const account = await getWorkspaceInstagramAccount(
    context.workspaceId,
    body.instagramAccountId ?? null
  );
  if (!account) {
    return NextResponse.json({ success: false, error: "Instagram account not connected." }, { status: 400 });
  }
  if (account.provider === "ZERNIO") {
    return NextResponse.json(
      { success: false, error: "Not available for Zernio accounts." },
      { status: 400 }
    );
  }

  const igContext = await createInstagramContext(account);
  if (igContext.provider !== "META") {
    return NextResponse.json({ success: false, error: "Not available." }, { status: 400 });
  }
  const accessToken = igContext.accessToken;

  const rows = await prisma.dmLog.findMany({
    where: {
      instagramAccountId: account.id,
      mediaId: null,
      commentText: { not: { startsWith: "(" } },
      NOT: [{ commentId: { startsWith: "dm:" } }, { commentId: { startsWith: "email:" } }],
      ...(body.after ? { id: { gt: body.after } } : {}),
    },
    orderBy: { id: "asc" },
    take: BATCH,
    select: { id: true, commentId: true },
  });

  let updated = 0;
  let unresolved = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        const mediaId = await getCommentMediaId(accessToken, row.commentId);
        if (!mediaId) {
          unresolved++;
          continue;
        }
        await prisma.dmLog.update({ where: { id: row.id }, data: { mediaId } });
        updated++;
      } catch {
        // Deleted comment or one Instagram no longer serves: leave it as is.
        unresolved++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

  return NextResponse.json({
    success: true,
    data: {
      updated,
      unresolved,
      next: rows.length === BATCH ? rows[rows.length - 1].id : null,
    },
  });
}
