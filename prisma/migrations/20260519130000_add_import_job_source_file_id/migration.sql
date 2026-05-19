-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN "sourceFileId" TEXT;

-- CreateIndex
CREATE INDEX "ImportJob_userId_source_sourceFileId_idx" ON "ImportJob"("userId", "source", "sourceFileId");
