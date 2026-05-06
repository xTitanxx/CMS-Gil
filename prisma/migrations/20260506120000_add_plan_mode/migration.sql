-- CreateEnum
CREATE TYPE "PlanMode" AS ENUM ('AI', 'DUMB');

-- AlterTable
ALTER TABLE "WeeklyPlan" ADD COLUMN "mode" "PlanMode" NOT NULL DEFAULT 'AI';
