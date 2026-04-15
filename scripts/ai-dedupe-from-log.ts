/**
 * Convert an ai-dedupe.ts run log into a review batch.
 *
 * Parses DUP verdicts from the log, forms groups via union-find, queries the
 * DB for each post's body/date/first-media info, and writes a review batch
 * at ./trash-review/<stamp>-rule-AI/candidates.json. Nothing is deleted.
 *
 * Usage:
 *   node --env-file=.env.local node_modules/.bin/tsx \
 *     scripts/ai-dedupe-from-log.ts <log-path> [--confidence=0.85]
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";

const args = process.argv.slice(2);
const logPath = args.find((a) => !a.startsWith("--"));
if (!logPath) {
  console.error("Usage: ... <log-path> [--confidence=0.85]");
  process.exit(1);
}
const getArg = (name: string, def: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const CONFIDENCE = Number(getArg("confidence", "0.85"));

const REVIEW_ROOT = path.join(process.cwd(), "trash-review");

interface Verdict {
  a: string;
  b: string;
  confidence: number;
  reason: string;
}

function parseLog(text: string): Verdict[] {
  const out: Verdict[] = [];
  const re =
    /\[\d+\/\d+\]\s+(c[a-z0-9]{24})\s+vs\s+(c[a-z0-9]{24})\s+…\s+DUP\s+conf=([\d.]+)\s+(.+?)$/;
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (!m) continue;
    const confidence = Number(m[3]);
    if (isNaN(confidence) || confidence < CONFIDENCE) continue;
    out.push({ a: m[1], b: m[2], confidence, reason: m[4].trim() });
  }
  return out;
}

class UF {
  parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let p = this.parent.get(x)!;
    while (p !== this.parent.get(p)) p = this.parent.get(p)!;
    this.parent.set(x, p);
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

async function main() {
  const text = await fs.readFile(logPath!, "utf8");
  const verdicts = parseLog(text);
  console.log(`Parsed ${verdicts.length} DUP verdicts at conf≥${CONFIDENCE}.`);

  const uf = new UF();
  for (const v of verdicts) uf.union(v.a, v.b);

  const idsByRoot = new Map<string, Set<string>>();
  for (const v of verdicts) {
    for (const id of [v.a, v.b]) {
      const r = uf.find(id);
      if (!idsByRoot.has(r)) idsByRoot.set(r, new Set());
      idsByRoot.get(r)!.add(id);
    }
  }

  const allIds = [...new Set(verdicts.flatMap((v) => [v.a, v.b]))];
  console.log(`Unique post IDs: ${allIds.length}, groups: ${idsByRoot.size}`);

  const posts = await prisma.post.findMany({
    where: { id: { in: allIds } },
    include: { media: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const byId = new Map(posts.map((p) => [p.id, p]));

  type GroupJson = {
    id: string;
    keep: {
      id: string;
      body: string;
      originalDate: string;
      storageKey: string | null;
      mimeType: string | null;
    };
    drops: Array<{
      id: string;
      body: string;
      originalDate: string;
      storageKey: string | null;
      mimeType: string | null;
      confidence: number;
      reason: string;
      decision: "pending" | "approve" | "reject";
    }>;
  };

  const groups: GroupJson[] = [];
  let groupIdx = 0;

  for (const [, idSet] of idsByRoot) {
    const rows = [...idSet]
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null)
      .sort((x, y) => {
        const dt = x.createdAt.getTime() - y.createdAt.getTime();
        return dt !== 0 ? dt : x.id.localeCompare(y.id);
      });
    if (rows.length < 2) continue;
    const [keep, ...drops] = rows;

    const verdictsForGroup = new Map<string, { conf: number; reason: string }>();
    for (const v of verdicts) {
      if (!idSet.has(v.a) || !idSet.has(v.b)) continue;
      for (const dropId of [v.a, v.b]) {
        if (dropId === keep.id) continue;
        const existing = verdictsForGroup.get(dropId);
        if (!existing || v.confidence > existing.conf) {
          verdictsForGroup.set(dropId, { conf: v.confidence, reason: v.reason });
        }
      }
    }

    groups.push({
      id: `g${String(++groupIdx).padStart(4, "0")}`,
      keep: {
        id: keep.id,
        body: keep.body,
        originalDate: keep.originalDate.toISOString(),
        storageKey: keep.media[0]?.storageKey ?? null,
        mimeType: keep.media[0]?.mimeType ?? null,
      },
      drops: drops.map((d) => ({
        id: d.id,
        body: d.body,
        originalDate: d.originalDate.toISOString(),
        storageKey: d.media[0]?.storageKey ?? null,
        mimeType: d.media[0]?.mimeType ?? null,
        confidence: verdictsForGroup.get(d.id)?.conf ?? 0,
        reason: verdictsForGroup.get(d.id)?.reason ?? "",
        decision: "pending",
      })),
    });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(REVIEW_ROOT, `${stamp}-rule-AI`);
  await fs.mkdir(outDir, { recursive: true });

  const manifest = {
    rule: "AI",
    createdAt: new Date().toISOString(),
    source: path.basename(logPath!),
    confidenceThreshold: CONFIDENCE,
    groupCount: groups.length,
    pendingDropCount: groups.reduce((a, g) => a + g.drops.length, 0),
    groups,
  };
  await fs.writeFile(
    path.join(outDir, "candidates.json"),
    JSON.stringify(manifest, null, 2),
  );

  console.log(`\n${groups.length} group(s), ${manifest.pendingDropCount} drop(s) pending review`);
  console.log(`→ ${path.relative(process.cwd(), outDir)}`);
  console.log(`\nOpen /admin/trash/review to decide on each.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
