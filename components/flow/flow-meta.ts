import type { FlowStep, FlowStepType } from "@/lib/flows/types";
import type { I18n, StaticMessageKey } from "@/lib/i18n";
import { newStepId } from "@/lib/flows/types";
import { BUILT_IN_DEFAULTS, type MessageDefaults } from "@/lib/message-defaults";

/** English keys, translated with t() where shown. */
export const STEP_TITLES: Record<FlowStepType, StaticMessageKey> = {
  trigger: "Trigger",
  message: "Send message",
  followGate: "Follow check",
  askEmail: "Ask for email",
  askFirstName: "Ask for first name",
  wait: "Wait",
  condition: "Condition",
};

export const ADDABLE_STEPS: FlowStepType[] = [
  "message",
  "followGate",
  "askEmail",
  "askFirstName",
  "wait",
  "condition",
];

export const STEP_ACCENTS: Record<FlowStepType, string> = {
  trigger: "bg-zinc-900 text-white",
  message: "bg-gradient-to-br from-fuchsia-500 via-pink-500 to-amber-400 text-white",
  followGate: "bg-sky-500 text-white",
  askEmail: "bg-violet-500 text-white",
  askFirstName: "bg-violet-500 text-white",
  wait: "bg-amber-500 text-white",
  condition: "bg-emerald-500 text-white",
};

export function createStep(
  type: FlowStepType,
  position: { x: number; y: number },
  d: MessageDefaults = BUILT_IN_DEFAULTS
): FlowStep {
  const id = newStepId(type);
  switch (type) {
    case "message":
      return { id, type, position, text: "", buttons: [] };
    case "followGate":
      return { id, type, position, text: d.followPrompt, buttonLabel: d.followButton };
    case "askEmail":
      return {
        id,
        type,
        position,
        text: d.emailPrompt,
        invalidText: d.emailInvalid,
        confirmKnown: true,
        confirmText: d.emailConfirm,
        crmWebhookUrl: "",
      };
    case "askFirstName":
      return { id, type, position, text: d.firstNamePrompt, thanksText: d.firstNameThanks };
    case "wait":
      return { id, type, position, minutes: 60 };
    case "condition":
      return { id, type, position, check: "clicked" };
    case "trigger":
      return { id, type, position };
  }
}

export function formatMinutes(minutes: number, t: I18n["t"]) {
  if (minutes < 60) return t("{n} min", { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? t("{h} h {m} min", { h, m }) : t("{h} h", { h });
}
