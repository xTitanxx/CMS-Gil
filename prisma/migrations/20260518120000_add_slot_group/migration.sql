-- CreateEnum
CREATE TYPE "SlotGroup" AS ENUM ('MAIN', 'VIDEO');

-- AlterTable
ALTER TABLE "WeeklyPlanSlot" ADD COLUMN "slotGroup" "SlotGroup" NOT NULL DEFAULT 'MAIN';

-- CreateIndex
CREATE INDEX "WeeklyPlanSlot_planId_day_slotGroup_idx" ON "WeeklyPlanSlot"("planId", "day", "slotGroup");
