import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const anthropic = new Anthropic();

export const SAMPLE_SIZE_DEFAULT = 30;
export const MIN_BODY_CHARS = 50;
export const THEME_COUNT_TARGET = 10;
export const TOP_TAGS_FOR_CLUSTERING = 100;

export interface ArchivePost {
  id: string;
  body: string;
  tags: string[];
  originalDate: Date;
}

export interface Theme {
  name: string;
  tags: string[];
}

export interface SampleEntry {
  id: string;
  originalDate: string; // YYYY-MM-DD
  body: string;
  tags: string[];
  theme: string;
}

export interface UnderstandingResult {
  voiceProfile: string;
  thematicMap: string;
  sampleBodies: SampleEntry[];
  basedOnPostCount: number;
}

export function topTagsByFrequency(posts: ArchivePost[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

export async function clusterTagsIntoThemes(
  tags: string[],
  targetCount: number,
): Promise<Theme[]> {
  if (tags.length === 0) return [];
  const prompt = `You group post tags into thematic clusters for a personal archive.
Tags: ${tags.join(", ")}

Group these into about ${targetCount} thematic clusters. Each cluster is a coherent theme (e.g. "family", "garden", "philosophy", "current events"). Every tag goes into exactly one cluster — pick the best fit. Theme names: short (1-3 words), lowercase.

Return ONLY a JSON object: {"themes": [{"name": "...", "tags": ["...", "..."]}, ...]}.`;

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { themes?: unknown };
    if (!Array.isArray(parsed.themes)) return [];
    return parsed.themes
      .filter(
        (t): t is { name: string; tags: string[] } =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as { name?: unknown }).name === "string" &&
          Array.isArray((t as { tags?: unknown }).tags),
      )
      .map((t) => ({
        name: t.name.toLowerCase().trim(),
        tags: t.tags.filter((x): x is string => typeof x === "string"),
      }));
  } catch {
    return [];
  }
}

function toEntry(p: ArchivePost, theme: string): SampleEntry {
  return {
    id: p.id,
    originalDate: p.originalDate.toISOString().slice(0, 10),
    body: p.body,
    tags: p.tags,
    theme,
  };
}

// Deterministic spread across years — round-robin pick from year buckets so
// the sample isn't dominated by whatever year the user posted most.
function diversifyPick(posts: ArchivePost[], n: number, theme: string): SampleEntry[] {
  if (posts.length === 0 || n <= 0) return [];
  if (posts.length <= n) return posts.map((p) => toEntry(p, theme));

  const byYear = new Map<number, ArchivePost[]>();
  for (const p of posts) {
    const y = p.originalDate.getFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(p);
  }
  // Within a year, sort by length so round-robin alternates short/medium/long.
  for (const arr of byYear.values()) arr.sort((a, b) => a.body.length - b.body.length);

  const years = [...byYear.keys()].sort();
  const out: ArchivePost[] = [];
  let idx = 0;
  while (out.length < n) {
    let added = false;
    for (const y of years) {
      const bucket = byYear.get(y)!;
      if (idx < bucket.length) {
        out.push(bucket[idx]);
        added = true;
        if (out.length >= n) break;
      }
    }
    if (!added) break;
    idx++;
  }
  return out.map((p) => toEntry(p, theme));
}

export function pickStratifiedSample(
  posts: ArchivePost[],
  themes: Theme[],
  sampleSize: number,
): SampleEntry[] {
  if (posts.length === 0 || sampleSize <= 0) return [];
  if (themes.length === 0) return diversifyPick(posts, sampleSize, "(general)");

  const tagToTheme = new Map<string, string>();
  for (const t of themes) for (const tag of t.tags) tagToTheme.set(tag, t.name);

  const grouped = new Map<string, ArchivePost[]>();
  for (const t of themes) grouped.set(t.name, []);
  const ungrouped: ArchivePost[] = [];

  for (const p of posts) {
    // First-matching tag wins — keeps a post in a single theme bucket.
    const matchedTag = p.tags.find((t) => tagToTheme.has(t));
    if (matchedTag) grouped.get(tagToTheme.get(matchedTag)!)!.push(p);
    else ungrouped.push(p);
  }

  const perTheme = Math.max(1, Math.ceil(sampleSize / themes.length));
  const result: SampleEntry[] = [];
  for (const t of themes) {
    result.push(...diversifyPick(grouped.get(t.name) ?? [], perTheme, t.name));
  }

  if (result.length < sampleSize && ungrouped.length > 0) {
    result.push(...diversifyPick(ungrouped, sampleSize - result.length, "(other)"));
  }
  return result.slice(0, sampleSize);
}

export async function generateVoiceProfile(samples: SampleEntry[]): Promise<string> {
  if (samples.length === 0) return "";
  const corpus = samples
    .map((s) => `[${s.originalDate}] ${s.body}`)
    .join("\n\n---\n\n");
  const prompt = `Read these posts written by Gil. Write a one-page profile (about 600 words) describing his writing voice — typical openings, sentence rhythm, tone, language mix (Hebrew vs English vs both), recurring stylistic moves, what he tends to avoid. Plain prose, no markdown headers or bullets. Be specific — quote short phrases from his posts (in their original language) when they illustrate a pattern. Address the reader as "the assistant who will help him draft new posts" — in second person.

POSTS:
${corpus}

Write the voice profile now:`;

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });
  const text =
    resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  return text.trim();
}

export async function generateThematicMap(
  themes: Theme[],
  themeCounts: Record<string, number>,
  totalPosts: number,
): Promise<string> {
  if (themes.length === 0) return "";
  const lines = themes
    .map(
      (t) =>
        `- ${t.name}: ${themeCounts[t.name] ?? 0} posts (tags: ${t.tags
          .slice(0, 8)
          .join(", ")})`,
    )
    .join("\n");
  const prompt = `Write a short paragraph (about 250 words) describing what Gil writes about, given this thematic breakdown of his ${totalPosts}-post archive. Use rough proportions ("often", "regularly", "occasionally"). Plain prose, no bullets, no headers. Address the reader as "the assistant who will help him draft new posts" — in second person.

THEMES:
${lines}

Write the thematic map now:`;

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });
  const text =
    resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  return text.trim();
}

export function countPostsPerTheme(
  posts: ArchivePost[],
  themes: Theme[],
): Record<string, number> {
  const tagToTheme = new Map<string, string>();
  for (const t of themes) for (const tag of t.tags) tagToTheme.set(tag, t.name);
  const counts: Record<string, number> = {};
  for (const t of themes) counts[t.name] = 0;
  for (const p of posts) {
    const seen = new Set<string>();
    for (const tag of p.tags) {
      const theme = tagToTheme.get(tag);
      if (theme && !seen.has(theme)) {
        counts[theme] = (counts[theme] ?? 0) + 1;
        seen.add(theme);
      }
    }
  }
  return counts;
}

export async function buildUnderstanding(
  userId: string,
  opts: { sampleSize?: number } = {},
): Promise<UnderstandingResult> {
  const sampleSize = opts.sampleSize ?? SAMPLE_SIZE_DEFAULT;
  const posts = await prisma.post.findMany({
    where: {
      userId,
      readiness: { not: "ARCHIVED" },
      body: { not: "" },
    },
    select: { id: true, body: true, tags: true, originalDate: true },
  });
  const usable: ArchivePost[] = posts.filter((p) => p.body.length >= MIN_BODY_CHARS);
  if (usable.length === 0) {
    return {
      voiceProfile: "",
      thematicMap: "",
      sampleBodies: [],
      basedOnPostCount: 0,
    };
  }

  const tags = topTagsByFrequency(usable, TOP_TAGS_FOR_CLUSTERING);
  const themes = await clusterTagsIntoThemes(tags, THEME_COUNT_TARGET);
  const themeCounts = countPostsPerTheme(usable, themes);
  const sampleBodies = pickStratifiedSample(usable, themes, sampleSize);

  const [voiceProfile, thematicMap] = await Promise.all([
    generateVoiceProfile(sampleBodies),
    generateThematicMap(themes, themeCounts, usable.length),
  ]);

  return {
    voiceProfile,
    thematicMap,
    sampleBodies,
    basedOnPostCount: usable.length,
  };
}

export async function persistUnderstanding(
  userId: string,
  result: UnderstandingResult,
): Promise<void> {
  await prisma.userArchiveUnderstanding.upsert({
    where: { userId },
    create: {
      userId,
      voiceProfile: result.voiceProfile,
      thematicMap: result.thematicMap,
      sampleBodies: result.sampleBodies as unknown as object,
      basedOnPostCount: result.basedOnPostCount,
    },
    update: {
      voiceProfile: result.voiceProfile,
      thematicMap: result.thematicMap,
      sampleBodies: result.sampleBodies as unknown as object,
      basedOnPostCount: result.basedOnPostCount,
      generatedAt: new Date(),
    },
  });
}
