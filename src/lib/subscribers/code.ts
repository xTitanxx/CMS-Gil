import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 8;
const SUFFIX_LENGTH = 4;
const BCRYPT_ROUNDS = 10;

const CODE_PREFIX = "gil-";
const MIN_CODE_LENGTH = 5;
const MAX_CODE_LENGTH = 40;
const CODE_SUFFIX_RE = /^[A-Za-z0-9-]+$/;

export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let suffix = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    suffix += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${CODE_PREFIX}${suffix}`;
}

export function deriveCodeFromName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, "");
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
  if (code.length < MIN_CODE_LENGTH || code.length > MAX_CODE_LENGTH) return false;
  if (!code.startsWith(CODE_PREFIX)) return false;
  const suffix = code.slice(CODE_PREFIX.length);
  return suffix.length > 0 && CODE_SUFFIX_RE.test(suffix);
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
