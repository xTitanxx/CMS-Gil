import Link from "next/link";
import { format } from "date-fns";
import { listReviewBatches } from "@/lib/trash-review";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ReviewIndex() {
  const batches = await listReviewBatches();

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Dedupe review
          </h1>
          <p className="text-sm text-gray-500">
            AI-flagged duplicate candidates awaiting your approval. Nothing is
            deleted until you approve + finalize.
          </p>
        </div>
        <Link
          href="/admin/trash"
          className="text-sm text-blue-600 hover:underline"
        >
          ← back to trash
        </Link>
      </div>

      {batches.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-500">
          <p>No review batches.</p>
          <p className="mt-1 text-xs text-gray-400">
            Run{" "}
            <code>
              scripts/ai-dedupe-from-log.ts &lt;log&gt;
            </code>{" "}
            or{" "}
            <code>scripts/ai-dedupe.ts --review</code>{" "}
            to populate this page.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map((b) => (
            <Link
              key={b.dir}
              href={`/admin/trash/review/${encodeURIComponent(b.dir)}`}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-900">
                    {format(new Date(b.createdAt), "MMM d, yyyy HH:mm")}
                  </h2>
                  <Badge variant="outline" className="text-xs">
                    conf ≥ {b.confidenceThreshold}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  source: {b.source}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3 text-xs text-gray-500">
                <span>{b.groupCount} groups</span>
                <span>·</span>
                <span>{b.pendingDropCount} pending</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
