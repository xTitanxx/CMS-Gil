import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadBuffer, audioKey, getSignedDownloadUrl } from "@/lib/storage";
import { del } from "@vercel/blob";

const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
]);

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tracks = await prisma.audioTrack.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  const withUrls = await Promise.all(
    tracks.map(async (t) => ({
      id: t.id,
      title: t.title,
      mimeType: t.mimeType,
      durationSec: t.durationSec,
      sizeBytes: t.sizeBytes,
      createdAt: t.createdAt,
      url: await getSignedDownloadUrl(t.storageKey).catch(() => null),
    })),
  );

  return NextResponse.json(withUrls);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let buffer: Buffer;
  let filename: string;
  let mimeType: string;
  let title: string;

  if (contentType.includes("application/json")) {
    const body = await req.json();
    filename = body.filename as string;
    mimeType = (body.mimeType as string) || "audio/mpeg";
    title = (body.title as string) || filename.replace(/\.[^/.]+$/, "");
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }
    const blobUrl = body.blobUrl as string;
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch blob" }, { status: 500 });
    }
    buffer = Buffer.from(await response.arrayBuffer());
    await del(blobUrl).catch(() => {});
  } else {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    filename = file.name;
    mimeType = file.type || "audio/mpeg";
    title = (formData.get("title") as string | null) || filename.replace(/\.[^/.]+$/, "");
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }
    buffer = Buffer.from(await file.arrayBuffer());
  }

  const key = audioKey(session.user.id, filename);
  const { url: storageKey } = await uploadBuffer(key, buffer, { contentType: mimeType });

  const track = await prisma.audioTrack.create({
    data: {
      userId: session.user.id,
      title,
      storageKey,
      mimeType,
      sizeBytes: buffer.length,
    },
  });

  const url = await getSignedDownloadUrl(storageKey).catch(() => null);

  return NextResponse.json(
    {
      id: track.id,
      title: track.title,
      mimeType: track.mimeType,
      sizeBytes: track.sizeBytes,
      durationSec: track.durationSec,
      createdAt: track.createdAt,
      url,
    },
    { status: 201 },
  );
}
