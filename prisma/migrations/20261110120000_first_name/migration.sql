-- Additive only: optional first-name question after the link is delivered.
ALTER TABLE "Automation"
  ADD COLUMN "askFirstName" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "firstNamePromptMessage" TEXT,
  ADD COLUMN "firstNameThanksMessage" TEXT;

ALTER TABLE "EmailCapture"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "firstNameAskedAt" TIMESTAMP(3),
  ADD COLUMN "firstNameAwaiting" BOOLEAN NOT NULL DEFAULT false;
