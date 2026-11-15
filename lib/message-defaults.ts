/**
 * Workspace-wide default messages: what an automation sends when one of its
 * own texts is left empty (email question, follow check, first name...), and
 * what a new campaign or canvas step starts with.
 *
 * Stored on Workspace.messageDefaults; a missing key falls back to the
 * built-in French text below. Client-safe.
 */

export type MessageDefaults = {
  emailPrompt: string;
  emailInvalid: string;
  emailConfirm: string;
  emailConfirmYes: string;
  emailConfirmChange: string;
  followPrompt: string;
  followButton: string;
  firstNamePrompt: string;
  firstNameThanks: string;
  linkButton: string;
};

export const MESSAGE_DEFAULT_KEYS = [
  "emailPrompt",
  "emailInvalid",
  "emailConfirm",
  "emailConfirmYes",
  "emailConfirmChange",
  "followPrompt",
  "followButton",
  "firstNamePrompt",
  "firstNameThanks",
  "linkButton",
] as const satisfies readonly (keyof MessageDefaults)[];

/** Button labels are capped by Instagram at 20 characters. */
export const BUTTON_KEYS: (keyof MessageDefaults)[] = [
  "emailConfirmYes",
  "emailConfirmChange",
  "followButton",
  "linkButton",
];

export const BUILT_IN_DEFAULTS: MessageDefaults = {
  emailPrompt: "Avant de te l'envoyer, quelle est ton adresse e-mail ? Écris-la ici 👇",
  emailInvalid:
    "Oups, ça ne ressemble pas à une adresse e-mail. Tu peux la réécrire ? (ex. prenom@exemple.fr)",
  emailConfirm: "Ton e-mail est toujours {email} ?",
  emailConfirmYes: "Oui",
  emailConfirmChange: "Modifier",
  followPrompt:
    "Petit service avant de t'envoyer le lien : abonne-toi à mon compte, puis clique sur le bouton ci-dessous 👇",
  followButton: "Je suis abonné(e)",
  firstNamePrompt: "Au fait, comment tu t'appelles ? Ton prénom suffit 😊",
  firstNameThanks: "Enchantée {name} ! 💛",
  linkButton: "Ouvrir le lien",
};

/** Stored values over the built-in ones; empty or invalid entries are ignored. */
export function resolveMessageDefaults(stored: unknown): MessageDefaults {
  const out: MessageDefaults = { ...BUILT_IN_DEFAULTS };
  if (stored && typeof stored === "object") {
    for (const key of MESSAGE_DEFAULT_KEYS) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        out[key] = BUTTON_KEYS.includes(key) ? value.trim().slice(0, 20) : value.trim().slice(0, 1000);
      }
    }
  }
  return out;
}

/** Campaign fields that fall back to a workspace default when left empty. */
export type DefaultableCampaignFields = {
  emailPromptMessage?: string | null;
  emailInvalidMessage?: string | null;
  followPromptMessage?: string | null;
  followPromptButtonLabel?: string | null;
  firstNamePromptMessage?: string | null;
  firstNameThanksMessage?: string | null;
  linkButtonLabel?: string | null;
};

const blank = (v: string | null | undefined) => !v || !v.trim();

/**
 * Fill a campaign's empty texts with the workspace defaults, in place, so
 * every existing "field || fallback" reads the workspace's wording.
 */
export function applyMessageDefaults<T extends DefaultableCampaignFields>(campaign: T, d: MessageDefaults): T {
  if (blank(campaign.emailPromptMessage)) campaign.emailPromptMessage = d.emailPrompt;
  if (blank(campaign.emailInvalidMessage)) campaign.emailInvalidMessage = d.emailInvalid;
  if (blank(campaign.followPromptMessage)) campaign.followPromptMessage = d.followPrompt;
  if (blank(campaign.followPromptButtonLabel)) campaign.followPromptButtonLabel = d.followButton;
  if (blank(campaign.firstNamePromptMessage)) campaign.firstNamePromptMessage = d.firstNamePrompt;
  if (blank(campaign.firstNameThanksMessage)) campaign.firstNameThanksMessage = d.firstNameThanks;
  if (blank(campaign.linkButtonLabel)) campaign.linkButtonLabel = d.linkButton;
  return campaign;
}
