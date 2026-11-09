import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl, isUnifiedLoginConfigured } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import {
  getAssignedInstagramAccounts,
  getLongLivedToken,
  getPagesWithInstagram,
  inspectUnifiedToken,
  subscribePageToWebhooks,
  getUserInfo,
  subscribeInstagramAccountToWebhooks,
} from "@/lib/meta/client";
import {
  encryptToken,
  exchangeCodeForToken,
  exchangeUnifiedCodeForToken,
  verifyOAuthState,
} from "@/lib/meta/oauth";
import { canManageWorkspace } from "@/lib/workspace-access";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: state.workspaceId,
      userId: session.user.id,
    },
  });

  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=forbidden`);
  }

  try {
    const redirectUri = `${baseUrl}/api/instagram/callback`;

    if (isUnifiedLoginConfigured()) {
      const connected = await connectUnifiedLogin({
        code,
        redirectUri,
        workspaceId: state.workspaceId,
      });
      return NextResponse.redirect(
        connected > 0
          ? `${baseUrl}/dashboard?connected=true`
          : `${baseUrl}/settings?instagram=already_connected`
      );
    }

    const { accessToken: shortLivedToken } = await exchangeCodeForToken(
      code,
      redirectUri
    );
    const { accessToken: longLivedToken, expiresIn } =
      await getLongLivedToken(shortLivedToken);
    const userInfo = await getUserInfo(longLivedToken);
    // Webhooks and the messaging API key off the professional account ID
    // (user_id), not the app-scoped `id`. Store user_id so comment webhooks
    // can be matched back to this account. Fall back to id if user_id is
    // ever absent.
    const instagramId = userInfo.user_id ?? userInfo.id;
    const connection = await canConnectInstagramAccount({
      workspaceId: state.workspaceId,
      instagramId,
    });

    if (!connection.allowed) {
      return NextResponse.redirect(
        `${baseUrl}/settings?instagram=already_connected`
      );
    }

    const encryptedToken = encryptToken(longLivedToken);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    let webhookSubscribed = false;
    try {
      const subscription = await subscribeInstagramAccountToWebhooks(
        instagramId,
        longLivedToken
      );
      webhookSubscribed = Boolean(subscription.success);
    } catch (subscriptionError) {
      console.warn(
        "[Instagram Callback] Webhook subscription failed:",
        subscriptionError
      );
    }

    const data = {
      username: userInfo.username,
      name: userInfo.name,
      accessToken: encryptedToken,
      tokenExpiresAt,
      webhookSubscribed,
    };
    const existing = await prisma.instagramAccount.findUnique({ where: { instagramId } });
    if (existing) {
      const updated = await prisma.instagramAccount.updateMany({
        where: { id: existing.id, workspaceId: state.workspaceId, provider: 'META' }, data,
      });
      if (!updated.count) return NextResponse.redirect(`${baseUrl}/settings?instagram=already_connected`);
    } else {
      await prisma.instagramAccount.create({ data: { ...data, workspaceId: state.workspaceId, instagramId, provider: 'META' } });
    }

    return NextResponse.redirect(`${baseUrl}/dashboard?connected=true`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Instagram Callback] Error:", err);
    // The message is the only diagnostic a self-hoster gets for a failed
    // connect, so persist it alongside the other operational events rather
    // than leaving it in server logs they may not be able to reach.
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Instagram connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});

    return NextResponse.redirect(
      `${baseUrl}/settings?instagram=failed&reason=${encodeURIComponent(
        message.slice(0, 200)
      )}`
    );
  }
}

/**
 * Unified login. Two token shapes can come back, depending on the login
 * configuration:
 * - a user token (configuration with "User access token" and Pages): each
 *   Instagram account is reached through its linked Facebook Page, whose Page
 *   token never expires. Works in development mode with Standard Access.
 * - a system-user token: accounts come from /me/assigned_instagram_accounts,
 *   which Meta only fills when business_management survives into the token
 *   (Advanced Access on public_profile, i.e. App Review).
 * Returns how many accounts were connected.
 */
async function connectUnifiedLogin({
  code,
  redirectUri,
  workspaceId,
}: {
  code: string;
  redirectUri: string;
  workspaceId: string;
}): Promise<number> {
  const token = await exchangeUnifiedCodeForToken(code, redirectUri);

  const candidates: { instagramId: string; token: string; pageId?: string }[] = [];
  const pages = await getPagesWithInstagram(token).catch(() => []);
  for (const page of pages) {
    candidates.push({ instagramId: page.instagramId, token: page.pageToken, pageId: page.pageId });
  }

  let grant: { scopes: string[]; instagramIds: string[] } = { scopes: [], instagramIds: [] };
  if (candidates.length === 0) {
    const assigned = await getAssignedInstagramAccounts(token).catch(() => []);
    try {
      grant = await inspectUnifiedToken(token);
    } catch (inspectError) {
      console.warn("[Instagram Callback] Token inspection failed:", inspectError);
    }
    const ids = new Set([...assigned.map((a) => a.id), ...grant.instagramIds]);
    for (const id of ids) candidates.push({ instagramId: id, token });
  }

  await prisma.operationalEvent
    .create({
      data: {
        source: "SYSTEM",
        level: "INFO",
        workspaceId,
        message: "Unified login token granted",
        payload: {
          pages: pages.map((p) => ({ pageId: p.pageId, instagramId: p.instagramId })),
          scopes: grant.scopes,
          candidates: candidates.map((c) => c.instagramId),
        },
      },
    })
    .catch(() => {});

  if (candidates.length === 0) {
    throw new Error(
      "Meta returned no Instagram account. Use a login configuration with a User access token and Pages, pick the Facebook Page linked to the Instagram account, and make sure the Instagram account is linked to that Page."
    );
  }

  let connected = 0;
  const failures: string[] = [];
  for (const candidate of candidates) {
    let userInfo;
    try {
      userInfo = await getUserInfo(candidate.token, candidate.instagramId);
    } catch (readError) {
      failures.push(
        `${candidate.instagramId}: ${readError instanceof Error ? readError.message : "unreadable"}`
      );
      continue;
    }
    const instagramId = userInfo.user_id ?? userInfo.id;
    const connection = await canConnectInstagramAccount({ workspaceId, instagramId });
    if (!connection.allowed) continue;

    let webhookSubscribed = false;
    try {
      const subscription = candidate.pageId
        ? await subscribePageToWebhooks(candidate.pageId, candidate.token)
        : await subscribeInstagramAccountToWebhooks(instagramId, candidate.token);
      webhookSubscribed = Boolean(subscription.success);
    } catch (subscriptionError) {
      console.warn("[Instagram Callback] Webhook subscription failed:", subscriptionError);
    }

    const data = {
      username: userInfo.username,
      name: userInfo.name,
      accessToken: encryptToken(candidate.token),
      // Page and system-user tokens do not expire, so the refresh cron skips them.
      tokenExpiresAt: null,
      webhookSubscribed,
    };
    const existing = await prisma.instagramAccount.findUnique({ where: { instagramId } });
    if (existing) {
      const updated = await prisma.instagramAccount.updateMany({
        where: { id: existing.id, workspaceId, provider: "META" },
        data,
      });
      if (!updated.count) continue;
    } else {
      await prisma.instagramAccount.create({
        data: { ...data, workspaceId, instagramId, provider: "META" },
      });
    }
    connected++;
  }
  if (connected === 0 && failures.length > 0) {
    throw new Error(`Meta returned the account but it cannot be read yet. ${failures[0]}`);
  }
  return connected;
}
