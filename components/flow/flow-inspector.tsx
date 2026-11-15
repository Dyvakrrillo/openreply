"use client";

import { useI18n } from "@/lib/i18n/provider";
import {
  MAX_BUTTONS,
  MAX_BUTTON_TEXT,
  MAX_WAIT_MINUTES,
  newStepId,
  type ConditionCheck,
  type FlowButton,
  type FlowStep,
} from "@/lib/flows/types";

const input =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/50 focus:outline-none";
const label = "mb-1 block text-xs font-medium text-muted";

function NumberField({
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Math.floor(Number(e.target.value) || min))))}
        className="w-24 rounded-lg border border-border bg-white px-2 py-1.5 text-sm focus:border-accent/50 focus:outline-none"
      />
      <span className="text-xs text-muted">{suffix}</span>
    </div>
  );
}

function Toggle({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="text-sm text-foreground">{children}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-zinc-300"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export default function FlowInspector({
  step,
  title,
  onChange,
  onDelete,
  onClose,
  editTriggerHref,
}: {
  step: FlowStep;
  title: string;
  onChange: (step: FlowStep) => void;
  onDelete: () => void;
  onClose: () => void;
  editTriggerHref: string;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<FlowStep>) => onChange({ ...step, ...patch } as FlowStep);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface hover:text-foreground" aria-label={t("Close")}>
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {step.type === "trigger" && (
          <div className="space-y-3 text-sm text-muted">
            <p>{t("The trigger (posts, keywords, public reply) is set in the campaign form.")}</p>
            <a href={editTriggerHref} className="inline-block rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-surface">
              {t("Edit the trigger")}
            </a>
          </div>
        )}

        {step.type === "message" && (
          <>
            <div>
              <span className={label}>{t("Message")}</span>
              <textarea
                value={step.text}
                onChange={(e) => set({ text: e.target.value })}
                rows={5}
                maxLength={2000}
                className={`${input} resize-none`}
                placeholder={t("Hi {username}! …", { username: "{username}" })}
              />
              <p className="mt-1 text-xs text-muted">
                {"{username}"} {t("personalizes.")}
                {step.buttons.length > 0 && ` ${step.text.length}/${MAX_BUTTON_TEXT}`}
              </p>
            </div>

            <div>
              <span className={label}>{t("Typing pause before sending")}</span>
              <NumberField value={step.delaySeconds ?? 0} min={0} max={60} onChange={(v) => set({ delaySeconds: v || undefined })} suffix={t("seconds")} />
            </div>

            <div className="space-y-2">
              <span className={label}>
                {t("Buttons")} ({step.buttons.length}/{MAX_BUTTONS})
              </span>
              {step.buttons.map((b, i) => (
                <div key={b.id} className="space-y-2 rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <select
                      value={b.kind}
                      onChange={(e) => {
                        const kind = e.target.value as FlowButton["kind"];
                        const next: FlowButton =
                          kind === "link"
                            ? { id: b.id, kind: "link", label: b.label, url: "" }
                            : { id: b.id, kind: "step", label: b.label };
                        set({ buttons: step.buttons.map((x, j) => (j === i ? next : x)) });
                      }}
                      className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
                    >
                      <option value="step">{t("Goes to a step")}</option>
                      <option value="link">{t("Opens a link")}</option>
                    </select>
                    <button
                      onClick={() => set({ buttons: step.buttons.filter((_, j) => j !== i) })}
                      className="ml-auto text-xs text-error hover:underline"
                    >
                      {t("Remove")}
                    </button>
                  </div>
                  <input
                    value={b.label}
                    maxLength={20}
                    onChange={(e) =>
                      set({ buttons: step.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
                    }
                    placeholder={t("Button label")}
                    className={input}
                  />
                  {b.kind === "link" && (
                    <input
                      value={b.url}
                      onChange={(e) =>
                        set({
                          buttons: step.buttons.map((x, j) =>
                            j === i && x.kind === "link" ? { ...x, url: e.target.value } : x
                          ),
                        })
                      }
                      placeholder="https://"
                      className={input}
                    />
                  )}
                  {b.kind === "step" && (
                    <p className="text-xs text-muted">{t("Drag its dot on the canvas to the next step.")}</p>
                  )}
                </div>
              ))}
              {step.buttons.length < MAX_BUTTONS && (
                <button
                  onClick={() => set({ buttons: [...step.buttons, { id: newStepId("btn"), kind: "step", label: "" }] })}
                  className="w-full rounded-lg border border-dashed border-border py-2 text-sm text-muted hover:border-accent/50 hover:text-foreground"
                >
                  + {t("Add a button")}
                </button>
              )}
            </div>

            {step.buttons.some((b) => b.kind === "link") && (
              <div className="space-y-2">
                <Toggle
                  on={Boolean(step.noClickMinutes)}
                  onToggle={() =>
                    set(step.noClickMinutes ? { noClickMinutes: undefined, noClickNext: undefined } : { noClickMinutes: 60 })
                  }
                >
                  {t("Another path if no link is clicked")}
                </Toggle>
                {step.noClickMinutes ? (
                  <NumberField
                    value={step.noClickMinutes}
                    min={5}
                    max={MAX_WAIT_MINUTES}
                    onChange={(v) => set({ noClickMinutes: v })}
                    suffix={t("minutes after the message")}
                  />
                ) : null}
              </div>
            )}
          </>
        )}

        {step.type === "followGate" && (
          <>
            <div>
              <span className={label}>{t("Message")}</span>
              <textarea value={step.text} onChange={(e) => set({ text: e.target.value })} rows={5} className={`${input} resize-none`} />
            </div>
            <div>
              <span className={label}>{t("Button label")}</span>
              <input value={step.buttonLabel} maxLength={20} onChange={(e) => set({ buttonLabel: e.target.value })} className={input} />
            </div>
            <p className="text-xs text-muted">{t("On tap, OpenReply checks they follow you, then moves on.")}</p>
          </>
        )}

        {step.type === "askEmail" && (
          <>
            <div>
              <span className={label}>{t("Question")}</span>
              <textarea value={step.text} onChange={(e) => set({ text: e.target.value })} rows={4} className={`${input} resize-none`} />
            </div>
            <div>
              <span className={label}>{t("If the address looks wrong")}</span>
              <textarea value={step.invalidText} onChange={(e) => set({ invalidText: e.target.value })} rows={2} className={`${input} resize-none`} />
            </div>
            <Toggle on={step.confirmKnown} onToggle={() => set({ confirmKnown: !step.confirmKnown })}>
              {t("Already known: ask if it is still right")}
            </Toggle>
            {step.confirmKnown && (
              <div>
                <span className={label}>{t("Confirmation question")}</span>
                <input value={step.confirmText} onChange={(e) => set({ confirmText: e.target.value })} className={input} />
                <p className="mt-1 text-xs text-muted">{t("{email} shows their address. Buttons: Yes / Change it.", { email: "{email}" })}</p>
              </div>
            )}
            <div>
              <span className={label}>{t("CRM webhook (FluentCRM)")}</span>
              <input value={step.crmWebhookUrl} onChange={(e) => set({ crmWebhookUrl: e.target.value })} placeholder="https://" className={input} />
            </div>
            <TimeoutFields step={step} set={set} />
          </>
        )}

        {step.type === "askFirstName" && (
          <>
            <div>
              <span className={label}>{t("Question")}</span>
              <textarea value={step.text} onChange={(e) => set({ text: e.target.value })} rows={3} className={`${input} resize-none`} />
            </div>
            <div>
              <span className={label}>{t("Thank-you after the answer")}</span>
              <textarea value={step.thanksText} onChange={(e) => set({ thanksText: e.target.value })} rows={2} className={`${input} resize-none`} />
              <p className="mt-1 text-xs text-muted">{t("{name} shows their first name.", { name: "{name}" })}</p>
            </div>
            <TimeoutFields step={step} set={set} />
          </>
        )}

        {step.type === "wait" && (
          <div>
            <span className={label}>{t("Wait")}</span>
            <NumberField value={step.minutes} min={1} max={MAX_WAIT_MINUTES} onChange={(v) => set({ minutes: v })} suffix={t("minutes (23 h max)")} />
          </div>
        )}

        {step.type === "condition" && (
          <div>
            <span className={label}>{t("Check")}</span>
            <select
              value={step.check}
              onChange={(e) => set({ check: e.target.value as ConditionCheck })}
              className={input}
            >
              <option value="clicked">{t("Clicked a link?")}</option>
              <option value="follows">{t("Follows you?")}</option>
              <option value="hasEmail">{t("Email already known?")}</option>
            </select>
          </div>
        )}
      </div>

      {step.type !== "trigger" && (
        <div className="border-t border-border px-4 py-3">
          <button onClick={onDelete} className="text-sm text-error hover:underline">
            {t("Delete this step")}
          </button>
        </div>
      )}
    </div>
  );
}

function TimeoutFields({
  step,
  set,
}: {
  step: Extract<FlowStep, { type: "askEmail" | "askFirstName" }>;
  set: (patch: Partial<FlowStep>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <Toggle
        on={Boolean(step.timeoutMinutes)}
        onToggle={() =>
          set(step.timeoutMinutes ? { timeoutMinutes: undefined, timeoutNext: undefined } : { timeoutMinutes: 60 })
        }
      >
        {t("Another path if they do not reply")}
      </Toggle>
      {step.timeoutMinutes ? (
        <NumberField
          value={step.timeoutMinutes}
          min={5}
          max={MAX_WAIT_MINUTES}
          onChange={(v) => set({ timeoutMinutes: v })}
          suffix={t("minutes without a reply")}
        />
      ) : null}
    </div>
  );
}
