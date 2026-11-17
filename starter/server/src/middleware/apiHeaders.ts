import type { RequestHandler } from 'express';
import { apiNotFound } from './notFound';

/**
 * First middleware on `/api` (security pass, D-150 and D-151):
 *
 * - `Cache-Control: no-store` on every API answer: they carry login tokens and personal lists,
 *   which must not be kept by the browser's disk cache or a shared proxy.
 * - `X-Content-Type-Options: nosniff`: answers are JSON and must never be sniffed as HTML (the
 *   JSON 404 repeats the request path).
 * - `OPTIONS` is answered with the JSON 404, like any method a route does not support (D-109).
 *   Express would otherwise answer it itself, with 200, an HTML body and the route's methods, for
 *   any caller and without a token. No CORS pre-flight is needed: the client is same-origin.
 */
export const apiHeaders: RequestHandler = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') {
    apiNotFound(req, res);
    return;
  }
  next();
};
