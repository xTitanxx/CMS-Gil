-- AlterTable
ALTER TABLE "Post" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Post_tags_idx" ON "Post" USING GIN ("tags");
