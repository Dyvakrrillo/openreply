import { prisma } from "@/lib/db/client";
import { createInstagramContext } from "@/lib/instagram/provider";
import { fetchAudienceSnapshot, type AudienceSnapshot } from "@/lib/performance/audience";
import { computeFunnel } from "@/lib/performance/funnel";
import { loadPostsWithInsights } from "@/lib/performance/posts";
import { getFollowerHistory } from "@/lib/reports/follower-history";
import { AdviceError, generateAdvice } from "./generate";
import { buildAdviceInput } from "./input";

// A run that has not finished after this long is considered lost (the process
// restarted mid-generation) so it never blocks the next one.
const STALE_PENDING_MS = 15 * 60_000;

export async function failStaleRuns(instagramAccountId: string): Promise<void> {
  await prisma.adviceRun.updateMany({
    where: {
      instagramAccountId,
      status: "PENDING",
      createdAt: { lt: new Date(Date.now() - STALE_PENDING_MS) },
    },
    data: { status: "FAILED", error: "api: The report did not finish (server restarted)", completedAt: new Date() },
  });
}

/** Create a PENDING run, or return the one already in progress. */
export async function startAdviceRun(
  instagramAccountId: string,
  locale: string
): Promise<{ id: string; alreadyRunning: boolean }> {
  await failStaleRuns(instagramAccountId);
  const running = await prisma.adviceRun.findFirst({
    where: { instagramAccountId, status: "PENDING" },
    select: { id: true },
  });
  if (running) return { id: running.id, alreadyRunning: true };
  const run = await prisma.adviceRun.create({
    data: { instagramAccountId, locale },
    select: { id: true },
  });
  return { id: run.id, alreadyRunning: false };
}

/** Gather the account's data, ask Claude, store the report. Never throws. */
export async function executeAdviceRun(runId: string): Promise<void> {
  try {
    const run = await prisma.adviceRun.findUnique({
      where: { id: runId },
      include: { instagramAccount: true },
    });
    if (!run) return;
    const account = run.instagramAccount;

    const context = await createInstagramContext(account);
    const [{ posts }, funnel, history] = await Promise.all([
      loadPostsWithInsights(context, 50),
      computeFunnel(account.workspaceId, account),
      getFollowerHistory(account.id, 60),
    ]);

    let audience: AudienceSnapshot | null = null;
    if (context.provider === "META") {
      audience = await fetchAudienceSnapshot(context.accessToken, account.instagramId).catch(() => null);
    }

    const input = buildAdviceInput({
      username: account.username,
      followers: history.length ? history[history.length - 1].followers : null,
      followerHistory: history,
      posts,
      funnel,
      audience,
      strategyBrief: account.strategyBrief,
    });
    const result = await generateAdvice(input, run.locale);

    await prisma.adviceRun.update({
      where: { id: runId },
      data: {
        status: "READY",
        payload: JSON.parse(JSON.stringify(result.report)),
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        error: null,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    const code = error instanceof AdviceError ? error.code : "api";
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Advice] Run failed:", code, message);
    await prisma.adviceRun
      .update({
        where: { id: runId },
        data: { status: "FAILED", error: `${code}: ${message}`.slice(0, 400), completedAt: new Date() },
      })
      .catch(() => {});
  }
}
