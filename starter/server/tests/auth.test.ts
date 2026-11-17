/**
 * Authentication through HTTP against TEST_DATABASE_URL (TECH_SPEC 6.1, 6.3; decisions D-117 to D-124):
 * register, login, me, and requireAuth in front of every route except health, register and login.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import request from 'supertest';
import type { AuthResponse } from '../../src/models';
import { createApp, listApiRoutes } from '../src/app';
import { DEMO_DISPLAY_NAME, DEMO_EMAIL, DEMO_PASSWORD, seedCatalog, seedDemo } from '../src/db/seed';
import { createLogger, memorySink, silentLogger } from '../src/logger';
import { count, resetDatabase, testPool } from './helpers/db';

jest.setTimeout(60000);

const SECRET = 'auth-test-secret';
const PASSWORD = 'correct horse battery';

let pool: Pool;
beforeAll(async () => {
  pool = testPool();
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE');
});

function appWithLog() {
  const sink = memorySink();
  const app = createApp(pool, { jwtSecret: SECRET, logger: createLogger({ level: 'debug', sinks: [sink], component: 'test.http' }) });
  return { app, sink };
}

const register = (app: ReturnType<typeof createApp>, body: unknown) => request(app).post('/api/auth/register').send(body as object);
const login = (app: ReturnType<typeof createApp>, body: unknown) => request(app).post('/api/auth/login').send(body as object);
const me = (app: ReturnType<typeof createApp>, authorization?: string) => {
  const req = request(app).get('/api/auth/me');
  return authorization === undefined ? req : req.set('Authorization', authorization);
};
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Registers a user and returns the response body. */
async function signUp(app: ReturnType<typeof createApp>, email = 'ana@example.com', password = PASSWORD, displayName?: string): Promise<AuthResponse> {
  const res = await register(app, { email, password, displayName });
  expect(res.status).toBe(201);
  return res.body as AuthResponse;
}

describe('POST /api/auth/register', () => {
  it('201 { token, user }: email trimmed and lower-cased, name trimmed, nothing else in the answer', async () => {
    const { app } = appWithLog();
    const res = await register(app, { email: '  Ana.Silva@Example.COM ', password: PASSWORD, displayName: '  Ana Silva  ' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['token', 'user']);
    expect(res.body.user).toEqual({ id: expect.any(String), email: 'ana.silva@example.com', displayName: 'Ana Silva' });
    expect(res.text).not.toMatch(/password|hash|\$2[aby]\$/i);
  });

  it('stores a bcrypt hash (cost 10) of the password, never the password itself', async () => {
    const { app } = appWithLog();
    const { user } = await signUp(app);
    const { rows } = await pool.query('SELECT email, password_hash, display_name FROM users WHERE id = $1', [user.id]);
    expect(rows[0].email).toBe('ana@example.com');
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$10\$.{53}$/);
    expect(rows[0].password_hash).not.toContain(PASSWORD);
    expect(bcrypt.compareSync(PASSWORD, rows[0].password_hash)).toBe(true);
  });

  it('the token is HS256, subject = the new user id, valid for 7 days, and works at once', async () => {
    const { app } = appWithLog();
    const { token, user } = await signUp(app);
    const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'], complete: true });
    expect(decoded.header.alg).toBe('HS256');
    const payload = decoded.payload as jwt.JwtPayload;
    expect(payload.sub).toBe(user.id);
    expect(payload.exp! - payload.iat!).toBe(7 * 24 * 60 * 60);
    expect(Math.abs(payload.iat! - nowSeconds())).toBeLessThanOrEqual(5);
    const res = await me(app, `Bearer ${token}`);
    expect([res.status, res.body]).toEqual([200, { user }]);
  });

  it.each([
    ['omitted', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', '   '],
  ])('a display name that is %s is stored as "" (the client then shows the email)', async (_label, displayName) => {
    const { app } = appWithLog();
    const { user } = await signUp(app, 'ana@example.com', PASSWORD, displayName as string | undefined);
    expect(user.displayName).toBe('');
  });

  it('a duplicate email in a different case (and with spaces) is 409; the first account is untouched', async () => {
    const { app } = appWithLog();
    const first = await signUp(app, 'ana@example.com', PASSWORD, 'Ana');
    for (const email of ['ANA@EXAMPLE.COM', 'Ana@Example.com', '  ana@example.com  ']) {
      const res = await register(app, { email, password: 'another password', displayName: 'Impostor' });
      expect([email, res.status, res.body]).toEqual([email, 409, { error: 'An account with this email already exists' }]);
    }
    expect(await count(pool, 'users')).toBe(1);
    const res = await login(app, { email: 'ana@example.com', password: PASSWORD });
    expect([res.status, res.body.user]).toEqual([200, first.user]);
    expect((await login(app, { email: 'ana@example.com', password: 'another password' })).status).toBe(401);
  });

  it('five simultaneous sign-ups with the same email in different cases: one 201, four 409, never 500', async () => {
    const { app } = appWithLog();
    const emails = ['race@example.com', 'RACE@example.com', 'Race@Example.com', 'race@EXAMPLE.COM', ' race@example.com'];
    const statuses = (await Promise.all(emails.map((email) => register(app, { email, password: PASSWORD })))).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(await count(pool, 'users')).toBe(1);
  });

  it.each([
    'nope',
    'ana@',
    '@example.com',
    'ana@example',
    'ana @example.com',
    'ana@exa mple.com',
    'ana@@example.com',
    'ana@example..com',
    '.ana@example.com',
    'josé@example.com',
    `${'a'.repeat(245)}@example.com`, // 257 characters, over 254
  ])('the bad email %j is 400', async (email) => {
    const { app } = appWithLog();
    const res = await register(app, { email, password: PASSWORD });
    expect([res.status, res.body]).toEqual([400, { error: 'email: must be a valid email address' }]);
    expect(await count(pool, 'users')).toBe(0);
  });

  it.each([
    [{ password: PASSWORD }, 'email: is required'],
    [{ email: '', password: PASSWORD }, 'email: is required'],
    [{ email: '   ', password: PASSWORD }, 'email: is required'],
    [{ email: 42, password: PASSWORD }, 'email: must be text'],
    [{ email: ['a@b.co'], password: PASSWORD }, 'email: must be text'],
  ])('a missing or non-text email %j is 400 %p', async (body, error) => {
    const res = await register(appWithLog().app, body);
    expect([res.status, res.body]).toEqual([400, { error }]);
  });

  it.each([
    ['short', 'must be at least 8 characters'],
    ['1234567', 'must be at least 8 characters'],
    ['', 'must be at least 8 characters'],
    ['🙂'.repeat(7), 'must be at least 8 characters'], // 14 UTF-16 units, 7 characters
    ['a'.repeat(73), 'must be at most 72 bytes (72 plain letters or digits; fewer with accents or emoji)'],
    ['é'.repeat(37), 'must be at most 72 bytes (72 plain letters or digits; fewer with accents or emoji)'],
  ])('the password %j is 400', async (password, problem) => {
    const res = await register(appWithLog().app, { email: 'ana@example.com', password });
    expect([res.status, res.body]).toEqual([400, { error: `password: ${problem}` }]);
    expect(await count(pool, 'users')).toBe(0);
  });

  it.each([
    ['exactly 8 characters', '12345678'],
    ['8 emoji', '🙂'.repeat(8)],
    ['72 bytes', 'a'.repeat(72)],
    ['36 accented letters (72 bytes)', 'é'.repeat(36)],
    ['8 spaces', '        '],
  ])('the password of %s is accepted', async (_label, password) => {
    const { app } = appWithLog();
    await signUp(app, 'ana@example.com', password);
    expect((await login(app, { email: 'ana@example.com', password })).status).toBe(200);
  });

  it.each([
    [{ email: 'ana@example.com' }, 'password: is required'],
    [{ email: 'ana@example.com', password: 12345678 }, 'password: must be text'],
    [{ email: 'ana@example.com', password: PASSWORD, displayName: 'x'.repeat(81) }, 'displayName: must be at most 80 characters'],
    [{ email: 'ana@example.com', password: PASSWORD, displayName: 'Ana\nSilva' }, 'displayName: must not contain control characters'],
    [{ email: 'ana@example.com', password: PASSWORD, displayName: 7 }, 'displayName: must be text'],
    [{}, 'email: is required; password: is required'],
    [{ email: 'nope', password: 'short' }, 'email: must be a valid email address; password: must be at least 8 characters'],
  ])('%j is 400 %p', async (body, error) => {
    const res = await register(appWithLog().app, body);
    expect([res.status, res.body]).toEqual([400, { error }]);
  });

  it('a display name of exactly 80 characters is kept', async () => {
    const { user } = await signUp(appWithLog().app, 'ana@example.com', PASSWORD, 'x'.repeat(80));
    expect(user.displayName).toHaveLength(80);
  });

  it('a body that is not a JSON object is 400', async () => {
    const { app } = appWithLog();
    const array = await request(app).post('/api/auth/register').send([]);
    expect([array.status, array.body]).toEqual([400, { error: 'The request body must be a JSON object' }]);
    const none = await request(app).post('/api/auth/register');
    expect([none.status, none.body]).toEqual([400, { error: 'email: is required; password: is required' }]);
    const nullBody = await request(app).post('/api/auth/register').set('Content-Type', 'application/json').send('null');
    expect([nullBody.status, nullBody.body]).toEqual([400, { error: 'Malformed JSON body' }]);
  });

  it('the log records the new user id, never the email or the password', async () => {
    const { app, sink } = appWithLog();
    const { user } = await signUp(app, 'secret.person@example.com', 'hunter2-hunter2');
    await register(app, { email: 'secret.person@example.com', password: 'hunter2-hunter2' });
    expect(sink.records.find((r) => r.event === 'user_registered')).toMatchObject({ level: 'info', userId: user.id });
    expect(sink.records.find((r) => r.event === 'registration_refused')).toMatchObject({ level: 'info', reason: 'email_taken' });
    const logged = JSON.stringify(sink.records);
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('secret.person');
  });
});

describe('POST /api/auth/login', () => {
  it('200 { token, user } for the right password; the email is matched trimmed and case-insensitively', async () => {
    const { app } = appWithLog();
    const { user } = await signUp(app, 'ana@example.com', PASSWORD, 'Ana');
    const res = await login(app, { email: '  ANA@Example.com ', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['token', 'user']);
    expect(res.body.user).toEqual(user);
    expect((jwt.verify(res.body.token, SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload).sub).toBe(user.id);
    expect((await me(app, `Bearer ${res.body.token}`)).body).toEqual({ user });
  });

  it('a wrong password and an unknown email give the same 401 and the same body', async () => {
    const { app, sink } = appWithLog();
    await signUp(app, 'ana@example.com');
    const wrong = await login(app, { email: 'ana@example.com', password: 'not the password' });
    const unknown = await login(app, { email: 'nobody@example.com', password: PASSWORD });
    expect([wrong.status, wrong.body]).toEqual([401, { error: 'Invalid email or password' }]);
    expect([unknown.status, unknown.body]).toEqual([wrong.status, wrong.body]);
    expect(Object.keys(unknown.headers).sort()).toEqual(Object.keys(wrong.headers).sort());
    expect(sink.records.filter((r) => r.event === 'login_failed').map((r) => r.reason)).toEqual(['wrong_password', 'unknown_email']);
    expect(JSON.stringify(sink.records)).not.toMatch(/not the password|nobody@|ana@example/);
  });

  it('an email with a control character (NUL) is a plain failed login: 401, no query, no warning (security pass, D-152)', async () => {
    const { app, sink } = appWithLog();
    await signUp(app, 'ana@example.com');
    const query = jest.spyOn(pool, 'query');
    try {
      for (const email of ['ana\u0000@example.com', 'ana@example.com\u0000', 'ana\n@example.com']) {
        const res = await login(app, { email, password: PASSWORD });
        expect([res.status, res.body]).toEqual([401, { error: 'Invalid email or password' }]);
      }
      expect(query.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('password_hash'))).toEqual([]);
    } finally {
      query.mockRestore();
    }
    expect(sink.records.filter((r) => r.event === 'database_input_rejected')).toEqual([]);
    expect(sink.records.filter((r) => r.event === 'login_failed').map((r) => r.reason)).toEqual(['unknown_email', 'unknown_email', 'unknown_email']);
  });

  it('the password is compared exactly: case and surrounding spaces matter', async () => {
    const { app } = appWithLog();
    await signUp(app, 'ana@example.com', '  Spaced Out  ');
    expect((await login(app, { email: 'ana@example.com', password: '  Spaced Out  ' })).status).toBe(200);
    expect((await login(app, { email: 'ana@example.com', password: 'Spaced Out' })).status).toBe(401);
    expect((await login(app, { email: 'ana@example.com', password: '  spaced out  ' })).status).toBe(401);
  });

  it('the 72-byte password followed by anything is refused (bcrypt would ignore the extra bytes)', async () => {
    const { app } = appWithLog();
    const exactly72 = 'k'.repeat(72);
    await signUp(app, 'ana@example.com', exactly72);
    expect((await login(app, { email: 'ana@example.com', password: exactly72 })).status).toBe(200);
    expect((await login(app, { email: 'ana@example.com', password: `${exactly72}x` })).status).toBe(401);
  });

  it('the same accented password typed in NFC or NFD logs in', async () => {
    const { app } = appWithLog();
    const nfd = 'cre\u0300me-bru\u0302le\u0301e';
    await signUp(app, 'ana@example.com', nfd);
    expect((await login(app, { email: 'ana@example.com', password: nfd.normalize('NFC') })).status).toBe(200);
  });

  it('a badly formed email or a short password is 401, not 400: login does not reveal the rules', async () => {
    const { app } = appWithLog();
    expect((await login(app, { email: 'nope', password: PASSWORD })).status).toBe(401);
    expect((await login(app, { email: 'ana@example.com', password: 'x' })).status).toBe(401);
  });

  it.each([
    [{}, 'email: is required; password: is required'],
    [{ email: '  ', password: PASSWORD }, 'email: is required'],
    [{ email: 'ana@example.com', password: '' }, 'password: is required'],
    [{ email: 1, password: PASSWORD }, 'email: must be text'],
    [{ email: 'ana@example.com', password: null }, 'password: must be text'],
  ])('empty or non-text input %j is 400 %p', async (body, error) => {
    const res = await login(appWithLog().app, body);
    expect([res.status, res.body]).toEqual([400, { error }]);
  });

  it('the seeded demo user logs in with demo1234 (the seed hashes like registration)', async () => {
    await seedCatalog(pool, { logger: silentLogger });
    await seedDemo(pool, { logger: silentLogger });
    const res = await login(appWithLog().app, { email: DEMO_EMAIL.toUpperCase(), password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: DEMO_EMAIL, displayName: DEMO_DISPLAY_NAME });
  });
});

describe('GET /api/auth/me and requireAuth', () => {
  it('200 { user } with a valid token; "bearer" in any case and extra spaces are fine', async () => {
    const { app } = appWithLog();
    const { token, user } = await signUp(app, 'ana@example.com', PASSWORD, 'Ana');
    for (const header of [`Bearer ${token}`, `bearer ${token}`, `BEARER   ${token}  `]) {
      const res = await me(app, header);
      expect([res.status, res.body]).toEqual([200, { user }]);
    }
  });

  it('a missing token is 401 "Authentication required" with WWW-Authenticate: Bearer', async () => {
    const { app } = appWithLog();
    for (const header of [undefined, '', '   ']) {
      const res = await me(app, header);
      expect([header, res.status, res.body]).toEqual([header, 401, { error: 'Authentication required' }]);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
  });

  const validUserToken = async (app: ReturnType<typeof createApp>) => (await signUp(app)).token;

  it.each([
    ['a garbage token', async () => 'Bearer garbage'],
    ['three dots', async () => 'Bearer ...'],
    ['"Bearer" with no token', async () => 'Bearer'],
    ['another scheme', async () => 'Basic YW5hOnBhc3N3b3Jk'],
    ['the token without "Bearer"', async (app: ReturnType<typeof createApp>) => validUserToken(app)],
    ['the same token twice', async (app: ReturnType<typeof createApp>) => {
      const token = await validUserToken(app);
      return `Bearer ${token} ${token}`;
    }],
    ['a token signed with another secret', async (app: ReturnType<typeof createApp>) => {
      const { user } = await signUp(app, 'other@example.com');
      return `Bearer ${jwt.sign({}, 'not-the-secret', { algorithm: 'HS256', subject: user.id, expiresIn: 600 })}`;
    }],
    ['an alg:none token', async (app: ReturnType<typeof createApp>) => {
      const { user } = await signUp(app, 'other@example.com');
      return `Bearer ${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, iat: nowSeconds(), exp: nowSeconds() + 600 })}.`;
    }],
    ['an HS512 token with the right secret', async (app: ReturnType<typeof createApp>) => {
      const { user } = await signUp(app, 'other@example.com');
      return `Bearer ${jwt.sign({}, SECRET, { algorithm: 'HS512', subject: user.id, expiresIn: 600 })}`;
    }],
    ['a token without expiry', async (app: ReturnType<typeof createApp>) => {
      const { user } = await signUp(app, 'other@example.com');
      return `Bearer ${jwt.sign({ sub: user.id }, SECRET, { algorithm: 'HS256' })}`;
    }],
    ['a token whose subject is not a uuid', async () => `Bearer ${jwt.sign({}, SECRET, { algorithm: 'HS256', subject: 'not-a-uuid', expiresIn: 600 })}`],
    ['a tampered token (subject swapped, old signature)', async (app: ReturnType<typeof createApp>) => {
      const victim = await signUp(app, 'victim@example.com');
      const [header, , signature] = (await signUp(app, 'attacker@example.com')).token.split('.');
      return `Bearer ${header}.${b64({ sub: victim.user.id, iat: nowSeconds(), exp: nowSeconds() + 600 })}.${signature}`;
    }],
  ])('%s is 401 "Invalid token" with error="invalid_token"', async (_label, makeHeader) => {
    const { app } = appWithLog();
    const header = await makeHeader(app);
    const res = await me(app, header);
    expect([res.status, res.body]).toEqual([401, { error: 'Invalid token' }]);
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('an expired token is 401 "Session expired, please sign in again"', async () => {
    const { app } = appWithLog();
    const { user } = await signUp(app);
    const expired = jwt.sign({ sub: user.id, iat: nowSeconds() - 8 * 86400, exp: nowSeconds() - 86400 }, SECRET, { algorithm: 'HS256' });
    const res = await me(app, `Bearer ${expired}`);
    expect([res.status, res.body]).toEqual([401, { error: 'Session expired, please sign in again' }]);
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('a token for a user that was deleted is 401 (the user is looked up on every request)', async () => {
    const { app, sink } = appWithLog();
    const { token, user } = await signUp(app);
    expect((await me(app, `Bearer ${token}`)).status).toBe(200);
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    const res = await me(app, `Bearer ${token}`);
    expect([res.status, res.body]).toEqual([401, { error: 'Invalid token' }]);
    expect(sink.records.filter((r) => r.event === 'auth_rejected').map((r) => r.reason)).toEqual(['user_not_found']);
  });

  it('a token made by an app with another secret is refused by this one', async () => {
    const other = createApp(pool, { jwtSecret: 'another-secret', logger: silentLogger });
    const { token } = await signUp(other);
    const res = await me(appWithLog().app, `Bearer ${token}`);
    expect([res.status, res.body]).toEqual([401, { error: 'Invalid token' }]);
  });

  it('rejections are logged at debug with a reason, never with the token', async () => {
    const { app, sink } = appWithLog();
    const { token } = await signUp(app);
    await me(app);
    await me(app, 'Basic abc');
    await me(app, `Bearer ${token.slice(0, -2)}xx`);
    const rejected = sink.records.filter((r) => r.event === 'auth_rejected');
    expect(rejected.map((r) => [r.level, r.reason])).toEqual([['debug', 'missing'], ['debug', 'malformed_header'], ['debug', 'invalid']]);
    expect(JSON.stringify(sink.records)).not.toContain(token.slice(0, 40));
  });
});

describe('which routes need a token (D-117)', () => {
  it('only GET /api/health, POST /api/auth/register and POST /api/auth/login are public', () => {
    const routes = listApiRoutes(appWithLog().app);
    expect(routes.filter((r) => r.access === 'public').map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /api/health',
      'POST /api/auth/login',
      'POST /api/auth/register',
    ]);
    expect(routes.filter((r) => r.access === 'signed-in').length).toBeGreaterThan(0);
  });

  it('every other declared route answers 401 without a token or with a bad one (before looking at the request)', async () => {
    const { app } = appWithLog();
    const routes = listApiRoutes(app).filter((r) => r.access === 'signed-in');
    for (const route of routes) {
      const path = route.path.replace(/:[A-Za-z]+/g, '3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69');
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
      for (const header of [undefined, 'Bearer garbage']) {
        let req = request(app)[method](path).send({});
        if (header) req = req.set('Authorization', header);
        const res = await req;
        expect([route.method, route.path, header, res.status]).toEqual([route.method, route.path, header, 401]);
      }
    }
  });

  it('the public routes answer without a token', async () => {
    const { app } = appWithLog();
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await register(app, {})).status).toBe(400);
    expect((await login(app, {})).status).toBe(400);
  });

  it('unknown paths and methods under /api/auth are 404 for everyone, not 401 (D-108)', async () => {
    const { app } = appWithLog();
    for (const [method, path] of [['get', '/api/auth/nope'], ['post', '/api/auth/me'], ['get', '/api/auth/login'], ['delete', '/api/auth/me']] as const) {
      for (const header of [undefined, 'Bearer garbage']) {
        let req = request(app)[method](path);
        if (header) req = req.set('Authorization', header);
        const res = await req;
        expect([method, path, header, res.status, res.body]).toEqual([method, path, header, 404, { error: `Not found: ${method.toUpperCase()} ${path}` }]);
      }
    }
  });

  it('createApp refuses an empty JWT secret', () => {
    expect(() => createApp(pool, { jwtSecret: '', logger: silentLogger })).toThrow('JWT secret');
  });
});
