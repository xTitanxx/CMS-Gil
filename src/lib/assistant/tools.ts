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
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
