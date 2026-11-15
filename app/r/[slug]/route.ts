import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { parseFlowClickTag } from "@/lib/flows/links";
import {
  getRequestIp,
  hashClickIp,
  parseRecipientToken,
} from "@/lib/tracking/server";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      automation: {
        select: {
          instagramAccountId: true,
        },
      },
    },
  });

  const searchParams = new URL(request.url).searchParams;
  const recipientHash = parseRecipientToken(searchParams.get("r"));

  if (!trackedLink) {
    // A link button drawn on a campaign's canvas (lib/flows/links.ts).
    const flowLink = await prisma.flowLink.findUnique({
      where: { slug },
      select: { workspaceId: true, automationId: true, stepId: true, buttonId: true, destinationUrl: true },
    });
    if (!flowLink) {
      return NextResponse.redirect(new URL("/", request.url), { status: 302 });
    }
    await prisma.flowEvent
      .create({
        data: {
          workspaceId: flowLink.workspaceId,
          automationId: flowLink.automationId,
          stepId: flowLink.stepId,
          buttonId: flowLink.buttonId,
          kind: "click",
          recipientHash,
        },
      })
      .catch(() => {});
    return NextResponse.redirect(flowLink.destinationUrl, { status: 302 });
  }

  // A form link sent from a canvas card: credit the card too.
  const flowTag = parseFlowClickTag(searchParams.get("f"));
  if (flowTag) {
    await prisma.flowEvent
      .create({
        data: {
          workspaceId: trackedLink.workspaceId,
          automationId: trackedLink.automationId,
          stepId: flowTag.stepId,
          buttonId: flowTag.buttonId,
          kind: "click",
          recipientHash,
        },
      })
      .catch(() => {});
  }

  await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      recipientHash,
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    },
  });

  return NextResponse.redirect(trackedLink.destinationUrl, { status: 302 });
}
