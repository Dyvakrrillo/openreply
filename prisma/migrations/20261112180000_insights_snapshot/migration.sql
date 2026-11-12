-- Additive only: daily copy of audience insights.
CREATE TABLE "InsightsSnapshot" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightsSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InsightsSnapshot_instagramAccountId_date_key" ON "InsightsSnapshot"("instagramAccountId", "date");

ALTER TABLE "InsightsSnapshot" ADD CONSTRAINT "InsightsSnapshot_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
