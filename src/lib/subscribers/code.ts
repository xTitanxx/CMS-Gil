import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let suffix = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    suffix += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `gil-${suffix}`;
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
