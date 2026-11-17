import type { Request } from 'express';

/**
 * The full request path without the query string (`/api/products`, not `/api/products?q=milk`).
 * Used in log records and 404 messages: the query string can hold search text, and it is not
 * needed to identify the route.
 */
export function requestPath(req: Request): string {
  const url = req.originalUrl || req.url || '';
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}
