import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";
import { AudioLibrary } from "./AudioLibrary";

export const metadata = { title: "Audio Library" };

export default async function AudioLibraryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const tracks = await prisma.audioTrack.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  const withUrls = await Promise.all(
    tracks.map(async (t) => ({
      id: t.id,
      title: t.title,
      mimeType: t.mimeType,
      sizeBytes: t.sizeBytes,
      durationSec: t.durationSec,
      createdAt: t.createdAt.toISOString(),
      url: await getSignedDownloadUrl(t.storageKey).catch(() => null),
    })),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="hidden text-2xl font-bold text-gray-900 md:block">Audio Library</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Upload music tracks (e.g. from Suno) and overlay them onto silent videos in posts.
        </p>
      </div>
      <AudioLibrary initialTracks={withUrls} />
    </div>
  );
}
