import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { BUILT_IN_DEFAULTS, MESSAGE_DEFAULT_KEYS, BUTTON_KEYS, resolveMessageDefaults } from "@/lib/message-defaults";
import { forgetMessageDefaults } from "@/lib/message-defaults-server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

/** The workspace's default wording, with the built-in text for anything unset. */
export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: context.workspaceId },
    select: { messageDefaults: true },
  });
  return NextResponse.json({
    success: true,
    data: {
      values: resolveMessageDefaults(workspace?.messageDefaults),
      builtIn: BUILT_IN_DEFAULTS,
      canEdit: canManageWorkspace(context.role),
    },
  });
}

const schema = z.object(
  Object.fromEntries(
    MESSAGE_DEFAULT_KEYS.map((key) => [
      key,
      z.string().max(BUTTON_KEYS.includes(key) ? 20 : 1000).optional(),
    ])
  ) as Record<(typeof MESSAGE_DEFAULT_KEYS)[number], z.ZodOptional<z.ZodString>>
);

/**
 * Save the wording. A value equal to the built-in text, or left empty, is not
 * stored, so a later improvement of the built-in text still reaches it.
 */
export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can change default messages" },
      { status: 403 }
    );
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid messages" }, { status: 400 });
  }
  const stored: Record<string, string> = {};
  for (const key of MESSAGE_DEFAULT_KEYS) {
    const value = parsed.data[key]?.trim();
    if (value && value !== BUILT_IN_DEFAULTS[key]) stored[key] = value;
  }
  await prisma.workspace.update({
    where: { id: context.workspaceId },
    data: { messageDefaults: stored },
  });
  forgetMessageDefaults(context.workspaceId);
  return NextResponse.json({ success: true, data: { values: resolveMessageDefaults(stored) } });
}
