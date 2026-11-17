import type { AppDeps } from '../deps';
import type { RouteBuilder } from './define';

/**
 * `GET /api/health`: `{ ok: true }` after a `SELECT 1` (TECH_SPEC 6.3). Public: no token needed.
 * When the database cannot be reached the query rejects and the central error handler answers
 * 500 `{ "error": "Internal server error" }` (D-113).
 */
export function healthRoutes(r: RouteBuilder, { pool }: AppDeps): void {
  r.public.get('/', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });
}
