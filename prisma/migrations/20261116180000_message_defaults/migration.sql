-- Additive only: workspace-wide default wording for automatic messages.
ALTER TABLE "Workspace" ADD COLUMN "messageDefaults" JSONB;
