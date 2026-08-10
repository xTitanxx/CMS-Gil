-- Persist Facebook timeline provenance separately from renderable posts. This
-- lets an import remain aware of missing/ambiguous source material instead of
-- silently treating it as successfully imported.

CREATE TYPE "FacebookImportStatus" AS ENUM (
  'COMPLETE',
  'NO_MEDIA_EXPECTED',
  'PARTIAL_MEDIA',
  'MISSING_MEDIA',
  'AMBIGUOUS',
  'UNRECOVERABLE'
);

ALTER TABLE "Media"
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "contentHash" TEXT;

-- Fail loudly if historical data contains duplicate attachment rows. Such
-- rows must be reconciled rather than silently discarded by the migration.
CREATE UNIQUE INDEX "Media_postId_originalUri_key"
  ON "Media"("postId", "originalUri");
CREATE INDEX "Media_postId_position_idx" ON "Media"("postId", "position");
CREATE INDEX "Media_contentHash_idx" ON "Media"("contentHash");

-- sourceId is nullable for manual content. PostgreSQL permits multiple NULLs,
-- while this composite key prevents concurrent/repeated Facebook imports from
-- creating the same canonical event twice for one user.
CREATE UNIQUE INDEX "Post_userId_sourceId_key"
  ON "Post"("userId", "sourceId");

CREATE TABLE "FacebookImportEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT,
  "canonicalKey" TEXT NOT NULL,
  "sourceArchive" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "sourceIndexes" INTEGER[] NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "activityTitle" TEXT NOT NULL,
  "bodySnapshot" TEXT NOT NULL,
  "shareSnapshot" JSONB,
  "expectedMediaUris" TEXT[] NOT NULL,
  "availableMediaUris" TEXT[] NOT NULL,
  "missingMediaUris" TEXT[] NOT NULL,
  "silentVideoUris" TEXT[] NOT NULL,
  "unknownAudioUris" TEXT[] NOT NULL,
  "rawEntries" JSONB NOT NULL,
  "status" "FacebookImportStatus" NOT NULL,
  "reconciliationAction" TEXT,
  "resolutionNote" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FacebookImportEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FacebookImportEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FacebookImportEvent_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FacebookImportEvent_postId_key"
  ON "FacebookImportEvent"("postId");
CREATE UNIQUE INDEX "FacebookImportEvent_userId_canonicalKey_key"
  ON "FacebookImportEvent"("userId", "canonicalKey");
CREATE INDEX "FacebookImportEvent_userId_status_idx"
  ON "FacebookImportEvent"("userId", "status");
CREATE INDEX "FacebookImportEvent_occurredAt_idx"
  ON "FacebookImportEvent"("occurredAt");

-- Supabase exposes public-schema tables through its Data API. The application
-- uses a privileged direct Prisma connection, so deny browser roles entirely.
ALTER TABLE "FacebookImportEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FacebookImportEvent" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "FacebookImportEvent" FROM anon;
REVOKE ALL ON TABLE "FacebookImportEvent" FROM authenticated;
