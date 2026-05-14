-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "shufflePosition" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Post_userId_shufflePosition_idx" ON "Post"("userId", "shufflePosition");
