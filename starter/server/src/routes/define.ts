/**
 * How routers declare their routes (decision D-117): **signed-in by default**. `r.get(...)` puts
 * requireAuth in front of the handler; only `r.public.get(...)` skips it. Every handler is wrapped
 * in asyncHandler (D-107), so no route can forget either.
 *
 * Each declaration is also recorded in a route table (method, path under /api, access), which the
 * tests walk to check that every route except the public ones answers 401 without a token.
 */
import type { RequestHandler, Router } from 'express';
import { asyncHandler, type AsyncRequestHandler } from '../middleware/asyncHandler';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RouteAccess = 'public' | 'signed-in';

export interface RouteInfo {
  method: HttpMethod;
  /** Path under /api, with Express parameters (`/lists/:id`). */
  path: string;
  access: RouteAccess;
}

type Declare = (path: string, handler: AsyncRequestHandler) => void;

export interface RouteBuilder {
  get: Declare;
  post: Declare;
  put: Declare;
  patch: Declare;
  delete: Declare;
  /** Routes anyone may call: only health, register and login (TECH_SPEC 6.1). */
  public: { get: Declare; post: Declare; put: Declare; patch: Declare; delete: Declare };
}

/** `/auth` + `/me` is `/auth/me`; `/health` + `/` is `/health`. */
export function joinPath(prefix: string, path: string): string {
  const joined = `${prefix.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`.replace(/\/+$/, '');
  return joined === '' ? '/' : joined;
}

export function routeBuilder(router: Router, prefix: string, requireAuth: RequestHandler, table: RouteInfo[]): RouteBuilder {
  const declare =
    (method: HttpMethod, access: RouteAccess): Declare =>
    (path, handler) => {
      const handlers: RequestHandler[] = access === 'public' ? [asyncHandler(handler)] : [requireAuth, asyncHandler(handler)];
      const route = router.route(path);
      switch (method) {
        case 'GET':
          route.get(...handlers);
          break;
        case 'POST':
          route.post(...handlers);
          break;
        case 'PUT':
          route.put(...handlers);
          break;
        case 'PATCH':
          route.patch(...handlers);
          break;
        case 'DELETE':
          route.delete(...handlers);
          break;
      }
      table.push({ method, path: joinPath(prefix, path), access });
    };
  const methods = (access: RouteAccess) => ({
    get: declare('GET', access),
    post: declare('POST', access),
    put: declare('PUT', access),
    patch: declare('PATCH', access),
    delete: declare('DELETE', access),
  });
  return { ...methods('signed-in'), public: methods('public') };
}
