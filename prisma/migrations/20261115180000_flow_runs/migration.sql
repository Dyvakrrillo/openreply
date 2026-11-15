-- Additive only: per-person progress in a step flow, and per-step events.
CREATE TABLE "FlowRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "igUserId" TEXT NOT NULL,
  "igUsername" TEXT,
  "currentStepId" TEXT,
  "waiting" TEXT,
  "seq" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "invalidReplies" INTEGER NOT NULL DEFAULT 0,
  "lastActionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FlowRun_automationId_igUserId_key" ON "FlowRun"("automationId", "igUserId");
CREATE INDEX "FlowRun_instagramAccountId_igUserId_status_idx" ON "FlowRun"("instagramAccountId", "igUserId", "status");
CREATE INDEX "FlowRun_workspaceId_idx" ON "FlowRun"("workspaceId");

CREATE TABLE "FlowEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "buttonId" TEXT,
  "igUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FlowEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FlowEvent_automationId_stepId_idx" ON "FlowEvent"("automationId", "stepId");
CREATE INDEX "FlowEvent_workspaceId_idx" ON "FlowEvent"("workspaceId");
