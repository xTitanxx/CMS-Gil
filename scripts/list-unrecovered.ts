import { promises as fs } from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { parseFacebookFile } from "../src/lib/facebook-parser";

const EXPORT_ROOT = "/Users/eitan/Documents/Code-Projects/CMS-Gil.nosync/sample-exports/JSONs/Unzipped JSONs";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

(async () => {
  const all = await walk(EXPORT_ROOT);
  const jsonFiles = all.filter((f) => f.endsWith(".json"));
  const parsed = new Map<string, { uris: string[] }>();
  for (const jf of jsonFiles) {
    try {
      for (const p of parseFacebookFile(JSON.parse(await fs.readFile(jf, "utf8")))) {
        const ex = parsed.get(p.sourceId);
        if (ex) for (const u of p.mediaUris) if (!ex.uris.includes(u)) ex.uris.push(u);
        else parsed.set(p.sourceId, { uris: [...p.mediaUris] });
      }
    } catch {}
  }

  const posts = await prisma.post.findMany({
    where: { source: "FACEBOOK", media: { none: {} } },
    select: { id: true, sourceId: true, originalDate: true, body: true, platformUrl: true },
    orderBy: { originalDate: "desc" },
  });

  const unrecovered: typeof posts = [];
  for (const p of posts) {
    if (!p.sourceId) continue;
    const entry = parsed.get(p.sourceId);
    if (!entry) {
      unrecovered.push(p);
      continue;
    }
    if (entry.uris.length > 0) unrecovered.push(p);
  }

  console.log(`Unrecovered posts with expected media or unparsed sourceId:`);
  for (const p of unrecovered) {
    const entry = parsed.get(p.sourceId!);
    const body = (p.body ?? "").replace(/\s+/g, " ").slice(0, 80);
    console.log(`\n- ${p.id}`);
    console.log(`  sourceId: ${p.sourceId}`);
    console.log(`  date: ${p.originalDate?.toISOString()}`);
    console.log(`  url: ${p.platformUrl ?? "(none)"}`);
    console.log(`  body: ${body}`);
    if (entry) console.log(`  expected uris: ${entry.uris.join(", ")}`);
    else console.log(`  NOT FOUND in parsed JSONs`);
  }

  await prisma.$disconnect();
})();
