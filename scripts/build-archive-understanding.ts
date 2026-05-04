// Bootstrap script: build the assistant's archive understanding for one user.
// Usage:
//   npx tsx --env-file=.env.local scripts/build-archive-understanding.ts <userId>
// If no userId is given, builds for the only user in the DB (errors if multiple).
import { prisma } from "@/lib/prisma";
import { buildUnderstanding, persistUnderstanding } from "@/lib/assistant/archive-understanding";

(async () => {
  const arg = process.argv[2];
  let userId = arg;
  if (!userId) {
    const users = await prisma.user.findMany({ select: { id: true, email: true } });
    if (users.length === 1) {
      userId = users[0].id;
      console.log(`No userId given — defaulting to the only user: ${users[0].email} (${userId})`);
    } else {
      console.error(`Multiple users found, pass a userId: ${users.map((u) => `${u.id} (${u.email})`).join(", ")}`);
      process.exit(1);
    }
  }

  const started = Date.now();
  console.log(`Building understanding for ${userId}...`);
  const result = await buildUnderstanding(userId);
  console.log(`Generated in ${Date.now() - started}ms — based on ${result.basedOnPostCount} posts, ${result.sampleBodies.length} samples`);
  console.log(`\nVOICE PROFILE (${result.voiceProfile.length} chars):\n${result.voiceProfile.slice(0, 500)}...\n`);
  console.log(`THEMATIC MAP (${result.thematicMap.length} chars):\n${result.thematicMap.slice(0, 400)}...\n`);
  console.log(`SAMPLE THEMES: ${[...new Set(result.sampleBodies.map((s) => s.theme))].join(", ")}\n`);

  await persistUnderstanding(userId, result);
  console.log(`Persisted to UserArchiveUnderstanding.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
