import { describe, expect, it } from "vitest";
import { campaignToFlow, type CampaignForFlow } from "@/lib/flows/from-campaign";
import { flowSchema } from "@/lib/flows/schema";
import { stepOutputs, validateFlow, type FlowStep } from "@/lib/flows/types";

const full: CampaignForFlow = {
  dmMessage: "Voici ton guide {link}",
  openingDmEnabled: true,
  openingDmMessage: "Hello {username}",
  openingDmButtonLabel: "Je le veux",
  linkButtonLabel: "Le guide",
  requireFollow: true,
  followPromptMessage: "Abonne-toi",
  followPromptButtonLabel: "Abonnée",
  followUpEnabled: true,
  followUpMessage: "Merci !",
  followUpDelayMinutes: 30,
  clickReminderEnabled: true,
  clickReminderMessage: "Psst",
  clickReminderDelayMinutes: 90,
  requireEmail: true,
  emailPromptMessage: "Ton e-mail ?",
  emailInvalidMessage: "Invalide",
  crmWebhookUrl: "https://crm.example/hook",
  askFirstName: true,
  firstNamePromptMessage: "Ton prénom ?",
  firstNameThanksMessage: "Enchantée {name}",
  trackedLinks: [
    { destinationUrl: "https://example.com/b", label: "Le bonus", position: 1 },
    { destinationUrl: "https://example.com/a", label: null, position: 0 },
  ],
};

function byId(steps: FlowStep[], id: string) {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error(`missing step ${id}`);
  return step;
}

/** Steps reachable from the trigger, following every connection. */
function reachable(steps: FlowStep[]) {
  const seen = new Set<string>();
  const queue = ["trigger"];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const o of stepOutputs(byId(steps, id))) if (o.target) queue.push(o.target);
  }
  return seen;
}

describe("campaignToFlow", () => {
  it("keeps every setting of a full campaign, in the order the worker runs them", () => {
    const flow = campaignToFlow(full);
    const s = flow.steps;

    expect(byId(s, "trigger")).toMatchObject({ next: "opening" });
    expect(byId(s, "opening")).toMatchObject({
      type: "message",
      text: "Hello {username}",
      buttons: [{ kind: "step", label: "Je le veux", next: "email" }],
    });
    expect(byId(s, "follow")).toMatchObject({ text: "Abonne-toi", buttonLabel: "Abonnée", next: "reveal" });
    expect(byId(s, "email")).toMatchObject({
      text: "Ton e-mail ?",
      invalidText: "Invalide",
      crmWebhookUrl: "https://crm.example/hook",
      confirmKnown: false,
      next: "follow",
    });
    expect(byId(s, "reveal")).toMatchObject({
      text: "Voici ton guide {link}",
      buttons: [
        { kind: "link", label: "Le guide", url: "https://example.com/a" },
        { kind: "link", label: "Le bonus", url: "https://example.com/b" },
      ],
      noClickMinutes: 90,
      noClickNext: "click_reminder",
      next: "first_name",
    });
    expect(byId(s, "first_name")).toMatchObject({
      text: "Ton prénom ?",
      thanksText: "Enchantée {name}",
      next: "follow_up_wait",
      timeoutNext: "follow_up_wait",
    });
    expect(byId(s, "follow_up_wait")).toMatchObject({ minutes: 30, next: "follow_up" });
    expect(byId(s, "follow_up")).toMatchObject({ text: "Merci !" });
    expect(byId(s, "click_reminder")).toMatchObject({ text: "Psst" });
    expect((byId(s, "click_reminder") as Extract<FlowStep, { type: "message" }>).buttons).toHaveLength(2);
  });

  it("produces a valid, fully connected flow", () => {
    const flow = campaignToFlow(full);
    expect(flowSchema.safeParse(flow).success).toBe(true);
    expect(validateFlow(flow)).toEqual([]);
    expect(reachable(flow.steps).size).toBe(flow.steps.length);
  });

  it("draws a minimal campaign as trigger → link message", () => {
    const flow = campaignToFlow({
      dmMessage: "Hello {link}",
      openingDmEnabled: false,
      openingDmMessage: null,
      openingDmButtonLabel: null,
      linkButtonLabel: null,
      requireFollow: false,
      followPromptMessage: null,
      followPromptButtonLabel: null,
      followUpEnabled: false,
      followUpMessage: null,
      followUpDelayMinutes: null,
      trackedLinks: [{ destinationUrl: "https://example.com", label: null }],
    });
    expect(flow.steps.map((s) => s.id)).toEqual(["trigger", "reveal"]);
    expect(byId(flow.steps, "trigger")).toMatchObject({ next: "reveal" });
    expect(byId(flow.steps, "reveal")).toMatchObject({ buttons: [{ label: "Open link" }] });
    expect(validateFlow(flow)).toEqual([]);
  });

  it("shows worker defaults for empty texts instead of blanks", () => {
    const flow = campaignToFlow({ ...full, followPromptMessage: null, emailPromptMessage: "  " });
    expect((byId(flow.steps, "follow") as { text: string }).text.length).toBeGreaterThan(10);
    expect((byId(flow.steps, "email") as { text: string }).text.trim()).not.toBe("");
  });
});
