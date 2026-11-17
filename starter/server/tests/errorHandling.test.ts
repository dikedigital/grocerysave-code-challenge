/**
 * The central error handler with real errors (D-110, D-111): real Postgres errors from
 * TEST_DATABASE_URL, thrown HttpErrors, ZodErrors and non-Error values, through HTTP.
 *
 * createApp has no routes that fail on purpose, so these tests mount throwing routes on a small app
 * assembled exactly as createApp assembles its own: the same JSON parser, asyncHandler, JSON 404 and
 * error handler. createApp's own wiring is covered by app.test.ts (a 500 from a dead database).
 */
import express from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { z } from 'zod';
import { HttpError, forbidden, notFound } from '../src/httpError';
import { createLogger, memorySink } from '../src/logger';
import { asyncHandler } from '../src/middleware/asyncHandler';
import { createErrorHandler } from '../src/middleware/errorHandler';
import { apiNotFound } from '../src/middleware/notFound';
import { resetDatabase, testPool } from './helpers/db';

jest.setTimeout(30000);

let pool: Pool;
let userId: string;
const EMAIL = 'taken@grocerysave.test';

beforeAll(async () => {
  pool = testPool();
  await resetDatabase(pool);
  const { rows } = await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id", [EMAIL]);
  userId = rows[0].id;
});
afterAll(async () => {
  await pool.end();
});

/** Each route runs one statement that Postgres rejects, with parameters as the services will pass them. */
const failingQueries: Record<string, [string, unknown[]]> = {
  'bad-uuid': ['SELECT * FROM shopping_lists WHERE id = $1', ['not-a-uuid']],
  'int-overflow': ['SELECT $1::int', ['99999999999']],
  'bad-date': ['SELECT $1::date', ['2026-13-45']],
  'nul-byte': ['SELECT $1::text', ['Milk\u0000']],
  'numeric-overflow': ['SELECT $1::numeric(10, 2)', ['1e20']], // travel_cost_per_km is numeric(10, 2)
  'not-null': ['INSERT INTO shopping_lists (owner_id, name) VALUES ($1, NULL)', [null]], // owner filled in below
  check: ['INSERT INTO user_preferences (user_id, max_stores) VALUES ($1, 9)', [null]],
  unique: ['INSERT INTO users (email, password_hash) VALUES ($1, $2)', [EMAIL, 'x']],
  'foreign-key': ['INSERT INTO shopping_lists (owner_id, name) VALUES (gen_random_uuid(), $1)', ['Orphan']],
  'undefined-table': ['SELECT * FROM no_such_table', []],
};

function buildApp() {
  const sink = memorySink();
  const log = createLogger({ level: 'debug', sinks: [sink], component: 'test.http' });
  const app = express();
  app.use('/api', express.json());
  app.get(
    '/api/pg/:name',
    asyncHandler(async (req) => {
      const [sql, params] = failingQueries[req.params.name];
      await pool.query(sql, params.map((p) => (p === null ? userId : p)));
    }),
  );
  app.get('/api/http/:status', (req) => {
    throw new HttpError(Number(req.params.status), `thrown ${req.params.status}`);
  });
  app.get(
    '/api/async-http',
    asyncHandler(async () => {
      throw forbidden('Only the owner may delete this list');
    }),
  );
  app.get(
    '/api/async-not-found',
    asyncHandler(async () => {
      await pool.query('SELECT 1');
      throw notFound('List not found');
    }),
  );
  app.post(
    '/api/zod',
    asyncHandler(async (req, res) => {
      const body = z.object({ name: z.string().min(1, 'is required'), quantity: z.number().positive('must be greater than 0').optional() }).parse(req.body);
      res.status(201).json(body);
    }),
  );
  app.get(
    '/api/reject/:what',
    asyncHandler(async (req) => {
      const values: Record<string, unknown> = { undefined: undefined, null: null, route: 'route', router: 'router', object: { reason: 'odd' } };
      throw values[req.params.what];
    }),
  );
  app.get('/api/late-failure', (_req, res, next) => {
    res.status(200).write('partial');
    next(new Error('failed after writing'));
  });
  app.use('/api', apiNotFound);
  app.use(createErrorHandler(log));
  return { app, sink };
}

describe('Postgres input errors are never 500 (TECH_SPEC 6.1)', () => {
  it.each([
    ['bad-uuid', 400, 'Invalid input', '22P02'],
    ['int-overflow', 400, 'Invalid input', '22003'],
    ['bad-date', 400, 'Invalid input', '22008'],
    ['nul-byte', 400, 'Invalid input', '22021'],
    ['numeric-overflow', 400, 'Invalid input', '22003'],
    ['not-null', 400, 'Invalid input', '23502'],
    ['check', 400, 'Invalid input', '23514'],
    ['unique', 409, 'Already exists', '23505'],
    ['foreign-key', 404, 'Referenced resource not found', '23503'],
  ])('%s: %p { error: %p } (SQLSTATE %s), logged at warn', async (name, status, message, code) => {
    const { app, sink } = buildApp();
    const res = await request(app).get(`/api/pg/${name}`);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: message });
    const warned = sink.records.filter((r) => r.event === 'database_input_rejected');
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ level: 'warn', code, status, method: 'GET', path: `/api/pg/${name}` });
    expect(sink.records.filter((r) => r.level === 'error')).toEqual([]);
  });

  it('the unique violation names the constraint in the log, but not the duplicate email (pg puts it in `detail`)', async () => {
    const { app, sink } = buildApp();
    await request(app).get('/api/pg/unique');
    const [record] = sink.records.filter((r) => r.event === 'database_input_rejected');
    expect(record).toMatchObject({ constraint: 'users_email_key', table: 'users' });
    expect(JSON.stringify(sink.records)).not.toContain(EMAIL);
  });

  it('a Postgres error that is a server bug (undefined table) stays a 500, logged at error', async () => {
    const { app, sink } = buildApp();
    const res = await request(app).get('/api/pg/undefined-table');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toContain('no_such_table');
    const [record] = sink.records.filter((r) => r.event === 'request_failed');
    expect(record).toMatchObject({ level: 'error', code: '42P01', status: 500 });
    expect(String(record.error)).toContain('no_such_table');
  });
});

describe('HttpError, from sync and async handlers', () => {
  it.each([400, 401, 403, 404, 409])('HttpError %p gives that status and its message; not logged as a failure', async (status) => {
    const { app, sink } = buildApp();
    const res = await request(app).get(`/api/http/${status}`);
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: `thrown ${status}` });
    expect(sink.records.filter((r) => r.level === 'error' || r.level === 'warn')).toEqual([]);
  });

  it('HttpError 500 hides its message', async () => {
    const { app, sink } = buildApp();
    const res = await request(app).get('/api/http/500');
    expect([res.status, res.body]).toEqual([500, { error: 'Internal server error' }]);
    expect(sink.records.find((r) => r.event === 'request_failed')?.error).toBe('thrown 500');
  });

  it('thrown from async handlers (after a query, too)', async () => {
    const { app } = buildApp();
    const res1 = await request(app).get('/api/async-http');
    expect([res1.status, res1.body]).toEqual([403, { error: 'Only the owner may delete this list' }]);
    const res2 = await request(app).get('/api/async-not-found');
    expect([res2.status, res2.body]).toEqual([404, { error: 'List not found' }]);
  });
});

describe('zod validation errors', () => {
  it('a failed schema.parse is 400 naming each field', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/zod').send({ name: '', quantity: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'name: is required; quantity: must be greater than 0' });
  });

  it('a request without a JSON body reaches the schema as {} and fails validation, not parsing', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/zod');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^name: /);
  });

  it('a valid body passes', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/zod').send({ name: 'Milk', quantity: 2 });
    expect([res.status, res.body]).toEqual([201, { name: 'Milk', quantity: 2 }]);
  });
});

describe('rejections with non-Error values are 500, never a silent 404', () => {
  it.each(['undefined', 'null', 'route', 'router', 'object'])('Promise.reject(%s) is a JSON 500', async (what) => {
    const { app, sink } = buildApp();
    const res = await request(app).get(`/api/reject/${what}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(sink.records.filter((r) => r.event === 'request_failed')).toHaveLength(1);
  });
});

describe('an error after the response has started', () => {
  it('is logged once and handed to Express (no attempt at a second, JSON, response)', async () => {
    const { app, sink } = buildApp();
    // What the client then sees (partial body, "aborted", a reset) is Express's and Node's business.
    const outcome = await request(app)
      .get('/api/late-failure')
      .timeout(5000)
      .then(
        (res) => res.text,
        (error: Error) => `client error: ${error.message}`,
      );
    expect(outcome).not.toContain('Internal server error');
    expect(sink.records.filter((r) => r.event === 'response_failed')).toHaveLength(1);
    expect(sink.records.filter((r) => r.event === 'request_failed')).toEqual([]);
  });
});
