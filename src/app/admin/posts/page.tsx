import { AllPostsView } from "./AllPostsView";
import { PostsFeed } from "./PostsFeed";
import { StoriesReel } from "./StoriesReel";
import { ReelsFeed } from "./ReelsFeed";

export const metadata = { title: "All Posts" };

type SearchParams = { [key: string]: string | string[] | undefined };

function pick(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const view = pick(sp, "view") === "feed" ? "feed" : "list";
  const kindRaw = pick(sp, "kind");
  const kindParam: "posts" | "stories" | "reels" =
    kindRaw === "stories" ? "stories" : kindRaw === "reels" ? "reels" : "posts";

  if (view === "feed" && kindParam === "stories") {
    return <StoriesReel />;
  }

  if (view === "feed" && kindParam === "reels") {
    return <ReelsFeed />;
  }

  if (view === "feed") {
    return <PostsFeed />;
  }

  const tagsParam = pick(sp, "tags");

  return (
    <AllPostsView
      initialSearch={pick(sp, "search") ?? ""}
      initialSort={pick(sp, "sort") ?? "originalDate_desc"}
      initialContent={pick(sp, "content")}
      initialAudio={pick(sp, "audio")}
      initialLink={pick(sp, "link")}
      initialMultiMedia={pick(sp, "multiMedia")}
      initialTagged={pick(sp, "tagged")}
      initialShare={pick(sp, "share")}
      initialQuality={pick(sp, "quality")}
      initialTags={tagsParam ? tagsParam.split(",").filter(Boolean) : []}
      initialKind={kindParam}
    />
  );
}
