import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 8;
const SUFFIX_LENGTH = 4;
const BCRYPT_ROUNDS = 10;

const CODE_PREFIX = "gil-";
const MIN_CODE_LENGTH = 5;
const MAX_CODE_LENGTH = 40;
const CODE_SUFFIX_RE = /^[a-z0-9-]+$/;

// Codes are stored and matched case-insensitively. Mobile keyboards on
// elderly users' devices love to auto-capitalize the first letter — making
// the code reject `Gil-bob` after the user typed `gil-bob` is just cruel.
export function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let suffix = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    suffix += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${CODE_PREFIX}${suffix}`;
}

export function deriveCodeFromName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return cleaned ? `${CODE_PREFIX}${cleaned}` : "";
}

export function appendRandomSuffix(base: string): string {
  const bytes = randomBytes(SUFFIX_LENGTH);
  let suf = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suf += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${base}-${suf}`;
}

export function isWellFormedCode(code: string): boolean {
  if (typeof code !== "string") return false;
  const normalized = normalizeCode(code);
  if (normalized.length < MIN_CODE_LENGTH || normalized.length > MAX_CODE_LENGTH) return false;
  if (!normalized.startsWith(CODE_PREFIX)) return false;
  const suffix = normalized.slice(CODE_PREFIX.length);
  return suffix.length > 0 && CODE_SUFFIX_RE.test(suffix);
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(normalizeCode(code), BCRYPT_ROUNDS);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(normalizeCode(code), hash);
}

// Deterministic blind-index over the code. Stored in `Subscriber.codeBlindIndex`
// alongside the bcrypt hash so sign-in and collision-check can find the row in
// O(1) instead of bcrypt-comparing every non-revoked row.
//
// HMAC (not plain SHA-256) so an attacker who exfiltrates the index column
// can't precompute a rainbow table for the 41-bit code space — they need the
// pepper, which lives only on Vercel (and dev .env.local).
export function blindIndex(code: string): string {
  return blindIndexRaw(normalizeCode(code));
}

// Same HMAC as `blindIndex` but skips normalization. Sign-in uses this to
// look up legacy rows that were indexed under their original case-mixed
// plaintext, before we made codes case-insensitive.
export function blindIndexRaw(code: string): string {
  const hex = process.env.SUBSCRIBER_INDEX_PEPPER ?? "";
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "SUBSCRIBER_INDEX_PEPPER must be 32 bytes (64 hex chars). " +
        `Got ${key.length} bytes from a ${hex.length}-char value.`
    );
  }
  return createHmac("sha256", key).update(code).digest("base64url");
}
