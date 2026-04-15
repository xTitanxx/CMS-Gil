-- CreateEnum
CREATE TYPE "Lifecycle" AS ENUM ('UNKNOWN', 'EVERGREEN', 'EPHEMERAL', 'SEASONAL');

-- CreateEnum
CREATE TYPE "Season" AS ENUM ('SPRING', 'SUMMER', 'FALL', 'WINTER');

-- CreateEnum
CREATE TYPE "Readiness" AS ENUM ('UNCHECKED', 'READY', 'NOT_READY', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "audioTrackId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "lifecycle" "Lifecycle" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "lifecycleOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notReadyReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "readiness" "Readiness" NOT NULL DEFAULT 'UNCHECKED',
ADD COLUMN     "readinessCheckedAt" TIMESTAMP(3),
ADD COLUMN     "season" "Season";

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE INDEX "AudioTrack_userId_createdAt_idx" ON "AudioTrack"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostRating_postId_key" ON "PostRating"("postId");

-- CreateIndex
CREATE INDEX "PostRating_stars_idx" ON "PostRating"("stars");

-- CreateIndex
CREATE INDEX "Post_readiness_idx" ON "Post"("readiness");

-- CreateIndex
CREATE INDEX "Post_lifecycle_idx" ON "Post"("lifecycle");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_audioTrackId_fkey" FOREIGN KEY ("audioTrackId") REFERENCES "AudioTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostRating" ADD CONSTRAINT "PostRating_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
