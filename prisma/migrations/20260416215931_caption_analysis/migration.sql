-- AlterTable: caption analysis fields
ALTER TABLE "Post"
  ADD COLUMN IF NOT EXISTS "captionQuality"    INTEGER,
  ADD COLUMN IF NOT EXISTS "captionEvergreen"  BOOLEAN,
  ADD COLUMN IF NOT EXISTS "captionAnalyzedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "captionSuggestion" TEXT;

-- CreateTable: background job tracking for caption analysis
CREATE TABLE IF NOT EXISTS "BulkCaptionAnalyzeJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "BulkAnalyzeStatus" NOT NULL DEFAULT 'RUNNING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkCaptionAnalyzeJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BulkCaptionAnalyzeJob_userId_status_idx"
  ON "BulkCaptionAnalyzeJob"("userId", "status");
