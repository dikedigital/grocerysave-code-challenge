/**
 * The API skeleton through HTTP (supertest), against TEST_DATABASE_URL: createApp, GET /api/health,
 * the JSON 404 for unknown /api paths, the JSON 400 for malformed bodies and the central error
 * handler (TECH_SPEC 6.1 to 6.3; decisions D-104 to D-113).
 */
import net from 'node:net';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp, JSON_BODY_LIMIT } from '../src/app';
import { DEFAULT_JWT_SECRET } from '../src/config';
import { createPool } from '../src/db/pool';
import { createLogger, memorySink } from '../src/logger';
import { resetDatabase, testDatabaseUrl, testPool } from './helpers/db';

jest.setTimeout(30000);

let pool: Pool;
beforeAll(async () => {
  pool = testPool();
  await resetDatabase(pool); // TECH_SPEC 10: API tests start from an empty database
});
afterAll(async () => {
  await pool.end();
});

/** An app on `db` whose log records (debug and up) are collected in `sink.records`. */
function appWithLog(db: Pool = pool) {
  const sink = memorySink();
  const app = createApp(db, { logger: createLogger({ level: 'debug', sinks: [sink], component: 'test.http' }) });
  return { app, sink };
}

describe('createApp', () => {
  it('returns an Express app without listening', () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    try {
      const { app } = appWithLog();
      expect(typeof app).toBe('function'); // an Express app is a request handler
      expect(typeof app.listen).toBe('function');
      expect(listen).not.toHaveBeenCalled();
    } finally {
      listen.mockRestore();
    }
  });

  it('warns once when tokens would be signed with the built-in development secret (D-122)', () => {
    const records = (jwtSecret: string) => {
      const sink = memorySink();
      createApp(pool, { jwtSecret, logger: createLogger({ level: 'info', sinks: [sink] }) });
      return sink.records.filter((r) => r.event === 'jwt_secret_default');
    };
    const warned = records(DEFAULT_JWT_SECRET);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ level: 'warn', message: expect.stringContaining('JWT_SECRET is not set') });
    expect(JSON.stringify(warned)).not.toContain(DEFAULT_JWT_SECRET);
    expect(records('a-real-secret')).toEqual([]);
  });

  it('does not advertise Express (no X-Powered-By)', async () => {
    const res = await request(appWithLog().app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /api/health', () => {
  it('is 200 { ok: true } as JSON, after a SELECT 1 on the pool it was given', async () => {
    const query = jest.spyOn(pool, 'query');
    try {
      const res = await request(appWithLog().app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toEqual({ ok: true });
      expect(query).toHaveBeenCalledWith('SELECT 1');
    } finally {
      query.mockRestore();
    }
  });

  it('is public: no token, or any Authorization header, still gives 200', async () => {
    const { app } = appWithLog();
    for (const header of [undefined, 'Bearer not-a-jwt', 'Basic abc', '']) {
      const req = request(app).get('/api/health');
      if (header !== undefined) req.set('Authorization', header);
      const res = await req;
      expect([header, res.status, res.body]).toEqual([header, 200, { ok: true }]);
    }
  });

  it('accepts a trailing slash and HEAD', async () => {
    const { app } = appWithLog();
    expect((await request(app).get('/api/health/')).body).toEqual({ ok: true });
    expect((await request(app).head('/api/health')).status).toBe(200);
  });

  it('logs each request at debug: method, path without query string, status, duration; no headers', async () => {
    const { app, sink } = appWithLog();
    await request(app).get('/api/health?probe=1').set('Authorization', 'Bearer secret-token');
    await new Promise((resolve) => setImmediate(resolve)); // the record is written on the response's 'finish' event
    const records = sink.records.filter((r) => r.event === 'request_completed');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: 'debug', method: 'GET', path: '/api/health', status: 200 });
    expect(typeof records[0].durationMs).toBe('number');
    expect(JSON.stringify(sink.records)).not.toContain('secret-token');
  });
});

describe('the central error handler, when the database is down', () => {
  let deadPool: Pool;
  beforeAll(() => {
    // Same credentials and database name, a port where nothing listens: connections are refused at once.
    const url = new URL(testDatabaseUrl());
    url.hostname = '127.0.0.1';
    url.port = '1';
    deadPool = createPool(url.toString());
  });
  afterAll(async () => {
    await deadPool.end();
  });

  it('GET /api/health is a JSON 500 with a generic message; the cause is logged, not sent', async () => {
    const { app, sink } = appWithLog(deadPool);
    const res = await request(app).get('/api/health').set('Authorization', 'Bearer secret-token');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|stack/i);

    const failed = sink.records.filter((r) => r.event === 'request_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: 'error', method: 'GET', path: '/api/health', status: 500, code: 'ECONNREFUSED' });
    expect(String(failed[0].error)).toContain('ECONNREFUSED');
    expect(typeof failed[0].stack).toBe('string');
    expect(JSON.stringify(sink.records)).not.toContain('secret-token');
  });

  it('the app keeps serving after a failure', async () => {
    const { app } = appWithLog(deadPool);
    expect((await request(app).get('/api/health')).status).toBe(500);
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });
});

describe('unknown /api paths: JSON 404 for everyone', () => {
  const cases: Array<[string, string]> = [
    ['GET', '/api/nope'],
    ['GET', '/api'],
    ['GET', '/api/'],
    ['GET', '/api/does/not/exist'],
    ['GET', '/api/health/extra'],
    ['POST', '/api/nope'],
    ['PUT', '/api/nope/123'],
    ['PATCH', '/api/nope'],
    ['DELETE', '/api/nope'],
    // A known path with a method it does not support (D-109).
    ['POST', '/api/health'],
    ['DELETE', '/api/health'],
  ];

  it.each(cases)('%s %s is 404 { error } as JSON, with and without a token', async (method, path) => {
    const { app } = appWithLog();
    for (const token of [null, 'Bearer not-a-jwt']) {
      const agent = request(app);
      const req = method === 'GET' ? agent.get(path) : method === 'POST' ? agent.post(path) : method === 'PUT' ? agent.put(path) : method === 'PATCH' ? agent.patch(path) : agent.delete(path);
      if (token) req.set('Authorization', token);
      const res = await req;
      expect([token, res.status]).toEqual([token, 404]);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toEqual({ error: `Not found: ${method} ${path}` });
    }
  });

  it('the message leaves out the query string', async () => {
    const res = await request(appWithLog().app).get('/api/nope?q=milk&token=abc');
    expect(res.body).toEqual({ error: 'Not found: GET /api/nope' });
  });

  it('a valid JSON body does not change it: the route is unknown', async () => {
    const res = await request(appWithLog().app).post('/api/nope').send({ name: 'Milk' });
    expect(res.status).toBe(404);
  });

  it('an empty body declared as JSON is not an error either', async () => {
    const res = await request(appWithLog().app).post('/api/nope').set('Content-Type', 'application/json');
    expect(res.status).toBe(404);
  });

  it('paths outside /api are not answered by the JSON 404 (they belong to the web app, D-105)', async () => {
    const res = await request(appWithLog().app).get('/apifoo');
    expect(res.status).toBe(404);
    expect(res.headers['content-type'] ?? '').not.toMatch(/json/);
  });
});

describe('malformed JSON bodies: JSON 400', () => {
  const bodies = [
    ['truncated object', '{"email": "a@b.test", "password":'],
    ['single quotes', "{'email': 'a@b.test'}"],
    ['trailing comma', '{"name": "Milk",}'],
    ['unquoted key', '{name: "Milk"}'],
    ['not JSON at all', 'name=Milk'],
    ['a bare string (only objects and arrays are accepted)', '"Milk"'],
    ['a bare number', '42'],
    ['a misspelt literal', 'nul'],
  ];

  it.each(bodies)('%s is 400 { error: "Malformed JSON body" }', async (_label, body) => {
    const res = await request(appWithLog().app).post('/api/nope').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'Malformed JSON body' });
  });

  it('on every /api path, known or not, and with a charset in the Content-Type', async () => {
    const { app } = appWithLog();
    for (const path of ['/api/health', '/api/auth/login', '/api/lists/123/items']) {
      const res = await request(app).post(path).set('Content-Type', 'application/json; charset=utf-8').send('{"a":');
      expect([path, res.status, res.body]).toEqual([path, 400, { error: 'Malformed JSON body' }]);
    }
  });

  it('never echoes the body back or writes it to the log (it may hold a password)', async () => {
    const { app, sink } = appWithLog();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send("{'email': 'a@b.test', 'password': 'hunter2-secret'}");
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('hunter2');
    expect(JSON.stringify(sink.records)).not.toContain('hunter2');
    expect(sink.records.filter((r) => r.level === 'error')).toEqual([]);
  });

  it(`a body over ${JSON_BODY_LIMIT} is 413 { error }`, async () => {
    const body = JSON.stringify({ content: 'x'.repeat(1024 * 1024 + 1) });
    const res = await request(appWithLog().app).post('/api/nope').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body is too large' });
  });

  it('a body just under the limit is read (and the unknown route is then a 404)', async () => {
    const body = JSON.stringify({ content: 'x'.repeat(1000 * 1000) });
    const res = await request(appWithLog().app).post('/api/nope').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(404);
  });

  it('a charset other than UTF is 415 { error } as JSON', async () => {
    const res = await request(appWithLog().app).post('/api/nope').set('Content-Type', 'application/json; charset=latin1').send('{}');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'unsupported charset "LATIN1"' });
  });

  it('a malformed body outside /api is not parsed at all', async () => {
    const res = await request(appWithLog().app).post('/somewhere').set('Content-Type', 'application/json').send('{"a":');
    expect(res.status).toBe(404);
    expect(res.headers['content-type'] ?? '').not.toMatch(/json/);
  });
});

describe('security headers and OPTIONS on /api (security pass, D-150, D-151)', () => {
  it.each([
    ['GET', '/api/health', 200],
    ['GET', '/api/nope', 404],
    ['POST', '/api/nope', 400], // malformed body
  ])('%s %s (%p) has Cache-Control: no-store and X-Content-Type-Options: nosniff', async (method, path, status) => {
    const { app } = appWithLog();
    const req = method === 'GET' ? request(app).get(path) : request(app).post(path).set('Content-Type', 'application/json').send('{"a":');
    const res = await req;
    expect(res.status).toBe(status);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('also on a 401 from requireAuth', async () => {
    const { app } = appWithLog();
    const res = await request(app).get('/api/auth/me');
    expect([res.status, res.headers['cache-control'], res.headers['x-content-type-options']]).toEqual([401, 'no-store', 'nosniff']);
  });

  it.each(['/api/health', '/api/lists', '/api/lists/3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69', '/api/auth/login', '/api/nope'])(
    'OPTIONS %s is the JSON 404, with or without a token (Express would answer 200 with the methods)',
    async (path) => {
      const { app } = appWithLog();
      for (const token of [null, 'Bearer garbage']) {
        let req = request(app).options(path);
        if (token) req = req.set('Authorization', token);
        const res = await req;
        expect([path, token, res.status, res.body, res.headers.allow]).toEqual([path, token, 404, { error: `Not found: OPTIONS ${path}` }, undefined]);
      }
    },
  );

  it('outside /api nothing changes (the web app decides its own caching)', async () => {
    const res = await request(appWithLog().app).get('/index.html');
    expect(res.headers['cache-control']).toBeUndefined();
  });
});

