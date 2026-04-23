-- CreateEnum
CREATE TYPE "Lifecycle" AS ENUM ('UNKNOWN', 'EVERGREEN', 'EPHEMERAL', 'SEASONAL');
CREATE TYPE "Season" AS ENUM ('SPRING', 'SUMMER', 'FALL', 'WINTER');
CREATE TYPE "Readiness" AS ENUM ('UNCHECKED', 'READY', 'NOT_READY', 'ARCHIVED');

-- AlterTable Post
ALTER TABLE "Post"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "lifecycle" "Lifecycle" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "lifecycleOverridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notReadyReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "readiness" "Readiness" NOT NULL DEFAULT 'UNCHECKED',
  ADD COLUMN "readinessCheckedAt" TIMESTAMP(3),
  ADD COLUMN "season" "Season";

CREATE INDEX "Post_readiness_idx" ON "Post"("readiness");
CREATE INDEX "Post_lifecycle_idx" ON "Post"("lifecycle");

-- CreateTable PostRating
CREATE TABLE "PostRating" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PostRating_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PostRating_postId_key" ON "PostRating"("postId");
CREATE INDEX "PostRating_stars_idx" ON "PostRating"("stars");
ALTER TABLE "PostRating" ADD CONSTRAINT "PostRating_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable AudioTrack
CREATE TABLE "AudioTrack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "sizeBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AudioTrack_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AudioTrack_userId_createdAt_idx" ON "AudioTrack"("userId", "createdAt");
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable Media
ALTER TABLE "Media" ADD COLUMN "audioTrackId" TEXT;
ALTER TABLE "Media" ADD CONSTRAINT "Media_audioTrackId_fkey" FOREIGN KEY ("audioTrackId") REFERENCES "AudioTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
