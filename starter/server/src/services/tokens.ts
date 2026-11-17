/**
 * Login tokens (TECH_SPEC 6.1; decision D-122): a JWT signed with HS256 and `config.jwtSecret`,
 * valid 7 days, whose subject is the user id. The payload holds nothing else (`sub`, `iat`, `exp`),
 * so a token never carries stale account data.
 *
 * Verification accepts only HS256 (an `alg: none` token, or one signed with another algorithm, is
 * refused) and only tokens that have an expiry and a uuid subject.
 */
import jwt from 'jsonwebtoken';
import { isUuid } from '../middleware/validate';

export const TOKEN_ALGORITHM = 'HS256';
export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signToken(userId: string, secret: string): string {
  return jwt.sign({}, secret, { algorithm: TOKEN_ALGORITHM, expiresIn: TOKEN_TTL_SECONDS, subject: userId });
}

export type TokenRejection = 'expired' | 'invalid';
export type TokenCheck = { ok: true; userId: string } | { ok: false; reason: TokenRejection; detail: string };

export function verifyToken(token: string, secret: string): TokenCheck {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: [TOKEN_ALGORITHM] });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) return { ok: false, reason: 'expired', detail: 'jwt expired' };
    return { ok: false, reason: 'invalid', detail: error instanceof Error ? error.message : 'unreadable token' };
  }
  if (typeof payload === 'string') return { ok: false, reason: 'invalid', detail: 'payload is not an object' };
  if (typeof payload.exp !== 'number') return { ok: false, reason: 'invalid', detail: 'no expiry' };
  if (typeof payload.sub !== 'string' || !isUuid(payload.sub)) return { ok: false, reason: 'invalid', detail: 'subject is not a user id' };
  return { ok: true, userId: payload.sub.toLowerCase() };
}
