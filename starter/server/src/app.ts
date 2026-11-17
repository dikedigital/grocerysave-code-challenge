import express from 'express';
import type { Pool } from 'pg';
import { config, DEFAULT_JWT_SECRET } from './config';
import type { AppDeps } from './deps';
import { logger as rootLogger, type Logger } from './logger';
import { apiHeaders } from './middleware/apiHeaders';
import { createErrorHandler } from './middleware/errorHandler';
import { apiNotFound } from './middleware/notFound';
import { requestLog } from './middleware/requestLog';
import { createApiRouter } from './routes';
import type { RouteInfo } from './routes/define';

/** Largest JSON body accepted (D-112): a 500-item import or a pasted CSV fits with room to spare. */
export const JSON_BODY_LIMIT = '1mb';

export interface CreateAppOptions {
  /** Receives the HTTP layer's log records; default the process logger (`app.http`) (D-114). */
  logger?: Logger;
  /** Secret for the HS256 login tokens; default `config.jwtSecret` (JWT_SECRET). Must not be empty. */
  jwtSecret?: string;
}

/** Where `createApp` keeps the route table (D-117). */
const ROUTES_KEY = 'apiRoutes';

/** Every declared API route (method, full path, access) of an app made by createApp. */
export function listApiRoutes(app: express.Express): RouteInfo[] {
  const routes = app.locals[ROUTES_KEY] as RouteInfo[] | undefined;
  return (routes ?? []).map((route) => ({ ...route, path: `/api${route.path}` }));
}

const httpLogger = rootLogger.child('http');

/**
 * Builds the Express app without listening (TECH_SPEC 6.2; D-104). `server/src/index.ts` (next
 * stage) listens; tests hand the app to supertest.
 *
 * Order matters:
 * 1. request log (debug, D-114); then, for `/api`, the security headers and OPTIONS as 404 (D-150, D-151);
 * 2. JSON body parser, for `/api` only, limit JSON_BODY_LIMIT (a malformed body is a 400 on any
 *    `/api` path, D-110; too large is 413, D-112);
 * 3. the API routers; each protected route has requireAuth in front of it (D-117);
 * 4. the JSON 404 for every other `/api` request (D-108, D-109);
 * 5. the central error handler, last (D-111).
 *
 * Not yet: `options.staticDir` and the SPA fallback for non-`/api` GET requests (TECH_SPEC 6.2),
 * which come with the server process (D-105).
 */
export function createApp(pool: Pool, options: CreateAppOptions = {}): express.Express {
  const log = options.logger ?? httpLogger;
  const jwtSecret = options.jwtSecret ?? config.jwtSecret;
  if (typeof jwtSecret !== 'string' || jwtSecret === '') throw new Error('createApp: the JWT secret must be a non-empty string');
  if (jwtSecret === DEFAULT_JWT_SECRET) {
    // Product owner, API round 3: warn, do not refuse to start (D-122).
    log.warn('jwt_secret_default', 'JWT_SECRET is not set: login tokens are signed with the built-in development secret. Set JWT_SECRET outside development.');
  }
  const deps: AppDeps = { pool, logger: log, jwtSecret };
  const api = createApiRouter(deps);

  const app = express();
  app.disable('x-powered-by');

  app.use(requestLog(log));
  app.use('/api', apiHeaders);
  app.use('/api', express.json({ limit: JSON_BODY_LIMIT }));
  app.use('/api', api.router);
  app.locals[ROUTES_KEY] = api.routes;
  app.use('/api', apiNotFound);
  app.use(createErrorHandler(log));

  return app;
}
