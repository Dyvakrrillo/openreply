// Email gate helpers: find an address in a typed DM and push the captured
// contact to a CRM incoming webhook (built for FluentCRM, works with any
// endpoint that accepts a form POST with an `email` field).

// Pragmatic, not RFC 5322: people type addresses into a chat, often with words
// around them ("voici mon mail : jane@example.com merci"). We take the first
// thing shaped like local@domain.tld.
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,24}/i;

export function extractEmail(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(EMAIL_PATTERN);
  if (!match) return null;
  const email = match[0].replace(/^[._%+-]+/, "").replace(/\.+$/, "").toLowerCase();
  if (email.length > 254 || email.includes("..")) return null;
  return email;
}

export const DEFAULT_EMAIL_PROMPT =
  "Before I send it over, what's your email address? Just type it here 👇";
export const DEFAULT_EMAIL_INVALID =
  "Hmm, that doesn't look like an email address. Could you type it again? (e.g. name@example.com)";

// After this many replies without an address we stop asking, so the person's
// later DMs go back to normal keyword handling instead of being swallowed.
export const MAX_INVALID_EMAIL_REPLIES = 2;

// Only wait for a typed address inside Instagram's 24-hour messaging window:
// past it we could not answer them anyway.
export const EMAIL_CAPTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isValidCrmWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export type CrmContact = {
  email: string;
  instagramUsername: string | null;
  instagramUserId: string;
  sourceAccount: string;
  campaignName: string;
};

/**
 * Form fields sent to the CRM. FluentCRM's incoming webhook maps `email` and
 * standard contact fields by name, and custom fields by their slug; the lists,
 * tags and status are chosen in the webhook's own settings in WordPress. Create
 * custom fields with these slugs in FluentCRM to keep the extra values.
 */
export function buildCrmFormBody(contact: CrmContact): URLSearchParams {
  const body = new URLSearchParams();
  body.set("email", contact.email);
  if (contact.instagramUsername) body.set("instagram_username", contact.instagramUsername);
  body.set("instagram_user_id", contact.instagramUserId);
  body.set("source_account", contact.sourceAccount);
  body.set("source_campaign", contact.campaignName);
  body.set("source", "instagram");
  return body;
}

export class CrmSyncError extends Error {}

export async function pushContactToCrm(
  webhookUrl: string,
  contact: CrmContact,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!isValidCrmWebhookUrl(webhookUrl)) {
    throw new CrmSyncError("CRM webhook URL must be an https:// URL");
  }
  let response: Response;
  try {
    response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: buildCrmFormBody(contact).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new CrmSyncError(`CRM webhook unreachable: ${message}`);
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw new CrmSyncError(`CRM webhook answered ${response.status}${text ? `: ${text}` : ""}`);
  }
}
