import { types } from 'node:util';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { errorMessage } from '../errors';

export type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async route handler so that a rejection reaches the central error handler (D-107).
 * Express 4 ignores the promise a handler returns: without this a failed query would leave the
 * request hanging.
 *
 * The rejection reason is always passed on as an `Error`. Express treats `next()` with a falsy
 * value as "carry on" and `next('route')` / `next('router')` as routing commands, so
 * `Promise.reject(undefined)` or a rejected string `'route'` would otherwise fall through to the
 * 404 handler instead of giving a 500.
 */
export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch((reason: unknown) => next(asError(reason)));
  };
}

/** `value` when it is an error (from any realm); otherwise an `Error` describing it, with `cause`. */
export function asError(value: unknown): Error {
  if (value instanceof Error || types.isNativeError(value)) return value as Error;
  return new Error(errorMessage(value), { cause: value });
}
