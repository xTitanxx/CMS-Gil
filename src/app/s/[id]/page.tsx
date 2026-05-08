import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicStory, pickOgImage } from "@/lib/public-posts";
import { getMediaUrl } from "@/lib/storage";
import { SingleStoryViewer } from "./SingleStoryViewer";
import { SubscriberHeader } from "@/components/SubscriberHeader";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const story = await getPublicStory(id);
  if (!story) return {};

  const dateLabel = formatDate(story.originalDate);
  const title = `Story from ${dateLabel}`;
  const description = `A story by Gil Alter from ${dateLabel}.`;

  const og = await pickOgImage(story.media);
  const url = `/s/${story.id}`;

  return {
    title,
    description,
    openGraph: {
      type: "article",
      url,
      title,
      description,
      siteName: "Gil Alter",
      publishedTime: story.originalDate.toISOString(),
      images: og
        ? [{ url: og.url, width: og.width, height: og.height, alt: og.alt }]
        : undefined,
    },
    twitter: {
      card: og ? "summary_large_image" : "summary",
      title,
      description,
      images: og ? [og.url] : undefined,
    },
    alternates: { canonical: url },
  };
}

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
      hasAudio: m.hasAudio,
      url: await getMediaUrl(m).catch(
        () => null
      ),
    }))
  );

  const storyForClient = {
    id: story.id,
    originalDate: story.originalDate.toISOString(),
    media: mediaWithUrls,
  };

  return (
    <>
      <SubscriberHeader />
      <SingleStoryViewer story={storyForClient} />
    </>
  );
}
