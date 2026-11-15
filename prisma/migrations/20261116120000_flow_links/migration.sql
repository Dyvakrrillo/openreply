-- Additive: click tracking for canvas link buttons.
ALTER TABLE "FlowEvent" ALTER COLUMN "igUserId" DROP NOT NULL;
ALTER TABLE "FlowEvent" ADD COLUMN "recipientHash" TEXT;
CREATE INDEX "FlowEvent_automationId_kind_recipientHash_idx" ON "FlowEvent"("automationId", "kind", "recipientHash");

CREATE TABLE "FlowLink" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "buttonId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "destinationUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlowLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FlowLink_slug_key" ON "FlowLink"("slug");
CREATE UNIQUE INDEX "FlowLink_automationId_buttonId_key" ON "FlowLink"("automationId", "buttonId");
CREATE INDEX "FlowLink_workspaceId_idx" ON "FlowLink"("workspaceId");
