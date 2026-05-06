import { prisma } from "@/lib/prisma";

let cachedContext: string | null = null;
let cachedAt = 0;
let cachedCount = 0;
let cachedIds: Set<string> = new Set();
const TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getPostContext(): Promise<{
  text: string;
  count: number;
  ids: Set<string>;
}> {
  const now = Date.now();
  if (cachedContext && now - cachedAt < TTL_MS) {
    return { text: cachedContext, count: cachedCount, ids: cachedIds };
  }

  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) {
    throw new Error("GIL_USER_ID environment variable is not set");
  }

  // Baseline is the always-cached "ambient context" for small-talk and
  // recency-aware answers. The per-turn hybrid retrieval in /api/chat picks
  // up older posts that fall outside this window, so we keep the baseline
  // small (was 200) — saves ~75% of system-prompt tokens without hurting
  // recall of older content.
  const posts = await prisma.post.findMany({
    where: { userId: gilUserId },
    select: { id: true, body: true, tags: true, originalDate: true },
    orderBy: { originalDate: "desc" },
    take: 50,
  });

  const lines = posts.map((p) => {
    const date = new Date(p.originalDate).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const tags = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
    const body = p.body?.trim() ?? "(no text)";
    return `[ID: ${p.id}] ${date}${tags}\n${body}`;
  });

  cachedContext = lines.join("\n---\n");
  cachedCount = posts.length;
  cachedIds = new Set(posts.map((p) => p.id));
  cachedAt = now;

  return { text: cachedContext, count: cachedCount, ids: cachedIds };
}
