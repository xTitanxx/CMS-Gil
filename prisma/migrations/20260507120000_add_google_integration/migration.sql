-- Google OAuth tokens for the YouTube + Drive integration. Kept SEPARATE
-- from the NextAuth Account row so admin sign-in is decoupled from the
-- integration. See `model GoogleIntegration` in schema.prisma for context.
CREATE TABLE "GoogleIntegration" (
  "id"                  TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "googleSub"           TEXT NOT NULL,
  "email"               TEXT NOT NULL,
  "accessToken"         TEXT NOT NULL,
  "refreshToken"        TEXT,
  "expiresAt"           INTEGER,
  "scope"               TEXT,
  "youtubeChannelId"    TEXT,
  "youtubeChannelTitle" TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleIntegration_userId_key" ON "GoogleIntegration"("userId");
CREATE INDEX "GoogleIntegration_googleSub_idx" ON "GoogleIntegration"("googleSub");

ALTER TABLE "GoogleIntegration"
  ADD CONSTRAINT "GoogleIntegration_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleIntegration" ENABLE ROW LEVEL SECURITY;
