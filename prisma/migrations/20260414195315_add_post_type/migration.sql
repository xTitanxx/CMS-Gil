-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('POST', 'REEL', 'STORY');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "postType" "PostType" NOT NULL DEFAULT 'POST';
