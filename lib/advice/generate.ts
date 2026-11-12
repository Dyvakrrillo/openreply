import Anthropic from "@anthropic-ai/sdk";
import { adviceJsonSchema, adviceReportSchema, normalizeReport, type AdviceReport } from "./schema";
import type { AdviceInput } from "./input";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";

export const DEFAULT_ADVICE_MODEL = "claude-opus-5-5";
// If safety classifiers decline the request, the API re-runs it on this model.
const FALLBACK_MODEL = "claude-opus-4-8";

export class AdviceError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "auth" | "rate_limit" | "refused" | "truncated" | "invalid" | "api"
  ) {
    super(message);
  }
}

export function isAdviceConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function adviceModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ADVICE_MODEL;
}

export interface GeneratedAdvice {
  report: AdviceReport;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * One advice report from Claude. The key is read from ANTHROPIC_API_KEY by the
 * SDK. The output is constrained to a JSON schema, then validated again with
 * zod; a malformed answer is retried once.
 */
export async function generateAdvice(
  input: AdviceInput,
  locale: string,
  injectedClient?: Anthropic
): Promise<GeneratedAdvice> {
  if (!injectedClient && !isAdviceConfigured()) {
    throw new AdviceError("ANTHROPIC_API_KEY is not set", "not_configured");
  }
  const client = injectedClient ?? new Anthropic();
  const model = adviceModel();
  const system = buildSystemPrompt(locale);
  const user = buildUserPrompt(input);

  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: [{ model: FALLBACK_MODEL }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: adviceJsonSchema } },
        system,
        messages: [{ role: "user", content: user }],
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new AdviceError("The Anthropic API key was refused", "auth");
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new AdviceError("Anthropic rate limit reached, try again later", "rate_limit");
      }
      throw new AdviceError(error instanceof Error ? error.message : "Anthropic API error", "api");
    }

    if (response.stop_reason === "refusal") {
      throw new AdviceError("The model declined to write this report", "refused");
    }
    if (response.stop_reason === "max_tokens") {
      throw new AdviceError("The report was cut off before the end", "truncated");
    }

    const textBlock = response.content.find((block) => block.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";
    try {
      const parsed = adviceReportSchema.parse(JSON.parse(raw));
      return {
        report: normalizeReport(parsed),
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    } catch (error) {
      lastProblem = error instanceof Error ? error.message.slice(0, 200) : "invalid output";
    }
  }
  throw new AdviceError(`The report could not be read (${lastProblem})`, "invalid");
}
