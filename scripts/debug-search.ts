/**
 * Diagnostic: scan Post.body for characters that cause search mismatches when
 * the user types the "same" text on a keyboard.
 *
 *   - smart quotes / curly apostrophes (U+2018, U+2019, U+201C, U+201D)
 *   - en/em dashes (U+2013, U+2014) vs. hyphen (U+002D)
 *   - ellipsis char (U+2026) vs. three dots
 *   - non-breaking space (U+00A0) vs. normal space
 *   - zero-width space / joiner / non-joiner (U+200B..200D, U+FEFF)
 *   - soft hyphen (U+00AD)
 *
 * Also reports UTF-8 mojibake signatures (sequences like Ã© that indicate
 * latin1-encoded UTF-8 that never got fixed).
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/debug-search.ts
 */
import { prisma } from "../src/lib/prisma";

const LANDMINES: Array<{ name: string; regex: RegExp; hint: string }> = [
  { name: "curly-single-quote",  regex: /[\u2018\u2019]/g, hint: "typed ' won't match" },
  { name: "curly-double-quote",  regex: /[\u201C\u201D]/g, hint: 'typed " won\'t match' },
  { name: "en-dash",             regex: /\u2013/g,          hint: "typed - won't match" },
  { name: "em-dash",             regex: /\u2014/g,          hint: "typed - won't match" },
  { name: "ellipsis",            regex: /\u2026/g,          hint: "typed ... won't match" },
  { name: "nbsp",                regex: /\u00A0/g,          hint: "typed space won't match" },
  { name: "zero-width",          regex: /[\u200B-\u200D\uFEFF]/g, hint: "invisible — any surrounding text that spans one won't match" },
  { name: "soft-hyphen",         regex: /\u00AD/g,          hint: "invisible — word-spanning searches fail" },
];

// Mojibake signature: UTF-8 bytes interpreted as latin1 produce things like
// Ã©, Ã¨, Ã¼, â€™, â€“, etc.
const MOJIBAKE = /Ã[\u0080-\u00BF]|â€[\u0080-\u00BF]/g;

async function main() {
  const total = await prisma.post.count();
  console.log(`Posts in DB: ${total}`);

  const posts = await prisma.post.findMany({
    where: { body: { not: "" } },
    select: { id: true, body: true, originalDate: true },
  });
  console.log(`Non-empty bodies: ${posts.length}\n`);

  const hitCounts = new Map<string, number>();
  const hitSamples = new Map<string, string>();

  for (const p of posts) {
    for (const { name, regex } of LANDMINES) {
      if (regex.test(p.body)) {
        hitCounts.set(name, (hitCounts.get(name) ?? 0) + 1);
        if (!hitSamples.has(name)) {
          const match = p.body.match(regex);
          const idx = match?.index ?? 0;
          const ctx = p.body.slice(Math.max(0, idx - 25), idx + 25);
          hitSamples.set(name, `${p.id}: …${ctx}…`);
        }
      }
    }
    if (MOJIBAKE.test(p.body)) {
      hitCounts.set("mojibake", (hitCounts.get("mojibake") ?? 0) + 1);
      if (!hitSamples.has("mojibake")) {
        hitSamples.set("mojibake", `${p.id}: ${p.body.slice(0, 80)}`);
      }
    }
  }

  console.log("Landmine report:");
  console.log("────────────────");
  for (const { name, hint } of LANDMINES) {
    const c = hitCounts.get(name) ?? 0;
    if (c > 0) {
      console.log(`  ${name.padEnd(22)} ${String(c).padStart(4)} posts  — ${hint}`);
      console.log(`    sample: ${hitSamples.get(name)}`);
    }
  }
  const moji = hitCounts.get("mojibake") ?? 0;
  if (moji > 0) {
    console.log(`  mojibake (Ã/â€ seq)   ${String(moji).padStart(4)} posts  — latin1→utf8 decode never applied`);
    console.log(`    sample: ${hitSamples.get("mojibake")}`);
  }

  if (hitCounts.size === 0) {
    console.log("  (none) — no known encoding landmines detected.");
    console.log("  The search bug is probably elsewhere (whitespace, newlines, or the snippet being searched).");
    console.log("  Re-run with a specific failing snippet to continue:");
    console.log("    tsx scripts/debug-search.ts --snippet 'exact text that should match'");
    return;
  }

  console.log("\nRecommendation:");
  console.log("  Use Postgres unaccent() + a normalization pass on both the stored body and the search");
  console.log('  term: collapse curly→straight quotes, dashes→hyphen, nbsp→space, strip zero-width.');
  console.log("  Implementation options:");
  console.log("  1. Normalize body at write time + normalize the search term at read time (fast, simple).");
  console.log("  2. Add a generated `bodyNormalized` column + GIN pg_trgm index (best performance).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
