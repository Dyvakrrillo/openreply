-- Additive only: imported email addresses keyed by Instagram username.
CREATE TABLE "KnownContact" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "igUsername" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'import',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnownContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KnownContact_instagramAccountId_igUsername_key" ON "KnownContact"("instagramAccountId", "igUsername");
CREATE INDEX "KnownContact_workspaceId_idx" ON "KnownContact"("workspaceId");
ALTER TABLE "KnownContact" ADD CONSTRAINT "KnownContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnownContact" ADD CONSTRAINT "KnownContact_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
