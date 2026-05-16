// YouTube Data API v3 — Video upload
// Scopes: https://www.googleapis.com/auth/youtube.upload

import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import { getObject } from "@/lib/storage";
import { Readable } from "stream";

const anthropic = new Anthropic();

interface PublishResult {
  platformPostId: string;
  platformUrl?: string;
}

interface YouTubeCredentials {
  accessToken: string;
  refreshToken?: string;
}

export async function postToYouTube(
  creds: YouTubeCredentials,
  title: string,
  body: string,
  mediaKeys: string[]
): Promise<PublishResult> {
  const videoKey = mediaKeys.find((k) =>
    k.match(/\.(mp4|mov|avi|webm|mkv)$/i)
  );
  if (!videoKey) {
    throw new Error("YouTube requires a video file");
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
  });

  const youtube = google.youtube({ version: "v3", auth });

  const videoBuffer = await getObject(videoKey);
  const stream = Readable.from(videoBuffer);

  const description = body.includes("#Shorts")
    ? truncate(body, 5000)
    : truncate(body + "\n\n#Shorts", 5000);

  const generatedTitle = await generateTitle(title || body);

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: generatedTitle,
        description,
        categoryId: "22", // People & Blogs
      },
      status: {
        privacyStatus: "public",
      },
    },
    media: {
      mimeType: "video/*",
      body: stream,
    },
  });

  const videoId = res.data.id!;
  return {
    platformPostId: videoId,
    platformUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + "..." : str;
}

const TITLE_PROMPT = `You write YouTube titles for a reflective, first-person creator whose posts are about MS, breathwork, depression, presence, and personal growth.

Given the full post body, write a single YouTube title that:
- Is at most 70 characters (hard limit — count them)
- Captures the core idea or hook, not a generic restatement
- Stays in the author's voice: honest, grounded, not clickbaity, not hype
- Uses sentence case, no emoji, no hashtags, no quotes, no trailing punctuation unless meaningful
- Reads as a complete thought a viewer would click on

Output ONLY the title text. No preamble, no quotes, no explanation, no alternatives.`;

// Generates a YouTube title using Haiku 4.5. Falls back to the heuristic
// deriveTitle() on any error (API down, rate limit, malformed output) so a
// flaky Anthropic call never blocks publishing. Cost: ~half a cent per call;
// latency: ~1-2s added to YouTube publish.
async function generateTitle(body: string): Promise<string> {
  const trimmed = body.trim();
  if (!trimmed) return "Untitled";

  try {
    // Hard 20s cap. The Anthropic SDK doesn't enforce its own deadline; a
    // wedged call would otherwise sit eating the lambda's 300s budget before
    // we even start uploading the video. On timeout/abort we fall through to
    // the deriveTitle fallback in the catch block.
    const resp = await anthropic.messages.create(
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: TITLE_PROMPT,
        messages: [{ role: "user", content: trimmed }],
      },
      { signal: AbortSignal.timeout(20_000) },
    );
    const raw =
      resp.content
        .find((b): b is Anthropic.TextBlock => b.type === "text")
        ?.text?.trim() ?? "";
    // Strip wrapping quotes the model might add despite instructions.
    const stripped = raw.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "").trim();
    if (!stripped) return deriveTitle(body, 100);
    // Hard YouTube cap — if the model overran 100, word-boundary trim.
    if (stripped.length > 100) return deriveTitle(stripped, 100);
    return stripped;
  } catch {
    return deriveTitle(body, 100);
  }
}

// YouTube titles are capped at 100 chars. A naive slice cuts mid-word ("…hydrati")
// and the same string is already used as the description, so the title should
// be a short, self-contained hook — first sentence, then first line, then a
// word-boundary truncate as a last resort. Used as the fallback when the AI
// generator fails.
export function deriveTitle(body: string, max = 100): string {
  const trimmed = body.trim();
  if (!trimmed) return "Untitled";

  let candidate = trimmed;
  const sentenceMatch = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/);
  if (sentenceMatch && sentenceMatch[0].trim().length > 0) {
    candidate = sentenceMatch[0].trim();
  } else {
    const lineMatch = trimmed.match(/^[^\n]+/);
    if (lineMatch) candidate = lineMatch[0].trim();
  }

  if (candidate.length <= max) return candidate;

  const slice = candidate.slice(0, max - 3);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max / 2 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + "...";
}
