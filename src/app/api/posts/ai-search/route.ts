import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { query } = await req.json();
  if (!query?.trim()) {
    return NextResponse.json({ tags: [], keywords: [], explanation: "" });
  }

  // Get all tags this user has
  const rows = await prisma.$queryRaw<{ tag: string }[]>`
    SELECT DISTINCT unnest(tags) AS tag
    FROM "Post"
    WHERE "userId" = ${session.user.id}
  `;
  const availableTags = rows.map((r) => r.tag);

  const prompt = `You are helping search a personal content library of social media posts about mental health and wellbeing.

Available tags in this library: ${availableTags.length > 0 ? availableTags.join(", ") : "(none yet)"}

User's search query: "${query}"

Return a JSON object with:
- "tags": array of tags from the available list that best match the query (include partial/conceptual matches, not just exact)
- "keywords": array of 1-3 plain text keywords to also search in post body text
- "explanation": one short sentence describing what you're searching for

Return only the JSON object, no explanation outside it.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const match = raw.match(/\{[\s\S]*\}/);

  let tags: string[] = [];
  let keywords: string[] = [];
  let explanation = "";

  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown) => typeof t === "string") : [];
      keywords = Array.isArray(parsed.keywords) ? parsed.keywords.filter((k: unknown) => typeof k === "string") : [];
      explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";
    } catch { /* leave empty */ }
  }

  return NextResponse.json({ tags, keywords, explanation });
}
