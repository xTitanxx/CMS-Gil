import { prisma } from "@/lib/prisma";

async function main() {
  const p = prisma;
  const userId = "cmnala41x000004lgj4riwp83";
  const posts = await p.post.findMany({
    where: { userId, body: { not: "" } },
    select: { id: true, body: true, tags: true, originalDate: true, readiness: true },
  });
  const withBody = posts.filter((x) => x.body && x.body.trim().length >= 30);
  const ready = withBody.filter((x) => x.readiness !== "ARCHIVED");
  const lengths = ready.map((x) => x.body!.length);
  lengths.sort((a, b) => a - b);
  const sum = lengths.reduce((a, b) => a + b, 0);
  const sumTags = ready.reduce((a, x) => a + x.tags.length, 0);
  console.log({
    total: posts.length,
    withBody30plus: withBody.length,
    notArchived: ready.length,
    avgChars: Math.round(sum / lengths.length),
    p50: lengths[Math.floor(lengths.length * 0.5)],
    p95: lengths[Math.floor(lengths.length * 0.95)],
    p99: lengths[Math.floor(lengths.length * 0.99)],
    max: lengths[lengths.length - 1],
    sumKChars: Math.round(sum / 1000),
    estTokensAtBody: Math.round(sum / 4),
    avgTags: Math.round(sumTags / ready.length),
  });
  for (const cap of [400, 500, 600, 800, 1000]) {
    let total = 0;
    for (const x of ready) total += Math.min(x.body!.length, cap);
    const tagsChars = ready.reduce((a, x) => a + x.tags.slice(0, 5).join(", ").length + 30, 0);
    const bodiesK = Math.round(total / 1000);
    const tokens = Math.round((total + tagsChars) / 4);
    const truncated = ready.filter((x) => x.body!.length > cap).length;
    console.log({ cap, bodiesK, tokensApprox: tokens, postsTruncated: truncated, pctTruncated: Math.round((truncated / ready.length) * 100) });
  }
  await p.$disconnect();
}

main();
