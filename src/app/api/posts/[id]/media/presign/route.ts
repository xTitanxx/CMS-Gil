import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mediaKey } from "@/lib/storage";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

// R2 single-PUT ceiling is 5 GB. The composer already restricts MIME via
// dropzone and any phone-captured video lands well under this; reject earlier
// here so a malicious client can't ask us to sign a 50 GB PUT.
const MAX_PRESIGNED_BYTES = 5 * 1024 * 1024 * 1024;

const PRESIGN_TTL_SECONDS = 60 * 10; // 10 min — enough for a slow phone upload

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

  const { id: postId } = await params;

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: session.user.id },
    select: { id: true },
  });
  if (!post) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  // Bind the content-type into the presigned URL: the browser MUST send the
  // matching Content-Type header on its PUT, otherwise R2 rejects the request.
  // This prevents a client from swapping in a disallowed type post-signing.
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
    console.error("[api/posts/[id]/media/presign] failed", {
      postId,
      err: err instanceof Error ? err.message : err,
    });
    return NextResponse.json(
      { error: "Failed to mint upload URL" },
      { status: 500 }
    );
  }
}
