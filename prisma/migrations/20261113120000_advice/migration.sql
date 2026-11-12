-- Additive only: AI advice reports and the creator's strategy brief.
ALTER TABLE "InstagramAccount" ADD COLUMN "strategyBrief" TEXT;

CREATE TYPE "AdviceStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "AdviceRun" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "status" "AdviceStatus" NOT NULL DEFAULT 'PENDING',
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "payload" JSONB,
    "error" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AdviceRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdviceRun_instagramAccountId_createdAt_idx" ON "AdviceRun"("instagramAccountId", "createdAt");

ALTER TABLE "AdviceRun" ADD CONSTRAINT "AdviceRun_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
