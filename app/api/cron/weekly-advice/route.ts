import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { isAdviceConfigured } from "@/lib/advice/generate";
import { executeAdviceRun, startAdviceRun } from "@/lib/advice/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MIN_DAYS_BETWEEN_REPORTS = 6;

/** Writes the weekly advice report for each connected account that has none yet this week. */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdviceConfigured()) {
    return NextResponse.json({ success: true, data: { skipped: "ANTHROPIC_API_KEY is not set" } });
  }

  const accounts = await prisma.instagramAccount.findMany({
    where: { provider: "META", accessToken: { not: "" } },
    select: { id: true },
  });
  const since = new Date(Date.now() - MIN_DAYS_BETWEEN_REPORTS * 86_400_000);
  let started = 0;
  for (const account of accounts) {
    const recent = await prisma.adviceRun.findFirst({
      where: { instagramAccountId: account.id, status: { in: ["READY", "PENDING"] }, createdAt: { gte: since } },
      select: { id: true },
    });
    if (recent) continue;
    const run = await startAdviceRun(account.id, "fr");
    if (run.alreadyRunning) continue;
    await executeAdviceRun(run.id);
    started += 1;
  }
  return NextResponse.json({ success: true, data: { accounts: accounts.length, started } });
}
