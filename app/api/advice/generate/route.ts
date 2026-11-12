import { after, NextRequest, NextResponse } from "next/server";
import { getI18n } from "@/lib/i18n/server";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { isAdviceConfigured } from "@/lib/advice/generate";
import { executeAdviceRun, startAdviceRun } from "@/lib/advice/run";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
// The report is written after the response, inside this window.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Only owners and admins can do this" }, { status: 403 });
  }
  if (!isAdviceConfigured()) {
    return NextResponse.json({ success: false, error: "not_configured" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { instagramAccountId?: string };
  const account = await getWorkspaceInstagramAccount(context.workspaceId, body.instagramAccountId);
  if (!account) {
    return NextResponse.json({ success: false, error: "Instagram account not connected." }, { status: 400 });
  }

  const { locale } = await getI18n();
  const run = await startAdviceRun(account.id, locale);
  if (!run.alreadyRunning) {
    after(() => executeAdviceRun(run.id));
  }
  return NextResponse.json({ success: true, data: { id: run.id, alreadyRunning: run.alreadyRunning } });
}
