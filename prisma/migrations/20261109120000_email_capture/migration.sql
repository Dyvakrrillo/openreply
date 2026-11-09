-- Additive only: email gate settings on campaigns and per-person capture state.
CREATE TYPE "EmailCaptureStatus" AS ENUM ('AWAITING', 'CAPTURED', 'ABANDONED');

ALTER TABLE "Automation"
  ADD COLUMN "requireEmail" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailPromptMessage" TEXT,
  ADD COLUMN "emailInvalidMessage" TEXT,
  ADD COLUMN "crmWebhookUrl" TEXT;

CREATE TABLE "EmailCapture" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "igUserId" TEXT NOT NULL,
  "igUsername" TEXT,
  "email" TEXT,
  "status" "EmailCaptureStatus" NOT NULL DEFAULT 'AWAITING',
  "invalidAttempts" INTEGER NOT NULL DEFAULT 0,
  "capturedAt" TIMESTAMP(3),
  "crmSyncedAt" TIMESTAMP(3),
  "crmError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailCapture_automationId_igUserId_key" ON "EmailCapture"("automationId", "igUserId");
CREATE INDEX "EmailCapture_instagramAccountId_igUserId_status_idx" ON "EmailCapture"("instagramAccountId", "igUserId", "status");
CREATE INDEX "EmailCapture_workspaceId_idx" ON "EmailCapture"("workspaceId");

ALTER TABLE "EmailCapture" ADD CONSTRAINT "EmailCapture_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailCapture" ADD CONSTRAINT "EmailCapture_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailCapture" ADD CONSTRAINT "EmailCapture_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
