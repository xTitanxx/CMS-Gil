import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  uploadBuffer,
  audioKey,
  getSignedDownloadUrl,
  getObject,
  deleteObject,
  r2UrlForKey,
} from "@/lib/storage";
import { detectMimeType } from "@/lib/magic-byte";

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
  let title: string;
  let storageKey: string;
  let alreadyInR2 = false;
  let presignedKey = "";

  if (contentType.includes("application/json")) {
    // Large file: client PUT directly to R2 via /api/audio/presign. We get
    // the key back and fetch the object for the same magic-byte sniff a
    // direct POST would get.
    const body = await req.json();
    filename = (body.filename as string) ?? "";
    title = (body.title as string) || filename.replace(/\.[^/.]+$/, "");
    const key = typeof body.key === "string" ? body.key : "";

    // Lock the key to this user's audio prefix. Without this, the JSON body
    // could point at any object in R2 (another user's audio, someone's
    // media file, the import staging area) and we'd happily wire it into
    // this user's AudioTrack row.
    const userPrefix = `audio/${session.user.id}/`;
    if (!key.startsWith(userPrefix)) {
      return NextResponse.json({ error: "Invalid storage key" }, { status: 400 });
    }

    presignedKey = key;
    alreadyInR2 = true;
    try {
      buffer = await getObject(r2UrlForKey(key));
    } catch (err) {
      console.error("[api/audio] failed to fetch presigned object", err);
      return NextResponse.json(
        { error: "Failed to fetch uploaded file" },
        { status: 500 }
      );
    }
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
    // If the client already pushed the file to R2, delete the orphan now
    // or it leaks. deleteObject swallows its own errors.
    if (alreadyInR2) {
      await deleteObject(r2UrlForKey(presignedKey));
    }
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  const mimeType = detected;

  if (alreadyInR2) {
    storageKey = r2UrlForKey(presignedKey);
  } else {
    const key = audioKey(session.user.id, filename);
    const uploaded = await uploadBuffer(key, buffer, { contentType: mimeType });
    storageKey = uploaded.url;
  }

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
