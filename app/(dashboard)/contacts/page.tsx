"use client";

/**
 * Contacts
 *
 * Everyone who gave their email in a DM, one row per person: Instagram
 * username, email, first name, the campaigns they came through and whether
 * the CRM received them. Searchable and exportable as CSV. A first name or an
 * email can be corrected by hand, and people whose email you already have
 * (e.g. from ManyChat) can be added so campaigns don't ask them again.
 */

import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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

// Errors the contacts API can return, shown in the interface language.
const SAVE_ERRORS: Record<string, StaticMessageKey> = {
  "Invalid input": "Invalid input",
  "Invalid email address": "Invalid email address",
  "Invalid Instagram username": "Invalid Instagram username",
  "Instagram account not found": "Instagram account not found",
  "Contact not found": "Contact not found",
};

function saveError(error: unknown): StaticMessageKey {
  return (typeof error === "string" && SAVE_ERRORS[error]) || "Could not save this contact.";
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none";

function AddContactForm({
  accounts,
  defaultAccountId,
  onSaved,
  onCancel,
}: {
  accounts: AccountOption[];
  defaultAccountId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [accountId, setAccountId] = useState(
    defaultAccountId !== "all" ? defaultAccountId : accounts[0]?.id ?? ""
  );
  const [igUsername, setIgUsername] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId: accountId, igUsername, email, firstName }),
    }).catch(() => null);
    const payload = await res?.json().catch(() => null);
    setBusy(false);
    if (!payload?.success) {
      setError(t(saveError(payload?.error)));
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={save} className="panel rounded p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t("Add a contact")}</h2>
        <p className="mt-1 text-sm text-muted">
          {t("For someone whose email you already have (e.g. from ManyChat): campaigns that ask for an email won't ask them again.")}
        </p>
      </div>
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {accounts.length > 1 && (
          <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} includeAll={false} />
        )}
        <input
          required
          value={igUsername}
          onChange={(e) => setIgUsername(e.target.value)}
          placeholder={t("Instagram username")}
          autoCapitalize="none"
          className={inputClass}
        />
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("Email")}
          className={inputClass}
        />
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder={t("First name (optional)")}
          className={inputClass}
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !accountId}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? t("Saving…") : t("Save")}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground">
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

export default function ContactsPage() {
  const { t, locale } = useI18n();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [awaiting, setAwaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [adding, setAdding] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ email: "", firstName: "" });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  function startEdit(contact: ContactRow) {
    setEditingId(contact.id);
    setDraft({ email: contact.email, firstName: contact.firstName ?? "" });
    setEditError("");
  }

  async function saveEdit(contact: ContactRow) {
    setSaving(true);
    setEditError("");
    const res = await fetch("/api/contacts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: contact.source, id: contact.id, ...draft }),
    }).catch(() => null);
    const payload = await res?.json().catch(() => null);
    setSaving(false);
    if (!payload?.success) {
      setEditError(t(saveError(payload?.error)));
      return;
    }
    setContacts((rows) =>
      rows.map((row) =>
        row.id === contact.id
          ? { ...row, email: draft.email.trim().toLowerCase(), firstName: draft.firstName.trim() || null }
          : row
      )
    );
    setEditingId(null);
    // The CRM status may have changed after the re-send.
    if (contact.source === "capture") reload();
  }

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
  }, [accountId, reloadKey]);

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
          {accounts.length > 0 && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:border-border-hover"
            >
              {t("Add a contact")}
            </button>
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

      {adding && (
        <AddContactForm
          accounts={accounts}
          defaultAccountId={accountId}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      <div className="panel rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {[t("Instagram"), t("Email"), t("First name"), t("Campaigns"), t("Since"), t("CRM"), ""].map((h) => (
                  <th key={h} className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-4 sm:px-6">
                    <div className="h-4 bg-surface-hover rounded" />
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted sm:px-6">
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
                    {editingId === c.id ? (
                      <>
                        <td className="px-4 py-3 sm:px-6">
                          <input
                            type="email"
                            value={draft.email}
                            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                            aria-label={t("Email")}
                            className={inputClass}
                          />
                          {editError && <p className="mt-1 text-xs text-red-500">{editError}</p>}
                        </td>
                        <td className="px-4 py-3 sm:px-6">
                          <input
                            value={draft.firstName}
                            onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && saveEdit(c)}
                            aria-label={t("First name")}
                            placeholder={t("First name")}
                            autoFocus
                            className={inputClass}
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-4 text-foreground sm:px-6">{c.email}</td>
                        <td className="px-4 py-4 sm:px-6">
                          {c.firstName ? <span className="text-foreground">{c.firstName}</span> : <span className="text-muted">—</span>}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-4 text-muted sm:px-6">
                      {c.source === "known" ? t("Added by hand, not reached yet") : c.campaigns.join(", ")}
                    </td>
                    <td className="px-4 py-4 text-muted whitespace-nowrap sm:px-6">
                      {c.firstCapturedAt
                        ? new Date(c.firstCapturedAt).toLocaleDateString(locale, { day: "numeric", month: "short" })
                        : "—"}
                    </td>
                    <td className="px-4 py-4 sm:px-6" title={c.crmError ?? undefined}>
                      {c.source === "known" ? (
                        <span className="text-muted">—</span>
                      ) : c.crmSynced ? (
                        <span className="text-emerald-500">{t("Sent")}</span>
                      ) : (
                        <span className="text-red-500">{t("Failed")}</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right whitespace-nowrap sm:px-6">
                      {editingId === c.id ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(c)}
                            disabled={saving}
                            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                          >
                            {saving ? t("Saving…") : t("Save")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground"
                          >
                            {t("Cancel")}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:border-border-hover"
                        >
                          {t("Edit")}
                        </button>
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
