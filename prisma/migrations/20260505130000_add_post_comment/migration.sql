-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Subscriber"
ADD COLUMN     "commentsDisabledAt" TIMESTAMP(3),
ADD COLUMN     "displayName" TEXT;

-- CreateTable
CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostComment_postId_status_createdAt_idx" ON "PostComment"("postId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PostComment_status_createdAt_idx" ON "PostComment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PostComment_subscriberId_createdAt_idx" ON "PostComment"("subscriberId", "createdAt");

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
