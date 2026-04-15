import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeReadiness } from "@/lib/readiness";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function isBroken(storageKey: string, mimeType: string): Promise<boolean> {
  const publicId = storageKey.replace(/\.[^/.]+$/, "");
  const resourceType = mimeType.startsWith("video/") ? "video" : "image";
  const url = cloudinary.url(publicId, { resource_type: resourceType, type: "upload" });
  try {
    const res = await fetch(url, { method: "HEAD" });
    return !res.ok;
  } catch {
    return true;
  }
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const posts = await prisma.post.findMany({
    where: {
      OR: [{ readinessCheckedAt: null }, { readinessCheckedAt: { lt: since } }],
      NOT: { readiness: "ARCHIVED" },
    },
    include: { media: true },
    take: 200,
  });

  let updated = 0;
  for (const post of posts) {
    const brokenReasons: string[] = [];
    for (const m of post.media) {
      if (await isBroken(m.storageKey, m.mimeType)) {
        brokenReasons.push("broken-media");
        break;
      }
    }
    const carry = post.notReadyReasons.filter((r) => r === "dont-post");
    const notReadyReasons = [...carry, ...brokenReasons];
    const { readiness, reasons } = computeReadiness(
      {
        body: post.body,
        share: post.share,
        readiness: post.readiness,
        notReadyReasons,
      },
      post.media.map((m) => ({ mimeType: m.mimeType, hasAudio: m.hasAudio }))
    );
    await prisma.post.update({
      where: { id: post.id },
      data: { readiness, notReadyReasons: reasons, readinessCheckedAt: new Date() },
    });
    updated++;
  }
  return NextResponse.json({ updated });
}
