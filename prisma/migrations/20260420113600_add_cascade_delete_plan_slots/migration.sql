-- DropForeignKey
ALTER TABLE "WeeklyPlanSlot" DROP CONSTRAINT "WeeklyPlanSlot_postId_fkey";

-- AddForeignKey
ALTER TABLE "WeeklyPlanSlot" ADD CONSTRAINT "WeeklyPlanSlot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
