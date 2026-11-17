/**
 * `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` (TECH_SPEC 6.1, 6.3;
 * decisions D-118 to D-124).
 */
import { z } from 'zod';
import type { AuthResponse, User } from '../../../src/models';
import type { AppDeps } from '../deps';
import { conflict, unauthorized } from '../httpError';
import { authUser } from '../middleware/auth';
import { OBJECT_BODY, characters, hasControlCharacters, isBlank, text } from '../middleware/validate';
import { hashPassword, passwordProblem, verifyPassword } from '../services/passwords';
import { signToken } from '../services/tokens';
import { createUser, findCredentials, normalizeEmail } from '../services/users';
import type { RouteBuilder } from './define';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
export const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists';
export const MAX_EMAIL_LENGTH = 254;
export const MAX_DISPLAY_NAME_LENGTH = 80;

const validEmail = z.string().email();

/** Trimmed, lower-cased and checked (D-118, D-119): one message per problem. */
const email = text().transform((value, ctx) => {
  const normalized = normalizeEmail(value);
  if (normalized === '') {
    ctx.addIssue({ code: 'custom', message: 'is required' });
    return z.NEVER;
  }
  if (normalized.length > MAX_EMAIL_LENGTH || !validEmail.safeParse(normalized).success) {
    ctx.addIssue({ code: 'custom', message: 'must be a valid email address' });
    return z.NEVER;
  }
  return normalized;
});

/** A new password: at least 8 characters, at most 72 bytes (D-120). Never trimmed. */
const newPassword = text().superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/** Optional; trimmed; absent, null or blank is stored as '' and the client shows the email (D-124). */
const displayName = z
  .string({ invalid_type_error: 'must be text' })
  .nullish()
  .transform((value, ctx) => {
    const trimmed = isBlank(value ?? '') ? '' : (value ?? '').trim();
    if (characters(trimmed) > MAX_DISPLAY_NAME_LENGTH) {
      ctx.addIssue({ code: 'custom', message: `must be at most ${MAX_DISPLAY_NAME_LENGTH} characters` });
      return z.NEVER;
    }
    if (hasControlCharacters(trimmed)) {
      ctx.addIssue({ code: 'custom', message: 'must not contain control characters' });
      return z.NEVER;
    }
    return trimmed;
  });

export const registerSchema = z.object({ email, password: newPassword, displayName }, OBJECT_BODY);

/** Login checks presence only: format and length rules would only reveal the rules; a wrong value is 401 (D-121). */
export const loginSchema = z.object(
  {
    email: text().transform((value, ctx) => {
      const normalized = normalizeEmail(value);
      if (normalized === '') {
        ctx.addIssue({ code: 'custom', message: 'is required' });
        return z.NEVER;
      }
      return normalized;
    }),
    password: text().min(1, 'is required'),
  },
  OBJECT_BODY,
);

export function authRoutes(r: RouteBuilder, { pool, jwtSecret, logger }: AppDeps): void {
  const log = logger.child('auth');
  const respond = (user: User): AuthResponse => ({ token: signToken(user.id, jwtSecret), user });

  r.public.post('/register', async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const user = await createUser(pool, { email: input.email, passwordHash, displayName: input.displayName });
    if (!user) {
      log.info('registration_refused', 'registration refused: the email is already registered', { reason: 'email_taken' });
      throw conflict(EMAIL_TAKEN_MESSAGE);
    }
    log.info('user_registered', `user ${user.id} registered`, { userId: user.id });
    res.status(201).json(respond(user));
  });

  r.public.post('/login', async (req, res) => {
    const input = loginSchema.parse(req.body);
    // An email with a control character (a NUL byte, say) cannot belong to an account: it is a
    // failed login like any unknown email, without a query (security pass, D-152). Before, Postgres
    // refused the NUL and the answer was a 400 instead of the uniform 401.
    const found = hasControlCharacters(input.email) ? null : await findCredentials(pool, input.email);
    const matches = await verifyPassword(input.password, found?.passwordHash ?? null);
    if (!found || !matches) {
      // Same status and message for both (TECH_SPEC 6.3); the log keeps the reason, never the email or password.
      log.info('login_failed', 'login failed', { reason: found ? 'wrong_password' : 'unknown_email', userId: found?.user.id });
      throw unauthorized(INVALID_CREDENTIALS_MESSAGE);
    }
    log.info('login_succeeded', `user ${found.user.id} signed in`, { userId: found.user.id });
    res.json(respond(found.user));
  });

  r.get('/me', async (req, res) => {
    res.json({ user: authUser(req) });
  });
}
