"use client";

import { createContext, useContext, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps, type Node } from "@xyflow/react";
import { useI18n } from "@/lib/i18n/provider";
import type { FlowStep } from "@/lib/flows/types";
import type { I18n } from "@/lib/i18n";
import { STEP_ACCENTS, STEP_TITLES, formatMinutes } from "./flow-meta";

export type StepNodeData = { step: FlowStep; label: string };
export type StepNode = Node<StepNodeData, "step">;

/** Campaign facts the trigger card summarises (they are edited in the form). */
export type TriggerSummary = {
  keywords: string[];
  matchAnyWord: boolean;
  scope: "specific" | "any" | "next";
  dmTriggerEnabled: boolean;
  publicReplyEnabled: boolean;
};

export const TriggerSummaryContext = createContext<TriggerSummary | null>(null);

const handleClass = "!h-3 !w-3 !border-2 !border-white !bg-zinc-400";

function Bubble({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-snug ${
        muted ? "bg-zinc-50 text-zinc-400 italic" : "bg-zinc-100 text-zinc-800"
      }`}
    >
      {children}
    </div>
  );
}

function Chip({ icon, children, tone = "violet" }: { icon: string; children: React.ReactNode; tone?: "violet" | "amber" }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] ${
        tone === "amber" ? "bg-amber-50 text-amber-800" : "bg-violet-50 text-violet-800"
      }`}
    >
      <span aria-hidden>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

/** A labelled output on the right edge, with its own connection dot. */
function Output({
  id,
  label,
  pill = false,
  tone = "default",
}: {
  id: string;
  label: string;
  pill?: boolean;
  tone?: "default" | "yes" | "no" | "warn";
}) {
  const dot =
    tone === "yes"
      ? "!bg-emerald-500"
      : tone === "no"
        ? "!bg-rose-500"
        : tone === "warn"
          ? "!bg-amber-500"
          : "!bg-zinc-400";
  return (
    <div className="relative flex justify-end pr-1">
      <span
        className={
          pill
            ? "rounded-full border border-zinc-200 bg-white px-3 py-1 text-[13px] font-medium text-zinc-800 shadow-sm"
            : "text-[12px] text-zinc-500"
        }
      >
        {label}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        id={id}
        className={`${handleClass} ${dot}`}
        style={{ right: -22 }}
      />
    </div>
  );
}

function render(text: string) {
  return text.replace(/\{username\}/gi, "@username").replace(/\{name\}/gi, "Marie");
}

export function StepNodeView({ id, data, selected }: NodeProps<StepNode>) {
  const { t } = useI18n();
  const { step, label } = data;
  const trigger = useContext(TriggerSummaryContext);
  const updateNodeInternals = useUpdateNodeInternals();

  // Handles move when buttons or optional outputs change; tell React Flow.
  const handleKey = JSON.stringify(
    step.type === "message"
      ? [step.buttons.map((b) => b.id + b.kind), step.noClickMinutes]
      : "timeoutMinutes" in step
        ? step.timeoutMinutes
        : null
  );
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleKey, updateNodeInternals]);

  return (
    <div
      className={`w-[280px] rounded-2xl border bg-white shadow-sm transition-shadow ${
        selected ? "border-accent shadow-lg ring-2 ring-accent/30" : "border-zinc-200 hover:shadow-md"
      }`}
    >
      {step.type !== "trigger" && (
        <Handle type="target" position={Position.Left} id="in" className={handleClass} style={{ left: -7, top: 30 }} />
      )}

      <div className="flex items-center gap-2.5 px-4 pt-3.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${STEP_ACCENTS[step.type]}`}>
          {ICONS[step.type]}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] leading-none text-zinc-400">
            {step.type === "trigger" ? "OpenReply" : "Instagram"}
          </p>
          <p className="truncate text-sm font-semibold text-zinc-900">{label}</p>
        </div>
      </div>

      <div className="space-y-2.5 px-4 pb-3.5 pt-3">
        {step.type === "trigger" && trigger && (
          <>
            <Bubble>
              {trigger.scope === "any"
                ? t("Comment on any post or reel")
                : trigger.scope === "next"
                  ? t("Comment on the next post or reel")
                  : t("Comment on a specific post or reel")}
              {" · "}
              {trigger.matchAnyWord ? t("any word") : trigger.keywords.join(", ") || t("no keyword yet")}
            </Bubble>
            {trigger.dmTriggerEnabled && <Bubble>{t("Or a DM with the same keywords")}</Bubble>}
            {trigger.publicReplyEnabled && <Chip icon="💬">{t("Public reply under the comment")}</Chip>}
          </>
        )}

        {step.type === "message" && (
          <>
            {step.delaySeconds ? (
              <Chip icon="⏱">{t("Waiting {n} sec…", { n: step.delaySeconds })}</Chip>
            ) : null}
            {step.text.trim() ? <Bubble>{render(step.text)}</Bubble> : <Bubble muted>{t("Empty message")}</Bubble>}
            {step.buttons.map((b) =>
              b.kind === "link" ? (
                <div key={b.id} className="flex justify-end">
                  <span className="max-w-full truncate rounded-full border border-zinc-200 bg-white px-3 py-1 text-[13px] font-medium text-sky-600 shadow-sm">
                    🔗 {b.label || t("Link")}
                  </span>
                </div>
              ) : (
                <Output key={b.id} id={`button:${b.id}`} label={b.label || t("Button")} pill />
              )
            )}
            {step.noClickMinutes && step.buttons.some((b) => b.kind === "link") ? (
              <Output
                id="noClick"
                label={t("If no click after {time}", { time: formatMinutes(step.noClickMinutes, t) })}
                tone="warn"
              />
            ) : null}
          </>
        )}

        {step.type === "followGate" && (
          <>
            <Bubble>{render(step.text)}</Bubble>
            <div className="flex justify-end">
              <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[13px] font-medium text-zinc-800 shadow-sm">
                {step.buttonLabel}
              </span>
            </div>
            <Chip icon="✅">{t("Checks they follow you")}</Chip>
          </>
        )}

        {step.type === "askEmail" && (
          <>
            <Bubble>{render(step.text)}</Bubble>
            <Chip icon="💬">{t("Waiting for a reply from contact…")}</Chip>
            {step.confirmKnown && <Chip icon="🔁">{t("Already known: asks to confirm it")}</Chip>}
            {step.crmWebhookUrl.trim() && <Chip icon="⚡">{t("Sent to your CRM")}</Chip>}
          </>
        )}

        {step.type === "askFirstName" && (
          <>
            <Bubble>{render(step.text)}</Bubble>
            <Chip icon="💬">{t("Waiting for a reply from contact…")}</Chip>
            {step.thanksText.trim() && <Bubble>{render(step.thanksText)}</Bubble>}
          </>
        )}

        {step.type === "wait" && (
          <Chip icon="⏱" tone="amber">
            {t("Wait {time}", { time: formatMinutes(step.minutes, t) })}
          </Chip>
        )}

        {step.type === "condition" && (
          <Bubble>
            {step.check === "clicked"
              ? t("Clicked a link?")
              : step.check === "follows"
                ? t("Follows you?")
                : t("Email already known?")}
          </Bubble>
        )}
      </div>

      <div className="space-y-1.5 border-t border-zinc-100 px-4 py-2.5">
        {step.type === "condition" ? (
          <>
            <Output id="yes" label={t("Yes")} tone="yes" />
            <Output id="no" label={t("No")} tone="no" />
          </>
        ) : (
          <>
            {(step.type === "askEmail" || step.type === "askFirstName") && step.timeoutMinutes ? (
              <Output
                id="timeout"
                label={t("If no reply after {time}", { time: formatMinutes(step.timeoutMinutes, t) })}
                tone="no"
              />
            ) : null}
            <Output
              id="next"
              label={
                step.type === "askEmail" || step.type === "askFirstName"
                  ? t("After the reply")
                  : step.type === "followGate"
                    ? t("Once they follow")
                    : t("Next step")
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

const ICONS: Record<FlowStep["type"], string> = {
  trigger: "⚡",
  message: "✉️",
  followGate: "👤",
  askEmail: "@",
  askFirstName: "Aa",
  wait: "⏱",
  condition: "⑂",
};

export const nodeTypes = { step: StepNodeView };

/** Title shown on a card, e.g. "Send message #2". */
export function stepLabel(step: FlowStep, index: number, t: I18n["t"]) {
  const base = t(STEP_TITLES[step.type]);
  return step.type === "message" ? `${base} #${index}` : base;
}
