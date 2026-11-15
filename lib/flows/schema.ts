import { z } from "zod";
import { FLOW_VERSION, MAX_BUTTONS, MAX_WAIT_MINUTES, type Flow } from "./types";

// Runtime shape check for a flow sent by the canvas. Business rules (text
// required, valid URLs, ...) are in validateFlow(); this only guarantees the
// JSON is something the editor and the worker can read.

const id = z.string().min(1).max(64);
const target = id.optional();
const position = z.object({ x: z.number().finite(), y: z.number().finite() });
const text = z.string().max(2000);

const button = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("link"), label: z.string().max(20), url: z.string().max(2000) }),
  z.object({ id, kind: z.literal("step"), label: z.string().max(20), next: target }),
]);

const step = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("trigger"), position, next: target }),
  z.object({
    id,
    type: z.literal("message"),
    position,
    text,
    delaySeconds: z.number().int().min(0).max(60).optional(),
    buttons: z.array(button).max(MAX_BUTTONS),
    next: target,
    noClickMinutes: z.number().int().min(5).max(MAX_WAIT_MINUTES).optional(),
    noClickNext: target,
  }),
  z.object({ id, type: z.literal("followGate"), position, text, buttonLabel: z.string().max(20), next: target }),
  z.object({
    id,
    type: z.literal("askEmail"),
    position,
    text,
    invalidText: text,
    confirmKnown: z.boolean(),
    confirmText: text,
    crmWebhookUrl: z.string().max(2000),
    next: target,
    timeoutMinutes: z.number().int().min(5).max(MAX_WAIT_MINUTES).optional(),
    timeoutNext: target,
  }),
  z.object({
    id,
    type: z.literal("askFirstName"),
    position,
    text,
    thanksText: text,
    next: target,
    timeoutMinutes: z.number().int().min(5).max(MAX_WAIT_MINUTES).optional(),
    timeoutNext: target,
  }),
  z.object({ id, type: z.literal("wait"), position, minutes: z.number().int().min(1).max(MAX_WAIT_MINUTES), next: target }),
  z.object({
    id,
    type: z.literal("condition"),
    position,
    check: z.enum(["follows", "clicked", "hasEmail"]),
    yes: target,
    no: target,
  }),
]);

export const flowSchema = z.object({
  version: z.literal(FLOW_VERSION),
  steps: z.array(step).min(1).max(100),
});

export function parseFlow(value: unknown): Flow | null {
  const parsed = flowSchema.safeParse(value);
  return parsed.success ? (parsed.data as Flow) : null;
}
