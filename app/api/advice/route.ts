import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { adviceModel, isAdviceConfigured } from "@/lib/advice/generate";
import { failStaleRuns } from "@/lib/advice/run";
import type { AdviceReport } from "@/lib/advice/schema";

export const dynamic = "force-dynamic";

export interface AdviceRunView {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  model: string | null;
  report: AdviceReport | null;
}

export interface AdviceResponse {
  configured: boolean;
  model: string;
  account: { id: string; username: string };
  accounts: Array<{ id: string; username: string }>;
  strategyBrief: string;
  run: AdviceRunView | null;
  history: Array<{ id: string; status: "PENDING" | "READY" | "FAILED"; createdAt: string }>;
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
  await failStaleRuns(account.id);

  const reportId = request.nextUrl.searchParams.get("reportId");
  const [accounts, runs] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { id: true, username: true },
    }),
    prisma.adviceRun.findMany({
      where: { instagramAccountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const chosen = (reportId ? runs.find((r) => r.id === reportId) : null) ?? runs[0] ?? null;
  const data: AdviceResponse = {
    configured: isAdviceConfigured(),
    model: adviceModel(),
    account: { id: account.id, username: account.username },
    accounts,
    strategyBrief: account.strategyBrief ?? "",
    run: chosen
      ? {
          id: chosen.id,
          status: chosen.status,
          createdAt: chosen.createdAt.toISOString(),
          completedAt: chosen.completedAt?.toISOString() ?? null,
          error: chosen.error,
          model: chosen.model,
          report: chosen.status === "READY" ? (chosen.payload as unknown as AdviceReport) : null,
        }
      : null,
    history: runs.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt.toISOString() })),
  };
  return NextResponse.json({ success: true, data });
}
