"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { Flow, FlowStep } from "@/lib/flows/types";
import { Avatar, Phone, StatusBar } from "@/components/campaign-preview";
import { formatMinutes } from "./flow-meta";

type Item =
  | { kind: "bot"; text: string; buttons: { label: string; link: boolean }[]; quick?: string[] }
  | { kind: "user"; text: string }
  | { kind: "note"; text: string };

type Choice = { label: string; reply?: string; run: () => Sim };
type Sim = { items: Item[]; choices: Choice[] };

const SAMPLE_EMAIL = "marie@exemple.fr";
const SAMPLE_NAME = "Marie";

function personalize(text: string) {
  return text
    .replace(/\{username\}/gi, "username")
    .replace(/\{name\}/gi, SAMPLE_NAME)
    .replace(/\{email\}/gi, SAMPLE_EMAIL)
    .replace(/\s*\{link\}\s*/gi, " ")
    .trim();
}

/**
 * Click-through simulation of a flow inside the phone mockup. Each tap on a
 * choice plays the next steps until the flow waits for the person again.
 * Remount it (key) to restart after the flow changes.
 */
export default function FlowPreview({
  flow,
  username,
  avatarUrl,
  keyword,
}: {
  flow: Flow;
  username: string;
  avatarUrl: string | null;
  keyword: string;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const byId = new Map(flow.steps.map((s) => [s.id, s]));

  // Pure: the items a path produces until the person must act, and the
  // choices offered then. A choice returns the next batch the same way.
  function play(startId: string | undefined, acc: Item[] = []): Sim {
    const out = [...acc];
    let currentId = startId;
    for (let guard = 0; guard < 40; guard += 1) {
      const step: FlowStep | undefined = currentId ? byId.get(currentId) : undefined;
      if (!step) {
        out.push({ kind: "note", text: t("End of the automation") });
        return { items: out, choices: [] };
      }
      const pause = (choices: Choice[]): Sim => ({ items: out, choices });
      switch (step.type) {
        case "trigger":
          out.push({ kind: "note", text: t("Someone comments “{keyword}”", { keyword }) });
          currentId = step.next;
          continue;
        case "wait":
          out.push({ kind: "note", text: t("⏱ {time} later", { time: formatMinutes(step.minutes, t) }) });
          currentId = step.next;
          continue;
        case "message": {
          out.push({
            kind: "bot",
            text: personalize(step.text) || "…",
            buttons: step.buttons.map((b) => ({ label: b.label || "…", link: b.kind === "link" })),
          });
          const stepButtons = step.buttons.filter((b) => b.kind === "step");
          if (stepButtons.length > 0) {
            return pause(
              stepButtons.map((b) => ({
                label: b.label || "…",
                reply: b.label || "…",
                run: () => play(b.kind === "step" ? b.next : undefined),
              }))
            );
          }
          const hasLink = step.buttons.some((b) => b.kind === "link");
          if (hasLink && step.noClickMinutes) {
            const time = formatMinutes(step.noClickMinutes, t);
            return pause([
              { label: t("Taps the link"), run: () => play(step.next) },
              {
                label: t("Does not tap ({time})", { time }),
                run: () => play(step.noClickNext, [{ kind: "note", text: t("⏱ {time} later, no click", { time }) }]),
              },
            ]);
          }
          currentId = step.next;
          continue;
        }
        case "followGate":
          out.push({ kind: "bot", text: personalize(step.text), buttons: [{ label: step.buttonLabel, link: false }] });
          return pause([{ label: step.buttonLabel, reply: step.buttonLabel, run: () => play(step.next) }]);
        case "askEmail": {
          const askAgain = (): Sim => ({
            items: [{ kind: "bot", text: personalize(step.text), buttons: [] }],
            choices: [{ label: t("Replies with an email"), reply: SAMPLE_EMAIL, run: () => play(step.next) }],
          });
          const choices: Choice[] = [];
          if (step.confirmKnown) {
            // A known address: the real step asks to confirm instead.
            choices.push({
              label: t("Email already known"),
              run: () => ({
                items: [{ kind: "bot", text: personalize(step.confirmText), buttons: [], quick: [t("Yes"), t("Change it")] }],
                choices: [
                  { label: t("Yes"), reply: t("Yes"), run: () => play(step.next) },
                  { label: t("Change it"), reply: t("Change it"), run: askAgain },
                ],
              }),
            });
          }
          choices.unshift({ label: t("Replies with an email"), reply: SAMPLE_EMAIL, run: () => play(step.next) });
          if (step.timeoutMinutes) {
            const time = formatMinutes(step.timeoutMinutes, t);
            choices.push({
              label: t("Does not reply ({time})", { time }),
              run: () => play(step.timeoutNext, [{ kind: "note", text: t("⏱ {time} later", { time }) }]),
            });
          }
          out.push({ kind: "bot", text: personalize(step.text), buttons: [] });
          return pause(choices);
        }
        case "askFirstName": {
          out.push({ kind: "bot", text: personalize(step.text), buttons: [] });
          const choices: Choice[] = [
            {
              label: t("Replies with a first name"),
              reply: SAMPLE_NAME,
              run: () =>
                play(step.next, step.thanksText.trim() ? [{ kind: "bot", text: personalize(step.thanksText), buttons: [] }] : []),
            },
          ];
          if (step.timeoutMinutes) {
            const time = formatMinutes(step.timeoutMinutes, t);
            choices.push({
              label: t("Does not reply ({time})", { time }),
              run: () => play(step.timeoutNext, [{ kind: "note", text: t("⏱ {time} later", { time }) }]),
            });
          }
          return pause(choices);
        }
        case "condition": {
          const question =
            step.check === "clicked"
              ? t("Clicked a link?")
              : step.check === "follows"
                ? t("Follows you?")
                : t("Email already known?");
          out.push({ kind: "note", text: question });
          return pause([
            { label: t("Yes"), run: () => play(step.yes) },
            { label: t("No"), run: () => play(step.no) },
          ]);
        }
      }
    }
    return { items: out, choices: [] };
  }

  const begin = () => play(flow.steps.find((s) => s.type === "trigger")?.id);
  // The parent remounts this component when the flow changes, which restarts it.
  const [sim, setSim] = useState<Sim>(begin);
  const { items, choices } = sim;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [sim]);

  function choose(choice: Choice) {
    const next = choice.run();
    setSim((prev) => ({
      items: [...prev.items, ...(choice.reply ? [{ kind: "user" as const, text: choice.reply }] : []), ...next.items],
      choices: next.choices,
    }));
  }

  function restart() {
    setSim(begin());
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Phone>
        <div className="flex h-full flex-col text-white">
          <StatusBar />
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <Avatar url={avatarUrl} size={30} />
            <span className="text-sm font-semibold">{username}</span>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            {items.map((item, i) =>
              item.kind === "note" ? (
                <p key={i} className="py-1 text-center text-[11px] text-zinc-500">
                  {item.text}
                </p>
              ) : item.kind === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[#3797f0] px-3 py-2 text-sm">{item.text}</div>
                </div>
              ) : (
                <div key={i} className="flex items-end gap-2">
                  <Avatar url={avatarUrl} size={22} />
                  <div className="max-w-[80%] space-y-1.5">
                    <div className="overflow-hidden rounded-2xl rounded-bl-md bg-zinc-800">
                      <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm">{item.text}</p>
                      {item.buttons.map((b, j) => (
                        <div key={j} className="mx-1.5 mb-1.5 rounded-xl bg-zinc-700 px-4 py-1.5 text-center text-sm font-medium">
                          {b.link ? "🔗 " : ""}
                          {b.label}
                        </div>
                      ))}
                    </div>
                    {item.quick && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.quick.map((q) => (
                          <span key={q} className="rounded-full border border-white/30 px-3 py-1 text-xs">
                            {q}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
          {choices.length > 0 && (
            <div className="space-y-1.5 border-t border-white/10 bg-zinc-950 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">{t("Simulate")}</p>
              <div className="flex flex-wrap gap-1.5">
                {choices.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => choose(c)}
                    className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Phone>
      <button onClick={restart} className="text-xs text-muted hover:text-foreground">
        ↺ {t("Restart the simulation")}
      </button>
    </div>
  );
}
