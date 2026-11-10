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

export const DEFAULT_FIRST_NAME_PROMPT =
  "By the way, what should I call you? Your first name is enough 😊";
export const DEFAULT_FIRST_NAME_THANKS = "Nice to meet you, {name}! 💛";

// Words people send back that are not a name ("ok", "thanks", "no"...).
const NOT_A_NAME = new Set([
  "ok", "okay", "oki", "okk", "oui", "non", "no", "yes", "yep", "nope", "merci", "mercii",
  "thanks", "thank", "thx", "super", "top", "cool", "parfait", "génial", "genial", "bonjour",
  "hello", "hi", "salut", "coucou", "hey", "stop", "pourquoi", "why", "lien", "link",
  "reçu", "recu", "bien", "vu", "d'accord", "dac", "ouais", "nan",
  // Everyday words that make a short reply a sentence, not a name.
  "pas", "je", "j'ai", "tu", "il", "elle", "on", "nous", "vous", "moi", "toi", "le", "la", "les",
  "un", "une", "des", "de", "du", "et", "ou", "mais", "pour", "avec", "sans", "toujours",
  "encore", "rien", "quoi", "comment", "est", "suis", "ai", "veux", "voulais", "plus", "très",
  "trop", "aussi", "ça", "ca", "cela", "the", "a", "an", "and", "or", "not", "is", "it",
  "please", "plz", "stp", "svp", "lol", "mdr", "ahah", "haha", "test",
]);

const NAME_PREFIXES = [
  /^(?:moi\s+)?c['’]est\s+/i,
  /^je\s+m['’]appelle\s+/i,
  /^mon\s+pr[ée]nom\s+(?:est|c['’]est)\s*:?\s*/i,
  /^pr[ée]nom\s*:\s*/i,
  /^appelle[-\s]moi\s+/i,
  /^tu\s+peux\s+m['’]appeler\s+/i,
  /^my\s+name\s+is\s+/i,
  /^i['’]?m\s+/i,
  /^call\s+me\s+/i,
];

/**
 * A first name from a chat reply ("Julie", "moi c'est julie 😊", "Marie-Anne"),
 * capitalised, or null when the reply does not look like one (a question, a
 * sentence, an email, "ok merci"...). Strict on purpose: a wrong first name in
 * a newsletter is worse than none.
 */
export function extractFirstName(text: string | null | undefined): string | null {
  if (!text) return null;
  let value = text
    .normalize("NFC")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const prefix of NAME_PREFIXES) value = value.replace(prefix, "");
  value = value.replace(/^[\s"'“”«»(]+|[\s"'“”«»).!,;:~]+$/g, "");
  if (!value || value.length > 40) return null;
  const words = value.split(" ");
  if (words.length > 2) return null;
  if (!words.every((word) => /^\p{L}+(?:['’-]\p{L}+)*$/u.test(word))) return null;
  if (words.some((word) => NOT_A_NAME.has(word.toLowerCase()))) return null;
  return words
    .map((word) =>
      word
        .toLowerCase()
        .replace(/(^|['’-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase())
    )
    .join(" ");
}

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
  firstName?: string | null;
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
  if (contact.firstName) body.set("first_name", contact.firstName);
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
