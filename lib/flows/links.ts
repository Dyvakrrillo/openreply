import { prisma } from "@/lib/db/client";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";
import type { Flow } from "./types";

/**
 * Give every canvas link button a tracked redirect (FlowLink), except buttons
 * whose URL is one of the campaign's form links: those keep using that
 * TrackedLink so the campaign's existing click counts stay whole.
 *
 * A button keeps its slug when its URL changes (links already sent keep
 * working and point to the new URL), and links of deleted buttons are removed.
 */
export async function syncFlowLinks({
  workspaceId,
  automationId,
  flow,
}: {
  workspaceId: string;
  automationId: string;
  flow: Flow;
}): Promise<void> {
  const tracked = await prisma.trackedLink.findMany({
    where: { automationId },
    select: { destinationUrl: true },
  });
  const trackedUrls = new Set(tracked.map((t) => t.destinationUrl.trim()));

  const wanted = flow.steps.flatMap((step) =>
    step.type === "message"
      ? step.buttons
          .filter((b) => b.kind === "link" && b.url.trim() && !trackedUrls.has(b.url.trim()))
          .map((b) => ({ stepId: step.id, buttonId: b.id, url: (b as { url: string }).url.trim() }))
      : []
  );

  for (const link of wanted) {
    await prisma.flowLink.upsert({
      where: { automationId_buttonId: { automationId, buttonId: link.buttonId } },
      create: {
        workspaceId,
        automationId,
        stepId: link.stepId,
        buttonId: link.buttonId,
        slug: generateTrackedLinkSlug(),
        destinationUrl: link.url,
      },
      update: { stepId: link.stepId, destinationUrl: link.url },
    });
  }

  await prisma.flowLink.deleteMany({
    where: { automationId, buttonId: { notIn: wanted.map((l) => l.buttonId) } },
  });
}

/** `f` query value tying a click to a canvas step and button. */
export function flowClickTag(stepId: string, buttonId: string) {
  return `${stepId}~${buttonId}`;
}

export function parseFlowClickTag(value: string | null) {
  if (!value || !/^[\w-]{1,64}~[\w-]{1,64}$/.test(value)) return null;
  const [stepId, buttonId] = value.split("~");
  return { stepId, buttonId };
}
