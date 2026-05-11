import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { auth } from "@/lib/auth";
import { importKey } from "@/lib/storage";

// FB exports arrive as .zip; the dropzone also accepts .json for a single
// already-extracted file but those go through /api/import/upload, not here.
// Some browsers tag a freshly-saved ZIP as octet-stream, so accept that too.
const ALLOWED_CONTENT_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
]);

// R2 single-PUT max. A 5 GB cap covers everything Meta produces in a single
// ZIP fragment; if someone tries to push a corrupt 50 GB file we reject it
// before we sign anything.
const MAX_PRESIGNED_BYTES = 5 * 1024 * 1024 * 1024;

// Importing a 4 GB ZIP from a phone over LTE can take real minutes. 30
// minutes is generous but harmless — the URL still binds to the bucket +
// key + content-type, so a leaked URL only lets you overwrite that one key.
const PRESIGN_TTL_SECONDS = 60 * 30;

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "cms-gil-media";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const key = importKey(session.user.id, filename);

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
    console.error("[api/import/presign] failed", {
      err: err instanceof Error ? err.message : err,
    });
    return NextResponse.json(
      { error: "Failed to mint upload URL" },
      { status: 500 }
    );
  }
}
