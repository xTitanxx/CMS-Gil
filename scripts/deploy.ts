/**
 * Trigger a Vercel production deployment built from the latest commit on
 * GitHub's `main` (claude/personal-cms-social-posting-QV57t) — *not* from the
 * local working tree.
 *
 * Why: `vercel --prod` from the CLI tars up whatever is on disk and ships
 * that. With multiple sessions on different feature branches sharing one
 * filesystem, that's let WIP code leak into production. This script asks
 * Vercel to clone origin/main itself and build there, so the working tree
 * is irrelevant.
 *
 * Setup (one-time):
 *   1. Create a Vercel API token at https://vercel.com/account/tokens
 *   2. Add `VERCEL_TOKEN=...` to .env.local (and to Vercel project envs if
 *      you want CI to use it too)
 *
 * Usage:
 *   npm run deploy
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_JSON_PATH = resolve(process.cwd(), ".vercel/project.json");

interface ProjectJson {
  projectId: string;
  orgId: string;
  projectName: string;
}

function loadProjectIds(): ProjectJson {
  try {
    const raw = readFileSync(PROJECT_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as ProjectJson;
    if (!parsed.projectId || !parsed.orgId || !parsed.projectName) {
      throw new Error("missing fields");
    }
    return parsed;
  } catch (err) {
    console.error(
      `Could not read ${PROJECT_JSON_PATH}. Run \`vercel link\` first to generate it.`,
      err,
    );
    process.exit(1);
  }
}

async function main() {
  // Lazy-load .env.local so the script works without dotenv when run via
  // `next` / `vercel env pull` already populated process.env.
  if (!process.env.VERCEL_TOKEN) {
    try {
      const dotenv = await import("dotenv");
      dotenv.config({ path: ".env.local" });
    } catch {
      // dotenv may not be installed; that's fine if VERCEL_TOKEN is already set
    }
  }

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    console.error(
      "VERCEL_TOKEN is not set. Create one at https://vercel.com/account/tokens " +
        "and add it to .env.local",
    );
    process.exit(1);
  }

  const { projectId, orgId, projectName } = loadProjectIds();

  // Pin the deploy to a specific commit SHA so it's deterministic — if
  // someone pushes to main between us reading and Vercel cloning, the SHA
  // we asked for is what builds, not whatever is "latest at clone time".
  const { execSync } = await import("node:child_process");
  let sha: string;
  try {
    execSync("git fetch origin claude/personal-cms-social-posting-QV57t", {
      stdio: "ignore",
    });
    sha = execSync("git rev-parse origin/claude/personal-cms-social-posting-QV57t", {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    console.error("Failed to read origin's main SHA. Are you online?", err);
    process.exit(1);
  }

  console.log(`Deploying ${projectName} @ ${sha.slice(0, 8)} to production…`);

  const url = `https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(orgId)}&forceNew=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: projectName,
      project: projectId,
      target: "production",
      gitSource: {
        type: "github",
        ref: "claude/personal-cms-social-posting-QV57t",
        sha,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`Vercel API ${res.status} ${res.statusText}: ${detail}`);
    process.exit(1);
  }

  const data = (await res.json()) as {
    id: string;
    url?: string;
    inspectorUrl?: string;
  };

  console.log(`Started deployment ${data.id}`);
  if (data.inspectorUrl) console.log(`  Logs:  ${data.inspectorUrl}`);
  if (data.url) console.log(`  URL:   https://${data.url}`);
  console.log(
    "\nThe build runs on Vercel and will alias to gilalter.com when it finishes.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
