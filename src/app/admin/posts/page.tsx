import { PostsList } from "./PostsList";
import { PostsFeed } from "./PostsFeed";
import { StoriesReel } from "./StoriesReel";
import { ReelsFeed } from "./ReelsFeed";

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
  const contentParam = pick(sp, "content");
  const audioParam = pick(sp, "audio");
  const linkParam = pick(sp, "link") as "all" | "with" | "without" | undefined;
  const multiMediaParam = pick(sp, "multiMedia") as "all" | "2" | undefined;
  const taggedParam = pick(sp, "tagged") as "all" | "yes" | "no" | undefined;

  return (
    <PostsList
      initialSearch={pick(sp, "search") ?? ""}
      initialSort={pick(sp, "sort") ?? "originalDate_desc"}
      initialContent={contentParam}
      initialAudio={audioParam}
      initialLink={linkParam ?? "all"}
      initialMultiMedia={multiMediaParam ?? "all"}
      initialTagged={taggedParam ?? "all"}
      initialTags={tagsParam ? tagsParam.split(",").filter(Boolean) : []}
      initialKind={kindParam}
    />
  );
}
