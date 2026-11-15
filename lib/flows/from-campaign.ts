/**
 * Draw an existing (form-built) campaign as a flow, without changing it.
 *
 * Every setting of the campaign ends up on a step, so the canvas shows the
 * campaign exactly as the worker runs it today. The campaign's own fields are
 * never rewritten by this: a campaign only switches to its flow when someone
 * saves it from the canvas, and the original fields are kept untouched then
 * too, so the switch can be undone.
 *
 * Client-safe (no database imports).
 */

import {
  DEFAULT_EMAIL_INVALID,
  DEFAULT_EMAIL_PROMPT,
  DEFAULT_FIRST_NAME_PROMPT,
  DEFAULT_FIRST_NAME_THANKS,
} from "@/lib/email-capture";
import { FLOW_VERSION, type Flow, type FlowButton, type FlowStep } from "./types";

/** Worker defaults, mirrored so an empty field shows what is really sent. */
export const DEFAULT_FOLLOW_PROMPT =
  "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over";
export const DEFAULT_FOLLOW_BUTTON = "i'm following";
const DEFAULT_LINK_LABEL = "Open link";

export type CampaignForFlow = {
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number | null;
  clickReminderEnabled?: boolean;
  clickReminderMessage?: string | null;
  clickReminderDelayMinutes?: number | null;
  requireEmail?: boolean;
  emailPromptMessage?: string | null;
  emailInvalidMessage?: string | null;
  crmWebhookUrl?: string | null;
  askFirstName?: boolean;
  firstNamePromptMessage?: string | null;
  firstNameThanksMessage?: string | null;
  trackedLinks?: { destinationUrl: string; label: string | null; position?: number }[];
};

const COL = 340;

export function campaignToFlow(c: CampaignForFlow): Flow {
  const steps: FlowStep[] = [];
  let col = 0;
  const at = (row = 0) => ({ x: col * COL, y: row * 260 });

  // Each step is linked from the previous one's main output. The order is
  // the worker's: opening DM, then email, then follow check, then the link.
  let link: (id: string) => void;
  const trigger: FlowStep = { id: "trigger", type: "trigger", position: at() };
  steps.push(trigger);
  link = (id) => {
    trigger.next = id;
  };

  if (c.openingDmEnabled && c.openingDmMessage?.trim()) {
    col += 1;
    const buttonId = "opening_btn";
    const step: FlowStep = {
      id: "opening",
      type: "message",
      position: at(),
      text: c.openingDmMessage,
      buttons: [{ id: buttonId, kind: "step", label: c.openingDmButtonLabel || "" }],
    };
    steps.push(step);
    link("opening");
    link = (id) => {
      step.buttons = step.buttons.map((b) => (b.id === buttonId ? { ...b, next: id } : b));
    };
  }

  if (c.requireEmail) {
    col += 1;
    const step: FlowStep = {
      id: "email",
      type: "askEmail",
      position: at(),
      text: c.emailPromptMessage?.trim() || DEFAULT_EMAIL_PROMPT,
      invalidText: c.emailInvalidMessage?.trim() || DEFAULT_EMAIL_INVALID,
      // Today a known address is reused silently; keep that behaviour.
      confirmKnown: false,
      confirmText: "Ton e-mail est toujours {email} ?",
      crmWebhookUrl: c.crmWebhookUrl ?? "",
    };
    steps.push(step);
    link("email");
    link = (id) => {
      step.next = id;
    };
  }

  if (c.requireFollow) {
    col += 1;
    const step: FlowStep = {
      id: "follow",
      type: "followGate",
      position: at(),
      text: c.followPromptMessage?.trim() || DEFAULT_FOLLOW_PROMPT,
      buttonLabel: c.followPromptButtonLabel?.trim() || DEFAULT_FOLLOW_BUTTON,
    };
    steps.push(step);
    link("follow");
    link = (id) => {
      step.next = id;
    };
  }

  // The message with the link(s): the heart of every campaign.
  col += 1;
  const links = [...(c.trackedLinks ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const linkButtons: FlowButton[] = links.map((l, i) => ({
    id: `link_${i}`,
    kind: "link",
    label: (i === 0 ? c.linkButtonLabel : l.label) || DEFAULT_LINK_LABEL,
    url: l.destinationUrl,
  }));
  const reveal: FlowStep = {
    id: "reveal",
    type: "message",
    position: at(),
    text: c.dmMessage,
    buttons: linkButtons,
  };
  steps.push(reveal);
  link("reveal");
  const revealCol = col;

  // After the link: first name (email path), thank-you and click reminder.
  let after: (id: string) => void = (id) => {
    reveal.next = id;
  };

  if (c.requireEmail && c.askFirstName) {
    col += 1;
    const step: FlowStep = {
      id: "first_name",
      type: "askFirstName",
      position: at(),
      text: c.firstNamePromptMessage?.trim() || DEFAULT_FIRST_NAME_PROMPT,
      thanksText: c.firstNameThanksMessage?.trim() || DEFAULT_FIRST_NAME_THANKS,
    };
    steps.push(step);
    after("first_name");
    after = (id) => {
      step.next = id;
      // The thank-you goes out even if they never answer.
      step.timeoutMinutes = 60;
      step.timeoutNext = id;
    };
  }

  if (c.followUpEnabled && c.followUpMessage?.trim()) {
    col += 1;
    const delay = Math.max(0, c.followUpDelayMinutes ?? 0);
    let first = "follow_up";
    if (delay > 0) {
      steps.push({ id: "follow_up_wait", type: "wait", position: at(), minutes: delay, next: "follow_up" });
      first = "follow_up_wait";
      col += 1;
    }
    steps.push({ id: "follow_up", type: "message", position: at(), text: c.followUpMessage, buttons: [] });
    after(first);
  }

  if (c.clickReminderEnabled && c.clickReminderMessage?.trim() && linkButtons.length > 0) {
    reveal.noClickMinutes = Math.max(5, c.clickReminderDelayMinutes ?? 60);
    reveal.noClickNext = "click_reminder";
    steps.push({
      id: "click_reminder",
      type: "message",
      position: { x: (revealCol + 1) * COL, y: 300 },
      text: c.clickReminderMessage,
      buttons: linkButtons.map((b) => ({ ...b, id: `${b.id}_reminder` })),
    });
  }

  return { version: FLOW_VERSION, steps };
}
