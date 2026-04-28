-- UserMemory was previously a key/value table that the app never wrote to.
-- Replace it with a free-form schema the assistant can append to.
DROP TABLE IF EXISTS "UserMemory" CASCADE;

CREATE TABLE "UserMemory" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "kind"      TEXT NOT NULL DEFAULT 'general',
  "postId"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserMemory_userId_createdAt_idx" ON "UserMemory" ("userId", "createdAt");
CREATE INDEX "UserMemory_postId_idx" ON "UserMemory" ("postId");

ALTER TABLE "UserMemory"
  ADD CONSTRAINT "UserMemory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserMemory"
  ADD CONSTRAINT "UserMemory_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Re-enable RLS to match the rest of the schema (see 20260423120000_enable_rls_all_tables).
ALTER TABLE "UserMemory" ENABLE ROW LEVEL SECURITY;
