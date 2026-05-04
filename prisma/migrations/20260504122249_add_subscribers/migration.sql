-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "monthlyBudgetUsd" DECIMAL(8,4) NOT NULL DEFAULT 1.20,
    "cycleStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cycleUsedUsd" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriberConversation" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriberConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriberMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriberMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriberUsage" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(8,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriberUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_codeHash_key" ON "Subscriber"("codeHash");

-- CreateIndex
CREATE INDEX "Subscriber_revokedAt_idx" ON "Subscriber"("revokedAt");

-- CreateIndex
CREATE INDEX "SubscriberConversation_subscriberId_updatedAt_idx" ON "SubscriberConversation"("subscriberId", "updatedAt");

-- CreateIndex
CREATE INDEX "SubscriberMessage_conversationId_createdAt_idx" ON "SubscriberMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriberUsage_subscriberId_createdAt_idx" ON "SubscriberUsage"("subscriberId", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriberConversation" ADD CONSTRAINT "SubscriberConversation_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriberMessage" ADD CONSTRAINT "SubscriberMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SubscriberConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriberUsage" ADD CONSTRAINT "SubscriberUsage_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
