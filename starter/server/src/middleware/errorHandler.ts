/**
 * The central error handler (TECH_SPEC 6.1; decisions D-110 to D-112). Every error of every
 * route ends here and becomes `{ "error": "<message>" }` with the right status:
 *
 * | Error | Status | Message sent |
 * |---|---|---|
 * | `HttpError` 4xx (routes, services) | its status | its message |
 * | `ZodError` (a schema `.parse` that failed) | 400 | `path: message` per issue, `; `-joined, at most 5 |
 * | body that is not valid JSON (body-parser `entity.parse.failed`) | 400 | `Malformed JSON body` |
 * | body over the size limit (`entity.too.large`) | 413 | `Request body is too large` |
 * | other body-parser client errors (charset, encoding...) | their 4xx | their message |
 * | Postgres class 22 (bad uuid, out of range...), 23502, 23514 | 400 | `Invalid input` |
 * | Postgres 23505 (unique) | 409 | `Already exists` |
 * | Postgres 23503 (foreign key) | 404 | `Referenced resource not found` |
 * | anything else, including `HttpError` 5xx and non-Error values | 500 | `Internal server error` |
 *
 * The real cause of a 500 is logged (`request_failed`, error), never sent. Postgres input errors
 * are logged at warn (`database_input_rejected`), since they usually mean a route forgot to
 * validate. Bodies and headers are never logged: they can hold a password or a token.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { errorMessage } from '../errors';
import { HttpError } from '../httpError';
import type { Logger } from '../logger';
import { requestPath } from './requestPath';

export const INTERNAL_ERROR_MESSAGE = 'Internal server error';
export const MALFORMED_JSON_MESSAGE = 'Malformed JSON body';
export const BODY_TOO_LARGE_MESSAGE = 'Request body is too large';
/** At most this many zod issues are spelled out in a 400 message; the rest are counted. */
export const MAX_REPORTED_ISSUES = 5;

export type ErrorKind = 'http' | 'validation' | 'body' | 'database' | 'internal';

export interface ErrorOutcome {
  status: number;
  /** What the client receives as `error`. */
  message: string;
  kind: ErrorKind;
  /** The SQLSTATE, for Postgres errors. */
  code?: string;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** `path: message` for each issue, joined with `; `, at most MAX_REPORTED_ISSUES of them. */
export function formatZodError(error: ZodError): string {
  const parts = error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  const more = error.issues.length - MAX_REPORTED_ISSUES;
  if (more > 0) parts.push(`and ${more} more`);
  return parts.length > 0 ? parts.join('; ') : 'Invalid request';
}

/**
 * A Postgres error as `pg` reports it: a five-character SQLSTATE in `code` and a `severity`.
 * Checked by shape, not `instanceof`, so an error from another copy of `pg` still counts; Node's
 * own codes (`ECONNREFUSED`, `ERR_...`) do not match.
 */
export function isPostgresError(error: unknown): error is Error & { code: string; severity: string } {
  const code = field(error, 'code');
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof field(error, 'severity') === 'string';
}

/** The client-error reading of a SQLSTATE, or null when it is a server-side failure. */
export function classifySqlState(code: string): { status: number; message: string } | null {
  if (code === '23505') return { status: 409, message: 'Already exists' };
  if (code === '23503') return { status: 404, message: 'Referenced resource not found' };
  if (code === '23502' || code === '23514' || code.startsWith('22')) return { status: 400, message: 'Invalid input' };
  return null;
}

/** Decides status and client message for any thrown value. Pure; never throws. */
export function classifyError(error: unknown): ErrorOutcome {
  if (error instanceof HttpError) {
    return error.status >= 500
      ? { status: 500, message: INTERNAL_ERROR_MESSAGE, kind: 'internal' }
      : { status: error.status, message: error.message, kind: 'http' };
  }

  if (error instanceof ZodError) {
    return { status: 400, message: formatZodError(error), kind: 'validation' };
  }

  // body-parser (express.json) errors: http-errors with a `type` and `expose: true` for 4xx.
  const type = field(error, 'type');
  if (type === 'entity.parse.failed') return { status: 400, message: MALFORMED_JSON_MESSAGE, kind: 'body' };
  if (type === 'entity.too.large') return { status: 413, message: BODY_TOO_LARGE_MESSAGE, kind: 'body' };
  const status = field(error, 'status') ?? field(error, 'statusCode');
  if (
    field(error, 'expose') === true &&
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status < 500
  ) {
    const message = field(error, 'message');
    return { status, message: typeof message === 'string' && message !== '' ? message : 'Bad request', kind: 'body' };
  }

  if (isPostgresError(error)) {
    const mapped = classifySqlState(error.code);
    if (mapped) return { ...mapped, kind: 'database', code: error.code };
    return { status: 500, message: INTERNAL_ERROR_MESSAGE, kind: 'internal', code: error.code };
  }

  return { status: 500, message: INTERNAL_ERROR_MESSAGE, kind: 'internal' };
}

/** The Express error handler (four parameters: that is how Express recognises one). */
export function createErrorHandler(log: Logger) {
  return function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
    const method = req.method;
    const path = requestPath(req);

    if (res.headersSent) {
      // Too late for a JSON answer: Express's default handler closes the connection.
      log.error('response_failed', `${method} ${path} failed after the response started: ${errorMessage(error)}`, {
        method,
        path,
        error: errorMessage(error),
      });
      next(error);
      return;
    }

    const outcome = classifyError(error);
    if (outcome.status >= 500) {
      const stack = field(error, 'stack');
      log.error('request_failed', `${method} ${path} failed: ${errorMessage(error)}`, {
        method,
        path,
        status: outcome.status,
        error: errorMessage(error),
        code: outcome.code ?? (typeof field(error, 'code') === 'string' ? field(error, 'code') : undefined),
        stack: typeof stack === 'string' ? stack : undefined,
      });
    } else if (outcome.kind === 'database') {
      // The message names the problem (and may quote the bad value); `detail`, which can quote a
      // whole row (an email, say), is left out.
      log.warn('database_input_rejected', `${method} ${path}: Postgres rejected the input (${outcome.code}): ${errorMessage(error)}`, {
        method,
        path,
        status: outcome.status,
        code: outcome.code,
        constraint: field(error, 'constraint'),
        table: field(error, 'table'),
        column: field(error, 'column'),
      });
    }

    res.status(outcome.status).json({ error: outcome.message });
  };
}
