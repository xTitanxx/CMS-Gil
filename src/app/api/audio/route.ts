import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadBuffer, audioKey, getSignedDownloadUrl } from "@/lib/storage";
import { isOurBlobUrl } from "@/lib/url-allowlist";
import { detectMimeType } from "@/lib/magic-byte";
import { del } from "@vercel/blob";

// Detected types (after magic-byte sniff) we'll accept. The client may have
// asserted "audio/mp3" or "audio/x-wav"; the magic-byte detector normalizes
// to canonical names so we don't need to enumerate aliases here.
const ALLOWED_DETECTED = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
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
    title = (body.title as string) || filename.replace(/\.[^/.]+$/, "");
    const blobUrl = body.blobUrl as string;
    if (!isOurBlobUrl(blobUrl)) {
      return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
    }
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
    title = (formData.get("title") as string | null) || filename.replace(/\.[^/.]+$/, "");
    buffer = Buffer.from(await file.arrayBuffer());
  }

  // Sniff the actual content; ignore the client-asserted Content-Type and
  // filename extension (both spoofable). The detected type is what we record
  // and what R2 will serve back.
  const detected = detectMimeType(buffer);
  if (!detected || !ALLOWED_DETECTED.has(detected)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  mimeType = detected;

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
