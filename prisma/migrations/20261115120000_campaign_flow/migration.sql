-- Additive only: step-by-step version of a campaign, edited on the canvas.
ALTER TABLE "Automation"
  ADD COLUMN "flow" JSONB,
  ADD COLUMN "flowEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "flowSavedAt" TIMESTAMP(3);
