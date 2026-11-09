import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAssignedInstagramAccounts,
  getUserInfo,
  getUserMedia,
  graphBaseFor,
  sendDirectMessage,
} from "../lib/meta/client";
import { getUnifiedAuthorizationUrl, getAuthorizationUrl } from "../lib/meta/oauth";
import { getMissingInstagramOAuthEnv } from "../lib/env";

const UNIFIED = "EAAtestsystemusertoken";
const INSTAGRAM = "IGAAtestinstagramtoken";

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("Graph host routing", () => {
  it("sends Instagram Login tokens to graph.instagram.com", () => {
    expect(graphBaseFor(INSTAGRAM)).toMatch(/^https:\/\/graph\.instagram\.com\//);
  });

  it("sends unified login tokens to graph.facebook.com", () => {
    expect(graphBaseFor(UNIFIED)).toMatch(/^https:\/\/graph\.facebook\.com\//);
  });
});

describe("unified login API calls", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the account by id instead of /me and fills user_id", async () => {
    fetchMock.mockResolvedValue(json({ id: "1784", username: "billy" }));
    const user = await getUserInfo(UNIFIED, "1784");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.host).toBe("graph.facebook.com");
    expect(url.pathname).toMatch(/\/1784$/);
    expect(user.user_id).toBe("1784");
  });

  it("refuses /me reads without an account id", async () => {
    await expect(getUserMedia(UNIFIED, 10)).rejects.toThrow(/account id is required/);
  });

  it("keeps /me for Instagram Login tokens", async () => {
    fetchMock.mockResolvedValue(json({ data: [] }));
    await getUserMedia(INSTAGRAM, 10, "1784");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.host).toBe("graph.instagram.com");
    expect(url.pathname).toMatch(/\/me\/media$/);
  });

  it("sends messages through graph.facebook.com", async () => {
    fetchMock.mockResolvedValue(json({ recipient_id: "u", message_id: "m" }));
    await sendDirectMessage(UNIFIED, "1784", "u", "hi");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^https:\/\/graph\.facebook\.com\/v[\d.]+\/1784\/messages$/
    );
  });

  it("lists the accounts assigned to the system user", async () => {
    fetchMock.mockResolvedValue(json({ data: [{ id: "1", username: "a" }] }));
    await expect(getAssignedInstagramAccounts(UNIFIED)).resolves.toEqual([
      { id: "1", username: "a" },
    ]);
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toMatch(
      /\/me\/assigned_instagram_accounts$/
    );
  });
});

describe("unified login OAuth", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("builds a Facebook dialog URL with the login configuration", () => {
    process.env.META_APP_ID = "941976168846655";
    process.env.META_LOGIN_CONFIG_ID = "cfg_1";
    const url = new URL(getUnifiedAuthorizationUrl("https://x.test/cb", "st"));
    expect(url.host).toBe("www.facebook.com");
    expect(url.searchParams.get("config_id")).toBe("cfg_1");
    expect(url.searchParams.get("client_id")).toBe("941976168846655");
    expect(url.searchParams.get("state")).toBe("st");
    expect(new URL(getAuthorizationUrl("https://x.test/cb", "st")).host).toBe(
      "www.facebook.com"
    );
  });

  it("asks for the unified variables once a login configuration is set", () => {
    process.env.META_LOGIN_CONFIG_ID = "cfg_1";
    delete process.env.META_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    process.env.NEXTAUTH_SECRET = "secret-secret-secret";
    expect(getMissingInstagramOAuthEnv()).toEqual(["META_APP_ID", "FACEBOOK_APP_SECRET"]);
  });
});
