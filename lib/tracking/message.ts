export interface MessageTrackedLink {
  slug: string;
  destinationUrl: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/i;

function trimTrailingPunctuation(url: string) {
  return url.replace(/[.,!?;:]+$/, "");
}

export function extractFirstUrl(message: string): string | null {
  const match = message.match(URL_PATTERN);
  if (!match) return null;

  try {
    const url = trimTrailingPunctuation(match[0]);
    return new URL(url).toString();
  } catch {
    return null;
  }
}

export function replaceUrlWithTrackedPlaceholder(
  message: string,
  destinationUrl: string | null | undefined
) {
  if (!destinationUrl) return message;
  if (message.includes(destinationUrl)) {
    return message.replace(destinationUrl, "{link}");
  }

  const withoutTrailingSlash = destinationUrl.replace(/\/$/, "");
  return message.replace(withoutTrailingSlash, "{link}");
}

/**
 * Put the person's username in place of {username}. When it is unknown the
 * token is dropped along with the space before it ("Salut {username} !" →
 * "Salut !", "Hey {username}, voilà" → "Hey, voilà"), never replaced by a
 * placeholder word in some other language.
 */
export function personalizeUsername(message: string, commenterName?: string | null) {
  if (commenterName) return message.replace(/\{username\}/gi, commenterName);
  return message.replace(/[ \t]*\{username\}/gi, "").replace(/^[ \t]+/gm, "");
}

/** {name} and its spellings ({prenom}, {prénom}, {first_name}). */
const FIRST_NAME_TOKEN = /\{(?:name|prenom|prénom|first_name)\}/gi;
const FIRST_NAME_TOKEN_WITH_SPACE = /[ \t]*\{(?:name|prenom|prénom|first_name)\}/gi;

/**
 * Put the person's first name in place of {name}. Unknown: the token is
 * dropped with the space before it, like {username}.
 */
export function personalizeFirstName(message: string, firstName?: string | null) {
  if (firstName) return message.replace(FIRST_NAME_TOKEN, firstName);
  return message.replace(FIRST_NAME_TOKEN_WITH_SPACE, "").replace(/^[ \t]+/gm, "");
}

/** Campaign texts that may carry {name}. The first-name thank-you is not one:
 * its {name} is the answer just given, filled in where it is sent. */
type FirstNameFields = {
  dmMessage?: string | null;
  openingDmMessage?: string | null;
  followPromptMessage?: string | null;
  emailPromptMessage?: string | null;
  emailInvalidMessage?: string | null;
  firstNamePromptMessage?: string | null;
  followUpMessage?: string | null;
  clickReminderMessage?: string | null;
};

const FIRST_NAME_FIELDS: (keyof FirstNameFields)[] = [
  "dmMessage",
  "openingDmMessage",
  "followPromptMessage",
  "emailPromptMessage",
  "emailInvalidMessage",
  "firstNamePromptMessage",
  "followUpMessage",
  "clickReminderMessage",
];

/**
 * Fill {name} in a campaign's texts with the recipient's known first name, in
 * place, before anything is rendered. Unknown: left as is, and dropped
 * cleanly when the text is rendered.
 */
export function applyFirstName<T extends FirstNameFields>(campaign: T, firstName: string | null | undefined): T {
  if (!firstName) return campaign;
  for (const field of FIRST_NAME_FIELDS) {
    const value = campaign[field];
    if (typeof value === "string") (campaign as FirstNameFields)[field] = personalizeFirstName(value, firstName);
  }
  return campaign;
}

/**
 * Personalize {username} and strip the {link} token — used when the link is
 * delivered as a separate button rather than inline in the message text.
 */
export function renderMessageWithoutLink({
  message,
  commenterName,
}: {
  message: string;
  commenterName?: string | null;
}) {
  // {name} left at this point has no known first name: drop it cleanly.
  return personalizeFirstName(personalizeUsername(message, commenterName))
    .replace(/\s*\{link\}\s*/gi, " ")
    .trim();
}

export function buildTrackedUrl(
  slug: string,
  baseUrl?: string,
  recipientToken?: string
) {
  const resolvedBaseUrl =
    baseUrl ??
    (typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXTAUTH_URL ?? "http://localhost:3000");

  const url = `${resolvedBaseUrl.replace(/\/$/, "")}/r/${slug}`;
  return recipientToken ? `${url}?r=${recipientToken}` : url;
}

export function renderMessageWithTracking({
  message,
  commenterName,
  trackedLinks,
  baseUrl,
  recipientToken,
}: {
  message: string;
  commenterName?: string | null;
  trackedLinks?: MessageTrackedLink[];
  baseUrl?: string;
  recipientToken?: string;
}) {
  let rendered = personalizeFirstName(personalizeUsername(message, commenterName));
  const primaryLink = trackedLinks?.[0];

  if (!primaryLink) return rendered;

  const trackedUrl = buildTrackedUrl(primaryLink.slug, baseUrl, recipientToken);

  if (/\{link\}/i.test(rendered)) {
    return rendered.replace(/\{link\}/gi, trackedUrl);
  }

  if (rendered.includes(primaryLink.destinationUrl)) {
    rendered = rendered.replaceAll(primaryLink.destinationUrl, trackedUrl);
  } else {
    const withoutTrailingSlash = primaryLink.destinationUrl.replace(/\/$/, "");
    rendered = rendered.replaceAll(withoutTrailingSlash, trackedUrl);
  }

  return rendered;
}
