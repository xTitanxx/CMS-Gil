import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runImportJob } from "@/lib/import-worker";
import unzipper from "unzipper";
import { Readable } from "stream";

export const maxDuration = 300; // 5 min for Vercel Pro

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const job = await prisma.importJob.create({
    data: {
      userId,
      filename: file.name,
      source: "UPLOAD",
      status: "PENDING",
    },
  });

  // Process async (don't await — return job ID immediately)
  processUpload(job.id, userId, file).catch((err) => {
    console.error("Import error:", err);
    prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorLog: JSON.stringify([String(err)]),
        completedAt: new Date(),
      },
    });
  });

  return NextResponse.json({ jobId: job.id });
}

async function processUpload(
  jobId: string,
  userId: string,
  file: File
): Promise<void> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (file.name.endsWith(".zip")) {
    await processZip(jobId, userId, buffer);
  } else if (file.name.endsWith(".json")) {
    await runImportJob({
      jobId,
      userId,
      jsonContent: buffer.toString("utf-8"),
    });
  } else {
    throw new Error("Unsupported file type. Upload a .zip or .json file.");
  }
}

async function processZip(
  jobId: string,
  userId: string,
  buffer: Buffer
): Promise<void> {
  const directory = await unzipper.Open.buffer(buffer);
  const mediaFiles = new Map<string, Buffer>();
  let jsonContent: string | null = null;
  let jsonFilename = "facebook_export.json";

  // Extract all files from ZIP
  for (const entry of directory.files) {
    const entryBuffer = await entry.buffer();

    // Find the main Facebook posts JSON
    if (
      entry.path.match(/your_posts.*\.json$/i) &&
      !entry.path.includes("__MACOSX")
    ) {
      jsonContent = entryBuffer.toString("utf-8");
      jsonFilename = entry.path;
    } else if (
      entry.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|heic)$/i) &&
      !entry.path.includes("__MACOSX")
    ) {
      mediaFiles.set(entry.path, entryBuffer);
    }
  }

  if (!jsonContent) {
    throw new Error(
      "No your_posts*.json found in ZIP. Make sure you're uploading a Facebook data export."
    );
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: { filename: jsonFilename },
  });

  await runImportJob({ jobId, userId, jsonContent, mediaFiles });
}
