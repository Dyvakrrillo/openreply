"use client";

/**
 * Advice
 *
 * An AI-written report built from the account's own numbers (reach, funnel,
 * audience) and the creator's strategy brief: diagnosis, mistakes to fix, one
 * goal for 28 days, a content calendar and next moves. Generated in the
 * background, so the page polls while a report is running.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useState } from "react";
import AccountSelect from "@/components/account-select";
import type { AdviceResponse } from "@/app/api/advice/route";

const STATUS_STYLE: Record<string, string> = {
  critical: "bg-red-500/10 text-red-600",
  attention: "bg-amber-500/10 text-amber-600",
  good: "bg-emerald-500/10 text-emerald-600",
};

export default function AdvicePage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<AdviceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("all");
  const [reportId, setReportId] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [briefTouched, setBriefTouched] = useState(false);
  const [saved, setSaved] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (accountId !== "all") params.set("instagramAccountId", accountId);
    if (reportId) params.set("reportId", reportId);
    try {
      const res = await fetch(`/api/advice?${params}`, { cache: "no-store" }).then((r) => r.json());
      if (!res.success) {
        setError(res.error ?? "Failed to load advice");
        return;
      }
      setData(res.data);
      setError(null);
      setBrief((current) => (briefTouched ? current : res.data.strategyBrief));
    } catch {
      setError("Failed to load advice");
    } finally {
      setLoading(false);
    }
  }, [accountId, reportId, briefTouched]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // A report is written in the background: check back until it is done.
  const pending = data?.run?.status === "PENDING";
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  async function saveBrief() {
    setSaved(false);
    const res = await fetch("/api/advice/strategy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(accountId !== "all" ? { instagramAccountId: accountId } : {}),
        strategyBrief: brief,
      }),
    }).then((r) => r.json());
    if (res.success) {
      setSaved(true);
      setBriefTouched(false);
    }
  }

  async function generate() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/advice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId !== "all" ? { instagramAccountId: accountId } : {}),
      }).then((r) => r.json());
      if (!res.success) {
        setStartError(res.error ?? "Failed to start the report");
        return;
      }
      setReportId(null);
      await load();
    } finally {
      setStarting(false);
    }
  }

  function errorText(raw: string | null): string {
    const code = raw?.split(":")[0];
    if (code === "auth") return t("The Anthropic key was refused. Check it in Railway.");
    if (code === "rate_limit") return t("Anthropic is busy or the credit is used up. Try again later.");
    if (code === "refused") return t("The model declined to write this report.");
    if (code === "truncated" || code === "invalid") return t("The report could not be read. Try again.");
    return t("The report could not be written. Try again.");
  }

  if (loading) {
    return (
      <div className="panel rounded p-6">
        <div className="h-4 w-40 bg-zinc-200 rounded" />
        <div className="mt-4 h-24 bg-zinc-200/60 rounded" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-error">{t("Failed to load advice")}</p>
      </div>
    );
  }

  const { run } = data;
  const report = run?.report ?? null;
  const dateText = (iso: string) =>
    new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const formatLabel: Record<string, string> = {
    reel: t("Reel"),
    carousel: t("Carousel"),
    story: t("Story"),
    photo: t("Photo"),
  };
  const categoryLabel: Record<string, string> = {
    utility: t("Utility"),
    connection: t("Connection"),
    positioning: t("Positioning"),
    community: t("Community"),
    entertainment: t("Entertainment"),
    conversion: t("Conversion"),
  };
  const statusLabel: Record<string, string> = {
    critical: t("Critical"),
    attention: t("Attention"),
    good: t("Good"),
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">{t("Advice")}</h1>
          <p className="text-sm text-muted mt-1">
            {t("A report written from your own numbers and your strategy.")} @{data.account.username}
          </p>
        </div>
        {data.accounts.length > 1 && (
          <AccountSelect
            accounts={data.accounts.map((a) => ({ id: a.id, username: a.username, instagramId: a.id }))}
            value={accountId}
            onChange={(id) => {
              setLoading(true);
              setReportId(null);
              setBriefTouched(false);
              setAccountId(id);
            }}
          />
        )}
      </div>

      {!data.configured && (
        <div className="panel rounded p-4 sm:p-6 border border-border space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{t("One setting left to turn this on")}</h2>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-muted">
            <li>{t("Create an account on console.anthropic.com, add a few dollars of credit, then create an API key.")}</li>
            <li>{t("In Railway, open the openreply service, then Variables, and add ANTHROPIC_API_KEY with that key.")}</li>
            <li>{t("Railway restarts the service by itself. Come back here and write your first report.")}</li>
          </ol>
          <p className="text-xs text-muted">{t("A report costs about ten cents.")}</p>
        </div>
      )}

      <div className="panel rounded p-4 sm:p-6 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("Your strategy")}</h2>
          <p className="text-xs text-muted mt-1">
            {t("Write it once: your goal, what you sell or want to sell, who you want to reach, what you do not want to do. The advice follows it.")}
          </p>
        </div>
        <textarea
          value={brief}
          onChange={(e) => {
            setBrief(e.target.value);
            setBriefTouched(true);
            setSaved(false);
          }}
          rows={5}
          maxLength={3000}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-y"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveBrief()}
            disabled={!briefTouched}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:border-border-hover disabled:opacity-40"
          >
            {t("Save")}
          </button>
          {saved && <span className="text-sm text-muted">{t("Saved")}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!data.configured || pending || starting}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {pending ? t("Writing the report…") : t("Write a new report")}
        </button>
        {pending && <span className="text-sm text-muted">{t("This takes one or two minutes. You can leave this page.")}</span>}
        {startError && (
          <span className="text-sm text-error">
            {startError === "not_configured" ? t("The Anthropic key is missing.") : t("The report could not be started.")}
          </span>
        )}
        {data.history.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            {t("Report of")}
            <select
              value={run?.id ?? ""}
              onChange={(e) => setReportId(e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-foreground"
            >
              {data.history.map((h) => (
                <option key={h.id} value={h.id}>
                  {dateText(h.createdAt)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {run?.status === "FAILED" && (
        <div className="panel rounded p-4 border border-border">
          <p className="text-sm text-error">{errorText(run.error)}</p>
        </div>
      )}

      {!run && data.configured && (
        <div className="panel rounded p-8 text-center text-sm text-muted">{t("No report yet. Write the first one.")}</div>
      )}

      {report && run && (
        <div className="space-y-8">
          <div className="panel rounded p-4 sm:p-6 border border-accent/30">
            <h2 className="text-base font-semibold text-foreground">{report.headline}</h2>
            <p className="mt-2 text-sm text-muted">{report.summary}</p>
            <p className="mt-3 text-xs text-muted">{dateText(run.createdAt)}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {report.cards.map((card) => (
              <div key={card.title} className="panel rounded p-4">
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[card.status]}`}>
                  {statusLabel[card.status]}
                </span>
                <h3 className="mt-2 text-sm font-semibold text-foreground">{card.title}</h3>
                <p className="mt-1 text-sm text-muted">{card.text}</p>
              </div>
            ))}
          </div>

          <div className="panel rounded p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">{t("The mistakes costing you the most")}</h2>
            <ul className="space-y-5">
              {report.mistakes.map((m) => (
                <li key={m.title} className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">{m.title}</h3>
                  <p className="text-sm text-muted">{m.why}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg bg-surface-hover/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Evidence")}</p>
                      <p className="mt-1 text-sm text-foreground">{m.evidence}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-500/10 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{t("What to do")}</p>
                      <p className="mt-1 text-sm text-foreground">{m.action}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel rounded p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground">{t("One goal for the next 28 days")}</h2>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{report.goal.metric}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {report.goal.today.toLocaleString(locale)} <span className="text-muted">→</span>{" "}
              <span className="text-accent">{report.goal.target.toLocaleString(locale)}</span>
            </p>
            <p className="mt-2 text-sm text-muted">{report.goal.why}</p>
          </div>

          <div className="panel rounded p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">{t("Post ideas for the next 28 days")}</h2>
            <ul className="divide-y divide-border">
              {report.calendar.map((entry) => (
                <li key={`${entry.day}-${entry.idea}`} className="flex gap-4 py-3">
                  <span className="w-16 shrink-0 text-sm font-semibold text-foreground">{t("Day {day}", { day: entry.day })}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{entry.idea}</p>
                    <p className="mt-1 text-xs text-muted">
                      {formatLabel[entry.format]} · {categoryLabel[entry.category]}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel rounded p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">{t("Your next moves")}</h2>
            <ul className="space-y-4">
              {report.nextMoves.map((move, index) => (
                <li key={move.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-hover text-xs font-semibold text-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{move.title}</p>
                    <p className="mt-1 text-sm text-muted">{move.detail}</p>
                    <p className="mt-1 text-xs text-muted">
                      {move.horizon === "week" ? t("This week") : t("This month")} ·{" "}
                      {move.urgency === "high" ? t("High urgency") : t("Medium urgency")} ·{" "}
                      {move.impact === "high" ? t("High impact") : t("Medium impact")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
