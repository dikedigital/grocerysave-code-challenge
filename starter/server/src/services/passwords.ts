/**
 * Password rules and hashing (TECH_SPEC 6.1; decisions D-120, D-121). bcryptjs at cost 10.
 *
 * - A password is normalised to Unicode NFC before it is measured, hashed or compared, so the same
 *   visible password typed on different systems (é as one code point or as e + accent) matches.
 * - "At least 8 characters" counts code points, not UTF-16 units (an emoji is one character).
 * - bcrypt reads only the first 72 bytes of its input and ignores the rest without a word. So a new
 *   password may be at most 72 UTF-8 bytes, and a login attempt over 72 bytes always fails;
 *   otherwise "<72-byte password>anything" would log in.
 * - A failed lookup (unknown email) still runs one bcrypt comparison against a fixed dummy hash, so
 *   an unknown email and a wrong password take about the same time.
 */
import bcrypt from 'bcryptjs';

/** bcryptjs cost (TECH_SPEC 6.1). */
export const BCRYPT_COST = 10;
export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt's input limit. */
export const MAX_PASSWORD_BYTES = 72;

export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

/** Length in characters (code points) of the normalised password. */
export function passwordLength(password: string): number {
  return [...normalizePassword(password)].length;
}

export function passwordBytes(password: string): number {
  return Buffer.byteLength(normalizePassword(password), 'utf8');
}

/** Why a new password is refused, or null when it is acceptable. */
export function passwordProblem(password: string): string | null {
  if (passwordLength(password) < MIN_PASSWORD_LENGTH) return `must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (passwordBytes(password) > MAX_PASSWORD_BYTES) {
    return `must be at most ${MAX_PASSWORD_BYTES} bytes (${MAX_PASSWORD_BYTES} plain letters or digits; fewer with accents or emoji)`;
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(normalizePassword(password), BCRYPT_COST);
}

let dummyHash: Promise<string> | null = null;
/** A hash of a random value, computed once, to compare against when there is no user. */
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(`no-such-user-${Math.random()}`, BCRYPT_COST);
  return dummyHash;
}

/**
 * True when `password` matches `hash`. `hash` null (no such user) and passwords over 72 bytes are
 * always false, after the same amount of bcrypt work as a real comparison.
 */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  const normalized = normalizePassword(password);
  const usable = hash !== null && Buffer.byteLength(normalized, 'utf8') <= MAX_PASSWORD_BYTES;
  const matches = await bcrypt.compare(normalized, usable ? hash : await getDummyHash());
  return usable && matches;
}
