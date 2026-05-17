"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { SortMenu, type SortOption } from "@/app/admin/posts/PostFilterUI";
import { GenericFilterMenu, type FilterGroup } from "./GenericFilterMenu";

export interface PostingFilterDef<T> {
  /** Stable id used in the filter menu and for change tracking. */
  id: string;
  /** Section heading shown in the filter menu. */
  title: string;
  /** Possible values. */
  options: { value: string; label: string }[];
  /** Map an item to the value(s) it belongs to. Items match the filter if
   *  ANY of their values are in the active selection set. */
  valueFor: (item: T) => string | string[];
}

export interface PostingSortDef<T> extends SortOption {
  /** Comparator: negative → a before b. */
  compare: (a: T, b: T) => number;
}

interface PostingListViewProps<T> {
  title: string;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  /** Optional row of banners/CTAs rendered above the toolbar. */
  beforeToolbar?: ReactNode;
  /** Optional row rendered between the toolbar and the list (e.g. bulk action bar). */
  beforeList?: ReactNode;

  items: T[];
  loading?: boolean;
  /** Manual refresh handler (renders a refresh button next to filter when set). */
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;

  /** Used by the search input as a placeholder ("Search {plural}…") and by
   *  the end-of-list counter. */
  itemNoun?: { singular: string; plural: string };

  /** Strings to match against when the search input has a value. */
  searchKeys: (item: T) => string[];
  sortOptions: PostingSortDef<T>[];
  /** Optional filter groups. Each group narrows the list independently (AND
   *  across groups, OR within a group, matching FilterMenu's semantics). */
  filters?: PostingFilterDef<T>[];

  getId: (item: T) => string;
  renderRow: (item: T, index: number) => ReactNode;
  emptyState?: ReactNode;
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

export function PostingListView<T>(props: PostingListViewProps<T>) {
  const {
    title,
    subtitle,
    headerActions,
    beforeToolbar,
    beforeList,
    items,
    loading,
    onRefresh,
    refreshing,
    itemNoun,
    searchKeys,
    sortOptions,
    filters,
    getId,
    renderRow,
    emptyState,
  } = props;

  const noun = itemNoun ?? { singular: "item", plural: "items" };

  const [search, setSearch] = useState("");
  const defaultSort = sortOptions[0]?.value ?? "default";
  const [sort, setSort] = useState(defaultSort);

  // One state slot per filter group, initialised to "all selected" (= no filter).
  const [filterState, setFilterState] = useState<Record<string, Set<string>>>(
    () => {
      const init: Record<string, Set<string>> = {};
      for (const f of filters ?? []) {
        init[f.id] = new Set(f.options.map((o) => o.value));
      }
      return init;
    },
  );

  const resetFilters = useCallback(() => {
    const next: Record<string, Set<string>> = {};
    for (const f of filters ?? []) {
      next[f.id] = new Set(f.options.map((o) => o.value));
    }
    setFilterState(next);
  }, [filters]);

  const filterGroups: FilterGroup[] = useMemo(
    () =>
      (filters ?? []).map((f) => ({
        id: f.id,
        title: f.title,
        options: f.options,
        selected: filterState[f.id] ?? new Set(f.options.map((o) => o.value)),
        onChange: (next: Set<string>) =>
          setFilterState((prev) => ({ ...prev, [f.id]: next })),
      })),
    [filters, filterState],
  );

  const filtered = useMemo(() => {
    const needle = normalize(search);
    const out: T[] = [];
    for (const item of items) {
      // Filter groups
      let keep = true;
      for (const f of filters ?? []) {
        const selected = filterState[f.id];
        if (!selected || selected.size === f.options.length) continue; // "any"
        const raw = f.valueFor(item);
        const vals = Array.isArray(raw) ? raw : [raw];
        if (!vals.some((v) => selected.has(v))) {
          keep = false;
          break;
        }
      }
      if (!keep) continue;

      // Search
      if (needle) {
        const keys = searchKeys(item).map(normalize);
        if (!keys.some((k) => k.includes(needle))) continue;
      }

      out.push(item);
    }

    const sorter = sortOptions.find((s) => s.value === sort);
    if (sorter) {
      out.sort(sorter.compare);
    }
    return out;
  }, [items, filters, filterState, search, searchKeys, sort, sortOptions]);

  const countLabel =
    filtered.length < items.length
      ? `${filtered.length.toLocaleString()} of ${items.length.toLocaleString()} ${noun.plural}`
      : `${items.length.toLocaleString()} ${noun.plural}`;

  const computedSubtitle = subtitle ?? countLabel;

  return (
    <div className="space-y-3 md:space-y-4">
      <PageHeader title={title} subtitle={computedSubtitle} actions={headerActions} />

      {beforeToolbar}

      {/* Search + sort + filter row, mirroring PostListShell's chrome. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={`Search ${noun.plural}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-full border border-gray-200 bg-white pl-10 pr-3 text-base placeholder:text-gray-400 focus:border-gray-400 focus:outline-none md:h-9 md:text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:gap-1.5">
          <SortMenu sort={sort} setSort={setSort} options={sortOptions} />
          {filters && filters.length > 0 && (
            <GenericFilterMenu groups={filterGroups} onReset={resetFilters} />
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 md:h-9 md:w-9"
              aria-label="Refresh"
              title="Refresh"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {beforeList}

      {loading && items.length === 0 ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        emptyState ?? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-500">
            No {noun.plural} match.
          </div>
        )
      ) : (
        <div className="space-y-2">
          {filtered.map((item, index) => (
            <div key={getId(item)}>{renderRow(item, index)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
