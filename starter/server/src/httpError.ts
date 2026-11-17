/**
 * An error that carries the HTTP status the API answers with (TECH_SPEC 6.1, decision D-106).
 * Routes and services throw these; the central error handler (`middleware/errorHandler.ts`) turns
 * them into `{ "error": message }` responses. A status of 500 or more is treated like any other
 * server failure: the client gets a generic message and the real one is only logged.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError(`HttpError status must be an integer from 400 to 599, got ${String(status)}`);
    }
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** 400: validation failed or the request is malformed. */
export const badRequest = (message = 'Bad request'): HttpError => new HttpError(400, message);
/** 401: missing or invalid token. */
export const unauthorized = (message = 'Authentication required'): HttpError => new HttpError(401, message);
/** 403: authenticated but not allowed. */
export const forbidden = (message = 'Forbidden'): HttpError => new HttpError(403, message);
/** 404: not found, including resources the caller may not see (TECH_SPEC 6.1). */
export const notFound = (message = 'Not found'): HttpError => new HttpError(404, message);
/** 409: duplicate (for example an email already registered). */
export const conflict = (message = 'Conflict'): HttpError => new HttpError(409, message);
