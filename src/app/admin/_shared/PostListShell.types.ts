import type { ReactNode } from "react";
import type {
  ContentCategory,
  AudioCategory,
} from "@/lib/posts-query";
import type {
  LinkValue,
  MultiMediaValue,
  TaggedValue,
  ShareValue,
  QualityValue,
  CaptionQualityValue,
  EnrichedValue,
} from "@/app/admin/posts/PostFilterUI";

export type KindFilter = "posts" | "stories";

export interface SharedFilterState {
  search: string;
  sort: string;
  aiTags: string[];
  content: Set<ContentCategory>;
  audio: Set<AudioCategory>;
  link: Set<LinkValue>;
  multiMedia: Set<MultiMediaValue>;
  tagged: Set<TaggedValue>;
  share: Set<ShareValue>;
  quality: Set<QualityValue>;
  captionQuality: Set<CaptionQualityValue>;
  enriched: Set<EnrichedValue>;
  kind: KindFilter;
  subKind: string;
}

export interface ListApiResponse<TPost> {
  posts: TPost[];
  total?: number;
  filteredTotal?: number;
  kindCounts?: { posts: number; stories: number };
  subKindCounts?: Record<string, number>;
  subKindTotals?: Record<string, number>;
  nextCursor: string | null;
}

export interface PostListShellProps<TPost> {
  apiEndpoint: string;
  extraParams?: Record<string, string | undefined>;
  title: string;
  itemNoun?: { singular: string; plural: string };
  headerActions?: ReactNode;
  beforeList?: ReactNode;
  bulkBar?: ReactNode;
  emptyState?: ReactNode;
  renderRow: (post: TPost, index: number) => ReactNode;
  hideKindTabs?: boolean;
  showSelectAll?: boolean;
  onSelectAllToggle?: (selectAll: boolean, visiblePosts: TPost[]) => void;
  allSelected?: boolean;
  onPostsChanged?: (posts: TPost[]) => void;
  getPostId: (post: TPost) => string;
}
