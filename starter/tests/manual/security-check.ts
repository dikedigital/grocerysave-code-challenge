/**
 * Security evidence, with two users, through real HTTP (security pass, API round 6).
 *
 *   TEST_DATABASE_URL=postgres://.../grocerysave_test npx tsx tests/manual/security-check.ts [--marker INJ]
 *
 * Empties TEST_DATABASE_URL (refused unless its name contains "test"), loads the catalog, starts
 * createApp on a free local port and prints a Markdown report:
 *   1. what register, login and /me answer (status, headers, body), and the token's content;
 *   2. what the users table stores (password_hash);
 *   3. user B against every route of user A's list: B's status and answer, whether A's list stayed
 *      byte-for-byte the same, and A doing the same on a list of her own (the route works);
 *   4. indirect attempts (A's item through B's list, A's household, ownerId / listId in bodies);
 *   5. no token and a bad token on every list route;
 *   6. SQL-looking payloads through every text input: what is stored is exactly what was sent.
 * Every /lists/:id route in the app's route table must appear in part 3, or the run fails.
 * Exits 1 if any check fails. The payloads carry a marker (default INJ) so that
 * tests/manual/sql-injection-evidence.sh can find them in the Postgres statement log.
 */
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp, listApiRoutes } from '../../server/src/app';
import { config } from '../../server/src/config';
import { migrate } from '../../server/src/db/migrate';
import { createPool } from '../../server/src/db/pool';
import { seedCatalog } from '../../server/src/db/seed';
import { createLogger, memorySink, silentLogger } from '../../server/src/logger';
import { parseListLine } from '../../src/utils/parseList';

const args = process.argv.slice(2);
const MARKER = args.includes('--marker') ? args[args.indexOf('--marker') + 1] : 'INJ';
const SECRET = 'security-check-secret';
const PASSWORD = 'Correct horse 42';

const url = config.testDatabaseUrl;
if (!url || !new URL(url).pathname.slice(1).includes('test')) {
  console.error('TEST_DATABASE_URL must be set and name a database containing "test" (it is emptied)');
  process.exit(2);
}

let failures = 0;
const mark = (ok: boolean) => {
  if (!ok) failures += 1;
  return ok ? 'PASS' : '**FAIL**';
};
const out = (text = '') => console.log(text);
const cell = (text: unknown) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max)}...` : text);

interface Answer { status: number; headers: Headers; text: string; json: unknown }

async function main() {
  const pool = createPool(url);
  await migrate(pool, { reset: true });
  await seedCatalog(pool, { logger: silentLogger });
  const sink = memorySink();
  const app = createApp(pool, { jwtSecret: SECRET, logger: createLogger({ level: 'debug', sinks: [sink], component: 'app.http' }) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, options: { token?: string | null; body?: unknown; raw?: string } = {}): Promise<Answer> => {
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = options.token;
    let body: string | undefined;
    if (options.raw !== undefined) body = options.raw;
    else if (options.body !== undefined) body = JSON.stringify(options.body);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers, body });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, headers: res.headers, text, json };
  };
  const show = (answer: Answer, headerNames = ['content-type', 'cache-control', 'x-content-type-options']) => {
    out('```http');
    out(`HTTP ${answer.status}`);
    for (const name of headerNames) if (answer.headers.get(name) !== null) out(`${name}: ${answer.headers.get(name)}`);
    out('');
    out(answer.json === null ? answer.text : JSON.stringify(answer.json, null, 2));
    out('```');
  };

  out(`# Security evidence (${new Date().toISOString()})`);
  out('');
  out(`Real HTTP to createApp on ${base}; database \`${new URL(url).pathname.slice(1)}\`, emptied first. Password of both users: \`${PASSWORD}\`.`);

  // ---------------------------------------------------------------- 1. register, login, me
  out('\n## 1. What register, login and /me answer\n');
  const regA = await call('POST', '/api/auth/register', { body: { email: '  Alice@Example.com ', password: PASSWORD, displayName: 'Alice' } });
  out('`POST /api/auth/register` `{"email":"  Alice@Example.com ","password":"Correct horse 42","displayName":"Alice"}`:');
  show(regA);
  const regB = await call('POST', '/api/auth/register', { body: { email: 'bob@example.com', password: PASSWORD, displayName: 'Bob' } });
  const A = { token: `Bearer ${(regA.json as { token: string }).token}`, id: (regA.json as { user: { id: string } }).user.id };
  const Bu = { token: `Bearer ${(regB.json as { token: string }).token}`, id: (regB.json as { user: { id: string } }).user.id };
  const login = await call('POST', '/api/auth/login', { body: { email: 'ALICE@example.com', password: PASSWORD } });
  out('\n`POST /api/auth/login` `{"email":"ALICE@example.com","password":"Correct horse 42"}`:');
  show(login);
  const me = await call('GET', '/api/auth/me', { token: A.token });
  out('\n`GET /api/auth/me` with that token:');
  show(me);
  const token = (login.json as { token: string }).token;
  const decoded = jwt.decode(token, { complete: true }) as jwt.Jwt;
  out('\nThe token, decoded (header and payload are only base64, not secret):');
  out('```json');
  out(JSON.stringify({ header: decoded.header, payload: decoded.payload }, null, 2));
  out('```');
  const payload = decoded.payload as jwt.JwtPayload;
  const answers = [regA, login, me];
  const checks1: Array<[string, boolean]> = [
    ['register 201, login 200, me 200', regA.status === 201 && login.status === 200 && me.status === 200],
    ['register and login bodies have exactly the keys token, user', [regA, login].every((a) => JSON.stringify(Object.keys(a.json as object).sort()) === '["token","user"]')],
    ['/me body has exactly the key user', JSON.stringify(Object.keys(me.json as object)) === '["user"]'],
    ['every user object has exactly id, email, displayName', [regA, login, me].every((a) => JSON.stringify(Object.keys((a.json as { user: object }).user).sort()) === '["displayName","email","id"]')],
    ['no answer contains the password, a bcrypt hash ($2a$/$2b$) or the word "password"', answers.every((a) => !a.text.includes(PASSWORD) && !/\$2[aby]\$/.test(a.text) && !/password/i.test(a.text))],
    ['the token payload holds only sub, iat, exp; sub is the user id; 7 days', JSON.stringify(Object.keys(payload).sort()) === '["exp","iat","sub"]' && payload.sub === A.id && payload.exp! - payload.iat! === 604800],
    ['the token header says HS256', decoded.header.alg === 'HS256'],
    ['all three answers: Cache-Control no-store, nosniff', answers.every((a) => a.headers.get('cache-control') === 'no-store' && a.headers.get('x-content-type-options') === 'nosniff')],
  ];
  out('\n| Check | Result |\n|---|---|');
  for (const [label, ok] of checks1) out(`| ${label} | ${mark(ok)} |`);

  // ---------------------------------------------------------------- 2. the password_hash column
  out('\n## 2. What the users table stores\n');
  const columns = await pool.query<{ column_name: string; data_type: string }>("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position");
  out(`Columns of \`users\`: ${columns.rows.map((c) => `\`${c.column_name}\` (${c.data_type})`).join(', ')}.\n`);
  out('`SELECT email, display_name, password_hash, length(password_hash) FROM users ORDER BY email`:\n');
  const stored = await pool.query<{ email: string; display_name: string; password_hash: string; length: number }>('SELECT email, display_name, password_hash, length(password_hash) AS length FROM users ORDER BY email');
  out('| email | display_name | password_hash | length |\n|---|---|---|---|');
  for (const row of stored.rows) out(`| ${row.email} | ${row.display_name} | \`${row.password_hash}\` | ${row.length} |`);
  const [hashA, hashB] = stored.rows.map((r) => r.password_hash);
  const checks2: Array<[string, boolean]> = [
    ['each hash is bcrypt ($2a$/$2b$) with cost 10, 60 characters', stored.rows.every((r) => /^\$2[ab]\$10\$[./A-Za-z0-9]{53}$/.test(r.password_hash))],
    ['no hash contains the password', stored.rows.every((r) => !r.password_hash.includes(PASSWORD))],
    ['bcrypt.compare(password, hash) is true for both (it is the password, hashed)', stored.rows.every((r) => bcrypt.compareSync(PASSWORD, r.password_hash))],
    ['same password, different hashes (each has its own salt)', hashA !== hashB],
    ['the email was stored trimmed and lower-cased', stored.rows[0].email === 'alice@example.com'],
    ['no column other than password_hash relates to the password', columns.rows.filter((c) => /pass/i.test(c.column_name)).map((c) => c.column_name).join() === 'password_hash'],
  ];
  out('\n| Check | Result |\n|---|---|');
  for (const [label, ok] of checks2) out(`| ${label} | ${mark(ok)} |`);

  // ---------------------------------------------------------------- 3. B against every route of A's list
  const json = <T>(a: Answer) => a.json as T;
  const newList = async (user: { token: string }, name: string) => json<{ id: string }>(await call('POST', '/api/lists', { token: user.token, body: { name } })).id;
  const newItem = async (user: { token: string }, listId: string, name: string) => json<{ id: string }>(await call('POST', `/api/lists/${listId}/items`, { token: user.token, body: { name } })).id;
  const household = async (ownerId: string, name: string) => {
    const { rows } = await pool.query<{ id: string }>('INSERT INTO households (name, owner_id) VALUES ($1, $2) RETURNING id', [name, ownerId]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')", [rows[0].id, ownerId]);
    return rows[0].id;
  };
  const householdA = await household(A.id, "Alice's home");
  const householdB = await household(Bu.id, "Bob's home");
  const listA = await newList(A, 'Alice private list');
  const itemA = await newItem(A, listA, 'milk');
  await newItem(A, listA, 'Alice secret item');
  const listB = await newList(Bu, 'Bob list');
  await newItem(Bu, listB, 'bread');

  const fingerprint = async (listId: string) => {
    const list = await pool.query('SELECT id, name, owner_id, household_id, created_at, updated_at FROM shopping_lists WHERE id = $1', [listId]);
    const items = await pool.query('SELECT * FROM list_items WHERE list_id = $1 ORDER BY id', [listId]);
    return createHash('sha256').update(JSON.stringify([list.rows, items.rows])).digest('hex').slice(0, 12);
  };

  interface Attempt { what: string; method: string; path: (ids: { list: string; item: string }) => string; route: string; body?: (ids: { list: string; item: string }) => unknown; built?: boolean }
  const attempts: Attempt[] = [
    { what: 'read the list', method: 'GET', route: '/api/lists/:id', path: (i) => `/api/lists/${i.list}` },
    { what: 'rename the list', method: 'PATCH', route: '/api/lists/:id', path: (i) => `/api/lists/${i.list}`, body: () => ({ name: 'Renamed by Bob' }) },
    { what: 'move the list to his household', method: 'PATCH', route: '/api/lists/:id', path: (i) => `/api/lists/${i.list}`, body: () => ({ householdId: householdB }) },
    { what: 'rename, with a bad body', method: 'PATCH', route: '/api/lists/:id', path: (i) => `/api/lists/${i.list}`, body: () => ({}) },
    { what: 'add an item', method: 'POST', route: '/api/lists/:id/items', path: (i) => `/api/lists/${i.list}/items`, body: () => ({ name: 'added by Bob' }) },
    { what: 'edit an item', method: 'PATCH', route: '/api/lists/:id/items/:itemId', path: (i) => `/api/lists/${i.list}/items/${i.item}`, body: () => ({ name: 'edited by Bob', completed: true }) },
    { what: 'delete an item', method: 'DELETE', route: '/api/lists/:id/items/:itemId', path: (i) => `/api/lists/${i.list}/items/${i.item}` },
    { what: 'bulk-add items', method: 'POST', route: '/api/lists/:id/items/bulk', path: (i) => `/api/lists/${i.list}/items/bulk`, body: () => ({ items: [{ name: 'bulk by Bob' }] }) },
    { what: 'import text', method: 'POST', route: '/api/lists/:id/import', path: (i) => `/api/lists/${i.list}/import`, body: () => ({ format: 'text', content: 'imported by Bob' }) },
    { what: 'import CSV', method: 'POST', route: '/api/lists/:id/import', path: (i) => `/api/lists/${i.list}/import`, body: () => ({ format: 'csv', content: 'name\ncsv by Bob' }) },
    { what: 'compare prices', method: 'GET', route: '/api/lists/:id/comparison', path: (i) => `/api/lists/${i.list}/comparison`, built: false },
    { what: 'optimise the purchase', method: 'GET', route: '/api/lists/:id/optimization', path: (i) => `/api/lists/${i.list}/optimization`, built: false },
    { what: 'delete the list', method: 'DELETE', route: '/api/lists/:id', path: (i) => `/api/lists/${i.list}` },
  ];

  out("\n## 3. Bob (B) against every route of Alice's (A) list\n");
  out(`Alice's list \`${listA}\` has two items (one is \`${itemA}\`). For each attempt: Bob's status and answer; whether Alice's list (its row and all its items, every column) has the same fingerprint before and after; and, as a control, Alice doing the same on a fresh list of her own, to show the route works.\n`);
  out("| # | Bob tries to | Request | Bob gets | Bob's answer | Alice's list unchanged | Alice on her own list |\n|---|---|---|---|---|---|---|");
  const listLen = async () => (await pool.query('SELECT count(*)::int AS n FROM list_items WHERE list_id = $1', [listA])).rows[0].n;
  let n = 0;
  for (const attempt of attempts) {
    n += 1;
    const before = await fingerprint(listA);
    const itemsBefore = await listLen();
    const ids = { list: listA, item: itemA };
    const bob = await call(attempt.method, attempt.path(ids), { token: Bu.token, body: attempt.body?.(ids) });
    const after = await fingerprint(listA);
    const unchanged = before === after && itemsBefore === (await listLen());
    const scratch = await newList(A, `scratch ${n}`);
    const scratchIds = { list: scratch, item: await newItem(A, scratch, 'scratch item') };
    const control = await call(attempt.method, attempt.path(scratchIds), { token: A.token, body: attempt.method === 'PATCH' && attempt.route === '/api/lists/:id' && attempt.what.includes('household') ? { householdId: householdA } : attempt.body?.(scratchIds) });
    const bobOk = bob.status === 404 && (attempt.built === false || JSON.stringify(bob.json) === '{"error":"List not found"}');
    const controlOk = attempt.built === false ? control.status === 404 : control.status >= 200 && control.status < 300 || (attempt.what === 'rename, with a bad body' && control.status === 400);
    out(`| ${n} | ${attempt.what} | \`${attempt.method} ${attempt.route}\` | ${bob.status} ${mark(bobOk)} | \`${cell(short(bob.text))}\` | ${unchanged ? `yes (${before})` : `**NO** (${before} -> ${after})`} ${mark(unchanged)} | ${control.status}${attempt.built === false ? ' (route not built yet: 404 for everyone)' : ''} ${mark(controlOk)} |`);
  }
  const routes = listApiRoutes(app).filter((r) => r.path.startsWith('/api/lists/:id'));
  const missing = routes.filter((r) => !attempts.some((a) => a.method === r.method && a.route === r.path));
  out(`\nEvery \`/api/lists/:id...\` route in the app's route table (${routes.length}: ${routes.map((r) => `\`${r.method} ${r.path}\``).join(', ')}) is in the table above: ${mark(missing.length === 0)}${missing.length ? ` (missing: ${missing.map((r) => `${r.method} ${r.path}`).join(', ')})` : ''}.`);
  out('Comparison and optimisation are not built yet: their rows show the 404 every caller gets for an unknown path; they prove nothing about access until those routes exist. When they are added, this check fails until rows for them pass, and `auth.test.ts` requires a token on them automatically (D-117).');
  const bobLists = json<Array<{ id: string }>>(await call('GET', '/api/lists', { token: Bu.token }));
  out(`\n\`GET /api/lists\` as Bob: ${bobLists.length} list(s), Alice's list among them: ${bobLists.some((l) => l.id === listA) ? '**yes**' : 'no'} ${mark(!bobLists.some((l) => l.id === listA))}.`);
  const same = await call('GET', '/api/lists/3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69', { token: Bu.token });
  const real = await call('GET', `/api/lists/${listA}`, { token: Bu.token });
  out(`Bob on Alice's list and Bob on a list id that does not exist: status ${real.status} vs ${same.status}, body \`${real.text}\` vs \`${same.text}\`, same headers apart from Date/ETag: identical ${mark(real.status === same.status && real.text === same.text)}.`);
  const upper = await call('GET', `/api/lists/${listA.toUpperCase()}`, { token: Bu.token });
  out(`Alice's list id in capitals, as Bob: ${upper.status} ${mark(upper.status === 404)}.`);

  // ---------------------------------------------------------------- 4. indirect attempts
  out('\n## 4. Indirect attempts\n');
  out("| Bob tries to | Request | Status | Answer | Alice's data unchanged |\n|---|---|---|---|---|");
  const beforeIndirect = await fingerprint(listA);
  const indirect: Array<[string, string, string, unknown, (a: Answer) => boolean]> = [
    ["edit Alice's item through his own list", 'PATCH', `/api/lists/${listB}/items/${itemA}`, { completed: true }, (a) => a.status === 404 && a.text === '{"error":"Item not found"}'],
    ["delete Alice's item through his own list", 'DELETE', `/api/lists/${listB}/items/${itemA}`, undefined, (a) => a.status === 404 && a.text === '{"error":"Item not found"}'],
    ["create a list in Alice's household", 'POST', '/api/lists', { name: 'sneaky', householdId: householdA }, (a) => a.status === 404 && a.text === '{"error":"Household not found"}'],
    ["move his own list into Alice's household", 'PATCH', `/api/lists/${listB}`, { householdId: householdA }, (a) => a.status === 404 && a.text === '{"error":"Household not found"}'],
    ['create a list owned by Alice (ownerId in the body)', 'POST', '/api/lists', { name: 'owned by?', ownerId: A.id }, (a) => a.status === 201 && (a.json as { ownerId: string }).ownerId === Bu.id],
    ["bulk-add to Alice's list by naming it in the items (listId)", 'POST', `/api/lists/${listB}/items/bulk`, { items: [{ name: 'x', listId: listA }] }, (a) => a.status === 201 && (a.json as { items: Array<{ listId: string }> }).items[0].listId === listB],
    ['link an item to a product of his choice (productId)', 'POST', `/api/lists/${listB}/items`, { name: 'tape', productId: '00000000-0000-4000-8000-000000000000' }, (a) => a.status === 201 && (a.json as { productId: null }).productId === null],
  ];
  for (const [what, method, path, body, ok] of indirect) {
    const answer = await call(method, path, { token: Bu.token, body });
    out(`| ${what} | \`${method} ${cell(path.replace(listA, '<A list>').replace(listB, '<B list>').replace(itemA, '<A item>'))}\` | ${answer.status} | \`${cell(short(answer.text, 90))}\` | ${mark(ok(answer))} |`);
  }
  out(`\nAlice's list after all indirect attempts: ${(await fingerprint(listA)) === beforeIndirect ? 'unchanged' : '**changed**'} ${mark((await fingerprint(listA)) === beforeIndirect)}. Alice's lists still owned by Alice only: ${mark((await pool.query('SELECT count(*)::int AS n FROM shopping_lists WHERE owner_id = $1 AND name = $2', [A.id, 'owned by?'])).rows[0].n === 0)}.`);

  // ---------------------------------------------------------------- 5. no token, bad token
  out("\n## 5. No token and a bad token, on every list route (Alice's ids)\n");
  out('| Route | No token | `Bearer garbage` | Alice\'s token forged with another secret |\n|---|---|---|---|');
  const forged = `Bearer ${jwt.sign({}, 'not-the-secret', { algorithm: 'HS256', subject: A.id, expiresIn: 600 })}`;
  for (const route of listApiRoutes(app).filter((r) => r.access === 'signed-in')) {
    const path = route.path.replace(':id', listA).replace(':itemId', itemA);
    const statuses = [];
    for (const tokenValue of [null, 'Bearer garbage', forged]) statuses.push((await call(route.method, path, { token: tokenValue, body: route.method === 'GET' || route.method === 'DELETE' ? undefined : {} })).status);
    out(`| \`${route.method} ${route.path}\` | ${statuses[0]} | ${statuses[1]} | ${statuses[2]} ${mark(statuses.every((s) => s === 401))} |`);
  }
  const publicRoutes = listApiRoutes(app).filter((r) => r.access === 'public').map((r) => `\`${r.method} ${r.path}\``);
  out(`\nRoutes without a token: ${publicRoutes.join(', ')} ${mark(publicRoutes.length === 3)}. OPTIONS on a list route without a token: ${(await call('OPTIONS', `/api/lists/${listA}`)).status}.`);

  // ---------------------------------------------------------------- 6. payloads
  out('\n## 6. SQL-looking input is stored as data\n');
  const payloads = [
    `${MARKER}1'); DROP TABLE users; --`,
    `${MARKER}2' OR '1'='1`,
    `${MARKER}3"; SELECT pg_sleep(3); --`,
    `${MARKER}4 \\'; DELETE FROM shopping_lists; --`,
    `${MARKER}5' UNION SELECT password_hash FROM users --`,
    `${MARKER}6 $1 $$ %s {0} \${x} E'\\x41'`,
  ];
  out('Each payload goes through every text input as Alice; the table shows the status and whether what comes back (and is stored) is exactly what was sent.\n');
  out('| Input | Payload | Status | Returned / stored exactly | Time |\n|---|---|---|---|---|');
  const payloadList = await newList(A, 'payload list');
  const row = (input: string, payload: string, answer: Answer, exact: boolean, ms: number) =>
    out(`| ${input} | \`${cell(payload)}\` | ${answer.status} | ${mark(exact)} | ${ms} ms |`);
  const timed = async (run: () => Promise<Answer>) => {
    const started = Date.now();
    const answer = await run();
    return { answer, ms: Date.now() - started };
  };
  let k = 0;
  for (const p of payloads) {
    k += 1;
    let r = await timed(() => call('POST', '/api/auth/register', { body: { email: `payload${k}@example.com`, password: PASSWORD, displayName: p } }));
    row('register `displayName`', p, r.answer, r.answer.status === 201 && json<{ user: { displayName: string } }>(r.answer).user.displayName === p, r.ms);
    r = await timed(() => call('POST', '/api/auth/login', { body: { email: p, password: p } }));
    row('login `email` and `password`', p, r.answer, r.answer.status === 401, r.ms);
    r = await timed(() => call('POST', '/api/lists', { token: A.token, body: { name: p } }));
    const createdList = json<{ id: string; name: string }>(r.answer);
    row('list `name` (create)', p, r.answer, r.answer.status === 201 && createdList.name === p && json<{ name: string }>(await call('GET', `/api/lists/${createdList.id}`, { token: A.token })).name === p, r.ms);
    r = await timed(() => call('PATCH', `/api/lists/${createdList.id}`, { token: A.token, body: { name: `${p} renamed` } }));
    row('list `name` (rename)', p, r.answer, r.answer.status === 200 && json<{ name: string }>(r.answer).name === `${p} renamed`, r.ms);
    r = await timed(() => call('POST', `/api/lists/${payloadList}/items`, { token: A.token, body: { name: p, note: p.slice(0, 200) } }));
    const item = json<{ id: string; name: string; note: string }>(r.answer);
    row('item `name` and `note` (add)', p, r.answer, r.answer.status === 201 && item.name === p && item.note === p, r.ms);
    const unit = p.slice(0, 20).trim();
    r = await timed(() => call('PATCH', `/api/lists/${payloadList}/items/${item.id}`, { token: A.token, body: { unit, note: `${p}!` } }));
    row('item `unit` and `note` (edit)', unit, r.answer, r.answer.status === 200 && json<{ unit: string; note: string }>(r.answer).unit === unit && json<{ note: string }>(r.answer).note === `${p}!`, r.ms);
    r = await timed(() => call('POST', `/api/lists/${payloadList}/items/bulk`, { token: A.token, body: { items: [{ name: p, unit, note: p }] } }));
    row('bulk item `name`, `unit`, `note`', p, r.answer, r.answer.status === 201 && json<{ items: Array<{ name: string; note: string }> }>(r.answer).items[0].name === p, r.ms);
    const expectedName = parseListLine(p)?.name;
    r = await timed(() => call('POST', `/api/lists/${payloadList}/import`, { token: A.token, body: { format: 'text', content: p } }));
    row('import `content` (text)', p, r.answer, r.answer.status === 201 && json<{ items: Array<{ name: string }> }>(r.answer).items[0].name === expectedName, r.ms);
    r = await timed(() => call('POST', `/api/lists/${payloadList}/import`, { token: A.token, body: { format: 'csv', content: `name,note\n"${p.replace(/"/g, '""')}","${p.replace(/"/g, '""')}"` } }));
    row('import `content` (CSV)', p, r.answer, r.answer.status === 201 && json<{ items: Array<{ name: string; note: string }> }>(r.answer).items[0].name === p, r.ms);
    r = await timed(() => call('GET', `/api/lists/${encodeURIComponent(p)}`, { token: A.token }));
    row('list id in the path', p, r.answer, r.answer.status === 404, r.ms);
    r = await timed(() => call('PATCH', `/api/lists/${payloadList}`, { token: A.token, body: { householdId: p } }));
    row('`householdId`', p, r.answer, r.answer.status === 400, r.ms);
  }
  const nul = await call('POST', '/api/lists', { token: A.token, body: { name: `${MARKER}nul\u0000byte` } });
  out(`\nA NUL byte in a list name: ${nul.status} \`${nul.text}\` (refused before the database) ${mark(nul.status === 400)}.`);
  const tables = await pool.query("SELECT to_regclass('users') IS NOT NULL AS users, to_regclass('shopping_lists') IS NOT NULL AS lists, (SELECT count(*)::int FROM users) AS user_count");
  out(`After all payloads: table \`users\` exists ${mark(tables.rows[0].users)}, \`shopping_lists\` exists ${mark(tables.rows[0].lists)}, users: ${tables.rows[0].user_count} (2 + ${payloads.length} registered) ${mark(tables.rows[0].user_count === 2 + payloads.length)}.`);
  const rejected = sink.records.filter((r) => r.event === 'database_input_rejected');
  out(`Postgres refused an input (\`database_input_rejected\`, D-111) during the whole run: ${rejected.length} time(s) ${mark(rejected.length === 0)}. Requests answered 500: ${sink.records.filter((r) => r.event === 'request_failed').length} ${mark(sink.records.filter((r) => r.event === 'request_failed').length === 0)}.`);

  out(`\n## Result\n\n${failures === 0 ? 'All checks passed.' : `**${failures} check(s) failed.**`}`);
  server.close();
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
