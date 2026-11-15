/**
 * Step-by-step automation ("flow") stored on Automation.flow as JSON.
 *
 * Client-safe: no database or server imports, so the canvas editor and the
 * worker can share it.
 *
 * Every link between steps lives in the step data (`next`, a button's `next`,
 * `timeoutNext`, ...). The canvas draws its arrows from those fields and writes
 * them back when an arrow is connected, so there is one source of truth.
 */

export const FLOW_VERSION = 1;

export type FlowPosition = { x: number; y: number };

/** A DM button: opens a URL (tracked) or moves the person to another step. */
export type FlowButton =
  | { id: string; kind: "link"; label: string; url: string }
  | { id: string; kind: "step"; label: string; next?: string };

/** Entry point. Its settings (posts, keywords, public reply) stay on the campaign. */
export type TriggerStep = {
  id: string;
  type: "trigger";
  position: FlowPosition;
  next?: string;
};

export type MessageStep = {
  id: string;
  type: "message";
  position: FlowPosition;
  text: string;
  /** Pause before sending, in seconds (typing effect). */
  delaySeconds?: number;
  buttons: FlowButton[];
  /** Default path once the message is sent (not waiting for a tap). */
  next?: string;
  /**
   * Only for messages with link buttons: where to go if none of the links is
   * clicked after `noClickMinutes`.
   */
  noClickMinutes?: number;
  noClickNext?: string;
};

export type FollowGateStep = {
  id: string;
  type: "followGate";
  position: FlowPosition;
  text: string;
  buttonLabel: string;
  /** Reached once Instagram confirms they follow. */
  next?: string;
};

export type AskEmailStep = {
  id: string;
  type: "askEmail";
  position: FlowPosition;
  text: string;
  invalidText: string;
  /**
   * When the email is already known: ask "is this still right?" instead of
   * skipping straight to `next`.
   */
  confirmKnown: boolean;
  confirmText: string;
  /** FluentCRM (or any) incoming webhook that receives the address. */
  crmWebhookUrl: string;
  next?: string;
  timeoutMinutes?: number;
  timeoutNext?: string;
};

export type AskFirstNameStep = {
  id: string;
  type: "askFirstName";
  position: FlowPosition;
  text: string;
  /** Sent after a valid answer, before `next`. Empty sends nothing. */
  thanksText: string;
  next?: string;
  timeoutMinutes?: number;
  timeoutNext?: string;
};

export type WaitStep = {
  id: string;
  type: "wait";
  position: FlowPosition;
  minutes: number;
  next?: string;
};

export type ConditionCheck = "follows" | "clicked" | "hasEmail";

export type ConditionStep = {
  id: string;
  type: "condition";
  position: FlowPosition;
  check: ConditionCheck;
  yes?: string;
  no?: string;
};

export type FlowStep =
  | TriggerStep
  | MessageStep
  | FollowGateStep
  | AskEmailStep
  | AskFirstNameStep
  | WaitStep
  | ConditionStep;

export type FlowStepType = FlowStep["type"];

export type Flow = {
  version: typeof FLOW_VERSION;
  steps: FlowStep[];
};

/** Instagram keeps a conversation open 24h after the person's last action. */
export const MAX_WAIT_MINUTES = 23 * 60;
export const MAX_BUTTONS = 3;
/** Button template text limit on Instagram. */
export const MAX_BUTTON_TEXT = 640;

/** A named outgoing connection of a step: where an arrow starts. */
export type FlowOutput = { handle: string; target?: string };

/** Every outgoing connection of a step, in display order. */
export function stepOutputs(step: FlowStep): FlowOutput[] {
  switch (step.type) {
    case "trigger":
    case "followGate":
    case "wait":
      return [{ handle: "next", target: step.next }];
    case "message":
      return [
        ...step.buttons
          .filter((b) => b.kind === "step")
          .map((b) => ({ handle: `button:${b.id}`, target: (b as { next?: string }).next })),
        ...(step.buttons.some((b) => b.kind === "link") && step.noClickMinutes
          ? [{ handle: "noClick", target: step.noClickNext }]
          : []),
        { handle: "next", target: step.next },
      ];
    case "askEmail":
    case "askFirstName":
      return [
        { handle: "next", target: step.next },
        ...(step.timeoutMinutes ? [{ handle: "timeout", target: step.timeoutNext }] : []),
      ];
    case "condition":
      return [
        { handle: "yes", target: step.yes },
        { handle: "no", target: step.no },
      ];
  }
}

/** Return a copy of `step` with the connection `handle` pointing at `target`. */
export function connectStep(step: FlowStep, handle: string, target: string | undefined): FlowStep {
  if (handle.startsWith("button:") && step.type === "message") {
    const id = handle.slice("button:".length);
    return {
      ...step,
      buttons: step.buttons.map((b) =>
        b.id === id && b.kind === "step" ? { ...b, next: target } : b
      ),
    };
  }
  switch (handle) {
    case "next":
      return step.type === "condition" ? step : { ...step, next: target };
    case "noClick":
      return step.type === "message" ? { ...step, noClickNext: target } : step;
    case "timeout":
      return step.type === "askEmail" || step.type === "askFirstName"
        ? { ...step, timeoutNext: target }
        : step;
    case "yes":
      return step.type === "condition" ? { ...step, yes: target } : step;
    case "no":
      return step.type === "condition" ? { ...step, no: target } : step;
    default:
      return step;
  }
}

/** Remove every connection that points at `targetId` (used when a step is deleted). */
export function disconnectTarget(step: FlowStep, targetId: string): FlowStep {
  return stepOutputs(step).reduce(
    (current, output) =>
      output.target === targetId ? connectStep(current, output.handle, undefined) : current,
    step
  );
}

let idCounter = 0;
export function newStepId(prefix = "s"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Problems that would make the flow misbehave once live. Empty means OK. */
export function validateFlow(flow: Flow): string[] {
  const problems: string[] = [];
  const ids = new Set(flow.steps.map((s) => s.id));
  const triggers = flow.steps.filter((s) => s.type === "trigger");
  if (triggers.length !== 1) problems.push("The flow needs exactly one trigger.");
  for (const step of flow.steps) {
    for (const output of stepOutputs(step)) {
      if (output.target && !ids.has(output.target)) {
        problems.push(`A connection points to a deleted step.`);
      }
    }
    if (step.type === "message") {
      if (!step.text.trim()) problems.push("A message step has no text.");
      if (step.buttons.length > MAX_BUTTONS) problems.push("A message has more than 3 buttons.");
      if (step.buttons.length > 0 && step.text.length > MAX_BUTTON_TEXT)
        problems.push("A message with buttons is longer than 640 characters.");
      for (const b of step.buttons) {
        if (!b.label.trim()) problems.push("A button has no label.");
        if (b.kind === "link" && !/^https?:\/\/\S+$/.test(b.url.trim()))
          problems.push("A link button needs a valid URL.");
      }
    }
    if (step.type === "wait" && (step.minutes < 1 || step.minutes > MAX_WAIT_MINUTES))
      problems.push("A wait must be between 1 minute and 23 hours.");
    if (step.type === "askEmail" && step.crmWebhookUrl.trim() && !/^https:\/\/\S+$/.test(step.crmWebhookUrl.trim()))
      problems.push("The CRM webhook URL must start with https://.");
  }
  return [...new Set(problems)];
}
