// Voyage voyage-3-lite client. 512-dim float vectors, ~$0.02/1M input tokens.
//
// We use Voyage instead of OpenAI text-embedding-3-small because the corpus
// mixes English/Hebrew with Israeli + Jewish cultural references, and Voyage
// is trained explicitly for retrieval (better recall on multilingual narrative
// content than general-purpose models). 512-dim is the model's native size —
// no truncation. See plan: ~/.claude/plans/one-of-if-not-virtual-moore.md
//
// Returns null when VOYAGE_API_KEY is missing so callers can degrade to
// keyword/tag retrieval. We never throw — embedding failure is non-fatal.

const MODEL = "voyage-3-lite";
const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
export const EMBEDDING_DIM = 512;

type InputType = "query" | "document";

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

// Small LRU on normalized query text. Public chat sees repeat questions
// ("does Gil talk about MS?") — caching avoids the round-trip.
const QUERY_CACHE_MAX = 256;
const queryCache = new Map<string, number[]>();

function lruGet(key: string): number[] | undefined {
  const v = queryCache.get(key);
  if (!v) return undefined;
  // Touch: move to end of insertion order.
  queryCache.delete(key);
  queryCache.set(key, v);
  return v;
}

function lruSet(key: string, value: number[]): void {
  if (queryCache.has(key)) queryCache.delete(key);
  queryCache.set(key, value);
  if (queryCache.size > QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value;
    if (oldest) queryCache.delete(oldest);
  }
}

function normalizeCacheKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

async function callVoyageOnce(
  inputs: string[],
  inputType: InputType,
  apiKey: string,
): Promise<number[][] | null> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: inputs,
      model: MODEL,
      input_type: inputType,
    }),
    // Bump per-request timeout above Node's default; large batches + free-tier
    // throttling can take a while to respond.
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[embed] Voyage ${res.status}: ${text.slice(0, 300)}`);
    return null;
  }

  const json = (await res.json()) as VoyageResponse;
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

async function callVoyage(
  inputs: string[],
  inputType: InputType,
): Promise<number[][] | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.warn("[embed] VOYAGE_API_KEY missing — returning null embeddings");
    return null;
  }
  if (inputs.length === 0) return [];

  // Transient network failures (DNS, connect-timeout, socket reset) shouldn't
  // abort an entire backfill. Retry up to 3 times with exponential backoff.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await callVoyageOnce(inputs, inputType, apiKey);
      if (result) return result;
      // null = non-retryable HTTP error (already logged).
      return null;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        msg.includes("fetch failed") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ConnectTimeout") ||
        msg.includes("timeout");
      if (!transient) throw err;
      const backoffMs = 1000 * Math.pow(2, attempt);
      console.warn(`[embed] transient error (${msg}); retry ${attempt + 1}/3 in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  console.error("[embed] Voyage exhausted retries:", lastErr);
  return null;
}

// Embed a search query. Cached.
export async function embedQuery(query: string): Promise<number[] | null> {
  const key = normalizeCacheKey(query);
  if (!key) return null;
  const cached = lruGet(key);
  if (cached) return cached;

  const result = await callVoyage([query], "query");
  if (!result || !result[0]) return null;
  lruSet(key, result[0]);
  return result[0];
}

// Embed one or more documents. Not cached (each post is unique).
// Used by the backfill script and the auto-embed-on-write hook.
export async function embedDocuments(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  return callVoyage(texts, "document");
}

// Build the document text for a post. Kept tight — body + tags only — so the
// vector space stays clean. Per Plan agent: don't pollute with date / lifecycle
// / captionSuggestion (rewrites of body would dilute the embedding).
export function buildPostEmbeddingText(post: {
  body: string;
  tags: string[];
  captionSuggestion?: string | null;
}): string {
  const tagLine = post.tags.length > 0 ? `Tags: ${post.tags.join(", ")}` : "";
  const body = post.body.trim();
  // Caption-only fallback when body is empty.
  const text = body.length > 0 ? body : (post.captionSuggestion?.trim() ?? "");
  return [tagLine, text].filter(Boolean).join("\n");
}

// Format a JS number[] as the literal Postgres vector text format pgvector
// accepts: "[0.1,0.2,0.3]". Use with $queryRaw + ::vector cast.
export function toPgVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
