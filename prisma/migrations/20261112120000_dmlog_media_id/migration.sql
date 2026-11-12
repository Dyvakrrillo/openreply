-- Additive only: which Instagram post a comment-triggered DM came from.
ALTER TABLE "DmLog" ADD COLUMN "mediaId" TEXT;
CREATE INDEX "DmLog_instagramAccountId_mediaId_idx" ON "DmLog"("instagramAccountId", "mediaId");
