// PrismaAdapter (NextAuth) writes Google `Account.access_token` /
// `refresh_token` as plaintext. PR E wraps every write/read here so the
// columns hold AES-256-GCM ciphertext bound to (userId, "google") via AAD.
//
// Storage format: `enc:` prefix + the raw output of `encrypt()`. The prefix
// lets reads distinguish a freshly-encrypted value from a pre-encryption
// legacy row, so the migration can roll out without an explicit boolean
// column or a strict deploy/backfill ordering.

import { decrypt, encrypt } from "./encrypt";

const ENC_PREFIX = "enc:";

function aadFor(userId: string): string {
  return `google:${userId}`;
}

export function encryptGoogleToken(plaintext: string, userId: string): string {
  return ENC_PREFIX + encrypt(plaintext, aadFor(userId));
}

export function decryptGoogleToken(
  stored: string | null | undefined,
  userId: string
): string | null {
  if (!stored) return null;
  if (!stored.startsWith(ENC_PREFIX)) {
    // Legacy plaintext row — return as-is. Backfill will encrypt these.
    return stored;
  }
  return decrypt(stored.slice(ENC_PREFIX.length), aadFor(userId));
}

// True if a stored value is in the new (encrypted) format. Used by the
// backfill script to skip rows it has already processed.
export function isEncryptedGoogleToken(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(ENC_PREFIX);
}
