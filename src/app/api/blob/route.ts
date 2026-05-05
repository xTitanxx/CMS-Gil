import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: [
            "application/zip",
            "application/x-zip-compressed",
            "application/json",
            "application/octet-stream",
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
            "image/heic",
            "image/heif",
            "video/mp4",
            "video/quicktime",
          ],
          maximumSizeInBytes: 500 * 1024 * 1024, // 500 MB
        };
      },
      onUploadCompleted: async () => {
        // Processing is triggered separately by the client
      },
    });

    return Response.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
