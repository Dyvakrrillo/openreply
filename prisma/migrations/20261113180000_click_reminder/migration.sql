-- Additive only: optional reminder for people who have not clicked the link.
ALTER TABLE "Automation"
  ADD COLUMN "clickReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clickReminderMessage" TEXT,
  ADD COLUMN "clickReminderDelayMinutes" INTEGER NOT NULL DEFAULT 60;
