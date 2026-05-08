-- Enable pgvector for semantic post-recall in /api/chat and /api/assistant.
-- Idempotent: re-running is a no-op.
CREATE EXTENSION IF NOT EXISTS vector;

-- 512-dim embedding (Voyage voyage-3-lite output dimensionality).
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "embedding" vector(512);

-- HNSW cosine index. m=16/ef_construction=64 are pgvector's recommended
-- defaults for general retrieval. Build is fast at this corpus size.
CREATE INDEX IF NOT EXISTS "post_embedding_hnsw_idx"
  ON "Post" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
