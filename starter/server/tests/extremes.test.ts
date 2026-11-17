/**
 * The extremes (API round 7; decisions D-154 to D-158): pastes of thousands of lines, CSV notes over
 * several lines, quantities 0 and -2, names of white space only, very long names, JSON bodies of the
 * wrong shape. Every refusal must be a clear 400 (or 413 over the body limit), never a 500, and must
 * leave the database exactly as it was. Then: how many SQL statements GET /api/lists sends.
 */
import { createHash } from 'node:crypto';
import { Client, type Pool } from 'pg';
import request from 'supertest';
import type { ListItem, ShoppingList } from '../../src/models';
import { createApp } from '../src/app';
import { seedCatalog } from '../src/db/seed';
import { createLogger, memorySink, silentLogger } from '../src/logger';
import { signToken } from '../src/services/tokens';
import { resetDatabase, testPool } from './helpers/db';

jest.setTimeout(120000);
const SECRET = 'extremes-secret';

let pool: Pool;
let app: ReturnType<typeof createApp>;
const sink = memorySink();
let auth: string;
let listId: string;
let itemId: string;

beforeAll(async () => {
  pool = testPool();
  await resetDatabase(pool);
  await seedCatalog(pool, { logger: silentLogger });
  app = createApp(pool, { jwtSecret: SECRET, logger: createLogger({ level: 'warn', sinks: [sink] }) });
  const { rows } = await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ('x@example.com', 'x') RETURNING id");
  auth = `Bearer ${signToken(rows[0].id, SECRET)}`;
  listId = (await request(app).post('/api/lists').set('Authorization', auth).send({ name: 'Extremes' })).body.id;
  itemId = (await request(app).post(`/api/lists/${listId}/items`).set('Authorization', auth).send({ name: 'milk', quantity: 2 })).body.id;
});
afterAll(async () => {
  await pool.end();
});
afterEach(async () => {
  // No crash: the server still answers, and nothing was answered with a 500.
  expect((await request(app).get('/api/health')).status).toBe(200);
  expect(sink.records.filter((r) => r.event === 'request_failed' || r.event === 'response_failed')).toEqual([]);
  expect(sink.records.filter((r) => r.event === 'database_input_rejected')).toEqual([]);
});

/** Every user, list (with updated_at) and item, hashed: "no partial write" means this does not move. */
async function database(): Promise<string> {
  const users = await pool.query('SELECT * FROM users ORDER BY id');
  const lists = await pool.query('SELECT * FROM shopping_lists ORDER BY id');
  const items = await pool.query('SELECT * FROM list_items ORDER BY id');
  return createHash('sha256').update(JSON.stringify([users.rows, lists.rows, items.rows])).digest('hex');
}

type Method = 'post' | 'patch';
const send = (method: Method, path: string, body: unknown, contentType = 'application/json') => {
  const req = request(app)[method](path).set('Authorization', auth).set('Content-Type', contentType);
  return req.send(typeof body === 'string' ? body : JSON.stringify(body));
};

/** Sends the request and expects the status and error, with the database untouched. */
async function refused(method: Method, path: string, body: unknown, status: number, error: string) {
  const before = await database();
  const res = await send(method, path, body);
  expect([res.status, res.body]).toEqual([status, { error }]);
  expect(await database()).toBe(before);
}

const ITEMS = () => `/api/lists/${listId}/items`;
const ITEM = () => `/api/lists/${listId}/items/${itemId}`;
const BULK = () => `/api/lists/${listId}/items/bulk`;
const IMPORT = () => `/api/lists/${listId}/import`;
const LIST = () => `/api/lists/${listId}`;
const lines = (n: number, make: (i: number) => string) => Array.from({ length: n }, (_, i) => make(i)).join('\n');

describe('a paste of several thousand lines', () => {
  it('5000 different items: 400 "at most 500", nothing written', async () => {
    const started = Date.now();
    await refused('post', IMPORT(), { format: 'text', content: lines(5000, (i) => `${i % 9 + 1} kg item ${i} (note ${i})`) }, 400, 'content: at most 500 items at a time (found 5000)');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('5000 lines that merge into 10 items: 201, quantities added', async () => {
    const content = lines(5000, (i) => `- product ${i % 10}`);
    const res = await send('post', IMPORT(), { format: 'text', content });
    expect(res.status).toBe(201);
    expect(res.body.items.map((i: ListItem) => `${i.name} ${i.quantity}`)).toEqual(Array.from({ length: 10 }, (_, i) => `product ${i} 500`));
  });

  it('3000 lines in mixed shapes that come down to exactly 500 items: 201, 500 items in order', async () => {
    // Bullets, "x3", leading quantities, comments and blank lines around 500 names, all in the same
    // unit, so they merge into 500 items (different units would stay apart, D-05).
    const shapes = [(i: number) => `- thing ${i}`, (i: number) => `thing ${i} x3`, (i: number) => `2 thing ${i}`, (i: number) => `# comment ${i}`, () => '', (i: number) => `* [ ] THING ${i}`];
    const content = lines(3000, (i) => (i < 500 ? `thing ${i}` : shapes[i % shapes.length](i % 500)));
    const res = await send('post', IMPORT(), { format: 'text', content });
    expect([res.status, res.body.items?.length]).toEqual([201, 500]);
    expect(res.body.items.slice(0, 3).map((i: ListItem) => i.name)).toEqual(['thing 0', 'thing 1', 'thing 2']);
  });

  it('a paste over the 1 MB body limit: 413, nothing written', async () => {
    await refused('post', IMPORT(), { format: 'text', content: lines(60000, (i) => `item number ${i} with some text`) }, 413, 'Request body is too large');
  });

  it('499 good lines and one name of 130 characters: 400 naming item 500, none of the 499 written', async () => {
    const content = `${lines(499, (i) => `good ${i}`)}\n${'y'.repeat(130)}`;
    await refused('post', IMPORT(), { format: 'text', content }, 400, `content: item 500 ("${'y'.repeat(40)}..."): name: must be at most 120 characters`);
  });

  it('one pathological line of 900 KB ("a, a, a, ..."): a 400 within seconds, not a hang', async () => {
    const started = Date.now();
    await refused('post', IMPORT(), { format: 'text', content: 'a, '.repeat(300000) }, 400, `content: item 1 ("${'a, '.repeat(13)}a..."): name: must be at most 120 characters`);
    expect(Date.now() - started).toBeLessThan(10000);
  });
});

describe('parsing happens outside the list lock (D-157)', () => {
  it('while another change holds the list, a refused import answers at once instead of waiting for the lock', async () => {
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT id FROM shopping_lists WHERE id = $1 FOR UPDATE', [listId]);
      const started = Date.now();
      const res = await send('post', IMPORT(), { format: 'text', content: lines(5000, (i) => `item ${i}`) }).timeout(3000);
      expect([res.status, res.body]).toEqual([400, { error: 'content: at most 500 items at a time (found 5000)' }]);
      expect(Date.now() - started).toBeLessThan(2000); // before D-157 it waited for the COMMIT below
    } finally {
      await other.query('ROLLBACK');
      other.release();
    }
  });
});

describe('a CSV with a quoted note over several lines', () => {
  it('LF and CRLF inside the quotes: one item, the note on one line', async () => {
    const content = 'name,quantity,unit,note\r\nMilk,2,l,"first line\nsecond line\r\nthird line"\r\nEggs,12,,"a, b and ""c"""';
    const res = await send('post', IMPORT(), { format: 'csv', content });
    expect(res.status).toBe(201);
    expect(res.body.items.map((i: ListItem) => [i.name, i.quantity, i.unit, i.note])).toEqual([
      ['Milk', 2, 'l', 'first line second line third line'],
      ['Eggs', 12, 'dozen', 'a, b and "c"'],
    ]);
  });

  it('a quoted name over two lines is one name', async () => {
    const res = await send('post', IMPORT(), { format: 'csv', content: 'name,note\n"Whole\nmilk",x' });
    expect(res.body.items.map((i: ListItem) => i.name)).toEqual(['Whole milk']);
  });

  it('a multi-line note longer than 200 characters: 400 naming the item, nothing written', async () => {
    const note = Array.from({ length: 30 }, (_, i) => `line ${i} of the note`).join('\n');
    await refused('post', IMPORT(), { format: 'csv', content: `name,note\nbread,\nmilk,"${note}"` }, 400, 'content: item 2 ("milk"): note: must be at most 200 characters');
  });

  it('a quote that is never closed: the rest of the file is the last cell (the CSV reader\'s rule), no crash', async () => {
    const res = await send('post', IMPORT(), { format: 'csv', content: 'name,note\nbread,ok\nmilk,"never closed\nbutter,x' });
    expect(res.status).toBe(201);
    expect(res.body.items.map((i: ListItem) => [i.name, i.note])).toEqual([['bread', 'ok'], ['milk', 'never closed butter,x']]);
  });
});

describe('quantity 0 and -2', () => {
  it.each([
    [0, 'quantity: must be greater than 0'],
    [-2, 'quantity: must be greater than 0'],
    [-0, 'quantity: must be greater than 0'],
    [0.0004, 'quantity: must be greater than 0 (at least 0.001)'],
    ['1e400', 'quantity: must be at most 9999999.999'], // JSON reads it as Infinity
    ['-1e400', 'quantity: must be greater than 0'],
    [1e308, 'quantity: must be at most 9999999.999'],
    [10000000, 'quantity: must be at most 9999999.999'],
    [9999999.9995, 'quantity: must be at most 9999999.999'], // under the limit, but rounds to 10000000.000
    ['"2"', 'quantity: must be a number'],
    ['null', 'quantity: must be a number'],
    ['true', 'quantity: must be a number'],
    ['[2]', 'quantity: must be a number'],
  ])('quantity %p: 400 %p when adding, editing and in a bulk add; nothing written', async (raw, error) => {
    const value = typeof raw === 'number' ? JSON.stringify(raw) : raw;
    await refused('post', ITEMS(), `{"name":"milk","quantity":${value}}`, 400, error);
    await refused('patch', ITEM(), `{"quantity":${value}}`, 400, error);
    await refused('post', BULK(), `{"items":[{"name":"a"},{"name":"b"},{"name":"c"},{"name":"milk","quantity":${value}}]}`, 400, `items.3.${error}`);
  });

  it('in a paste, "0 milk" and "-2 milk" are names with quantity 1 (parser rule, TECH_SPEC 5.2); "-2" is no longer read as a bullet (D-156)', async () => {
    const res = await send('post', IMPORT(), { format: 'text', content: '0 milk\n-2 milk\n- 2 bread\nmilk x0' });
    expect(res.body.items.map((i: ListItem) => `${i.name} x${i.quantity}`)).toEqual(['0 milk x1', '-2 milk x1', 'bread x2', 'milk x0 x1']);
  });

  it('in a CSV, a quantity cell of 0, -2 or "abc" becomes 1 (parseListCsv: "an invalid or missing quantity becomes 1")', async () => {
    const res = await send('post', IMPORT(), { format: 'csv', content: 'name,quantity\nmilk,0\neggs,-2\nrice,abc' });
    expect(res.body.items.map((i: ListItem) => `${i.name} x${i.quantity}`)).toEqual(['milk x1', 'eggs x1', 'rice x1']);
  });
});

describe('a name that is only white space (or invisible)', () => {
  const blanks = [' ', '   ', '\t', '\n\n', '\u00a0\u3000\u2003', '\ufeff', '\u200b', '\u200b\u200b', '\u00ad', '\u2060\u200d', ' \u200b \u200c '];
  it.each(blanks.map((b) => [JSON.stringify(b), b]))('%s: 400 "is required" for list create and rename, item add and rename, bulk', async (_label, blank) => {
    await refused('post', '/api/lists', { name: blank }, 400, 'name: is required');
    await refused('patch', LIST(), { name: blank }, 400, 'name: is required');
    await refused('post', ITEMS(), { name: blank }, 400, 'name: is required');
    await refused('patch', ITEM(), { name: blank }, 400, 'name: is required');
    await refused('post', BULK(), { items: [{ name: 'ok' }, { name: blank }] }, 400, 'items.1.name: is required');
  });

  it('a unit that is blank or invisible is 400; a note that is, is no note', async () => {
    await refused('post', ITEMS(), { name: 'milk', unit: '\u200b ' }, 400, 'unit: must not be empty');
    const res = await send('post', ITEMS(), { name: 'tea', note: ' \u200b ' });
    expect([res.status, res.body.note]).toEqual([201, null]);
  });

  it('a pasted line that shows nothing but is not white space (a lone zero-width joiner): 400 naming it', async () => {
    await refused('post', IMPORT(), { format: 'text', content: 'milk\n\u200d' }, 400, 'content: item 2 ("\u200d"): name: is required');
    await refused('post', IMPORT(), { format: 'text', content: '  \n\t\n\u00a0' }, 400, 'content: no items found in the text');
  });

  it('invisible characters inside a real name are kept (an emoji family joined by ZWJ)', async () => {
    const family = 'Snacks for 👨‍👩‍👧';
    const res = await send('post', '/api/lists', { name: family });
    expect([res.status, res.body.name]).toEqual([201, family]);
  });
});

describe('a very long name', () => {
  it.each([
    ['a list name', 'post', '/api/lists', (n: string) => ({ name: n }), 100, 'name'],
    ['a list rename', 'patch', 'LIST', (n: string) => ({ name: n }), 100, 'name'],
    ['an item name', 'post', 'ITEMS', (n: string) => ({ name: n }), 120, 'name'],
    ['an item rename', 'patch', 'ITEM', (n: string) => ({ name: n }), 120, 'name'],
    ['a bulk item name', 'post', 'BULK', (n: string) => ({ items: [{ name: n }] }), 120, 'items.0.name'],
  ] as const)('%s: the limit passes, one more character and 500,000 characters are 400, over 1 MB is 413', async (_label, method, where, body, max, field) => {
    const path = where === 'LIST' ? LIST() : where === 'ITEMS' ? ITEMS() : where === 'ITEM' ? ITEM() : where === 'BULK' ? BULK() : where;
    const ok = await send(method, path, body('🛒'.repeat(max)));
    expect(ok.status).toBeLessThan(300);
    await refused(method, path, body('🛒'.repeat(max + 1)), 400, `${field}: must be at most ${max} characters`);
    await refused(method, path, body('x'.repeat(500000)), 400, `${field}: must be at most ${max} characters`);
    await refused(method, path, body('x'.repeat(1100000)), 413, 'Request body is too large');
  });
});

describe('JSON bodies of the wrong shape', () => {
  const endpoints: Array<[string, Method, () => string]> = [
    ['register', 'post', () => '/api/auth/register'],
    ['login', 'post', () => '/api/auth/login'],
    ['create list', 'post', () => '/api/lists'],
    ['rename list', 'patch', LIST],
    ['add item', 'post', ITEMS],
    ['edit item', 'patch', ITEM],
    ['bulk', 'post', BULK],
    ['import', 'post', IMPORT],
  ];
  it.each(endpoints)('%s: a list, a string, a number, null, true, truncated JSON are 400', async (_label, method, path) => {
    await refused(method, path(), '[]', 400, 'The request body must be a JSON object');
    await refused(method, path(), '[{"name":"milk"}]', 400, 'The request body must be a JSON object');
    for (const raw of ['"milk"', '42', 'null', 'true', '{"name":', '{name: "milk"}', '']) {
      if (raw === '') continue; // an empty body is {} (D-110): covered by the field checks below
      await refused(method, path(), raw, 400, 'Malformed JSON body');
    }
  });

  it.each([
    ['create list', 'post', () => '/api/lists', { name: ['milk'] }, 'name: must be text'],
    ['create list', 'post', () => '/api/lists', { name: { first: 'milk' } }, 'name: must be text'],
    ['create list', 'post', () => '/api/lists', { title: 'milk' }, 'name: is required'],
    ['add item', 'post', ITEMS, { name: 'milk', unit: ['l'] }, 'unit: must be text'],
    ['add item', 'post', ITEMS, { name: 'milk', note: { text: 'x' } }, 'note: must be text or null'],
    ['edit item', 'patch', ITEM, { completed: 'true' }, 'completed: must be true or false'],
    ['edit item', 'patch', ITEM, { completed: 1 }, 'completed: must be true or false'],
    ['edit item', 'patch', ITEM, { item: { quantity: 3 } }, 'Nothing to change: send name, quantity, unit, note and/or completed'],
    ['bulk', 'post', BULK, { items: { 0: { name: 'milk' } } }, 'items: must be a list of items'],
    ['bulk', 'post', BULK, { items: [['milk']] }, 'items.0: must be an item (an object)'],
    ['bulk', 'post', BULK, { items: [null] }, 'items.0: must be an item (an object)'],
    ['bulk', 'post', BULK, { item: [{ name: 'milk' }] }, 'items: is required'],
    ['import', 'post', IMPORT, { format: 'text', content: { lines: ['milk'] } }, 'content: must be text'],
    ['import', 'post', IMPORT, { format: ['text'], content: 'milk' }, 'format: must be "text" or "csv"'],
    ['import', 'post', IMPORT, { type: 'text', text: 'milk' }, 'format: is required; content: is required'],
    ['rename list', 'patch', LIST, { householdId: 5 }, 'householdId: must be a household id or null'],
    ['register', 'post', () => '/api/auth/register', { email: ['a@b.co'], password: 'longenough' }, 'email: must be text'],
    ['login', 'post', () => '/api/auth/login', { user: { email: 'a@b.co', password: 'x' } }, 'email: is required; password: is required'],
  ] as Array<[string, Method, () => string, unknown, string]>)('%s with %j: 400 %p', async (_label, method, path, body, error) => {
    await refused(method, path(), body, 400, error);
  });

  it('200,000 levels of nesting: 400, no stack overflow', async () => {
    await refused('post', '/api/lists', `{"name":${'['.repeat(200000)}${']'.repeat(200000)}}`, 400, 'name: must be text');
  });

  it('a __proto__ key changes nothing beyond the request (no prototype pollution)', async () => {
    const res = await send('post', '/api/lists', '{"name":"proto","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    expect(res.status).toBe(201);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'householdId', 'id', 'items', 'name', 'ownerId', 'updatedAt']);
  });

  it('JSON sent as text/plain is not parsed: the body is {} and the fields are missing (400), nothing written', async () => {
    const before = await database();
    const res = await request(app).post('/api/lists').set('Authorization', auth).set('Content-Type', 'text/plain').send('{"name":"milk"}');
    expect([res.status, res.body]).toEqual([400, { error: 'name: is required' }]);
    expect(await database()).toBe(before);
  });

  it('a repeated key: the last one wins (JSON.parse), as for any JSON reader', async () => {
    const res = await send('post', '/api/lists', '{"name":"first","name":"second"}');
    expect([res.status, res.body.name]).toEqual([201, 'second']);
  });
});

describe('how many SQL statements GET /api/lists sends', () => {
  /** A fresh user with `lists` lists of `items` items each, made in SQL. */
  async function userWith(lists: number, items: number): Promise<string> {
    const { rows } = await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id", [`count-${lists}-${items}-${Date.now()}@example.com`]);
    const owner = rows[0].id;
    await pool.query(
      `WITH l AS (INSERT INTO shopping_lists (owner_id, name) SELECT $1, 'list ' || n FROM generate_series(1, $2::int) n RETURNING id)
       INSERT INTO list_items (list_id, name, position) SELECT l.id, 'item ' || p, p FROM l, generate_series(0, $3::int - 1) p`,
      [owner, lists, items],
    );
    return `Bearer ${signToken(owner, SECRET)}`;
  }

  /** Every statement sent to Postgres during one GET /api/lists, in order. */
  async function statementsOf(token: string): Promise<{ sql: string[]; lists: ShoppingList[] }> {
    const spy = jest.spyOn(Client.prototype, 'query');
    try {
      const res = await request(app).get('/api/lists').set('Authorization', token);
      expect(res.status).toBe(200);
      const sql = spy.mock.calls.map(([text]) => (typeof text === 'string' ? text : String((text as { text?: string }).text)).replace(/\s+/g, ' ').trim());
      return { sql, lists: res.body };
    } finally {
      spy.mockRestore();
    }
  }

  it('20 lists of 10 items: 3 statements (the token\'s user, the lists, all 200 items at once)', async () => {
    const { sql, lists } = await statementsOf(await userWith(20, 10));
    expect([lists.length, lists.reduce((n, l) => n + l.items.length, 0)]).toEqual([20, 200]);
    expect(sql).toHaveLength(3);
    expect(sql[0]).toMatch(/^SELECT id, email, display_name FROM users WHERE id = \$1$/);
    expect(sql[1]).toMatch(/^SELECT l\.id, .* FROM shopping_lists l WHERE l\.owner_id = \$1 ORDER BY/);
    expect(sql[2]).toMatch(/FROM list_items WHERE list_id = ANY\(\$1::uuid\[\]\) ORDER BY/);
  });

  it('the same 3 for 0 lists (2: no items query), 1 list and 100 lists of 10 items', async () => {
    expect((await statementsOf(await userWith(0, 0))).sql).toHaveLength(2);
    expect((await statementsOf(await userWith(1, 10))).sql).toHaveLength(3);
    expect((await statementsOf(await userWith(100, 10))).sql).toHaveLength(3);
  });
});
