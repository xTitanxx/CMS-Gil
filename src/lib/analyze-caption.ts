import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const client = new Anthropic();

export interface CaptionAnalysis {
  quality: number;        // 1..5
  evergreen: boolean;
  rationale?: string;
}

const ANALYZE_PROMPT = `You rate social-media captions written by one author (a reflective, poetic voice on MS, breathwork, depression, personal growth). You see only the caption text — ignore any attached media.

Return JSON:
{
  "quality": 1-5 integer (1 = low-effort one-liner or just a link; 3 = decent note; 5 = polished, poetic, stands alone),
  "evergreen": true | false (true if the caption reads timelessly; false if it references a specific date, recent event, "yesterday", "today", a specific person's action, or news),
  "rationale": short one-line reason
}

Be honest. A short line attached to a strong photo can still be quality=1 if the caption alone is forgettable.`;

const PARSE_OBJ = /\{[\s\S]*\}/;

export function parseCaptionAnalysis(text: string): CaptionAnalysis | null {
  const m = text.match(PARSE_OBJ);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as Record<string, unknown>;
    const q = Number(p.quality);
    if (!Number.isInteger(q) || q < 1 || q > 5) return null;
    const evergreen = typeof p.evergreen === "boolean" ? p.evergreen : null;
    if (evergreen === null) return null;
    const rationale = typeof p.rationale === "string" ? p.rationale : undefined;
    return { quality: q, evergreen, rationale };
  } catch {
    return null;
  }
}

export async function analyzeCaption(postId: string): Promise<CaptionAnalysis | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { body: true },
  });
  if (!post) return null;

  const caption = post.body.trim();
  if (!caption) {
    // Nothing to rate — mark with nulls and move on.
    await prisma.post.update({
      where: { id: postId },
      data: {
        captionQuality: null,
        captionEvergreen: null,
        captionAnalyzedAt: new Date(),
      },
    });
    return null;
  }

  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: ANALYZE_PROMPT,
    messages: [{ role: "user", content: caption }],
  });
  const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  const parsed = parseCaptionAnalysis(text);
  if (!parsed) return null;

  await prisma.post.update({
    where: { id: postId },
    data: {
      captionQuality: parsed.quality,
      captionEvergreen: parsed.evergreen,
      captionAnalyzedAt: new Date(),
    },
  });
  return parsed;
}

interface HighQualityExample {
  body: string;
  tags: string[];
}

export async function getHighQualityExamples(
  userId: string,
  limit = 6,
): Promise<HighQualityExample[]> {
  const rows = await prisma.post.findMany({
    where: {
      userId,
      captionEvergreen: true,
      captionQuality: { gte: 4 },
    },
    select: { body: true, tags: true },
    take: 100,
  });
  // Random sample of `limit`.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows.slice(0, limit);
}

const SUGGEST_PROMPT = `You rewrite weak captions in the author's established voice, using their own stronger captions as style reference.

The author's voice: reflective, honest, poetic without being ornate; themes of MS, breathwork, depression, presence. Short sentences, natural breaks, no hashtags, no emojis unless they already appear in the examples. First-person.

STYLE EXAMPLES (from the same author's high-quality evergreen captions):
{EXAMPLES}

TASK: Rewrite the weak caption below to be evergreen and more crafted, preserving the original meaning and any concrete details. Do NOT invent facts. If the original mentions a specific date or recent event, keep the spirit but remove time markers so it reads timelessly. Keep a similar length — a one-liner original shouldn't become an essay.

Output ONLY the rewritten caption, nothing else. No preamble, no quotes, no explanation.

ORIGINAL CAPTION:
{ORIGINAL}`;

export async function suggestCaption(args: {
  postId: string;
  examples: HighQualityExample[];
}): Promise<string | null> {
  const post = await prisma.post.findUnique({
    where: { id: args.postId },
    select: { body: true },
  });
  if (!post) return null;
  const original = post.body.trim();
  if (!original) return null;

  const exText = args.examples
    .map((e, i) => `[example ${i + 1}]\n${e.body.trim()}`)
    .join("\n\n");
  const prompt = SUGGEST_PROMPT.replace("{EXAMPLES}", exText).replace("{ORIGINAL}", original);

  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text?.trim() ?? "";
  if (!text) return null;

  await prisma.post.update({
    where: { id: args.postId },
    data: { captionSuggestion: text },
  });
  return text;
}
