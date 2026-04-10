import { PostsList } from "./PostsList";
import { PostsFeed } from "./PostsFeed";

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

  if (view === "feed") {
    return <PostsFeed />;
  }

  const tagsParam = pick(sp, "tags");
  const audioParam = pick(sp, "audio") as
    | "all"
    | "audible"
    | "silent"
    | "hide-silent"
    | undefined;

  return (
    <PostsList
      initialSearch={pick(sp, "search") ?? ""}
      initialSort={pick(sp, "sort") ?? "originalDate_desc"}
      initialAudio={audioParam ?? "all"}
      initialTags={tagsParam ? tagsParam.split(",").filter(Boolean) : []}
    />
  );
}
