import { Router } from 'express';
import type { AppDeps } from '../deps';
import { requireAuth } from '../middleware/auth';
import { authRoutes } from './auth';
import { routeBuilder, type RouteBuilder, type RouteInfo } from './define';
import { healthRoutes } from './health';
import { itemRoutes } from './items';
import { listRoutes } from './lists';

/**
 * Every API router, mounted under `/api` by `createApp` (D-104). Each resource declares its routes
 * through a RouteBuilder at its own prefix: signed-in by default, public only when declared so
 * (D-117). requireAuth sits in front of each protected route, never in `router.use`, so an unknown
 * path stays a 404 for everyone (D-108).
 *
 * Next: bulk add and import, comparison and optimisation (lists); /households (sharing); /chains,
 * /stores, /products (catalog.ts); /routes (routePlans.ts); /preferences; /deals, /notifications; /sync.
 */
export function createApiRouter(deps: AppDeps): { router: Router; routes: RouteInfo[] } {
  const router = Router();
  const routes: RouteInfo[] = [];
  const auth = requireAuth(deps);

  const mount = (prefix: string, declare: (r: RouteBuilder, deps: AppDeps) => void) => {
    const sub = Router();
    declare(routeBuilder(sub, prefix, auth, routes), deps);
    router.use(prefix, sub);
  };

  mount('/health', healthRoutes);
  mount('/auth', authRoutes);
  mount('/lists', listRoutes);
  mount('/lists', itemRoutes);

  return { router, routes };
}
