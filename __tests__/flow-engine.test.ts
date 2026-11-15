import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockSend, mockFollow, mockQueueAdd, mockFindEmail, mockSyncCrm } = vi.hoisted(() => ({
  mockPrisma: {
    flowRun: { upsert: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    flowEvent: { create: vi.fn(), findFirst: vi.fn() },
    flowLink: { findMany: vi.fn() },
    linkClick: { findFirst: vi.fn() },
    automation: { findFirst: vi.fn() },
    emailCapture: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  },
  mockSend: vi.fn(),
  mockFollow: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockFindEmail: vi.fn(),
  mockSyncCrm: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/instagram/provider", () => ({
  sendFlowMessage: mockSend,
  getUserFollowStatus: mockFollow,
  createInstagramContext: vi.fn(async () => ({ provider: "META", accessToken: "tok" })),
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mockQueueAdd }),
  FLOW_JOB_NAME: "process-flow",
}));
vi.mock("@/lib/queue/email-gate", () => ({
  findCapturedEmail: mockFindEmail,
  syncCaptureToCrm: mockSyncCrm,
}));

import { handleFlowPostback, handleFlowText, processFlowJob, startFlow } from "@/lib/flows/engine";
import type { Flow } from "@/lib/flows/types";

const context = { provider: "META" as const, accessToken: "tok" };
const p = { x: 0, y: 0 };

const flow: Flow = {
  version: 1,
  steps: [
    { id: "trigger", type: "trigger", position: p, next: "hello" },
    {
      id: "hello",
      type: "message",
      position: p,
      text: "Hi {username}",
      buttons: [
        { id: "want", kind: "step", label: "I want it", next: "email" },
        { id: "site", kind: "link", label: "Site", url: "https://example.com/guide" },
      ],
    },
    {
      id: "email",
      type: "askEmail",
      position: p,
      text: "Your email?",
      invalidText: "Hmm, not an email",
      confirmKnown: true,
      confirmText: "Still {email}?",
      crmWebhookUrl: "https://crm.example/hook",
      next: "link",
    },
    {
      id: "link",
      type: "message",
      position: p,
      text: "Here it is {link}",
      buttons: [{ id: "g", kind: "link", label: "Guide", url: "https://example.com/guide" }],
      noClickMinutes: 60,
      noClickNext: "nudge",
      next: "pause",
    },
    { id: "pause", type: "wait", position: p, minutes: 30, next: "bye" },
    { id: "bye", type: "message", position: p, text: "Thanks!", buttons: [] },
    { id: "nudge", type: "message", position: p, text: "Psst", buttons: [] },
  ],
};

const automation = {
  id: "auto_1",
  name: "Guide",
  workspaceId: "ws_1",
  instagramAccountId: "acct_row",
  flow,
  flowEnabled: true,
  isActive: true,
  instagramAccount: { instagramId: "ig_biz", username: "brand", accessToken: "enc" },
  trackedLinks: [{ slug: "guide1", destinationUrl: "https://example.com/guide" }],
};

let seq = 0;
beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  mockPrisma.flowRun.upsert.mockResolvedValue({
    id: "run_1",
    seq: 0,
    igUserId: "user_1",
    igUsername: "marie",
    currentStepId: null,
    waiting: null,
    invalidReplies: 0,
  });
  mockPrisma.flowRun.update.mockImplementation(async () => ({ seq: ++seq }));
  mockPrisma.flowEvent.create.mockResolvedValue({});
  mockPrisma.flowEvent.findFirst.mockResolvedValue(null);
  mockPrisma.flowLink.findMany.mockResolvedValue([{ buttonId: "promo", slug: "flowslug1" }]);
  mockPrisma.emailCapture.upsert.mockResolvedValue({ id: "cap_1" });
  mockPrisma.emailCapture.updateMany.mockResolvedValue({ count: 0 });
  mockSend.mockResolvedValue({ message_id: "m1" });
  mockFindEmail.mockResolvedValue(null);
  mockSyncCrm.mockResolvedValue(undefined);
});

function lastParkData() {
  const calls = mockPrisma.flowRun.update.mock.calls.filter((c) => "waiting" in (c[0].data ?? {}));
  return calls.at(-1)?.[0].data;
}

describe("flow engine", () => {
  it("answers a comment with one private reply carrying mixed buttons, then waits for a tap", async () => {
    const sent = await startFlow({
      automation,
      flow,
      context,
      userId: "user_1",
      username: "marie",
      comment: { commentId: "c_1", postId: "media_1" },
    });

    expect(sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.commentId).toBe("c_1");
    expect(args.userId).toBeUndefined();
    expect(args.text).toBe("Hi marie");
    expect(args.buttons[0]).toEqual({ type: "postback", title: "I want it", payload: "flow:auto_1:hello:want" });
    // The link button goes through the campaign's tracked link, tagged with the card.
    expect(args.buttons[1].type).toBe("url");
    expect(args.buttons[1].url).toMatch(/\/r\/guide1\?r=[\w-]+&f=hello~site$/);
    expect(lastParkData()).toMatchObject({ currentStepId: "hello", waiting: "button" });
  });

  it("parks on the next step after a comment until the conversation opens", async () => {
    const twoMessages: Flow = {
      version: 1,
      steps: [
        { id: "trigger", type: "trigger", position: p, next: "a" },
        { id: "a", type: "message", position: p, text: "First", buttons: [], next: "b" },
        { id: "b", type: "message", position: p, text: "Second", buttons: [] },
      ],
    };
    await startFlow({ automation, flow: twoMessages, context, userId: "user_1", username: null, comment: { commentId: "c_1" } });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(lastParkData()).toMatchObject({ currentStepId: "b", waiting: "window" });
  });

  it("follows a button tap to the next step and asks to confirm a known email", async () => {
    mockFindEmail.mockResolvedValue("marie@example.com");
    await handleFlowPostback({
      automation,
      context,
      userId: "user_1",
      username: "marie",
      payload: { stepId: "hello", action: "want" },
    });

    expect(mockPrisma.flowEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stepId: "hello", kind: "button", buttonId: "want" }) })
    );
    const args = mockSend.mock.calls[0][0];
    expect(args.userId).toBe("user_1");
    expect(args.text).toBe("Still marie@example.com?");
    expect(args.buttons.map((b: { payload: string }) => b.payload)).toEqual([
      "flow:auto_1:email:yes",
      "flow:auto_1:email:change",
    ]);
    expect(lastParkData()).toMatchObject({ currentStepId: "email", waiting: "button" });
  });

  it("takes a typed email, sends it to the CRM and moves on", async () => {
    mockPrisma.flowRun.findFirst.mockResolvedValue({
      id: "run_1",
      seq: 3,
      igUserId: "user_1",
      igUsername: "marie",
      currentStepId: "email",
      waiting: "email",
      invalidReplies: 0,
      automationId: "auto_1",
    });
    mockPrisma.automation.findFirst.mockResolvedValue(automation);

    const handled = await handleFlowText({ instagramAccountId: "ig_biz", senderId: "user_1", text: "it's marie@example.com" });

    expect(handled).toBe(true);
    expect(mockPrisma.emailCapture.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ email: "marie@example.com", status: "CAPTURED" }) })
    );
    expect(mockSyncCrm).toHaveBeenCalledWith("cap_1", expect.objectContaining({ crmWebhookUrl: "https://crm.example/hook" }));
    // Link message, then a 30 min wait.
    expect(mockSend.mock.calls[0][0].text).toBe("Here it is");
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-flow",
      expect.objectContaining({ kind: "noClick", stepId: "link" }),
      expect.objectContaining({ delay: 60 * 60_000 })
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-flow",
      expect.objectContaining({ kind: "resume", stepId: "bye" }),
      expect.objectContaining({ delay: 30 * 60_000 })
    );
  });

  it("asks again when the reply is not an email", async () => {
    mockPrisma.flowRun.findFirst.mockResolvedValue({
      id: "run_1", seq: 3, igUserId: "user_1", igUsername: "marie",
      currentStepId: "email", waiting: "email", invalidReplies: 0, automationId: "auto_1",
    });
    mockPrisma.automation.findFirst.mockResolvedValue(automation);

    const handled = await handleFlowText({ instagramAccountId: "ig_biz", senderId: "user_1", text: "hello?" });

    expect(handled).toBe(true);
    expect(mockSend.mock.calls[0][0].text).toBe("Hmm, not an email");
    expect(mockPrisma.emailCapture.upsert).not.toHaveBeenCalled();
  });

  it("ignores a delayed job when the run has moved on", async () => {
    mockPrisma.flowRun.findUnique.mockResolvedValue({
      id: "run_1", seq: 7, igUserId: "user_1", igUsername: null,
      currentStepId: "x", waiting: null, invalidReplies: 0, status: "ACTIVE",
    });
    await processFlowJob({
      instagramAccountId: "ig_biz", automationId: "auto_1", userId: "user_1",
      runId: "run_1", kind: "resume", stepId: "bye", seq: 6,
    });
    expect(mockPrisma.automation.findFirst).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends the no-click path only to someone who has not clicked", async () => {
    mockPrisma.flowRun.findUnique.mockResolvedValue({
      id: "run_1", seq: 9, igUserId: "user_1", igUsername: null,
      currentStepId: "pause", waiting: "timer", invalidReplies: 0, status: "ACTIVE",
    });
    mockPrisma.automation.findFirst.mockResolvedValue(automation);
    const job = { instagramAccountId: "ig_biz", automationId: "auto_1", userId: "user_1", runId: "run_1", kind: "noClick" as const, stepId: "link" };

    mockPrisma.linkClick.findFirst.mockResolvedValueOnce({ id: "click" });
    await processFlowJob(job);
    expect(mockSend).not.toHaveBeenCalled();

    mockPrisma.linkClick.findFirst.mockResolvedValueOnce(null);
    await processFlowJob(job);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].text).toBe("Psst");
  });

  it("re-shows the follow prompt to someone who does not follow yet", async () => {
    const gated: Flow = {
      version: 1,
      steps: [
        { id: "trigger", type: "trigger", position: p, next: "gate" },
        { id: "gate", type: "followGate", position: p, text: "Follow me", buttonLabel: "Done", next: "bye" },
        { id: "bye", type: "message", position: p, text: "Thanks!", buttons: [] },
      ],
    };
    const gatedAutomation = { ...automation, flow: gated };

    mockFollow.mockResolvedValueOnce(false);
    await handleFlowPostback({ automation: gatedAutomation, context, userId: "user_1", username: null, payload: { stepId: "gate", action: "follow" } });
    expect(mockSend.mock.calls[0][0].text).toBe("Follow me");

    mockFollow.mockResolvedValueOnce(true);
    await handleFlowPostback({ automation: gatedAutomation, context, userId: "user_1", username: null, payload: { stepId: "gate", action: "follow" } });
    expect(mockSend.mock.calls[1][0].text).toBe("Thanks!");
  });

  it("gives a canvas-only link its own tracked redirect", async () => {
    const promoFlow: Flow = {
      version: 1,
      steps: [
        { id: "trigger", type: "trigger", position: p, next: "promo_msg" },
        {
          id: "promo_msg",
          type: "message",
          position: p,
          text: "Bonus",
          buttons: [{ id: "promo", kind: "link", label: "Bonus", url: "https://example.com/bonus" }],
        },
      ],
    };
    await startFlow({ automation, flow: promoFlow, context, userId: "user_1", username: null });
    expect(mockSend.mock.calls[0][0].buttons[0].url).toMatch(/\/r\/flowslug1\?r=[\w-]+&f=promo_msg~promo$/);
  });

  it("counts a click on a canvas link as clicked", async () => {
    mockPrisma.flowRun.findUnique.mockResolvedValue({
      id: "run_1", seq: 9, igUserId: "user_1", igUsername: null,
      currentStepId: "pause", waiting: "timer", invalidReplies: 0, status: "ACTIVE",
    });
    mockPrisma.automation.findFirst.mockResolvedValue(automation);
    mockPrisma.linkClick.findFirst.mockResolvedValue(null);
    mockPrisma.flowEvent.findFirst.mockResolvedValue({ id: "ev" });
    await processFlowJob({ instagramAccountId: "ig_biz", automationId: "auto_1", userId: "user_1", runId: "run_1", kind: "noClick", stepId: "link" });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("flow click tag", () => {
  it("round-trips and rejects anything else", async () => {
    const { flowClickTag, parseFlowClickTag } = await import("@/lib/flows/links");
    expect(parseFlowClickTag(flowClickTag("step_1", "btn-2"))).toEqual({ stepId: "step_1", buttonId: "btn-2" });
    expect(parseFlowClickTag("a~b~c")).toBeNull();
    expect(parseFlowClickTag("<script>")).toBeNull();
    expect(parseFlowClickTag(null)).toBeNull();
  });
});
