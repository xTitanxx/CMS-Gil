// Backfill: encrypt every plaintext Google `Account.access_token` /
// `refresh_token` row in place. Idempotent — rows already prefixed with
// `enc:` are skipped. Uses the same AAD binding as src/lib/google-tokens.ts
// so subsequent reads through `decryptGoogleToken` work transparently.
//
// Run: `tsx scripts/encrypt-google-tokens.ts` after PR E is deployed.
// Pre-flight: ensure ENCRYPTION_KEY is set (validated at module load by
// src/lib/encrypt.ts).
//
// Order of operations matters slightly:
//   1. Deploy PR E code (writes are encrypted, reads handle either format).
//   2. Run this script (encrypts existing rows in place).
//   3. After verifying every Account row is encrypted, the legacy
//      passthrough in decryptGoogleToken can be tightened later.

import { prisma } from "../src/lib/prisma";
import {
  encryptGoogleToken,
  isEncryptedGoogleToken,
} from "../src/lib/google-tokens";

async function main() {
  const accounts = await prisma.account.findMany({
    where: { provider: "google" },
    select: {
      id: true,
      userId: true,
      access_token: true,
      refresh_token: true,
    },
  });

  let encrypted = 0;
  let skipped = 0;
  for (const a of accounts) {
    const updates: Record<string, string> = {};
    if (a.access_token && !isEncryptedGoogleToken(a.access_token)) {
      updates.access_token = encryptGoogleToken(a.access_token, a.userId);
    }
    if (a.refresh_token && !isEncryptedGoogleToken(a.refresh_token)) {
      updates.refresh_token = encryptGoogleToken(a.refresh_token, a.userId);
    }
    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }
    await prisma.account.update({
      where: { id: a.id },
      data: updates,
    });
    encrypted++;
    console.log(`encrypted account ${a.id} (user ${a.userId})`);
  }

  console.log(
    `\nDone. ${encrypted} account(s) encrypted, ${skipped} already encrypted.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
