import { describe, expect, it, vi } from "vitest";
import {
  buildCrmFormBody,
  extractEmail,
  extractFirstName,
  isValidCrmWebhookUrl,
  pushContactToCrm,
} from "../lib/email-capture";

const contact = {
  email: "jane@example.com",
  instagramUsername: "jane",
  instagramUserId: "123",
  sourceAccount: "billy",
  campaignName: "Guide",
};

describe("extractEmail", () => {
  it("finds an address inside a sentence and lowercases it", () => {
    expect(extractEmail("voici mon mail : Jane.Doe+ig@Example.FR merci !")).toBe(
      "jane.doe+ig@example.fr"
    );
  });

  it("drops trailing punctuation", () => {
    expect(extractEmail("jane@example.com.")).toBe("jane@example.com");
  });

  it("returns null when there is no address", () => {
    expect(extractEmail("je ne sais pas")).toBeNull();
    expect(extractEmail("jane@example")).toBeNull();
    expect(extractEmail("")).toBeNull();
    expect(extractEmail(null)).toBeNull();
  });
});

describe("CRM webhook", () => {
  it("only accepts https URLs", () => {
    expect(isValidCrmWebhookUrl("https://crm.example.com/?fluentcrm=1&hash=x")).toBe(true);
    expect(isValidCrmWebhookUrl("http://crm.example.com")).toBe(false);
    expect(isValidCrmWebhookUrl("not a url")).toBe(false);
  });

  it("sends the contact as form fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await pushContactToCrm("https://crm.example.com/hook", contact, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(buildCrmFormBody(contact).toString());
    expect(new URLSearchParams(init.body).get("instagram_username")).toBe("jane");
  });

  it("reports a non-2xx answer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad hash", { status: 403 }));
    await expect(
      pushContactToCrm("https://crm.example.com/hook", contact, fetchImpl)
    ).rejects.toThrow("CRM webhook answered 403: bad hash");
  });
});

import { parseKnownContactsCsv, normalizeUsername } from "../lib/email-capture/known-contacts";

describe("known contacts CSV", () => {
  it("reads a header row with quoted cells and semicolons", () => {
    const csv = 'Name;Instagram Username;Email\n"Jane; D";@Jane.Doe;jane@example.com\nBob;bob;not-an-email\n';
    expect(parseKnownContactsCsv(csv)).toEqual({
      contacts: [{ igUsername: "jane.doe", email: "jane@example.com" }],
      skipped: 1,
    });
  });

  it("accepts headerless username,email lines", () => {
    expect(parseKnownContactsCsv("alice,alice@example.com\nbob,bob@example.com").contacts).toHaveLength(2);
  });

  it("normalizes profile URLs and handles", () => {
    expect(normalizeUsername("https://www.instagram.com/La_Prof/")).toBe("la_prof");
    expect(normalizeUsername("@x y")).toBeNull();
  });
});

describe("extractFirstName", () => {
  it.each([
    ["julie", "Julie"],
    ["Moi c'est julie 😊", "Julie"],
    ["je m'appelle MARIE-ANNE", "Marie-Anne"],
    ["Prénom : Chloé.", "Chloé"],
    ["Anne Sophie", "Anne Sophie"],
    ["my name is Sam!", "Sam"],
  ])("reads %s as %s", (input, expected) => {
    expect(extractFirstName(input)).toBe(expected);
  });

  it.each([
    ["ok merci"],
    ["toujours pas"],
    ["je sais pas"],
    ["merci !"],
    ["c'est quoi le lien du document ?"],
    ["jane@example.com"],
    ["j'adore ton contenu tu es top vraiment"],
    ["123"],
    ["👍"],
    [""],
  ])("rejects %s", (input) => {
    expect(extractFirstName(input)).toBeNull();
  });
});

describe("buildCrmFormBody first name", () => {
  it("sends first_name only when known", () => {
    const base = {
      email: "a@b.co",
      instagramUsername: "ab",
      instagramUserId: "1",
      sourceAccount: "acct",
      campaignName: "FIGJAM",
    };
    expect(buildCrmFormBody(base).has("first_name")).toBe(false);
    expect(buildCrmFormBody({ ...base, firstName: "Julie" }).get("first_name")).toBe("Julie");
  });
});
