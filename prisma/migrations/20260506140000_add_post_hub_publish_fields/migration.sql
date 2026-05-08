-- AlterTable
ALTER TABLE "Post" ADD COLUMN "lastPublishedViaHubAt" TIMESTAMP(3);
ALTER TABLE "Post" ADD COLUMN "hubPublishCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Post_userId_lastPublishedViaHubAt_idx" ON "Post" ("userId", "lastPublishedViaHubAt");

-- Backfill: any PublishRecord with status=PUBLISHED counts as a successful hub
-- publish. Use the latest publishedAt as lastPublishedViaHubAt and the count
-- of distinct PUBLISHED records as hubPublishCount.
UPDATE "Post" p
SET
  "lastPublishedViaHubAt" = sub.last_at,
  "hubPublishCount" = sub.cnt
FROM (
  SELECT "postId", MAX("publishedAt") AS last_at, COUNT(*) AS cnt
  FROM "PublishRecord"
  WHERE status = 'PUBLISHED' AND "publishedAt" IS NOT NULL
  GROUP BY "postId"
) sub
WHERE p.id = sub."postId";
