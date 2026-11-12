"use client";

/**
 * Audience
 *
 * Who follows the account (gender, age, country, city), when those followers
 * are online, and the account's last 30 days. All from Instagram account
 * insights; each block degrades on its own when Instagram does not return it.
 */

import type { Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useMemo, useState } from "react";
import AccountSelect from "@/components/account-select";
import StatCard from "@/components/stat-card";
import type { AudienceResponse } from "@/app/api/audience/route";
import { bestOnlineBands, withShares } from "@/lib/performance/audience";
import type { InsightBreakdownRow } from "@/lib/meta/client";

function formatNumber(n: number | null, locale: Locale): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(locale);
}

function Bars({
  rows,
  labelOf,
  locale,
  limit = 8,
}: {
  rows: InsightBreakdownRow[];
  labelOf: (label: string) => string;
  locale: Locale;
  limit?: number;
}) {
  const shown = withShares(rows).slice(0, limit);
  const max = Math.max(...shown.map((r) => r.share), 1);
  return (
    <ul className="space-y-2 text-sm">
      {shown.map((row) => (
        <li key={row.label}>
          <div className="flex justify-between gap-3">
            <span className="text-foreground truncate">{labelOf(row.label)}</span>
            <span className="text-muted whitespace-nowrap">
              {row.share.toLocaleString(locale, { maximumFractionDigits: 1 })} % · {formatNumber(row.value, locale)}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded bg-surface-hover">
            <div className="h-1.5 rounded bg-accent" style={{ width: `${(row.share / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AudiencePage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<AudienceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("all");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (accountId !== "all") params.set("instagramAccountId", accountId);
    fetch(`/api/audience?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setData(res.data);
          setError(null);
        } else {
          setError(res.error ?? "Failed to load audience");
        }
      })
      .catch(() => !cancelled && setError("Failed to load audience"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const snapshot = data?.snapshot ?? null;
  const bands = useMemo(
    () => (snapshot?.onlineByHour ? bestOnlineBands(snapshot.onlineByHour) : []),
    [snapshot]
  );

  const genderLabel = (code: string) =>
    code === "F" ? t("Women") : code === "M" ? t("Men") : t("Not specified");
  const countryLabel = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="panel rounded p-4 h-24 sm:p-5">
            <div className="h-4 w-16 bg-zinc-200 rounded" />
            <div className="mt-3 h-6 w-20 bg-zinc-200/60 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-error">{t("Failed to load audience")}</p>
      </div>
    );
  }

  const failed = snapshot ? Object.keys(snapshot.errors) : [];
  const onlineMax = snapshot?.onlineByHour ? Math.max(...snapshot.onlineByHour, 1) : 1;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">{t("Audience")}</h1>
          <p className="text-sm text-muted mt-1">
            {t("Who follows you and when they are online.")} @{data.account.username}
          </p>
        </div>
        {data.accounts.length > 1 && (
          <AccountSelect
            accounts={data.accounts.map((a) => ({ id: a.id, username: a.username, instagramId: a.id }))}
            value={accountId}
            onChange={(id) => {
              setLoading(true);
              setAccountId(id);
            }}
          />
        )}
      </div>

      {!snapshot ? (
        <div className="panel rounded p-6 text-sm text-muted">{t("Audience insights are not available for this account.")}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard label={t("Reach (30 days)")} value={formatNumber(snapshot.account.reach, locale)} />
            <StatCard label={t("Views (30 days)")} value={formatNumber(snapshot.account.views, locale)} />
            <StatCard label={t("Accounts engaged (30 days)")} value={formatNumber(snapshot.account.accountsEngaged, locale)} />
            <StatCard label={t("Link taps on profile (30 days)")} value={formatNumber(snapshot.account.profileLinksTaps, locale)} />
          </div>

          <div className="panel rounded p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground mb-1">{t("When your followers are online")}</h2>
            {snapshot.onlineByHour ? (
              <>
                <p className="text-xs text-muted mb-4">
                  {t("Average number of followers online, hour by hour. Best: {slots}.", {
                    slots: bands.map((b) => `${b.start}h – ${b.start + 3}h`).join(", "),
                  })}
                </p>
                <div className="flex h-32 items-end gap-1">
                  {snapshot.onlineByHour.map((value, hour) => (
                    <div key={hour} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${hour}h: ${value}`}>
                      <div
                        className={`w-full rounded-t ${bands.some((b) => hour >= b.start && hour < b.start + 3) ? "bg-accent" : "bg-surface-hover"}`}
                        style={{ height: `${Math.max((value / onlineMax) * 100, 2)}%` }}
                      />
                      <span className="text-[10px] text-muted">{hour % 3 === 0 ? hour : ""}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">{t("Instagram did not return this information.")}</p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="panel rounded p-4 sm:p-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">{t("Gender")}</h2>
              {snapshot.gender.length ? (
                <Bars rows={snapshot.gender} labelOf={genderLabel} locale={locale} />
              ) : (
                <p className="text-sm text-muted">{t("Instagram did not return this information.")}</p>
              )}
            </div>
            <div className="panel rounded p-4 sm:p-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">{t("Age")}</h2>
              {snapshot.age.length ? (
                <Bars
                  rows={[...snapshot.age].sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }))}
                  labelOf={(l) => l}
                  locale={locale}
                />
              ) : (
                <p className="text-sm text-muted">{t("Instagram did not return this information.")}</p>
              )}
            </div>
            <div className="panel rounded p-4 sm:p-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">{t("Countries")}</h2>
              {snapshot.country.length ? (
                <Bars rows={snapshot.country} labelOf={countryLabel} locale={locale} />
              ) : (
                <p className="text-sm text-muted">{t("Instagram did not return this information.")}</p>
              )}
            </div>
            <div className="panel rounded p-4 sm:p-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">{t("Cities")}</h2>
              {snapshot.city.length ? (
                <Bars rows={snapshot.city} labelOf={(l) => l} locale={locale} />
              ) : (
                <p className="text-sm text-muted">{t("Instagram did not return this information.")}</p>
              )}
            </div>
          </div>

          {failed.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">{t("Technical details (what Instagram refused)")}</summary>
              <ul className="mt-2 space-y-1">
                {failed.map((key) => (
                  <li key={key}>
                    <span className="text-foreground">{key}</span>: {snapshot.errors[key]}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
