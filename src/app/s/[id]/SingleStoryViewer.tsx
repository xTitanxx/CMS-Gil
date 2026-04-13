"use client";

import { useRouter } from "next/navigation";
import { StoryViewer } from "../../StoryViewer";
import type { Story } from "../../StoriesRow";

export function SingleStoryViewer({ story }: { story: Story }) {
  const router = useRouter();
  return (
    <StoryViewer
      stories={[story]}
      startIndex={0}
      onClose={() => router.push("/")}
    />
  );
}
