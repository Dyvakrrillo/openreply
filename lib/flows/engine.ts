/**
 * Step-flow engine: runs a campaign's canvas (Automation.flow) for one person.
 *
 * A run moves from step to step until it has to wait for the person (a button
 * tap, a typed email or first name), for time (a wait, a typing pause) or for
 * the conversation to open (after a comment, Instagram allows one private
 * reply until the person writes back or taps). It is then parked on that
 * step in FlowRun and picked up again by the matching entry point:
 *
 *   startFlow           comment or DM keyword (from dm-worker)
 *   handleFlowPostback  button tap, payload `flow:<automationId>:<stepId>:<action>`
 *   handleFlowText      typed reply while a run waits for text
 *   processFlowJob      delayed job (wait, typing pause, no reply, no click)
 *
 * Only campaigns with `flowEnabled` and a valid saved flow get here; every
 * other campaign keeps the form-based path in dm-worker untouched.
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getDMQueue, FLOW_JOB_NAME, type ProcessFlowJob } from "@/lib/queue/client";
import {
  createInstagramContext,
  getUserFollowStatus,
  sendFlowMessage,
  type FlowSendButton,
  type InstagramContext,
} from "@/lib/instagram/provider";
import { buildTrackedUrl, personalizeFirstName, renderMessageWithoutLink } from "@/lib/tracking/message";
import { hashRecipientId } from "@/lib/tracking/server";
import {
  extractEmail,
  extractFirstName,
  EMAIL_CAPTURE_WINDOW_MS,
  MAX_INVALID_EMAIL_REPLIES,
} from "@/lib/email-capture";
import {
  findCapturedEmail,
  findKnownFirstName,
  syncCaptureToCrm,
  type EmailGateAutomation,
} from "@/lib/queue/email-gate";
import { parseFlow } from "./schema";
import { getMessageDefaults } from "@/lib/message-defaults-server";
import { flowClickTag } from "./links";
import type { AskEmailStep, Flow, FlowStep, MessageStep } from "./types";

export type FlowAutomation = {
  id: string;
  name: string;
  workspaceId: string;
  instagramAccountId: string;
  flow: Prisma.JsonValue | null;
  flowEnabled: boolean;
  instagramAccount: { instagramId: string; username: string };
  trackedLinks: { slug: string; destinationUrl: string }[];
};

type Run = {
  id: string;
  seq: number;
  igUserId: string;
  igUsername: string | null;
  currentStepId: string | null;
  waiting: string | null;
  invalidReplies: number;
};

/** What one advance needs to send and schedule for a person. */
type Env = {
  automation: FlowAutomation;
  flow: Flow;
  context: InstagramContext;
  userId: string;
  username: string | null;
  accountConnectionId?: string;
  run: Run;
  /** Set while the comment's single private reply is still unused. */
  replyTo?: { commentId: string; postId?: string };
  /** Whether direct messages can be sent (false right after a comment). */
  windowOpen: boolean;
  sentAny: boolean;
  /** Known first name for {name}; null drops the token. */
  firstName?: string | null;
  /** Canvas link buttons' own tracked slugs, by button id (loaded once). */
  flowLinks?: Map<string, string>;
};

const MAX_STEPS_PER_ADVANCE = 30;

/** The campaign's flow when it is switched on and valid, else null. */
export function readEnabledFlow(automation: Pick<FlowAutomation, "flow" | "flowEnabled">): Flow | null {
  if (!automation.flowEnabled || !automation.flow) return null;
  return parseFlow(automation.flow);
}

function stepById(flow: Flow, id: string | undefined): FlowStep | undefined {
  return id ? flow.steps.find((s) => s.id === id) : undefined;
}

function render(text: string, env: Env, extra: { name?: string; email?: string } = {}) {
  let out = personalizeFirstName(text, extra.name ?? env.firstName);
  if (extra.email) out = out.replace(/\{email\}/gi, extra.email);
  return renderMessageWithoutLink({ message: out, commenterName: env.username }).trim();
}

function postback(automationId: string, stepId: string, action: string) {
  return `flow:${automationId}:${stepId}:${action}`;
}

/**
 * A link button's URL: the campaign's tracked link when the URL is one of its
 * form links, else the button's own FlowLink. Both carry the recipient token
 * and the step/button tag so the click is credited to this card.
 */
async function linkUrl(env: Env, stepId: string, buttonId: string, url: string) {
  const tracked = env.automation.trackedLinks.find((l) => l.destinationUrl.trim() === url.trim());
  let slug = tracked?.slug;
  if (!slug) {
    if (!env.flowLinks) {
      const rows = await prisma.flowLink.findMany({
        where: { automationId: env.automation.id },
        select: { buttonId: true, slug: true },
      });
      env.flowLinks = new Map(rows.map((r) => [r.buttonId, r.slug]));
    }
    slug = env.flowLinks.get(buttonId);
  }
  // A canvas saved before link tracking: send the plain URL.
  if (!slug) return url.trim();
  const base = buildTrackedUrl(slug, undefined, hashRecipientId(env.userId));
  return `${base}&f=${encodeURIComponent(flowClickTag(stepId, buttonId))}`;
}

async function messageButtons(env: Env, step: MessageStep): Promise<FlowSendButton[]> {
  return Promise.all(
    step.buttons.map(async (b): Promise<FlowSendButton> =>
      b.kind === "link"
        ? { type: "url", title: b.label, url: await linkUrl(env, step.id, b.id, b.url) }
        : { type: "postback", title: b.label, payload: postback(env.automation.id, step.id, b.id) }
    )
  );
}

async function logEvent(env: Env, stepId: string, kind: string, buttonId?: string) {
  await prisma.flowEvent
    .create({
      data: {
        workspaceId: env.automation.workspaceId,
        automationId: env.automation.id,
        stepId,
        kind,
        buttonId: buttonId ?? null,
        igUserId: env.userId,
      },
    })
    .catch(() => {});
}

function canSend(env: Env) {
  return Boolean(env.replyTo) || env.windowOpen;
}

/** Send one message: the comment's private reply if unused, else a DM. */
async function send(env: Env, stepId: string, text: string, buttons: FlowSendButton[]) {
  const target = env.replyTo
    ? { commentId: env.replyTo.commentId, postId: env.replyTo.postId }
    : { userId: env.userId };
  await sendFlowMessage({
    context: env.context,
    instagramAccountId: env.automation.instagramAccount.instagramId,
    ...target,
    text: text || "👇",
    buttons,
  });
  // After the private reply, nothing more can go out until they act.
  env.replyTo = undefined;
  env.sentAny = true;
  await logEvent(env, stepId, "sent");
}

async function schedule(env: Env, job: Omit<ProcessFlowJob, "instagramAccountId" | "automationId" | "userId" | "runId" | "accountConnectionId">, delayMs: number) {
  await getDMQueue().add(
    FLOW_JOB_NAME,
    {
      instagramAccountId: env.automation.instagramAccount.instagramId,
      accountConnectionId: env.accountConnectionId ?? env.automation.instagramAccountId,
      automationId: env.automation.id,
      userId: env.userId,
      runId: env.run.id,
      ...job,
    },
    {
      delay: Math.max(0, delayMs),
      // One job per run move; a re-scheduled move gets a new seq and id.
      jobId: `flow_${env.run.id}_${job.kind}_${job.stepId}_${job.seq ?? Date.now()}`,
    }
  );
}

/** Park the run on a step; returns the new seq for jobs tied to this wait. */
async function park(env: Env, stepId: string | null, waiting: string | null): Promise<number> {
  const updated = await prisma.flowRun.update({
    where: { id: env.run.id },
    data: {
      currentStepId: stepId,
      waiting,
      seq: { increment: 1 },
      ...(waiting === null && stepId === null ? { status: "DONE" } : {}),
    },
    select: { seq: true },
  });
  env.run.seq = updated.seq;
  env.run.currentStepId = stepId;
  env.run.waiting = waiting;
  return updated.seq;
}

function gateAutomation(env: Env, crmWebhookUrl: string): EmailGateAutomation {
  return {
    id: env.automation.id,
    name: env.automation.name,
    workspaceId: env.automation.workspaceId,
    instagramAccountId: env.automation.instagramAccountId,
    crmWebhookUrl: crmWebhookUrl.trim() || null,
    instagramAccount: { username: env.automation.instagramAccount.username },
  };
}

/** Store the address on this campaign's contact row and hand it to the CRM. */
async function saveEmail(env: Env, step: AskEmailStep, email: string) {
  const capture = await prisma.emailCapture.upsert({
    where: { automationId_igUserId: { automationId: env.automation.id, igUserId: env.userId } },
    create: {
      workspaceId: env.automation.workspaceId,
      automationId: env.automation.id,
      instagramAccountId: env.automation.instagramAccountId,
      igUserId: env.userId,
      igUsername: env.username,
      email,
      status: "CAPTURED",
      capturedAt: new Date(),
    },
    update: { email, status: "CAPTURED", capturedAt: new Date(), crmSyncedAt: null, crmError: null },
    select: { id: true },
  });
  // Changing an address elsewhere: keep every campaign's copy in step.
  await prisma.emailCapture.updateMany({
    where: {
      instagramAccountId: env.automation.instagramAccountId,
      igUserId: env.userId,
      status: "CAPTURED",
      id: { not: capture.id },
    },
    data: { email },
  });
  try {
    await syncCaptureToCrm(capture.id, gateAutomation(env, step.crmWebhookUrl));
  } catch (error) {
    console.error("[Flow] CRM sync failed:", error instanceof Error ? error.message : error);
  }
}

async function evaluate(env: Env, check: string): Promise<boolean> {
  if (check === "clicked") {
    // Any of the campaign's links: form links (LinkClick) or canvas links.
    const recipientHash = hashRecipientId(env.userId);
    const click = await prisma.linkClick.findFirst({
      where: { automationId: env.automation.id, recipientHash },
      select: { id: true },
    });
    if (click) return true;
    const flowClick = await prisma.flowEvent.findFirst({
      where: { automationId: env.automation.id, kind: "click", recipientHash },
      select: { id: true },
    });
    return Boolean(flowClick);
  }
  if (check === "follows") {
    return (await getUserFollowStatus({ context: env.context, recipientId: env.userId })) === true;
  }
  return Boolean(await findCapturedEmail(env.automation.instagramAccountId, env.userId, env.username));
}

/**
 * Play the flow from `startId` until it has to wait. `skipDelayFor` skips the
 * typing pause of that step (the pause is what scheduled this resume).
 */
async function advance(env: Env, startId: string | undefined, skipDelayFor?: string): Promise<void> {
  let stepId = startId;
  for (let guard = 0; guard < MAX_STEPS_PER_ADVANCE; guard += 1) {
    const step = stepById(env.flow, stepId);
    if (!step || step.type === "trigger") {
      await park(env, null, null);
      return;
    }

    const sends = step.type === "message" || step.type === "followGate";
    if (sends && !canSend(env)) {
      // Picked up by handleFlowText / handleFlowPostback once they act.
      await park(env, step.id, "window");
      return;
    }

    switch (step.type) {
      case "message": {
        if (step.delaySeconds && skipDelayFor !== step.id) {
          const seq = await park(env, step.id, "timer");
          await schedule(env, { kind: "resume", stepId: step.id, seq, skipDelay: true }, step.delaySeconds * 1000);
          return;
        }
        await send(env, step.id, render(step.text, env), await messageButtons(env, step));
        if (step.noClickMinutes && step.noClickNext && step.buttons.some((b) => b.kind === "link")) {
          await schedule(env, { kind: "noClick", stepId: step.id }, step.noClickMinutes * 60_000);
        }
        if (step.buttons.some((b) => b.kind === "step")) {
          await park(env, step.id, "button");
          return;
        }
        stepId = step.next;
        continue;
      }
      case "followGate": {
        await send(env, step.id, render(step.text, env), [
          { type: "postback", title: step.buttonLabel, payload: postback(env.automation.id, step.id, "follow") },
        ]);
        await park(env, step.id, "button");
        return;
      }
      case "askEmail": {
        const known = await findCapturedEmail(env.automation.instagramAccountId, env.userId, env.username);
        if (known && !step.confirmKnown) {
          await saveEmail(env, step, known);
          stepId = step.next;
          continue;
        }
        if (!canSend(env)) {
          await park(env, step.id, "window");
          return;
        }
        if (known) {
          const d = await getMessageDefaults(env.automation.workspaceId);
          await send(env, step.id, render(step.confirmText || d.emailConfirm, env, { email: known }), [
            { type: "postback", title: d.emailConfirmYes, payload: postback(env.automation.id, step.id, "yes") },
            { type: "postback", title: d.emailConfirmChange, payload: postback(env.automation.id, step.id, "change") },
          ]);
          await park(env, step.id, "button");
          return;
        }
        await send(env, step.id, render(step.text, env), []);
        const seq = await park(env, step.id, "email");
        await prisma.flowRun.update({ where: { id: env.run.id }, data: { invalidReplies: 0 } });
        if (step.timeoutMinutes && step.timeoutNext) {
          await schedule(env, { kind: "timeout", stepId: step.id, seq }, step.timeoutMinutes * 60_000);
        }
        return;
      }
      case "askFirstName": {
        // Already known (given in any campaign, or added in Contacts): skip
        // the question and its thank-you, like the form-based campaigns do.
        const knownName = await findKnownFirstName(env.automation.instagramAccountId, env.userId, env.username);
        if (knownName) {
          stepId = step.next;
          continue;
        }
        if (!canSend(env)) {
          await park(env, step.id, "window");
          return;
        }
        await send(env, step.id, render(step.text, env), []);
        const seq = await park(env, step.id, "firstName");
        if (step.timeoutMinutes && step.timeoutNext) {
          await schedule(env, { kind: "timeout", stepId: step.id, seq }, step.timeoutMinutes * 60_000);
        }
        return;
      }
      case "wait": {
        const seq = await park(env, step.id, "timer");
        await schedule(env, { kind: "resume", stepId: step.next ?? "", seq }, step.minutes * 60_000);
        return;
      }
      case "condition": {
        stepId = (await evaluate(env, step.check)) ? step.yes : step.no;
        continue;
      }
    }
  }
  console.error(`[Flow] Stopped a run after ${MAX_STEPS_PER_ADVANCE} steps (loop?)`, env.run.id);
  await park(env, null, null);
}

async function loadRun(automation: FlowAutomation, userId: string, username: string | null): Promise<Run> {
  return prisma.flowRun.upsert({
    where: { automationId_igUserId: { automationId: automation.id, igUserId: userId } },
    create: {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      igUserId: userId,
      igUsername: username,
    },
    update: { lastActionAt: new Date(), status: "ACTIVE", ...(username ? { igUsername: username } : {}) },
    select: { id: true, seq: true, igUserId: true, igUsername: true, currentStepId: true, waiting: true, invalidReplies: true },
  });
}

/** Mark a run failed when Instagram refuses a send (e.g. the 24h window closed). */
async function failRun(runId: string, error: unknown) {
  console.error("[Flow] Send failed, run stopped:", error instanceof Error ? error.message : error);
  await prisma.flowRun.update({ where: { id: runId }, data: { status: "FAILED" } }).catch(() => {});
}

/**
 * Start (or restart) the flow for someone who commented or sent a DM keyword.
 * Returns whether a message went out. Send errors are thrown so the caller's
 * delivery bookkeeping (dmLog, quotas) records them as for any campaign.
 */
export async function startFlow({
  automation,
  flow,
  context,
  userId,
  username,
  comment,
  accountConnectionId,
}: {
  automation: FlowAutomation;
  flow: Flow;
  context: InstagramContext;
  userId: string;
  username: string | null;
  comment?: { commentId: string; postId?: string };
  accountConnectionId?: string;
}): Promise<boolean> {
  const run = await loadRun(automation, userId, username);
  const env: Env = {
    automation,
    flow,
    context,
    userId,
    username,
    accountConnectionId,
    run,
    replyTo: comment,
    windowOpen: !comment,
    sentAny: false,
  };
  env.firstName = await findKnownFirstName(automation.instagramAccountId, userId, username);
  await prisma.flowRun.update({ where: { id: run.id }, data: { invalidReplies: 0 } });
  const trigger = flow.steps.find((s) => s.type === "trigger");
  await advance(env, trigger?.next);
  return env.sentAny;
}

/** Parse `flow:<automationId>:<stepId>:<action>`. */
export function parseFlowPayload(payload: string) {
  if (!payload.startsWith("flow:")) return null;
  const [automationId, stepId, action] = payload.slice("flow:".length).split(":");
  if (!automationId || !stepId || !action) return null;
  return { automationId, stepId, action };
}

/** A button tap on a flow message. The conversation is open after a tap. */
export async function handleFlowPostback({
  automation,
  context,
  userId,
  username,
  payload,
  accountConnectionId,
}: {
  automation: FlowAutomation;
  context: InstagramContext;
  userId: string;
  username: string | null;
  payload: { stepId: string; action: string };
  accountConnectionId?: string;
}): Promise<void> {
  const flow = readEnabledFlow(automation);
  if (!flow) return;
  const step = stepById(flow, payload.stepId);
  if (!step) return;
  const run = await loadRun(automation, userId, username);
  const env: Env = { automation, flow, context, userId, username, accountConnectionId, run, windowOpen: true, sentAny: false };
  env.firstName = await findKnownFirstName(automation.instagramAccountId, userId, username);

  try {
    if (step.type === "message") {
      const button = step.buttons.find((b) => b.id === payload.action);
      if (!button || button.kind !== "step") return;
      await logEvent(env, step.id, "button", button.id);
      await advance(env, button.next);
      return;
    }
    if (step.type === "followGate" && payload.action === "follow") {
      const follows = await getUserFollowStatus({ context, recipientId: userId });
      await logEvent(env, step.id, "button", "follow");
      if (follows === false) {
        // Not following yet: show the prompt again, stay on this step.
        await send(env, step.id, render(step.text, env), [
          { type: "postback", title: step.buttonLabel, payload: postback(automation.id, step.id, "follow") },
        ]);
        await park(env, step.id, "button");
        return;
      }
      // Following, or Instagram could not tell: never trap a real follower.
      await advance(env, step.next);
      return;
    }
    if (step.type === "askEmail") {
      if (payload.action === "yes") {
        const known = await findCapturedEmail(automation.instagramAccountId, userId, username);
        await logEvent(env, step.id, "button", "yes");
        if (known) await saveEmail(env, step, known);
        await advance(env, step.next);
        return;
      }
      if (payload.action === "change") {
        await logEvent(env, step.id, "button", "change");
        await send(env, step.id, render(step.text, env), []);
        const seq = await park(env, step.id, "email");
        if (step.timeoutMinutes && step.timeoutNext) {
          await schedule(env, { kind: "timeout", stepId: step.id, seq }, step.timeoutMinutes * 60_000);
        }
      }
    }
  } catch (error) {
    await failRun(run.id, error);
  }
}

/**
 * A typed DM from someone with a run waiting on text (or on the conversation
 * opening). Returns true when the message was handled here, so keyword
 * campaigns do not also answer it.
 */
export async function handleFlowText({
  instagramAccountId,
  senderId,
  text,
  accountConnectionId,
}: {
  instagramAccountId: string;
  senderId: string;
  text: string;
  accountConnectionId?: string;
}): Promise<boolean> {
  const run = await prisma.flowRun.findFirst({
    where: {
      igUserId: senderId,
      status: "ACTIVE",
      waiting: { in: ["email", "firstName", "window"] },
      updatedAt: { gte: new Date(Date.now() - EMAIL_CAPTURE_WINDOW_MS) },
      ...(accountConnectionId ? { instagramAccountId: accountConnectionId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, seq: true, igUserId: true, igUsername: true, currentStepId: true, waiting: true, invalidReplies: true, automationId: true },
  });
  if (!run) return false;

  const automation = await prisma.automation.findFirst({
    where: { id: run.automationId, isActive: true, flowEnabled: true },
    include: { instagramAccount: true, trackedLinks: { select: { slug: true, destinationUrl: true } } },
  });
  if (!automation || automation.instagramAccount.instagramId !== instagramAccountId) return false;
  const flow = readEnabledFlow(automation);
  const step = flow ? stepById(flow, run.currentStepId ?? undefined) : undefined;
  if (!flow || !step) return false;

  let context: InstagramContext;
  try {
    context = await createInstagramContext(automation.instagramAccount, `flow-text:${run.id}:${run.seq}`);
  } catch {
    return false;
  }
  const env: Env = {
    automation,
    flow,
    context,
    userId: senderId,
    username: run.igUsername,
    accountConnectionId,
    run,
    windowOpen: true,
    sentAny: false,
  };
  env.firstName = await findKnownFirstName(automation.instagramAccountId, senderId, run.igUsername);
  await prisma.flowRun.update({ where: { id: run.id }, data: { lastActionAt: new Date() } });

  try {
    if (run.waiting === "window") {
      // They wrote back after the comment's private reply: carry on.
      await advance(env, step.id);
      return true;
    }
    if (run.waiting === "email" && step.type === "askEmail") {
      const email = extractEmail(text);
      if (!email) {
        if (run.invalidReplies >= MAX_INVALID_EMAIL_REPLIES) return false;
        await prisma.flowRun.update({ where: { id: run.id }, data: { invalidReplies: { increment: 1 } } });
        await send(env, step.id, render(step.invalidText, env), []);
        return true;
      }
      await logEvent(env, step.id, "reply");
      await saveEmail(env, step, email);
      await advance(env, step.next);
      return true;
    }
    if (run.waiting === "firstName" && step.type === "askFirstName") {
      const firstName = extractFirstName(text);
      // Not a name ("ok merci", a question...): let normal DM handling see it.
      if (!firstName) return false;
      await logEvent(env, step.id, "reply");
      const captures = await prisma.emailCapture.findMany({
        where: { instagramAccountId: automation.instagramAccountId, igUserId: senderId, status: "CAPTURED" },
        select: { id: true, automationId: true },
      });
      await prisma.emailCapture.updateMany({
        where: { id: { in: captures.map((c) => c.id) } },
        data: { firstName, crmSyncedAt: null },
      });
      // Re-send this campaign's contact to the CRM with the first name.
      const own = captures.find((c) => c.automationId === automation.id);
      const emailStep = flow.steps.find((s): s is AskEmailStep => s.type === "askEmail" && Boolean(s.crmWebhookUrl.trim()));
      if (own && emailStep) {
        await syncCaptureToCrm(own.id, gateAutomation(env, emailStep.crmWebhookUrl)).catch(() => {});
      }
      env.firstName = firstName;
      if (step.thanksText.trim()) await send(env, step.id, render(step.thanksText, env, { name: firstName }), []);
      await advance(env, step.next);
      return true;
    }
  } catch (error) {
    await failRun(run.id, error);
    return true;
  }
  return false;
}

/** A delayed flow job: resume, no-reply path or no-click path. */
export async function processFlowJob(job: ProcessFlowJob): Promise<void> {
  const run = await prisma.flowRun.findUnique({
    where: { id: job.runId },
    select: { id: true, seq: true, igUserId: true, igUsername: true, currentStepId: true, waiting: true, invalidReplies: true, status: true },
  });
  if (!run || run.status !== "ACTIVE") return;
  if (job.kind !== "noClick" && job.seq !== run.seq) return;

  const automation = await prisma.automation.findFirst({
    where: { id: job.automationId, isActive: true, flowEnabled: true },
    include: { instagramAccount: true, trackedLinks: { select: { slug: true, destinationUrl: true } } },
  });
  if (!automation || automation.instagramAccount.instagramId !== job.instagramAccountId) return;
  const flow = readEnabledFlow(automation);
  if (!flow) return;

  let context: InstagramContext;
  try {
    context = await createInstagramContext(automation.instagramAccount, `flow-job:${job.runId}:${job.kind}:${job.stepId}:${job.seq ?? ""}`);
  } catch {
    return;
  }
  const env: Env = {
    automation,
    flow,
    context,
    userId: job.userId,
    username: run.igUsername,
    accountConnectionId: job.accountConnectionId,
    run,
    windowOpen: true,
    sentAny: false,
  };
  env.firstName = await findKnownFirstName(automation.instagramAccountId, job.userId, run.igUsername);

  try {
    if (job.kind === "resume") {
      await advance(env, job.stepId || undefined, job.skipDelay ? job.stepId : undefined);
      return;
    }
    const step = stepById(flow, job.stepId);
    if (job.kind === "timeout" && step && (step.type === "askEmail" || step.type === "askFirstName")) {
      await advance(env, step.timeoutNext);
      return;
    }
    if (job.kind === "noClick" && step?.type === "message" && step.noClickNext) {
      const clicked = await evaluate(env, "clicked");
      if (!clicked) await advance(env, step.noClickNext);
    }
  } catch (error) {
    await failRun(run.id, error);
  }
}
