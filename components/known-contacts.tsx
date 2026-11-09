"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { AccountOption } from "@/components/account-select";

type Data = {
  total: number;
  recent: { igUsername: string; email: string; instagramAccount: { username: string } }[];
};

/**
 * Emails already known for Instagram usernames (e.g. exported from ManyChat).
 * Campaigns with an email gate skip the question for these people.
 */
export function KnownContacts({ accounts, canManage }: { accounts: AccountOption[]; canManage: boolean }) {
  const { t } = useI18n();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/known-contacts", { cache: "no-store" });
    const payload = await res.json();
    if (payload.success) setData(payload.data);
  }, []);

  useEffect(() => {
    if (!canManage) return;
    void fetch("/api/known-contacts", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => payload.success && setData(payload.data));
  }, [canManage]);

  if (!canManage || accounts.length === 0) return null;

  async function onFile(file: File | undefined) {
    if (file) setCsv(await file.text());
  }

  async function importCsv() {
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/known-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId: accountId, csv }),
    });
    const payload = await res.json();
    setBusy(false);
    if (!payload.success) {
      setMessage(payload.error ?? t("Import failed."));
      return;
    }
    setCsv("");
    setMessage(
      t("{saved} contacts saved, {skipped} lines skipped.", {
        saved: payload.data.saved,
        skipped: payload.data.skipped,
      })
    );
    await refresh();
  }

  return (
    <section className="panel rounded p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t("Known contacts")}</h2>
        <p className="text-sm text-muted mt-1">
          {t("Emails you already have for Instagram usernames. Campaigns that ask for an email skip the question for these people.")}
        </p>
        <p className="text-sm text-foreground mt-2">
          {t("{count} known contacts", { count: data?.total ?? 0 })}
        </p>
      </div>

      <div className="space-y-2">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              @{account.username}
            </option>
          ))}
        </select>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="block w-full text-sm text-muted"
        />
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={t("Or paste CSV lines: instagram_username, email")}
          rows={4}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-y"
        />
        <button
          type="button"
          onClick={() => void importCsv()}
          disabled={busy || !csv.trim() || !accountId}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? t("Importing…") : t("Import contacts")}
        </button>
        {message && <p className="text-sm text-muted">{message}</p>}
      </div>

      {data && data.recent.length > 0 && (
        <ul className="divide-y divide-border text-sm">
          {data.recent.map((contact) => (
            <li key={`${contact.instagramAccount.username}:${contact.igUsername}`} className="flex justify-between gap-3 py-2">
              <span className="text-foreground">@{contact.igUsername}</span>
              <span className="text-muted truncate">{contact.email}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
