-- A reel or story may also appear in Facebook's posts export. Preserve both
-- source events while linking them to one canonical Post instead of duplicating
-- the Post/Media rows.
DROP INDEX IF EXISTS "FacebookImportEvent_postId_key";
CREATE INDEX IF NOT EXISTS "FacebookImportEvent_postId_idx"
  ON "FacebookImportEvent"("postId");
