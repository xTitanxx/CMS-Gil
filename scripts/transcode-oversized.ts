import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";

const EXPORT_ROOT = "/Users/eitan/Documents/Code-Projects/CMS-Gil.nosync/sample-exports/JSONs/Unzipped JSONs";
const CLOUDINARY_MAX = 100 * 1024 * 1024;
const TARGET_MAX = 95 * 1024 * 1024;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

function runFfmpeg(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "ignore"] });
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

async function transcode(input: string, output: string, crf: number): Promise<void> {
  const code = await runFfmpeg([
    "-y",
    "-i", input,
    "-vcodec", "libx264",
    "-crf", String(crf),
    "-preset", "medium",
    "-vf", "scale='min(1920,iw)':-2",
    "-acodec", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    output,
  ]);
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
}

async function main() {
  const all = await walk(EXPORT_ROOT);
  const oversized: { path: string; size: number }[] = [];
  for (const f of all) {
    if (!/\.mp4$/i.test(f)) continue;
    const st = await fs.stat(f);
    if (st.size > CLOUDINARY_MAX) oversized.push({ path: f, size: st.size });
  }
  console.log(`Found ${oversized.length} oversized mp4s`);

  let done = 0;
  let stillBig = 0;
  let failed = 0;

  for (const { path: src, size } of oversized) {
    const dir = path.dirname(src);
    const base = path.basename(src);
    const tmp = path.join(dir, `.transcoding-${base}`);
    const sizeMb = (size / 1024 / 1024).toFixed(1);

    try {
      for (const crf of [23, 28, 32]) {
        console.log(`  [START] ${base} (${sizeMb}MB) crf=${crf}`);
        await transcode(src, tmp, crf);
        const newSize = (await fs.stat(tmp)).size;
        const newMb = (newSize / 1024 / 1024).toFixed(1);
        if (newSize <= TARGET_MAX) {
          await fs.rename(tmp, src);
          console.log(`  [OK   ] ${base} ${sizeMb}MB -> ${newMb}MB (crf=${crf})`);
          done++;
          break;
        } else {
          console.log(`  [BIG  ] ${base} crf=${crf} -> ${newMb}MB, retrying`);
          await fs.unlink(tmp).catch(() => {});
          if (crf === 32) {
            stillBig++;
            console.log(`  [FAIL ] ${base} still >${TARGET_MAX / 1024 / 1024}MB even at crf=32`);
          }
        }
      }
    } catch (err) {
      failed++;
      await fs.unlink(tmp).catch(() => {});
      console.log(`  [ERR  ] ${base}: ${(err as Error).message}`);
    }
  }

  console.log(`\nSummary: transcoded=${done}  stillBig=${stillBig}  failed=${failed}  total=${oversized.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
