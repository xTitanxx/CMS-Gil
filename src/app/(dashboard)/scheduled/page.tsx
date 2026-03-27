"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock } from "lucide-react";

interface ScheduledRecord {
  id: string;
  platform: string;
  status: string;
  scheduledAt: string;
  post: {
    id: string;
    body: string;
  };
}

export default function ScheduledPage() {
  const [records, setRecords] = useState<ScheduledRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/posts?limit=100")
      .then((r) => r.json())
      .then((data) => {
        const scheduled: ScheduledRecord[] = [];
        for (const post of data.posts ?? []) {
          for (const pub of post.publishes ?? []) {
            if (pub.scheduledAt && pub.status === "PENDING") {
              scheduled.push({ ...pub, post: { id: post.id, body: post.body } });
            }
          }
        }
        scheduled.sort(
          (a, b) =>
            new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        );
        setRecords(scheduled);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Scheduled Posts</h1>
        <p className="text-sm text-gray-500">
          Posts queued for future publishing
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
          <Calendar className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-gray-500">No scheduled posts.</p>
          <Link href="/posts" className="mt-2 block text-sm text-blue-600 hover:underline">
            Go to posts to schedule one
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((rec) => (
            <div
              key={rec.id}
              className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex-shrink-0 rounded-lg bg-blue-50 p-2">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="default">{rec.platform}</Badge>
                  <span className="text-sm font-medium text-gray-900">
                    {format(new Date(rec.scheduledAt), "MMM d, yyyy · h:mm a")}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                  {rec.post.body}
                </p>
              </div>
              <Link href={`/posts/${rec.post.id}`}>
                <Button variant="ghost" size="sm">
                  View
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
