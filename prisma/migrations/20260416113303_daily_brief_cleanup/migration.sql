-- Drop redundant index (covered by the @@unique constraint's B-tree index)
DROP INDEX IF EXISTS "DailyBrief_userId_date_idx";

-- Add updatedAt column with a default so existing rows are populated
ALTER TABLE "DailyBrief" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
