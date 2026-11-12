"use client";

/**
 * Performance
 *
 * What each post brought, from reach to the link click: Instagram insights
 * (reach, engagement, shares) joined with OpenReply's own funnel (people who
 * got the DM, gave an email, clicked). Also the best days and hours to post,
 * deduced from the account's own posts.
 */

import type { Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useMemo, useState } from "react";
import AccountSelect from "@/components/account-select";
import StatCard from "@/components/stat-card";
import type { OverviewResponse } from "@/app/api/instagram/overview/route";
import type { FunnelResponse } from "@/app/api/performance/funnel/route";
import {
  HOUR_BAND,
  bestSlots,
  engagementNumerator,
  engagementRate,
  overallRate,
  percent,
  shareability,
  shareabilityNumerator,
  type PerfPost,
} from "@/lib/performance/metrics";

function formatNumber(n: number | null, locale: Locale): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(locale);
}

function formatPercent(n: number | null, locale: Locale): string {
  return n === null ? "—" : `${n.toLocaleString(locale, { maximumFractionDigits: 1 })} %`;
}

const COUNT_OPTIONS = [
  { value: "25", label: "Last 25" },
  { value: "50", label: "Last 50" },
  { value: "100", label: "Last 100" },
] as const;

const TH = "px-3 py-3 text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap";

export default function PerformancePage() {
  const { t, locale } = useI18n();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [funnel, setFunnel] = useState<FunnelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("all");
  const [count, setCount] = useState("50");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (accountId !== "all") params.set("instagramAccountId", accountId);
    const funnelParams = new URLSearchParams(params);
    params.set("count", count);

    Promise.all([
      fetch(`/api/instagram/overview?${params}`).then((r) => r.json()),
      fetch(`/api/performance/funnel?${funnelParams}`).then((r) => r.json()),
    ])
      .then(([o, f]) => {
        if (cancelled) return;
        if (!o.success || !f.success) {
          setError(o.error ?? f.error ?? "Failed to load performance");
          return;
        }
        setOverview(o.data);
        setFunnel(f.data);
        setError(null);
      })
      .catch(() => !cancelled && setError("Failed to load performance"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accountId, count]);

  const posts = overview?.posts;
  const perfPosts: PerfPost[] = useMemo(() => posts ?? [], [posts]);

  const stats = useMemo(() => {
    const byPost = funnel?.byPost ?? {};
    const unassigned = funnel?.unassigned ?? [];
    const rows = perfPosts.map((post) => {
      const f = byPost[post.id];
      return {
        post,
        funnel: f ?? null,
        engagement: engagementRate(post),
        shareability: shareability(post),
        emailRate: f ? percent(f.emails, f.people) : null,
      };
    });
    const sumFunnel = (pick: (f: NonNullable<(typeof rows)[number]["funnel"]>) => number) =>
      rows.reduce((total, r) => total + (r.funnel ? pick(r.funnel) : 0), 0) +
      unassigned.reduce((total, c) => total + pick({ campaigns: [], people: c.people, emails: c.emails, clicks: c.clicks }), 0);
    return {
      rows,
      engagement: overallRate(perfPosts, engagementNumerator),
      shareability: overallRate(perfPosts, shareabilityNumerator),
      people: sumFunnel((f) => f.people),
      emails: sumFunnel((f) => f.emails),
      clicks: sumFunnel((f) => f.clicks),
      slots: bestSlots(perfPosts),
    };
  }, [funnel, perfPosts]);

  function weekdayLabel(index: number): string {
    // 2024-01-01 was a Monday.
    return new Date(Date.UTC(2024, 0, 1 + index, 12)).toLocaleDateString(locale, {
      weekday: "long",
      timeZone: "UTC",
    });
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="panel rounded p-4 h-24 sm:p-5">
            <div className="h-4 w-16 bg-zinc-200 rounded" />
            <div className="mt-3 h-6 w-20 bg-zinc-200/60 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !overview || !funnel) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-error">{t("Failed to load performance")}</p>
      </div>
    );
  }

  const unassigned = funnel.unassigned;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">{t("Performance")}</h1>
          <p className="text-sm text-muted mt-1">
            {t("What each post brought, from reach to the link click.")} @{overview.account.username}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("Range")}</span>
            <select
              value={count}
              onChange={(e) => {
                setLoading(true);
                setCount(e.target.value);
              }}
              className="border-0 bg-transparent py-2 pr-1 text-sm text-foreground outline-none"
            >
              {COUNT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </label>
          {overview.accounts.length > 1 && (
            <AccountSelect
              accounts={overview.accounts.map((a) => ({ id: a.id, username: a.username, instagramId: a.id }))}
              value={accountId}
              onChange={(id) => {
                setLoading(true);
                setAccountId(id);
              }}
            />
          )}
        </div>
      </div>

      {!overview.insightsAvailable && (
        <div className="panel rounded p-4 border border-border">
          <p className="text-sm text-foreground">{t("Views, reach, saved and shares need the insights permission.")}</p>
          <a href="/api/instagram/connect" className="mt-3 inline-block text-sm text-accent hover:underline">
            {t("Reconnect Instagram")}
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatCard label={t("Engagement rate")} value={formatPercent(stats.engagement, locale)} />
        <StatCard label={t("Shareability")} value={formatPercent(stats.shareability, locale)} />
        <StatCard label={t("People served")} value={formatNumber(stats.people, locale)} />
        <StatCard label={t("Emails collected")} value={formatNumber(stats.emails, locale)} />
        <StatCard label={t("Link clicks")} value={formatNumber(stats.clicks, locale)} />
      </div>
      <p className="-mt-4 text-xs text-muted">
        {t("Engagement: likes, comments, saves and shares over reach. Shareability: shares and saves over reach.")}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel rounded p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground mb-3">{t("Best days to post")}</h2>
          {stats.slots.days.length === 0 ? (
            <p className="text-sm text-muted">{t("Not enough posts yet to tell.")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stats.slots.days.map((slot) => (
                <li key={slot.key} className="flex justify-between gap-3">
                  <span className="text-foreground capitalize">{weekdayLabel(slot.key)}</span>
                  <span className="text-muted">
                    {t("{reach} median reach ({count} posts)", {
                      reach: formatNumber(slot.medianReach, locale),
                      count: slot.posts,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel rounded p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground mb-3">{t("Best times to post")}</h2>
          {stats.slots.hours.length === 0 ? (
            <p className="text-sm text-muted">{t("Not enough posts yet to tell.")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stats.slots.hours.map((slot) => (
                <li key={slot.key} className="flex justify-between gap-3">
                  <span className="text-foreground">
                    {slot.key}h – {slot.key + HOUR_BAND}h
                  </span>
                  <span className="text-muted">
                    {t("{reach} median reach ({count} posts)", {
                      reach: formatNumber(slot.medianReach, locale),
                      count: slot.posts,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="-mt-4 text-xs text-muted">
        {t("Based on the median reach of your own posts (Paris time), so one viral post does not skew it. A day or time needs at least 2 posts to count.")}
      </p>

      <div className="panel rounded p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4">{t("Posts and what they brought")}</h2>
        {stats.rows.length === 0 ? (
          <p className="text-sm text-muted py-8 text-center">{t("No posts found")}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className={TH}>{t("Post")}</th>
                  <th className={TH}>{t("Reach")}</th>
                  <th className={TH}>{t("Engagement rate")}</th>
                  <th className={TH}>{t("Shareability")}</th>
                  <th className={TH}>{t("Comments")}</th>
                  <th className={TH}>{t("People served")}</th>
                  <th className={TH}>{t("Emails")}</th>
                  <th className={TH}>{t("Link clicks")}</th>
                  <th className={TH}>{t("Campaign")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stats.rows.map(({ post, funnel: f, engagement, shareability: share }) => {
                  const full = overview.posts.find((p) => p.id === post.id);
                  return (
                    <tr key={post.id} className="hover:bg-surface-hover/50 transition-colors">
                      <td className="px-3 py-3 max-w-[260px]">
                        <a
                          href={full?.permalink ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-foreground hover:text-accent"
                        >
                          {full?.caption || t("(no caption)")}
                        </a>
                        <span className="text-xs text-muted">
                          {new Date(post.timestamp).toLocaleDateString(locale, { day: "numeric", month: "short" })}
                          {full ? ` · ${full.mediaType}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-muted">{formatNumber(post.reach, locale)}</td>
                      <td className="px-3 py-3 text-muted">{formatPercent(engagement, locale)}</td>
                      <td className="px-3 py-3 text-muted">{formatPercent(share, locale)}</td>
                      <td className="px-3 py-3 text-muted">{formatNumber(post.comments, locale)}</td>
                      <td className="px-3 py-3 text-foreground">{f ? formatNumber(f.people, locale) : "—"}</td>
                      <td className="px-3 py-3 text-foreground">{f ? formatNumber(f.emails, locale) : "—"}</td>
                      <td className="px-3 py-3 text-foreground">{f ? formatNumber(f.clicks, locale) : "—"}</td>
                      <td className="px-3 py-3 text-muted">{f ? f.campaigns.join(", ") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {unassigned.length > 0 && (
        <div className="panel rounded p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground mb-1">{t("Results without a known post")}</h2>
          <p className="text-xs text-muted mb-4">
            {t("The post is not known for these people (older messages, or people who wrote to you directly).")}
          </p>
          <ul className="divide-y divide-border text-sm">
            {unassigned.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-3 py-2">
                <span className="text-foreground">{c.name}</span>
                <span className="text-muted">
                  {t("{people} people · {emails} emails · {clicks} clicks", {
                    people: c.people,
                    emails: c.emails,
                    clicks: c.clicks,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
