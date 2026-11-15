import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    trackedLink: {
      findUnique: vi.fn(),
    },
    linkClick: {
      create: vi.fn(),
    },
    flowLink: {
      findUnique: vi.fn(),
    },
    flowEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

import { GET } from "../app/r/[slug]/route";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.flowLink.findUnique.mockResolvedValue(null);
  mockPrisma.flowEvent.create.mockResolvedValue({});
});

describe("tracked link redirect route", () => {
  it("logs a workspace-isolated click and redirects to the destination", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: {
        instagramAccountId: "instagram_account_123",
      },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await GET(
      new Request("https://manychat-alternative.com/r/abc123", {
        headers: {
          "user-agent": "vitest",
          referer: "https://instagram.com/",
          "x-forwarded-for": "203.0.113.10",
        },
      }) as Parameters<typeof GET>[0],
      { params: Promise.resolve({ slug: "abc123" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/offer");
    expect(mockPrisma.trackedLink.findUnique).toHaveBeenCalledWith({
      where: { slug: "abc123" },
      select: expect.any(Object),
    });
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_123",
        automationId: "automation_123",
        instagramAccountId: "instagram_account_123",
        trackedLinkId: "link_123",
        userAgent: "vitest",
        referrer: "https://instagram.com/",
      }),
    });
  });

  it("stores a valid recipient token and ignores a malformed one", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: { instagramAccountId: "instagram_account_123" },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});
    const token = "AbCdEfGhIjKlMnOpQrSt_-";

    for (const [query, expected] of [
      [`?r=${token}`, token],
      ["?r=not-a-token", null],
      ["", null],
    ] as const) {
      const response = await GET(
        new Request(`https://manychat-alternative.com/r/abc123${query}`) as Parameters<
          typeof GET
        >[0],
        { params: Promise.resolve({ slug: "abc123" }) }
      );

      expect(response.headers.get("location")).toBe("https://example.com/offer");
      expect(mockPrisma.linkClick.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ recipientHash: expected }),
      });
    }
  });

  it("redirects unknown slugs to the homepage without logging a click", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(null);

    const response = await GET(
      new Request("https://manychat-alternative.com/r/missing") as Parameters<
        typeof GET
      >[0],
      { params: Promise.resolve({ slug: "missing" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://manychat-alternative.com/");
    expect(mockPrisma.linkClick.create).not.toHaveBeenCalled();
  });

  it("credits a canvas card when a form link carries its tag", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: { instagramAccountId: "instagram_account_123" },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});

    await GET(new Request("https://example.org/r/abc123?f=reveal~link_0") as never, {
      params: Promise.resolve({ slug: "abc123" }),
    });

    expect(mockPrisma.linkClick.create).toHaveBeenCalled();
    expect(mockPrisma.flowEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ automationId: "automation_123", stepId: "reveal", buttonId: "link_0", kind: "click" }),
    });
  });

  it("follows a canvas link and logs the click on its card", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(null);
    mockPrisma.flowLink.findUnique.mockResolvedValue({
      workspaceId: "workspace_123",
      automationId: "automation_123",
      stepId: "step_9",
      buttonId: "btn_9",
      destinationUrl: "https://example.com/bonus",
    });

    const response = await GET(new Request("https://example.org/r/flowslug") as never, {
      params: Promise.resolve({ slug: "flowslug" }),
    });

    expect(response.headers.get("location")).toBe("https://example.com/bonus");
    expect(mockPrisma.linkClick.create).not.toHaveBeenCalled();
    expect(mockPrisma.flowEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ stepId: "step_9", buttonId: "btn_9", kind: "click" }),
    });
  });
});
