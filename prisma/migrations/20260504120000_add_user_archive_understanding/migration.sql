-- Distilled "smart understanding" of a user's post archive — voice profile,
-- thematic map, and a stratified sample of representative full-text posts.
-- One row per user. Refreshed weekly by /api/cron/archive-understanding.
CREATE TABLE "UserArchiveUnderstanding" (
  "userId"           TEXT NOT NULL,
  "voiceProfile"     TEXT NOT NULL,
  "thematicMap"      TEXT NOT NULL,
  "sampleBodies"     JSONB NOT NULL,
  "generatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "basedOnPostCount" INTEGER NOT NULL,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserArchiveUnderstanding_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserArchiveUnderstanding"
  ADD CONSTRAINT "UserArchiveUnderstanding_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserArchiveUnderstanding" ENABLE ROW LEVEL SECURITY;
