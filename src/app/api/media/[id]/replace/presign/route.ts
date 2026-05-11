import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mediaKey } from "@/lib/storage";

// MediaReplaceDrop only swaps videos today; mirror its dropzone allowlist.
// Expand here (and in /replace's post-upload sniff) if image replace ever
// becomes a feature.
const ALLOWED_CONTENT_TYPES = new Set(["video/mp4", "video/quicktime"]);

const MAX_PRESIGNED_BYTES = 5 * 1024 * 1024 * 1024;
const PRESIGN_TTL_SECONDS = 60 * 10;

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "cms-gil-media";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: mediaId } = await params;

  // Same ownership check as POST /replace itself — without this, a presign
  // URL could be obtained for someone else's media.
  const existing = await prisma.media.findUnique({
    where: { id: mediaId },
    include: { post: { select: { userId: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.post.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { filename?: unknown; contentType?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const filename = typeof body.filename === "string" ? body.filename : "";
  const contentType =
    typeof body.contentType === "string" ? body.contentType : "";
  const size = typeof body.size === "number" ? body.size : 0;

  if (!filename || !contentType) {
    return NextResponse.json(
      { error: "filename and contentType are required" },
      { status: 400 }
    );
  }

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: `Unsupported content type: ${contentType}` },
      { status: 400 }
    );
  }

  if (size > MAX_PRESIGNED_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 5 GB per upload)" },
      { status: 400 }
    );
  }

  const key = mediaKey(session.user.id, filename);

  try {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS }
    );

    return NextResponse.json({ url, key });
  } catch (err) {
    console.error("[api/media/[id]/replace/presign] failed", {
      mediaId,
      err: err instanceof Error ? err.message : err,
    });
    return NextResponse.json(
      { error: "Failed to mint upload URL" },
      { status: 500 }
    );
  }
}
