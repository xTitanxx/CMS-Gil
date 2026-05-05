-- AlterTable
ALTER TABLE "Subscriber" ADD COLUMN     "codeBlindIndex" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_codeBlindIndex_key" ON "Subscriber"("codeBlindIndex");
