import type { RequestHandler } from 'express';
import type { Logger } from '../logger';
import { requestPath } from './requestPath';

/**
 * One `request_completed` record per finished request, at **debug** (D-114): method, path (no
 * query string), status and duration. Never the headers (they carry the token) or the body (it can
 * carry a password). Failures are logged by the error handler at warn / error instead.
 */
export function requestLog(log: Logger): RequestHandler {
  return (req, res, next) => {
    if (!log.isEnabled('debug')) {
      next();
      return;
    }
    const started = process.hrtime.bigint();
    const method = req.method;
    const path = requestPath(req);
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      log.debug('request_completed', `${method} ${path} ${res.statusCode}`, {
        method,
        path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  };
}
