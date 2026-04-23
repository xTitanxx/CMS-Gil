import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import type { Platform as PrismaPlatform } from "@prisma/client";
import { recommend } from "./recommend";
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

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "recommend_posts",
    description:
      "Returns ranked posts to publish based on ratings, lifecycle, freshness, and variety.",
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
        limit: { type: "number", description: "Default 10, max 20." },
      },
    },
  },
  {
    name: "search_archive",
    description: "Searches the archive by tag + keyword. Use for 'find a post about X'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
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
        limit: typeof input.limit === "number" ? Math.min(20, input.limit) : undefined,
      });
      return { ok: true, data };
    }
    case "search_archive": {
      const data = await retrieve({
        userId: ctx.userId,
        query: String(input.query ?? ""),
        limit: typeof input.limit === "number" ? Math.min(50, input.limit) : undefined,
        lifecycle: input.lifecycle as never,
        season: input.season as never,
        contentKind: input.contentKind as never,
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
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
