import { notFound } from "next/navigation";
import { getPublicStory } from "@/lib/public-posts";
import { getSignedDownloadUrl } from "@/lib/storage";
import { SingleStoryViewer } from "./SingleStoryViewer";

export const dynamic = "force-dynamic";

export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const story = await getPublicStory(id);
  if (!story || story.media.length === 0) notFound();

  const mediaWithUrls = await Promise.all(
    story.media.map(async (m) => ({
      id: m.id,
      mimeType: m.mimeType,
      url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(
        () => null
      ),
    }))
  );

  const storyForClient = {
    id: story.id,
    originalDate: story.originalDate.toISOString(),
    media: mediaWithUrls,
  };

  return <SingleStoryViewer story={storyForClient} />;
}
