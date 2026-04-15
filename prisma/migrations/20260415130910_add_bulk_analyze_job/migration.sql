-- CreateEnum
CREATE TYPE "BulkAnalyzeStatus" AS ENUM ('RUNNING', 'CANCELLED', 'DONE');

-- CreateTable
CREATE TABLE "BulkAnalyzeJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "BulkAnalyzeStatus" NOT NULL DEFAULT 'RUNNING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkAnalyzeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkAnalyzeJob_userId_status_idx" ON "BulkAnalyzeJob"("userId", "status");
