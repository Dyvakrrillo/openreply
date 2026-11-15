"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import {
  BUILT_IN_DEFAULTS,
  BUTTON_KEYS,
  type MessageDefaults,
} from "@/lib/message-defaults";
import type { StaticMessageKey } from "@/lib/i18n";
import { publishMessageDefaults } from "./use-message-defaults";

type Key = keyof MessageDefaults;

const GROUPS: { title: StaticMessageKey; keys: { key: Key; label: StaticMessageKey; hint?: string }[] }[] = [
  {
    title: "Email",
    keys: [
      { key: "emailPrompt", label: "Asking for the email" },
      { key: "emailInvalid", label: "When the address looks wrong" },
      { key: "emailConfirm", label: "Email already known: confirmation", hint: "{email} shows their address." },
      { key: "emailConfirmYes", label: "Confirmation button: yes" },
      { key: "emailConfirmChange", label: "Confirmation button: change" },
    ],
  },
  {
    title: "Follow check",
    keys: [
      { key: "followPrompt", label: "Asking them to follow" },
      { key: "followButton", label: "Follow button" },
    ],
  },
  {
    title: "First name",
    keys: [
      { key: "firstNamePrompt", label: "Asking for the first name" },
      { key: "firstNameThanks", label: "Thank-you after the first name", hint: "{name} shows their first name." },
    ],
  },
  {
    title: "Links",
    keys: [{ key: "linkButton", label: "Link button" }],
  },
];

/**
 * Settings → Default messages: the wording every automation uses when one of
 * its own texts is empty, and that new campaigns and canvas steps start with.
 */
export default function MessageDefaultsSettings() {
  const { t } = useI18n();
  const [values, setValues] = useState<MessageDefaults | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspace/message-defaults")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.success) return;
        setValues(d.data.values);
        setCanEdit(d.data.canEdit);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!values) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/workspace/message-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || "Error");
      setValues(body.data.values);
      publishMessageDefaults(body.data.values);
      setStatus({ tone: "ok", text: t("Saved.") });
    } catch (err) {
      setStatus({ tone: "error", text: err instanceof Error ? err.message : t("Save failed") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel rounded p-4 sm:p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold">{t("Default messages")}</h2>
        <p className="mt-1 text-sm text-muted">
          {t("Used by every automation whose own text is left empty, and to prefill new campaigns and canvas steps. {username} personalizes.", { username: "{username}" })}
        </p>
      </div>

      {!values ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : (
        <>
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t(group.title)}</p>
              {group.keys.map(({ key, label, hint }) => {
                const isButton = BUTTON_KEYS.includes(key);
                const changed = values[key] !== BUILT_IN_DEFAULTS[key];
                const common = {
                  value: values[key],
                  disabled: !canEdit,
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    setValues({ ...values, [key]: e.target.value }),
                  className:
                    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none disabled:opacity-60",
                };
                return (
                  <label key={key} className="block">
                    <span className="mb-1 flex items-center justify-between gap-2 text-sm text-foreground">
                      {t(label)}
                      {changed && canEdit && (
                        <button
                          type="button"
                          onClick={() => setValues({ ...values, [key]: BUILT_IN_DEFAULTS[key] })}
                          className="text-xs text-muted hover:text-foreground"
                        >
                          {t("Reset")}
                        </button>
                      )}
                    </span>
                    {isButton ? (
                      <input {...common} maxLength={20} />
                    ) : (
                      <textarea {...common} rows={2} maxLength={1000} className={`${common.className} resize-none`} />
                    )}
                    {hint && <span className="mt-1 block text-xs text-muted">{(t as (k: string, v: Record<string, string>) => string)(hint, { email: "{email}", name: "{name}" })}</span>}
                  </label>
                );
              })}
            </div>
          ))}

          {canEdit ? (
            <div className="flex items-center justify-end gap-3">
              {status && (
                <span className={`text-sm ${status.tone === "ok" ? "text-success" : "text-error"}`}>{status.text}</span>
              )}
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? t("Saving…") : t("Save")}
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted">{t("Only owners and admins can change default messages")}</p>
          )}
        </>
      )}
    </section>
  );
}

