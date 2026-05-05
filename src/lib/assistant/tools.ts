import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import type { Platform as PrismaPlatform } from "@prisma/client";
import { recommend, recommendMix } from "./recommend";
import { retrieve } from "./retrieve";

export interface ToolContext {
  userId: string;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const PLATFORM_MAP: Record<string, PrismaPlatform> = {
  facebook: "FACEBOOK",
  instagram: "INSTAGRAM",
  linkedin: "LINKEDIN",
  youtube: "YOUTUBE",
  tiktok: "TIKTOK",
};

function parseExcludePostIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  return ids.length ? ids : undefined;
}

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "recommend_posts",
    description:
      "Returns ranked posts to publish based on ratings, lifecycle, freshness, and variety. Pass excludePostIds with any post ids you've already proposed in this conversation when the user asks for 'different / fresh / other / more' picks — otherwise the engine returns the same top-ranked posts.",
    input_schema: {
      type: "object",
      properties: {
        when: { type: "string", description: "ISO date for target publish. Defaults to now." },
        platform: {
          type: "string",
          enum: ["instagram", "facebook", "linkedin", "tiktok", "youtube"],
        },
        kind: { type: "string", enum: ["POST", "STORY", "REEL"] },
        contentKind: {
          type: "string",
          enum: ["video", "image", "short-text", "long-text"],
          description:
            "Filter by content type. 'video' = REELs + any post with video media. 'image' = posts with image media, no video. 'short-text' = text-only posts ≤400 chars. 'long-text' = text-only posts >400 chars.",
        },
        excludePostIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Post ids to skip — typically the ids you've already shown or proposed earlier in the conversation. Lets the engine return fresh candidates instead of repeating the same top picks.",
        },
        limit: { type: "number", description: "Default 10, max 20." },
      },
    },
  },
  {
    name: "recommend_daily_mix",
    description:
      "Returns a balanced daily mix of recommendations across content kinds in a single call (default: 2 video + 2 image + 2 short-text). Cheaper and better-diversified than calling recommend_posts three times in parallel — one DB pass, and the picks across buckets won't share dominant tags. Use this for 'what should I post today', 'plan my day', or any unspecified-kind ask. Pass excludePostIds with previously-proposed ids when the user asks for a different / fresh mix.",
    input_schema: {
      type: "object",
      properties: {
        when: { type: "string", description: "ISO date for target publish. Defaults to now." },
        videoLimit: { type: "number", description: "How many video picks. Default 2." },
        imageLimit: { type: "number", description: "How many image picks. Default 2." },
        shortTextLimit: { type: "number", description: "How many short-text picks. Default 2." },
        longTextLimit: { type: "number", description: "How many long-text picks. Default 0; raise to 1 if a longer piece would round out the mix." },
        excludePostIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Post ids to skip — typically the ids you've already shown or proposed earlier in the conversation. Lets the engine return fresh candidates instead of repeating the same top picks.",
        },
      },
    },
  },
  {
    name: "search_archive",
    description:
      "Searches the archive by tag, keyword, exact phrase, and optional date range. Use for 'find a post about X', 'find posts from 2023 about Y', or when the user pastes exact text from a remembered post. Date params are ISO strings (YYYY-MM-DD or full ISO) — translate user phrasing like 'last month' or 'in 2023' into concrete from/to. Smart-quotes / em-dashes in pasted text are handled automatically.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        from: {
          type: "string",
          description: "ISO date inclusive lower bound on Post.originalDate (YYYY-MM-DD or full ISO).",
        },
        to: {
          type: "string",
          description: "ISO date inclusive upper bound on Post.originalDate (YYYY-MM-DD or full ISO).",
        },
        lifecycle: {
          type: "string",
          enum: ["EVERGREEN", "EPHEMERAL", "SEASONAL", "UNKNOWN"],
        },
        season: { type: "string", enum: ["SPRING", "SUMMER", "FALL", "WINTER"] },
        contentKind: {
          type: "string",
          enum: ["video", "image", "short-text", "long-text"],
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_post",
    description: "Full post body, media, rating, and publish history for an id.",
    input_schema: {
      type: "object",
      properties: { postId: { type: "string" } },
      required: ["postId"],
    },
  },
  {
    name: "list_scheduled",
    description: "Pending publishes in a date range.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO date inclusive." },
        to: { type: "string", description: "ISO date exclusive." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "schedule_post",
    description:
      "Creates a PENDING PublishRecord. Requires Post.readiness=READY and no existing pending within 24h of target.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "string" },
        platform: {
          type: "string",
          enum: ["instagram", "facebook", "linkedin", "tiktok", "youtube"],
        },
        scheduledAt: { type: "string" },
      },
      required: ["postId", "platform", "scheduledAt"],
    },
  },
  {
    name: "unschedule",
    description: "Deletes a PENDING PublishRecord by id.",
    input_schema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
    },
  },
  {
    name: "update_post",
    description:
      "Edits a post. Only call after the user has confirmed the change in chat. Accepts a partial patch of body/tags/lifecycle/season/readiness.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "string" },
        patch: {
          type: "object",
          properties: {
            body: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            lifecycle: { type: "string", enum: ["EVERGREEN", "EPHEMERAL", "SEASONAL", "UNKNOWN"] },
            season: { type: "string", enum: ["SPRING", "SUMMER", "FALL", "WINTER"] },
            readiness: { type: "string", enum: ["READY", "NOT_READY", "ARCHIVED", "UNCHECKED"] },
          },
        },
      },
      required: ["postId", "patch"],
    },
  },
  {
    name: "rate_post",
    description:
      "Sets the 1-5 star rating on a post. Only call after the user has confirmed the rating in chat.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "string" },
        stars: { type: "number", description: "Integer 1-5." },
        reasons: { type: "array", items: { type: "string" } },
        note: { type: "string" },
      },
      required: ["postId", "stars"],
    },
  },
  {
    name: "archive_post",
    description:
      "Archives a post — sets readiness=ARCHIVED and archivedAt=now. Only call after the user has confirmed.",
    input_schema: {
      type: "object",
      properties: { postId: { type: "string" } },
      required: ["postId"],
    },
  },
  {
    name: "publish_now",
    description:
      "Queues a post to be published on the next cron tick (scheduledAt=now). Only call after the user has confirmed platform and target post. Requires readiness=READY.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "string" },
        platform: { type: "string", enum: ["instagram", "facebook", "linkedin", "tiktok", "youtube"] },
      },
      required: ["postId", "platform"],
    },
  },
  {
    name: "analyze_captions",
    description:
      "Kicks off a background job that rates every media post's caption for quality (1-5) and caption-evergreen, then generates AI rewrite suggestions for low-quality or non-evergreen captions using the user's own high-quality captions as style reference. Only call after the user has confirmed. Pass postIds to limit to specific posts; omit for a full DB sweep.",
    input_schema: {
      type: "object",
      properties: {
        postIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of post ids to scope the run to. Omit for a full run.",
        },
        reanalyze: {
          type: "boolean",
          description: "If true, re-analyze posts that already have captionAnalyzedAt set. Default false.",
        },
      },
    },
  },
  {
    name: "caption_job_status",
    description:
      "Returns the latest caption-analysis job (status, total, completed) so the user can check progress.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_memory",
    description:
      "Saves a free-form memory about the user — preferences, post-feedback, style notes, anything the user explicitly asks to remember or you've inferred from a clear signal. Memories get injected into the system prompt every turn, so future conversations see them. When the user reacts to a specific post (\"this is great, remember it\" / \"not a fan of this one\"), call this tool TWICE in parallel: once with kind='post-feedback' and postId set (the literal feedback), and once with kind='preference' and no postId (an abstracted lesson derived from the post's tags/topic/format/length). Keep content to one sentence. Never save personal data the user didn't volunteer.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The memory itself, in one short sentence. Write in third person about the user (e.g. 'prefers personal-narrative captions over news commentary').",
        },
        kind: {
          type: "string",
          enum: ["preference", "post-feedback", "general"],
          description: "Coarse label. Use 'post-feedback' when tied to a specific post, 'preference' for abstracted patterns, 'general' for anything else.",
        },
        postId: {
          type: "string",
          description: "Optional source post id. Required when kind='post-feedback'.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "list_memories",
    description:
      "Lists all saved memories for the user. Memories are already injected into your system prompt; only call this if the user explicitly asks to review/list them.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "delete_memory",
    description:
      "Deletes a saved memory by id. Call when the user says 'forget that', 'that's not right', or otherwise asks you to drop a specific memory.",
    input_schema: {
      type: "object",
      properties: { memoryId: { type: "string" } },
      required: ["memoryId"],
    },
  },
  {
    name: "update_memory",
    description:
      "Refines an existing memory's content. Use when the user corrects a memory rather than asking to forget it (e.g. 'actually, I prefer X, not Y').",
    input_schema: {
      type: "object",
      properties: {
        memoryId: { type: "string" },
        content: { type: "string" },
      },
      required: ["memoryId", "content"],
    },
  },
  {
    name: "propose_to_planner",
    description:
      "Propose scheduling a specific post on a specific day (and optionally a time). Does NOT mutate the planner — it returns a proposal that the UI renders as an in-chat card with a V approve button. The user's approval is what actually adds the slot. Use this whenever you'd otherwise narrate a schedule suggestion (e.g. 'how about Thursday for [post:abc]?').",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "string" },
        day: {
          type: "string",
          description: "ISO date (YYYY-MM-DD) within the current or upcoming week.",
        },
        hour: {
          type: "integer",
          enum: [12, 15, 18, 21],
          description:
            "Optional time slot (24h, Asia/Jerusalem). Defaults to 12 (noon). Choose 15/18/21 when the user asks for afternoon/evening, or to spread multiple posts across a day.",
        },
        platforms: {
          type: "array",
          items: {
            type: "string",
            enum: ["INSTAGRAM", "FACEBOOK_PAGE", "LINKEDIN", "TIKTOK", "YOUTUBE"],
          },
          minItems: 1,
        },
        reasoning: {
          type: "string",
          description: "One short sentence on why this post fits this day/platforms.",
        },
      },
      required: ["postId", "day", "platforms"],
    },
  },
];

export async function handleTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case "recommend_posts": {
      const data = await recommend({
        userId: ctx.userId,
        when: typeof input.when === "string" ? new Date(input.when) : undefined,
        platform: input.platform as never,
        kind: input.kind as never,
        contentKind: input.contentKind as never,
        excludePostIds: parseExcludePostIds(input.excludePostIds),
        limit: typeof input.limit === "number" ? Math.min(20, input.limit) : undefined,
      });
      return { ok: true, data };
    }
    case "recommend_daily_mix": {
      const data = await recommendMix({
        userId: ctx.userId,
        when: typeof input.when === "string" ? new Date(input.when) : undefined,
        videoLimit: typeof input.videoLimit === "number" ? Math.min(5, Math.max(0, input.videoLimit)) : undefined,
        imageLimit: typeof input.imageLimit === "number" ? Math.min(5, Math.max(0, input.imageLimit)) : undefined,
        shortTextLimit:
          typeof input.shortTextLimit === "number"
            ? Math.min(5, Math.max(0, input.shortTextLimit))
            : undefined,
        longTextLimit:
          typeof input.longTextLimit === "number"
            ? Math.min(5, Math.max(0, input.longTextLimit))
            : undefined,
        excludePostIds: parseExcludePostIds(input.excludePostIds),
      });
      return { ok: true, data };
    }
    case "search_archive": {
      // Date-only strings (YYYY-MM-DD) parse to midnight UTC. For `to` that
      // means a `lte` boundary at 00:00, which excludes any post made later
      // that same day (or later in the last day of a month). Expand date-only
      // `to` values to end-of-day so single-day and inclusive-month queries
      // actually capture every post on that boundary.
      const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
      const fromRaw = typeof input.from === "string" ? new Date(input.from) : null;
      const toRaw = typeof input.to === "string"
        ? new Date(isDateOnly(input.to) ? `${input.to}T23:59:59.999Z` : input.to)
        : null;
      const from = fromRaw && !isNaN(fromRaw.getTime()) ? fromRaw : undefined;
      const to = toRaw && !isNaN(toRaw.getTime()) ? toRaw : undefined;
      const data = await retrieve({
        userId: ctx.userId,
        query: String(input.query ?? ""),
        limit: typeof input.limit === "number" ? Math.min(50, input.limit) : undefined,
        lifecycle: input.lifecycle as never,
        season: input.season as never,
        contentKind: input.contentKind as never,
        dateRange: from || to ? { from, to } : undefined,
      });
      return { ok: true, data };
    }
    case "get_post": {
      const post = await prisma.post.findFirst({
        where: { id: String(input.postId), userId: ctx.userId },
        include: {
          media: true,
          rating: true,
          publishes: { orderBy: { scheduledAt: "desc" }, take: 10 },
        },
      });
      if (!post) return { ok: false, error: "post not found" };
      return { ok: true, data: post };
    }
    case "list_scheduled": {
      const data = await prisma.publishRecord.findMany({
        where: {
          status: "PENDING",
          post: { userId: ctx.userId },
          scheduledAt: {
            gte: new Date(String(input.from)),
            lt: new Date(String(input.to)),
          },
        },
        orderBy: { scheduledAt: "asc" },
        include: { post: { select: { id: true, body: true, tags: true } } },
      });
      return { ok: true, data };
    }
    case "schedule_post": {
      const platformSlug = String(input.platform ?? "").toLowerCase();
      const platformEnum = PLATFORM_MAP[platformSlug];
      if (!platformEnum) return { ok: false, error: "unknown platform" };

      const post = await prisma.post.findFirst({
        where: { id: String(input.postId), userId: ctx.userId },
        select: { id: true, readiness: true },
      });
      if (!post) return { ok: false, error: "post not found" };
      if (post.readiness !== "READY")
        return { ok: false, error: "post is not READY" };

      const target = new Date(String(input.scheduledAt));
      const windowStart = new Date(target.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(target.getTime() + 24 * 60 * 60 * 1000);
      const clash = await prisma.publishRecord.findFirst({
        where: {
          postId: post.id,
          status: "PENDING",
          scheduledAt: { gte: windowStart, lte: windowEnd },
        },
      });
      if (clash)
        return { ok: false, error: "post already scheduled within 24h of that time" };

      const record = await prisma.publishRecord.create({
        data: {
          postId: post.id,
          platform: platformEnum,
          scheduledAt: target,
          status: "PENDING",
        },
      });
      return { ok: true, data: record };
    }
    case "unschedule": {
      const record = await prisma.publishRecord.findFirst({
        where: {
          id: String(input.recordId),
          status: "PENDING",
          post: { userId: ctx.userId },
        },
      });
      if (!record) return { ok: false, error: "record not found or not owned" };
      await prisma.publishRecord.delete({ where: { id: record.id } });
      return { ok: true, data: { id: record.id } };
    }
    case "update_post": {
      const post = await prisma.post.findFirst({
        where: { id: String(input.postId), userId: ctx.userId },
        select: { id: true },
      });
      if (!post) return { ok: false, error: "post not found" };

      const patch = (input.patch ?? {}) as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      if (typeof patch.body === "string") data.body = patch.body;
      if (Array.isArray(patch.tags)) data.tags = patch.tags.filter((t) => typeof t === "string");
      if (typeof patch.lifecycle === "string") {
        data.lifecycle = patch.lifecycle;
        data.lifecycleOverridden = true;
      }
      if (typeof patch.season === "string") {
        data.season = patch.season;
        data.lifecycleOverridden = true;
      }
      if (typeof patch.readiness === "string") data.readiness = patch.readiness;

      if (Object.keys(data).length === 0) return { ok: false, error: "empty patch" };

      const updated = await prisma.post.update({ where: { id: post.id }, data });
      console.log("[assistant] update_post", { userId: ctx.userId, postId: post.id, fields: Object.keys(data) });
      return { ok: true, data: { id: updated.id, updated: Object.keys(data) } };
    }
    case "rate_post": {
      const stars = Number(input.stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5)
        return { ok: false, error: "stars must be integer 1-5" };

      const post = await prisma.post.findFirst({
        where: { id: String(input.postId), userId: ctx.userId },
        select: { id: true },
      });
      if (!post) return { ok: false, error: "post not found" };

      const reasons = Array.isArray(input.reasons)
        ? (input.reasons as unknown[]).filter((r): r is string => typeof r === "string")
        : [];
      const note = typeof input.note === "string" ? input.note : null;

      const record = await prisma.postRating.upsert({
        where: { postId: post.id },
        create: { postId: post.id, stars, reasons, note },
        update: { stars, reasons, note },
      });
      console.log("[assistant] rate_post", { userId: ctx.userId, postId: post.id, stars });
      return { ok: true, data: { id: record.id, stars } };
    }
    case "archive_post": {
      const post = await prisma.post.findFirst({
        where: { id: String(input.postId), userId: ctx.userId },
        select: { id: true },
      });
      if (!post) return { ok: false, error: "post not found" };
      const updated = await prisma.post.update({
        where: { id: post.id },
        data: { readiness: "ARCHIVED", archivedAt: new Date() },
      });
      console.log("[assistant] archive_post", { userId: ctx.userId, postId: post.id });
      return { ok: true, data: { id: updated.id } };
    }
    case "publish_now": {
      const platformSlug = String(input.platform ?? "").toLowerCase();
      const platformEnum = PLATFORM_MAP[platformSlug];
      if (!platformEnum) return { ok: false, error: "unknown platform" };

      const post = await prisma.post.findFirst({
        where: { id: String(input.postId), userId: ctx.userId },
        select: { id: true, readiness: true },
      });
      if (!post) return { ok: false, error: "post not found" };
      if (post.readiness !== "READY") return { ok: false, error: "post is not READY" };

      const record = await prisma.publishRecord.create({
        data: {
          postId: post.id,
          platform: platformEnum,
          status: "PENDING",
          scheduledAt: new Date(),
        },
      });
      console.log("[assistant] publish_now", { userId: ctx.userId, postId: post.id, platform: platformEnum });
      return { ok: true, data: record };
    }
    case "analyze_captions": {
      const existing = await prisma.bulkCaptionAnalyzeJob.findFirst({
        where: { userId: ctx.userId, status: "RUNNING" },
      });
      if (existing) {
        return { ok: false, error: "a caption-analysis job is already running" };
      }

      const postIds = Array.isArray(input.postIds)
        ? (input.postIds as unknown[]).filter((x): x is string => typeof x === "string")
        : undefined;
      const reanalyze = input.reanalyze === true;

      let toAnalyze: { id: string }[];
      if (postIds && postIds.length > 0) {
        toAnalyze = await prisma.post.findMany({
          where: { userId: ctx.userId, id: { in: postIds } },
          select: { id: true },
        });
      } else {
        toAnalyze = await prisma.post.findMany({
          where: {
            userId: ctx.userId,
            media: { some: {} },
            ...(reanalyze ? {} : { captionAnalyzedAt: null }),
          },
          select: { id: true },
        });
      }
      if (toAnalyze.length === 0) {
        return { ok: false, error: "no matching posts to analyze" };
      }

      const job = await prisma.bulkCaptionAnalyzeJob.create({
        data: { userId: ctx.userId, total: toAnalyze.length, status: "RUNNING" },
      });

      // Fire-and-forget: do the actual work on the /api/posts/bulk-caption-analyze
      // worker by POSTing to ourselves. But to avoid re-running the candidate query
      // and losing the job we just created, do the work inline via the same pattern.
      // We reuse the background-analysis code path by importing directly.
      const { analyzeCaption, getHighQualityExamples, suggestCaption } = await import(
        "@/lib/analyze-caption"
      );
      const { after: nextAfter } = await import("next/server");

      nextAfter(async () => {
        const CONCURRENCY = 3;
        let i = 0;
        while (i < toAnalyze.length) {
          const current = await prisma.bulkCaptionAnalyzeJob.findUnique({
            where: { id: job.id },
            select: { status: true },
          });
          if (!current || current.status === "CANCELLED") return;
          const batch = toAnalyze.slice(i, i + CONCURRENCY);
          await Promise.allSettled(
            batch.map((p) =>
              analyzeCaption(p.id).catch((err) => console.error(`[caption-analyze] ${p.id}:`, err)),
            ),
          );
          i += batch.length;
          await prisma.bulkCaptionAnalyzeJob
            .update({ where: { id: job.id }, data: { completed: i } })
            .catch(() => {});
        }

        const examples = await getHighQualityExamples(ctx.userId, 6);
        if (examples.length === 0) {
          await prisma.bulkCaptionAnalyzeJob
            .update({ where: { id: job.id }, data: { status: "DONE" } })
            .catch(() => {});
          return;
        }
        const flagged = await prisma.post.findMany({
          where: {
            userId: ctx.userId,
            media: { some: {} },
            id: { in: toAnalyze.map((p) => p.id) },
            OR: [{ captionQuality: { lte: 2 } }, { captionEvergreen: false }],
          },
          select: { id: true },
        });
        await prisma.bulkCaptionAnalyzeJob
          .update({
            where: { id: job.id },
            data: { total: toAnalyze.length + flagged.length, completed: toAnalyze.length },
          })
          .catch(() => {});

        let j = 0;
        while (j < flagged.length) {
          const current = await prisma.bulkCaptionAnalyzeJob.findUnique({
            where: { id: job.id },
            select: { status: true },
          });
          if (!current || current.status === "CANCELLED") return;
          const batch = flagged.slice(j, j + CONCURRENCY);
          await Promise.allSettled(
            batch.map((p) =>
              suggestCaption({ postId: p.id, examples }).catch((err) =>
                console.error(`[caption-suggest] ${p.id}:`, err),
              ),
            ),
          );
          j += batch.length;
          await prisma.bulkCaptionAnalyzeJob
            .update({
              where: { id: job.id },
              data: { completed: toAnalyze.length + j },
            })
            .catch(() => {});
        }

        await prisma.bulkCaptionAnalyzeJob
          .update({ where: { id: job.id }, data: { status: "DONE" } })
          .catch(() => {});
      });

      console.log("[assistant] analyze_captions", {
        userId: ctx.userId,
        total: toAnalyze.length,
        jobId: job.id,
      });
      return { ok: true, data: { jobId: job.id, total: toAnalyze.length } };
    }
    case "caption_job_status": {
      const job = await prisma.bulkCaptionAnalyzeJob.findFirst({
        where: { userId: ctx.userId },
        orderBy: { createdAt: "desc" },
      });
      return { ok: true, data: job };
    }
    case "save_memory": {
      const content = typeof input.content === "string" ? input.content.trim() : "";
      if (!content) return { ok: false, error: "content required" };
      if (content.length > 500) return { ok: false, error: "content too long (max 500 chars)" };

      const allowedKinds = new Set(["preference", "post-feedback", "general"]);
      const rawKind = typeof input.kind === "string" ? input.kind : "general";
      const kind = allowedKinds.has(rawKind) ? rawKind : "general";

      let postId: string | null = null;
      if (typeof input.postId === "string" && input.postId.trim()) {
        const post = await prisma.post.findFirst({
          where: { id: input.postId, userId: ctx.userId },
          select: { id: true },
        });
        if (!post) return { ok: false, error: "post not found" };
        postId = post.id;
      }

      const memory = await prisma.userMemory.create({
        data: { userId: ctx.userId, content, kind, postId },
      });
      console.log("[assistant] save_memory", { userId: ctx.userId, id: memory.id, kind });
      return { ok: true, data: { id: memory.id, content: memory.content, kind: memory.kind, postId: memory.postId } };
    }
    case "list_memories": {
      const memories = await prisma.userMemory.findMany({
        where: { userId: ctx.userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, content: true, kind: true, postId: true, createdAt: true },
      });
      return { ok: true, data: memories };
    }
    case "delete_memory": {
      const memoryId = String(input.memoryId ?? "");
      const memory = await prisma.userMemory.findFirst({
        where: { id: memoryId, userId: ctx.userId },
        select: { id: true },
      });
      if (!memory) return { ok: false, error: "memory not found" };
      await prisma.userMemory.delete({ where: { id: memory.id } });
      console.log("[assistant] delete_memory", { userId: ctx.userId, id: memory.id });
      return { ok: true, data: { id: memory.id } };
    }
    case "update_memory": {
      const memoryId = String(input.memoryId ?? "");
      const content = typeof input.content === "string" ? input.content.trim() : "";
      if (!content) return { ok: false, error: "content required" };
      if (content.length > 500) return { ok: false, error: "content too long (max 500 chars)" };

      const memory = await prisma.userMemory.findFirst({
        where: { id: memoryId, userId: ctx.userId },
        select: { id: true },
      });
      if (!memory) return { ok: false, error: "memory not found" };
      const updated = await prisma.userMemory.update({
        where: { id: memory.id },
        data: { content },
      });
      console.log("[assistant] update_memory", { userId: ctx.userId, id: memory.id });
      return { ok: true, data: { id: updated.id, content: updated.content } };
    }
    case "propose_to_planner": {
      const postId = String(input.postId ?? "");
      const day = String(input.day ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return { ok: false, error: "day must be YYYY-MM-DD" };
      }
      const ALLOWED_HOURS = [12, 15, 18, 21];
      const hour =
        typeof input.hour === "number" && ALLOWED_HOURS.includes(input.hour)
          ? input.hour
          : null;
      const rawPlatforms = Array.isArray(input.platforms)
        ? (input.platforms as unknown[]).filter((p): p is string => typeof p === "string")
        : [];
      if (rawPlatforms.length === 0) {
        return { ok: false, error: "at least one platform required" };
      }
      const allowedPlatforms = new Set([
        "INSTAGRAM",
        "FACEBOOK_PAGE",
        "LINKEDIN",
        "TIKTOK",
        "YOUTUBE",
      ]);
      const platforms = rawPlatforms.filter((p) => allowedPlatforms.has(p));
      if (platforms.length === 0) {
        return { ok: false, error: "no valid platforms" };
      }

      // Compute the Asia/Jerusalem day window so we can surface posts already
      // scheduled on the proposed day. The assistant can use this to spread
      // proposals across hours; the UI card uses it to warn before approval.
      const { buildSlotDate } = await import("@/lib/planner/fixed-slots");
      const dayStartUTC = buildSlotDate(new Date(`${day}T00:00:00Z`), 0);
      const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);

      const [post, existingRecords] = await Promise.all([
        prisma.post.findFirst({
          where: { id: postId, userId: ctx.userId },
          select: {
            id: true,
            body: true,
            tags: true,
            originalDate: true,
            publishCount: true,
            lifecycle: true,
            postType: true,
            platformUrl: true,
            media: { select: { storageKey: true, mimeType: true, hasAudio: true } },
            rating: { select: { stars: true } },
          },
        }),
        prisma.publishRecord.findMany({
          where: {
            status: "PENDING",
            post: { userId: ctx.userId },
            scheduledAt: { gte: dayStartUTC, lt: dayEndUTC },
          },
          orderBy: { scheduledAt: "asc" },
          select: {
            id: true,
            scheduledAt: true,
            platform: true,
            post: {
              select: {
                id: true,
                body: true,
                postType: true,
                media: {
                  orderBy: { id: "asc" },
                  take: 1,
                  select: { storageKey: true, mimeType: true },
                },
              },
            },
          },
        }),
      ]);
      if (!post) return { ok: false, error: "post not found" };

      // Refuse to propose posts whose video has been stripped of audio — those
      // need a music attachment before they're shippable.
      const hasSilentVideo = post.media.some(
        (m) => m.mimeType.startsWith("video/") && m.hasAudio === false,
      );
      if (hasSilentVideo) {
        return {
          ok: false,
          error: "post has a silent video — attach music before scheduling",
        };
      }

      const { buildThumbUrl } = await import("@/lib/planner/thumbnail");
      const { formatInTimeZone } = await import("date-fns-tz");
      const { SCHEDULE_TZ } = await import("@/lib/planner/slot-constants");

      const firstMedia = post.media[0];
      const thumbUrl = buildThumbUrl(firstMedia?.storageKey, firstMedia?.mimeType);
      const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));

      const PLATFORM_DISPLAY_MAP: Record<string, string> = {
        FACEBOOK: "FACEBOOK_PAGE",
        FACEBOOK_PAGE: "FACEBOOK_PAGE",
        INSTAGRAM: "INSTAGRAM",
        LINKEDIN: "LINKEDIN",
        TIKTOK: "TIKTOK",
        YOUTUBE: "YOUTUBE",
      };

      const existingOnDay = existingRecords
        .filter((r) => r.post.id !== post.id)
        .map((r) => {
          const sched = r.scheduledAt!;
          const m = r.post.media[0];
          return {
            recordId: r.id,
            postId: r.post.id,
            hour: Number(formatInTimeZone(sched, SCHEDULE_TZ, "H")),
            scheduledAt: sched.toISOString(),
            body: r.post.body,
            thumbUrl: buildThumbUrl(m?.storageKey, m?.mimeType),
            platform: PLATFORM_DISPLAY_MAP[r.platform] ?? r.platform,
            postType: r.post.postType ?? "POST",
          };
        });

      const sameHourClash = hour != null && existingOnDay.some((e) => e.hour === hour);

      return {
        ok: true,
        data: {
          kind: "proposal",
          postId: post.id,
          day,
          hour,
          platforms,
          reasoning: typeof input.reasoning === "string" ? input.reasoning : null,
          existingOnDay,
          sameHourClash,
          post: {
            id: post.id,
            body: post.body,
            tags: post.tags,
            thumbUrl,
            hasVideo,
            mediaCount: post.media.length,
            lifecycle: post.lifecycle ?? "UNKNOWN",
            rating: post.rating?.stars ?? null,
            originalDate: post.originalDate.toISOString(),
            platformUrl: post.platformUrl ?? null,
            publishCount: post.publishCount,
            postType: post.postType ?? "POST",
          },
        },
      };
    }
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
