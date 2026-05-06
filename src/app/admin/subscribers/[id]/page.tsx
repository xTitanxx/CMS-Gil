import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl } from "@/lib/storage";
import { SubscriberDetailHeader } from "./SubscriberDetailHeader";
import { SubscriberCommentRow } from "./SubscriberCommentRow";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(date: Date): string {
  return date.toLocaleString();
}

export default async function SubscriberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "admin") redirect("/login");

  const { id } = await params;

  const [subscriber, bookmarks, comments, usageRows, usageTotal] = await Promise.all([
    prisma.subscriber.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        displayName: true,
        monthlyBudgetUsd: true,
        cycleStart: true,
        cycleUsedUsd: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true,
        commentsDisabledAt: true,
      },
    }),
    prisma.postBookmark.findMany({
      where: { subscriberId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        post: {
          select: {
            id: true,
            body: true,
            originalDate: true,
            media: {
              take: 1,
              select: { id: true, storageKey: true, mimeType: true, altText: true },
            },
          },
        },
      },
    }),
    prisma.postComment.findMany({
      where: { subscriberId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        body: true,
        status: true,
        createdAt: true,
        editedAt: true,
        deletedAt: true,
        post: { select: { id: true, body: true } },
      },
    }),
    prisma.subscriberUsage.findMany({
      where: { subscriberId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        inputTokens: true,
        cacheCreationInputTokens: true,
        cacheReadInputTokens: true,
        outputTokens: true,
        costUsd: true,
      },
    }),
    prisma.subscriberUsage.aggregate({
      where: { subscriberId: id },
      _count: { _all: true },
      _sum: { costUsd: true },
    }),
  ]);

  if (!subscriber) notFound();

  const monthlyBudgetUsd = Number(subscriber.monthlyBudgetUsd);
  const cycleUsedUsd = Number(subscriber.cycleUsedUsd);
  const pct =
    monthlyBudgetUsd > 0
      ? Math.min(100, Math.round((cycleUsedUsd / monthlyBudgetUsd) * 100))
      : 100;

  const bookmarkItems = await Promise.all(
    bookmarks.map(async (b) => ({
      id: b.id,
      bookmarkedAt: b.createdAt,
      post: {
        id: b.post.id,
        body: b.post.body,
        originalDate: b.post.originalDate,
        firstMediaUrl: b.post.media[0]
          ? await getMediaUrl(b.post.media[0]).catch(() => null)
          : null,
        firstMediaMime: b.post.media[0]?.mimeType ?? null,
      },
    }))
  );

  const lifetimeSpend = Number(usageTotal._sum.costUsd ?? 0);
  const lifetimeTurns = usageTotal._count._all;

  return (
    <div className="px-6 py-8">
      <div className="mb-4">
        <Link
          href="/admin/subscribers"
          className="text-sm text-blue-600 hover:underline"
        >
          ← All subscribers
        </Link>
      </div>

      <SubscriberDetailHeader
        subscriber={{
          id: subscriber.id,
          name: subscriber.name,
          email: subscriber.email,
          displayName: subscriber.displayName,
          monthlyBudgetUsd,
          cycleUsedUsd,
          cycleStart: subscriber.cycleStart.toISOString(),
          createdAt: subscriber.createdAt.toISOString(),
          lastSeenAt: subscriber.lastSeenAt?.toISOString() ?? null,
          revokedAt: subscriber.revokedAt?.toISOString() ?? null,
          commentsDisabledAt: subscriber.commentsDisabledAt?.toISOString() ?? null,
        }}
        pct={pct}
        lifetimeSpend={lifetimeSpend}
        lifetimeTurns={lifetimeTurns}
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Bookmarks ({bookmarkItems.length})
            </h2>
          </div>
          {bookmarkItems.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-gray-500">
              No bookmarks yet.
            </p>
          ) : (
            <ul className="max-h-[500px] divide-y divide-gray-100 overflow-y-auto">
              {bookmarkItems.map(({ id: bookmarkId, post, bookmarkedAt }) => (
                <li key={bookmarkId}>
                  <Link
                    href={`/p/${post.id}`}
                    target="_blank"
                    className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50"
                  >
                    {post.firstMediaUrl &&
                    post.firstMediaMime?.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.firstMediaUrl}
                        alt=""
                        className="h-12 w-12 flex-shrink-0 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">
                        {post.firstMediaMime?.startsWith("video/") ? "▶" : "—"}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500">
                        Saved {formatDate(bookmarkedAt)} · Posted{" "}
                        {formatDate(post.originalDate)}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-gray-800">
                        {post.body}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Comments ({comments.length})
            </h2>
          </div>
          {comments.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-gray-500">
              No comments yet.
            </p>
          ) : (
            <ul className="max-h-[500px] divide-y divide-gray-100 overflow-y-auto">
              {comments.map((c) => (
                <SubscriberCommentRow
                  key={c.id}
                  comment={{
                    id: c.id,
                    body: c.body,
                    status: c.status,
                    createdAt: c.createdAt.toISOString(),
                    editedAt: c.editedAt?.toISOString() ?? null,
                    postId: c.post.id,
                    postBodyExcerpt: c.post.body.slice(0, 120),
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-8 rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Usage — recent {usageRows.length} turn{usageRows.length === 1 ? "" : "s"}
          </h2>
          <p className="text-xs text-gray-500">
            Lifetime: {lifetimeTurns} turn{lifetimeTurns === 1 ? "" : "s"}, $
            {lifetimeSpend.toFixed(4)} total. Each row is one Claude API call.
          </p>
        </div>
        {usageRows.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-gray-500">
            No chat activity yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="py-2 font-medium">Cost</th>
                  <th className="py-2 font-medium">Input</th>
                  <th className="py-2 font-medium">Cache create</th>
                  <th className="py-2 font-medium">Cache read</th>
                  <th className="px-5 py-2 font-medium">Output</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {usageRows.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-2 text-gray-700">
                      {formatDateTime(u.createdAt)}
                    </td>
                    <td className="py-2 font-mono text-gray-800">
                      ${Number(u.costUsd).toFixed(6)}
                    </td>
                    <td className="py-2 font-mono text-gray-700">
                      {u.inputTokens.toLocaleString()}
                    </td>
                    <td className="py-2 font-mono text-gray-700">
                      {u.cacheCreationInputTokens.toLocaleString()}
                    </td>
                    <td className="py-2 font-mono text-gray-700">
                      {u.cacheReadInputTokens.toLocaleString()}
                    </td>
                    <td className="px-5 py-2 font-mono text-gray-700">
                      {u.outputTokens.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
