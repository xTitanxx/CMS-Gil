-- Per-API-call usage + cost record for the assistant. One row per Anthropic
-- response (multiple per user turn when tool-use iterates). Read by
-- /api/assistant/usage to surface a running cost total in the UI.
CREATE TABLE "AssistantUsage" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "conversationId"    TEXT,
  "model"             TEXT NOT NULL,
  "inputTokens"       INTEGER NOT NULL,
  "outputTokens"      INTEGER NOT NULL,
  "cacheCreateTokens" INTEGER NOT NULL DEFAULT 0,
  "cacheReadTokens"   INTEGER NOT NULL DEFAULT 0,
  "costUsd"           DECIMAL(12, 6) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantUsage_userId_createdAt_idx"
  ON "AssistantUsage"("userId", "createdAt");

ALTER TABLE "AssistantUsage"
  ADD CONSTRAINT "AssistantUsage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantUsage" ENABLE ROW LEVEL SECURITY;
