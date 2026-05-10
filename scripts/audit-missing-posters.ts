import { prisma } from "../src/lib/prisma";

async function head(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.status;
  } catch {
    return -1;
  }
}

async function pool<T, R>(
  items: T[],
  size: number,
  fn: (t: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

(async () => {
  const videos = await prisma.media.findMany({
    where: { mimeType: { startsWith: "video/" } },
    select: { id: true, storageKey: true, postId: true },
  });
  console.log(`Found ${videos.length} video media rows`);

  const checked = await pool(videos, 16, async (m) => {
    const posterUrl = m.storageKey.replace(/\.[^/.]+$/, ".poster.jpg");
    const status = await head(posterUrl);
    return { ...m, posterUrl, status };
  });

  const missing = checked.filter((c) => c.status !== 200);
  const ok = checked.filter((c) => c.status === 200);
  console.log(`OK posters: ${ok.length}`);
  console.log(`Missing posters (status != 200): ${missing.length}`);

  const byStatus = new Map<number, number>();
  for (const c of missing) {
    byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
  }
  console.log("By status:", Object.fromEntries(byStatus));

  const sample = missing.slice(0, 5);
  for (const s of sample) {
    console.log(`  postId=${s.postId} mediaId=${s.id} status=${s.status}`);
    console.log(`    video=${s.storageKey}`);
    console.log(`    poster=${s.posterUrl}`);
  }

  await prisma.$disconnect();
})();
