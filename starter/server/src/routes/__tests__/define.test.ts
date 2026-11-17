import express, { Router, type RequestHandler } from 'express';
import request from 'supertest';
import { isUuid } from '../../middleware/validate';
import { joinPath, routeBuilder, type RouteInfo } from '../define';

describe('joinPath', () => {
  it.each([
    ['/auth', '/me', '/auth/me'],
    ['/health', '/', '/health'],
    ['/lists', '/:id/items', '/lists/:id/items'],
    ['/lists/', '//x', '/lists/x'],
    ['', '/', '/'],
  ])('%p + %p = %p', (prefix, path, joined) => {
    expect(joinPath(prefix, path)).toBe(joined);
  });
});

describe('isUuid', () => {
  it.each([
    ['3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69', true],
    ['3F0C6A9E-2B1D-4C8E-9A7F-1E2D3C4B5A69', true],
    ['3f0c6a9e2b1d4c8e9a7f1e2d3c4b5a69', false],
    ['{3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69}', false],
    ['3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a6', false],
    ['not-a-uuid', false],
    ['', false],
    [42, false],
    [null, false],
  ])('%p: %p', (value, expected) => {
    expect(isUuid(value)).toBe(expected);
  });
});

describe('routeBuilder (D-117)', () => {
  /** An app with one router built by routeBuilder; the "auth" check refuses everything with 401. */
  function build(declare: (r: ReturnType<typeof routeBuilder>) => void) {
    const table: RouteInfo[] = [];
    const router = Router();
    const denyAll: RequestHandler = (_req, res) => {
      res.status(401).json({ error: 'no' });
    };
    declare(routeBuilder(router, '/things', denyAll, table));
    const app = express();
    app.use('/things', router);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      res.status(500).json({ error: String((error as Error).message) });
    });
    return { app, table };
  }

  it('routes are signed-in by default: the auth check runs first and the handler never does', async () => {
    const handler = jest.fn(async (_req: express.Request, res: express.Response) => {
      res.json({ reached: true });
    });
    const { app, table } = build((r) => {
      r.get('/', handler);
      r.post('/:id', handler);
      r.put('/:id', handler);
      r.patch('/:id', handler);
      r.delete('/:id', handler);
    });
    for (const [method, path] of [['get', '/things'], ['post', '/things/1'], ['put', '/things/1'], ['patch', '/things/1'], ['delete', '/things/1']] as const) {
      expect((await request(app)[method](path)).status).toBe(401);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(table).toEqual([
      { method: 'GET', path: '/things', access: 'signed-in' },
      { method: 'POST', path: '/things/:id', access: 'signed-in' },
      { method: 'PUT', path: '/things/:id', access: 'signed-in' },
      { method: 'PATCH', path: '/things/:id', access: 'signed-in' },
      { method: 'DELETE', path: '/things/:id', access: 'signed-in' },
    ]);
  });

  it('public routes skip the auth check and are recorded as public', async () => {
    const { app, table } = build((r) => {
      r.public.get('/open', async (_req, res) => {
        res.json({ reached: true });
      });
    });
    const res = await request(app).get('/things/open');
    expect([res.status, res.body]).toEqual([200, { reached: true }]);
    expect(table).toEqual([{ method: 'GET', path: '/things/open', access: 'public' }]);
  });

  it('handlers are wrapped in asyncHandler: a rejection reaches the error handler', async () => {
    const { app } = build((r) => {
      r.public.get('/boom', async () => {
        throw new Error('boom');
      });
    });
    const res = await request(app).get('/things/boom');
    expect([res.status, res.body]).toEqual([500, { error: 'boom' }]);
  });
});
