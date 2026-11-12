import { z } from "zod";

// The advice report the model must return. Validated with zod after parsing,
// and described to the API as a JSON schema (structured outputs). Limits on
// list sizes live in `normalizeReport` rather than in the schema: structured
// outputs do not support min/max items.

const text = z.string().trim().min(1);

export const REPORT_FORMATS = ["reel", "carousel", "story", "photo"] as const;
export const REPORT_CATEGORIES = [
  "utility",
  "connection",
  "positioning",
  "community",
  "entertainment",
  "conversion",
] as const;

export const adviceReportSchema = z.object({
  headline: text,
  summary: text,
  cards: z.array(
    z.object({
      title: text,
      status: z.enum(["critical", "attention", "good"]),
      text,
    })
  ),
  mistakes: z.array(z.object({ title: text, why: text, evidence: text, action: text })),
  goal: z.object({
    metric: text,
    today: z.number(),
    target: z.number(),
    why: text,
  }),
  calendar: z.array(
    z.object({
      day: z.number().int(),
      format: z.enum(REPORT_FORMATS),
      idea: text,
      category: z.enum(REPORT_CATEGORIES),
    })
  ),
  nextMoves: z.array(
    z.object({
      title: text,
      detail: text,
      urgency: z.enum(["high", "medium"]),
      impact: z.enum(["high", "medium"]),
      horizon: z.enum(["week", "month"]),
    })
  ),
});

export type AdviceReport = z.infer<typeof adviceReportSchema>;

const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** The same shape as `adviceReportSchema`, in the JSON-schema subset the API accepts. */
export const adviceJsonSchema = obj({
  headline: str,
  summary: str,
  cards: {
    type: "array",
    items: obj({ title: str, status: { type: "string", enum: ["critical", "attention", "good"] }, text: str }),
  },
  mistakes: { type: "array", items: obj({ title: str, why: str, evidence: str, action: str }) },
  goal: obj({ metric: str, today: { type: "number" }, target: { type: "number" }, why: str }),
  calendar: {
    type: "array",
    items: obj({
      day: { type: "integer" },
      format: { type: "string", enum: [...REPORT_FORMATS] },
      idea: str,
      category: { type: "string", enum: [...REPORT_CATEGORIES] },
    }),
  },
  nextMoves: {
    type: "array",
    items: obj({
      title: str,
      detail: str,
      urgency: { type: "string", enum: ["high", "medium"] },
      impact: { type: "string", enum: ["high", "medium"] },
      horizon: { type: "string", enum: ["week", "month"] },
    }),
  },
});

/** Cap list sizes and keep the calendar inside 28 days, in day order. */
export function normalizeReport(report: AdviceReport): AdviceReport {
  return {
    ...report,
    cards: report.cards.slice(0, 3),
    mistakes: report.mistakes.slice(0, 5),
    calendar: report.calendar
      .filter((entry) => entry.day >= 1 && entry.day <= 28)
      .sort((a, b) => a.day - b.day)
      .slice(0, 14),
    nextMoves: report.nextMoves.slice(0, 5),
  };
}
