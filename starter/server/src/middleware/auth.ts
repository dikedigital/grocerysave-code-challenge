/**
 * `requireAuth` (TECH_SPEC 6.1; decisions D-108, D-117, D-123): `Authorization: Bearer <JWT>`, a
 * valid HS256 token (services/tokens.ts) whose user still exists. Anything else is 401 with a
 * `WWW-Authenticate: Bearer` header (RFC 6750), and the route's handler never runs.
 *
 * It is not mounted with `router.use`: the route builder (routes/define.ts) puts it in front of
 * every route that is not declared public, so unknown paths stay 404 for everyone.
 */
import type { Request, RequestHandler, Response } from 'express';
import type { User } from '../../../src/models';
import type { AppDeps } from '../deps';
import { unauthorized } from '../httpError';
import { verifyToken } from '../services/tokens';
import { findUserById } from '../services/users';
import { asyncHandler } from './asyncHandler';
import { requestPath } from './requestPath';

export const AUTH_REQUIRED_MESSAGE = 'Authentication required';
export const INVALID_TOKEN_MESSAGE = 'Invalid token';
export const EXPIRED_TOKEN_MESSAGE = 'Session expired, please sign in again';

/** Why a request was refused; logged at debug as `auth_rejected`. */
export type AuthRejection = 'missing' | 'malformed_header' | 'expired' | 'invalid' | 'user_not_found';

/** The signed-in user of each request that passed requireAuth. A WeakMap: no global type augmentation, nothing kept after the request. */
const signedIn = new WeakMap<Request, User>();

/** The user requireAuth attached to this request. Throws (a 500) on a route without requireAuth: a programming error. */
export function authUser(req: Request): User {
  const user = signedIn.get(req);
  if (!user) throw new Error(`authUser: ${req.method} ${requestPath(req)} has no requireAuth in front of it`);
  return user;
}

/** `Bearer <token>`: the scheme in any case (RFC 7235), one token of visible characters. */
const BEARER = /^Bearer[ \t]+([^\s]+)[ \t]*$/i;

export function requireAuth({ pool, jwtSecret, logger }: AppDeps): RequestHandler {
  const log = logger.child('auth');

  const refuse = (req: Request, res: Response, reason: AuthRejection, detail?: string) => {
    log.debug('auth_rejected', `${req.method} ${requestPath(req)}: ${reason}`, { method: req.method, path: requestPath(req), reason, detail });
    res.set('WWW-Authenticate', reason === 'missing' ? 'Bearer' : 'Bearer error="invalid_token"');
    const message = reason === 'missing' ? AUTH_REQUIRED_MESSAGE : reason === 'expired' ? EXPIRED_TOKEN_MESSAGE : INVALID_TOKEN_MESSAGE;
    return unauthorized(message);
  };

  return asyncHandler(async (req, res, next) => {
    const header = req.get('authorization');
    if (header === undefined || header.trim() === '') throw refuse(req, res, 'missing');
    const match = BEARER.exec(header);
    if (!match) throw refuse(req, res, 'malformed_header');

    const check = verifyToken(match[1], jwtSecret);
    if (!check.ok) throw refuse(req, res, check.reason, check.detail);

    const user = await findUserById(pool, check.userId);
    if (!user) throw refuse(req, res, 'user_not_found');

    signedIn.set(req, user);
    next();
  });
}
