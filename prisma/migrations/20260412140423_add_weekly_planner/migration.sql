-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PARTIAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('PROPOSED', 'APPROVED', 'SCHEDULED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "publishCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WeeklyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyPlanSlot" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'PROPOSED',
    "reasoning" TEXT,
    "platforms" TEXT[],

    CONSTRAINT "WeeklyPlanSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPlan_userId_weekStart_key" ON "WeeklyPlan"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "WeeklyPlanSlot_postId_idx" ON "WeeklyPlanSlot"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPlanSlot_planId_day_key" ON "WeeklyPlanSlot"("planId", "day");

-- AddForeignKey
ALTER TABLE "WeeklyPlan" ADD CONSTRAINT "WeeklyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlanSlot" ADD CONSTRAINT "WeeklyPlanSlot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WeeklyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlanSlot" ADD CONSTRAINT "WeeklyPlanSlot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
