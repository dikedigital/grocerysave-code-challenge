import type { Request, Response } from 'express';
import { requestPath } from './requestPath';

/**
 * The JSON 404 for any `/api` request no route answered (TECH_SPEC 6.1: "unknown `/api` paths
 * (JSON, for everyone)"). Mounted after every API router, so it covers unknown paths and known
 * paths with an unsupported method (D-109). It comes before nothing that checks a token, so the
 * answer is the same with or without one (D-108).
 */
export function apiNotFound(req: Request, res: Response): void {
  res.status(404).json({ error: `Not found: ${req.method} ${requestPath(req)}` });
}
