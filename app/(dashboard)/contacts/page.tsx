"use client";

/**
 * Contacts
 *
 * Everyone who gave their email in a DM, one row per person: Instagram
 * username, email, first name, the campaigns they came through and whether
 * the CRM received them. Searchable and exportable as CSV.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useMemo, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import type { ContactRow } from "@/app/api/contacts/route";

function csvCell(value: string): string {
  return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(contacts: ContactRow[]) {
  const header = ["email", "first_name", "instagram_username", "account", "campaigns", "first_captured_at", "crm_synced"];
  const lines = contacts.map((c) =>
    [
      c.email,
      c.firstName ?? "",
      c.igUsername ?? "",
      c.account,
      c.campaigns.join(" | "),
      c.firstCapturedAt ?? "",
      c.crmSynced ? "yes" : "no",
    ]
      .map(csvCell)
      .join(",")
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ContactsPage() {
  const { t, locale } = useI18n();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [awaiting, setAwaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (accountId !== "all") params.set("instagramAccountId", accountId);
    fetch(`/api/contacts?${params}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        setContacts(payload.data.contacts);
        setAwaiting(payload.data.awaiting);
      })
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.email, c.firstName ?? "", c.igUsername ?? "", ...c.campaigns].some((v) => v.toLowerCase().includes(q))
    );
  }, [contacts, query]);

  const withFirstName = contacts.filter((c) => c.firstName).length;
  const crmProblems = contacts.filter((c) => !c.crmSynced).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: t("Contacts with an email"), value: contacts.length },
          { label: t("With a first name"), value: withFirstName },
          { label: t("Waiting for their email"), value: awaiting },
          { label: t("Not received by the CRM"), value: crmProblems },
        ].map((stat) => (
          <div key={stat.label} className="panel rounded p-4">
            <p className="text-xs text-muted">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{loading ? "…" : stat.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search an email, a name, a campaign…")}
          className="w-full sm:max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={(id) => {
                setLoading(true);
                setAccountId(id);
              }}
            />
          )}
          <button
            type="button"
            onClick={() => downloadCsv(filtered)}
            disabled={filtered.length === 0}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:border-border-hover disabled:opacity-40"
          >
            {t("Export CSV")}
          </button>
        </div>
      </div>

      <div className="panel rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {[t("Instagram"), t("Email"), t("First name"), t("Campaigns"), t("Since"), t("CRM")].map((h) => (
                  <th key={h} className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 sm:px-6">
                    <div className="h-4 bg-surface-hover rounded" />
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted sm:px-6">
                    {query ? t("No contact matches this search.") : t("No contacts yet. They appear here once someone types their email in a DM.")}
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-hover/50 transition-colors">
                    <td className="px-4 py-4 sm:px-6">
                      {c.igUsername ? (
                        <a
                          href={`https://instagram.com/${c.igUsername}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-foreground hover:text-accent"
                        >
                          @{c.igUsername}
                        </a>
                      ) : (
                        <span className="text-muted">{c.igUserId.slice(0, 10)}…</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-foreground sm:px-6">{c.email}</td>
                    <td className="px-4 py-4 sm:px-6">
                      {c.firstName ? <span className="text-foreground">{c.firstName}</span> : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-4 text-muted sm:px-6">{c.campaigns.join(", ")}</td>
                    <td className="px-4 py-4 text-muted whitespace-nowrap sm:px-6">
                      {c.firstCapturedAt
                        ? new Date(c.firstCapturedAt).toLocaleDateString(locale, { day: "numeric", month: "short" })
                        : "—"}
                    </td>
                    <td className="px-4 py-4 sm:px-6" title={c.crmError ?? undefined}>
                      {c.crmSynced ? (
                        <span className="text-emerald-500">{t("Sent")}</span>
                      ) : (
                        <span className="text-red-500">{t("Failed")}</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
