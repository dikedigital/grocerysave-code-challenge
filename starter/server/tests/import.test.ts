/**
 * Bulk add and import through HTTP against TEST_DATABASE_URL (TECH_SPEC 6.3; decisions D-142 to D-148):
 * POST /api/lists/:id/items/bulk { items } and POST /api/lists/:id/import { format, content }.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client, type Pool } from 'pg';
import request from 'supertest';
import type { ImportResponse, ListItem, ShoppingList } from '../../src/models';
import { parseListCsvDetailed, parseListTextDetailed } from '../../src/utils/parseList';
import { createApp } from '../src/app';
import { seedCatalog } from '../src/db/seed';
import { createLogger, memorySink, silentLogger } from '../src/logger';
import { signToken } from '../src/services/tokens';
import { count, resetDatabase, testPool } from './helpers/db';

jest.setTimeout(120000);

const SECRET = 'import-test-secret';
const UNKNOWN = '3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69';
const SAMPLES = path.join(__dirname, '../../tests/manual/samples');

let pool: Pool;
let sku: Record<string, string>;
beforeAll(async () => {
  pool = testPool();
  await resetDatabase(pool);
  await seedCatalog(pool, { logger: silentLogger });
  sku = Object.fromEntries((await pool.query<{ sku: string; id: string }>('SELECT sku, id FROM products')).rows.map((r) => [r.sku, r.id]));
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE users, households CASCADE');
});

interface TestUser { id: string; auth: string }
async function makeUser(email: string): Promise<TestUser> {
  const { rows } = await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, 'not-a-hash') RETURNING id", [email]);
  return { id: rows[0].id, auth: `Bearer ${signToken(rows[0].id, SECRET)}` };
}
function appWithLog() {
  const sink = memorySink();
  const app = createApp(pool, { jwtSecret: SECRET, logger: createLogger({ level: 'debug', sinks: [sink], component: 'test.http' }) });
  return { app, sink };
}
type App = ReturnType<typeof createApp>;

async function createList(app: App, user: TestUser, name = 'Groceries'): Promise<ShoppingList> {
  const res = await request(app).post('/api/lists').set('Authorization', user.auth).send({ name });
  expect(res.status).toBe(201);
  return res.body;
}
const importTo = (app: App, user: TestUser, listId: string, body: unknown) =>
  request(app).post(`/api/lists/${listId}/import`).set('Authorization', user.auth).send(body as object);
const bulkTo = (app: App, user: TestUser, listId: string, body: unknown) =>
  request(app).post(`/api/lists/${listId}/items/bulk`).set('Authorization', user.auth).send(body as object);
const getList = async (app: App, user: TestUser, listId: string) => (await request(app).get(`/api/lists/${listId}`).set('Authorization', user.auth)).body as ShoppingList;
const updatedAt = async (listId: string) => (await pool.query<{ updated_at: Date }>('SELECT updated_at FROM shopping_lists WHERE id = $1', [listId])).rows[0].updated_at.toISOString();
const summary = (items: ListItem[]) => items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, note: i.note ?? undefined }));
const lines = (n: number, make = (i: number) => `item number ${i}`) => Array.from({ length: n }, (_, i) => make(i)).join('\n');

describe('POST /api/lists/:id/import, format text', () => {
  it('201 { items, matched }: one item per line, in order, matched to the catalog, appended to the list', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    await request(app).post(`/api/lists/${list.id}/items`).set('Authorization', ana.auth).send({ name: 'already there' });
    const content = '2 milk\n- eggs (free range)\nbananas x3\n\n# a comment\nBirthday candles\n1.5 kg rice';
    const res = await importTo(app, ana, list.id, { format: 'text', content });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['items', 'matched']);
    const body = res.body as ImportResponse;
    expect(summary(body.items)).toEqual([
      { name: 'milk', quantity: 2, unit: 'gal', note: undefined }, // no unit written: the product's (D-147)
      { name: 'eggs', quantity: 1, unit: 'dozen', note: 'free range' },
      { name: 'bananas', quantity: 3, unit: 'lb', note: undefined },
      { name: 'Birthday candles', quantity: 1, unit: 'each', note: undefined }, // no product: each
      { name: 'rice', quantity: 1.5, unit: 'kg', note: undefined }, // written: kept
    ]);
    expect(body.items.map((i) => i.productId)).toEqual([sku['GS-001'], sku['GS-006'], sku['GS-011'], null, sku['GS-027']]);
    expect(body.items.map((i) => i.category)).toEqual(['Dairy', 'Dairy', 'Produce', 'Other', 'Pantry']);
    expect(body.matched).toBe(4);
    expect(body.items.every((i) => i.listId === list.id && i.completed === false)).toBe(true);
    expect((await getList(app, ana, list.id)).items.map((i) => i.name)).toEqual(['already there', 'milk', 'eggs', 'bananas', 'Birthday candles', 'rice']);
    expect((await getList(app, ana, list.id)).items.slice(1)).toEqual(body.items);
  });

  it('lines with the same name and unit are merged (quantities added, notes joined), as parseListText does', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const res = await importTo(app, ana, list.id, { format: 'text', content: 'Milk\nmilk (organic)\n2 MILK\n1 kg rice\n500 g rice' });
    expect(summary(res.body.items)).toEqual([
      { name: 'Milk', quantity: 4, unit: 'gal', note: 'organic' },
      { name: 'rice', quantity: 1, unit: 'kg', note: undefined },
      { name: 'rice', quantity: 500, unit: 'g', note: undefined },
    ]);
  });

  it('a written unit is kept, "each" included; a line without one gets the product unit (D-147, option A)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const res = await importTo(app, ana, list.id, { format: 'text', content: 'milk\n2 l milk\n3 each eggs\n2 eggs\nmilk x2\ntape\n2 kg tape' });
    expect(res.body.items.map((i: ListItem) => `${i.name} ${i.quantity} ${i.unit}`)).toEqual([
      'milk 3 gal', // "milk" and "milk x2" merged; no unit written
      'milk 2 l',
      'eggs 5 each', // "3 each eggs" and "2 eggs" merge (same name and unit); one wrote "each", so it is kept
      'tape 1 each', // no product, no unit: each
      'tape 2 kg',
    ]);
  });

  it('merging a line with a written "each" and one without: written wins, the unit stays each', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const res = await importTo(app, ana, list.id, { format: 'text', content: 'milk\n2 each milk' });
    expect(res.body.items.map((i: ListItem) => `${i.name} ${i.quantity} ${i.unit}`)).toEqual(['milk 3 each']);
  });

  it('CRLF and CR line endings work like LF', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const res = await importTo(app, ana, list.id, { format: 'text', content: 'milk\r\neggs\rbananas\r\n' });
    expect(res.body.items.map((i: ListItem) => i.name)).toEqual(['milk', 'eggs', 'bananas']);
  });
});

describe('POST /api/lists/:id/import, format csv', () => {
  it('201: header row, quantity and unit columns, missing quantity 1, unknown unit each, nameless rows skipped', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const content = 'name,quantity,unit,note\nrice,1.5,kg,\ncoffee,,,dark roast\n"Salt, fine",2,box,\n,3,kg,no name\ncandles,2,tub,pink';
    const res = await importTo(app, ana, list.id, { format: 'csv', content });
    expect(res.status).toBe(201);
    expect(summary(res.body.items)).toEqual([
      { name: 'rice', quantity: 1.5, unit: 'kg', note: undefined },
      { name: 'coffee', quantity: 1, unit: 'bag', note: 'dark roast' }, // empty unit cell: the product's (D-147)
      { name: 'Salt, fine', quantity: 2, unit: 'box', note: undefined },
      { name: 'candles', quantity: 2, unit: 'each', note: 'pink' }, // "tub" was written: unknown, so each
    ]);
    expect(res.body.matched).toBe(2); // rice, coffee
  });

  it('CSV rows are not merged', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const res = await importTo(app, ana, list.id, { format: 'csv', content: 'milk,1\nmilk,2' });
    expect(summary(res.body.items)).toEqual([
      { name: 'milk', quantity: 1, unit: 'gal', note: undefined },
      { name: 'milk', quantity: 2, unit: 'gal', note: undefined },
    ]);
  });

  const samples = fs.readdirSync(SAMPLES).filter((f) => /\.(txt|csv|tsv)$/.test(f)).sort();
  it.each(samples)('the sample file %s gives what the parser (the client preview) gives; units as D-147 says', async (file) => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const content = fs.readFileSync(path.join(SAMPLES, file), 'utf8');
    const format = file.endsWith('.txt') ? 'text' : 'csv';
    const parsed = format === 'text' ? parseListTextDetailed(content) : parseListCsvDetailed(content);
    const res = await importTo(app, ana, list.id, { format, content });
    expect(res.status).toBe(201);
    const items = res.body.items as ListItem[];
    expect(items.map((i) => ({ name: i.name, quantity: i.quantity, note: i.note ?? undefined }))).toEqual(parsed.map((p) => ({ name: p.name, quantity: p.quantity, note: p.note })));
    const unitOfProduct = Object.fromEntries((await pool.query<{ id: string; unit: string }>('SELECT id, unit FROM products')).rows.map((r) => [r.id, r.unit]));
    expect(items.map((i) => i.unit)).toEqual(parsed.map((p, index) => (p.unitWritten ? p.unit : (unitOfProduct[items[index].productId ?? ''] ?? 'each'))));
    expect(res.body.matched).toBe(res.body.items.filter((i: ListItem) => i.productId !== null).length);
    expect(await count(pool, 'list_items')).toBe(parsed.length);
  });
});

describe('POST /api/lists/:id/items/bulk', () => {
  it('201 { items, matched }: each item as given, in order; the unit is kept, the catalog fills productId and category', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const items = [
      { name: 'olive oil', quantity: 1, unit: 'bottle' },
      { name: 'salmon fillet', quantity: 2, unit: 'lb', note: 'wild' },
      { name: 'Birthday candles', quantity: 24, unit: 'each' },
      { name: 'milk', quantity: 2, unit: 'l' },
    ];
    const res = await bulkTo(app, ana, list.id, { items });
    expect(res.status).toBe(201);
    expect(summary(res.body.items)).toEqual(items.map((i) => ({ ...i, note: i.note })));
    expect(res.body.items.map((i: ListItem) => i.productId)).toEqual([sku['GS-002'], sku['GS-012'], null, sku['GS-001']]);
    expect(res.body.matched).toBe(3);
    expect((await getList(app, ana, list.id)).items).toEqual(res.body.items);
  });

  it('like a single add: a missing unit is the product unit (or each), a missing quantity 1, units canonical, notes trimmed (D-144)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const res = await bulkTo(app, ana, list.id, { items: [{ name: 'milk' }, { name: 'tape' }, { name: 'rice', unit: ' KG ', quantity: 0.33333, note: '  long grain ' }] });
    expect(summary(res.body.items)).toEqual([
      { name: 'milk', quantity: 1, unit: 'gal', note: undefined },
      { name: 'tape', quantity: 1, unit: 'each', note: undefined },
      { name: 'rice', quantity: 0.333, unit: 'kg', note: 'long grain' },
    ]);
  });

  it('productId, category, completed and other fields of an item are ignored', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const res = await bulkTo(app, ana, list.id, { items: [{ name: 'tape', productId: sku['GS-001'], category: 'Dairy', completed: true, id: UNKNOWN }] });
    expect(res.body.items[0]).toMatchObject({ productId: null, category: 'Other', completed: false });
    expect(res.body.items[0].id).not.toBe(UNKNOWN);
  });

  it('exactly 500 items are accepted, in order, with one INSERT statement', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const query = jest.spyOn(Client.prototype, 'query');
    try {
      const res = await bulkTo(app, ana, list.id, { items: Array.from({ length: 500 }, (_, i) => ({ name: `thing ${i}`, quantity: i + 1 })) });
      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(500);
      expect(res.body.items.map((i: ListItem) => i.quantity)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
      const inserts = query.mock.calls.filter(([sql]) => typeof sql === 'string' && /INSERT INTO list_items/.test(sql));
      expect(inserts).toHaveLength(1);
    } finally {
      query.mockRestore();
    }
    const { rows } = await pool.query<{ position: number }>('SELECT position FROM list_items WHERE list_id = $1 ORDER BY position', [list.id]);
    expect(rows.map((r) => r.position)).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });
});

describe('the list moves to the top', () => {
  it('an import and a bulk add each bump the list\'s updatedAt once', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'Mine');
    await createList(app, ana, 'Newer');
    const before = await updatedAt(list.id);
    await importTo(app, ana, list.id, { format: 'text', content: 'milk\neggs' });
    const afterImport = await updatedAt(list.id);
    expect(afterImport > before).toBe(true);
    const lists = (await request(app).get('/api/lists').set('Authorization', ana.auth)).body as ShoppingList[];
    expect(lists[0].name).toBe('Mine');
    await bulkTo(app, ana, list.id, { items: [{ name: 'bread' }] });
    expect((await updatedAt(list.id)) > afterImport).toBe(true);
  });
});

describe('400: an empty request, no items, an unknown format, more than 500 items', () => {
  const importCases: Array<[string, unknown, string]> = [
    ['an empty body', {}, 'format: is required; content: is required'],
    ['no content', { format: 'text' }, 'content: is required'],
    ['no format', { content: 'milk' }, 'format: is required'],
    ['an unknown format', { format: 'xml', content: 'milk' }, 'format: must be "text" or "csv"'],
    ['a format in capitals', { format: 'CSV', content: 'milk' }, 'format: must be "text" or "csv"'],
    ['a format that is not text', { format: 1, content: 'milk' }, 'format: must be "text" or "csv"'],
    ['content that is not text', { format: 'text', content: ['milk'] }, 'content: must be text'],
    ['empty content', { format: 'text', content: '' }, 'content: no items found in the text'],
    ['blank content', { format: 'text', content: '  \n\t\n ' }, 'content: no items found in the text'],
    ['only comments and bullets', { format: 'text', content: '# shopping\n- \n* ' }, 'content: no items found in the text'],
    ['an empty CSV', { format: 'csv', content: '' }, 'content: no items found in the CSV'],
    ['a CSV with only a header', { format: 'csv', content: 'name,quantity,unit,note\n' }, 'content: no items found in the CSV'],
    ['a CSV whose rows have no name', { format: 'csv', content: 'name,quantity\n,2\n,3' }, 'content: no items found in the CSV'],
    ['501 text lines', { format: 'text', content: lines(501) }, 'content: at most 500 items at a time (found 501)'],
    ['501 CSV rows', { format: 'csv', content: `name\n${lines(501)}` }, 'content: at most 500 items at a time (found 501)'],
    ['a body that is a list', [{ format: 'text', content: 'milk' }], 'The request body must be a JSON object'],
  ];
  it.each(importCases)('import: %s', async (_label, body, error) => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const before = await updatedAt(list.id);
    const res = await importTo(app, ana, list.id, body);
    expect([res.status, res.body]).toEqual([400, { error }]);
    expect(await count(pool, 'list_items')).toBe(0);
    expect(await updatedAt(list.id)).toBe(before);
  });

  it('import: 500 text lines after merging are fine, even from more lines', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const content = `${lines(500)}\n${lines(100)}`; // 600 lines, 500 distinct names
    const res = await importTo(app, ana, list.id, { format: 'text', content });
    expect([res.status, res.body.items.length]).toEqual([201, 500]);
    expect(res.body.items[0].quantity).toBe(2);
  });

  const bulkCases: Array<[string, unknown, string]> = [
    ['an empty body', {}, 'items: is required'],
    ['an empty list of items', { items: [] }, 'items: must contain at least 1 item'],
    ['items that are not a list', { items: 'milk' }, 'items: must be a list of items'],
    ['501 items', { items: Array.from({ length: 501 }, (_, i) => ({ name: `x${i}` })) }, 'items: must contain at most 500 items'],
    ['an item that is not an object', { items: [{ name: 'milk' }, 'eggs'] }, 'items.1: must be an item (an object)'],
    ['an item without a name', { items: [{ name: 'milk' }, { quantity: 2 }] }, 'items.1.name: is required'],
    ['an item with quantity 0', { items: [{ name: 'milk' }, { name: 'eggs', quantity: 0 }] }, 'items.1.quantity: must be greater than 0'],
    ['an item with an empty unit', { items: [{ name: 'milk', unit: '' }] }, 'items.0.unit: must not be empty'],
    ['a body that is a list', [{ name: 'milk' }], 'The request body must be a JSON object'],
  ];
  it.each(bulkCases)('bulk: %s', async (_label, body, error) => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const before = await updatedAt(list.id);
    const res = await bulkTo(app, ana, list.id, body);
    expect([res.status, res.body]).toEqual([400, { error }]);
    expect(await count(pool, 'list_items')).toBe(0);
    expect(await updatedAt(list.id)).toBe(before);
  });
});

describe('all or nothing', () => {
  it('one bad item among many refuses the whole bulk add', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const items = Array.from({ length: 300 }, (_, i) => ({ name: `ok ${i}` }));
    items.push({ name: 'x'.repeat(121) });
    const res = await bulkTo(app, ana, list.id, { items });
    expect([res.status, res.body]).toEqual([400, { error: 'items.300.name: must be at most 120 characters' }]);
    expect(await count(pool, 'list_items')).toBe(0);
  });

  it('a parsed item that breaks a rule refuses the whole import, naming the item (D-146)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const long = 'y'.repeat(130);
    const cases: Array<[string, string]> = [
      [`milk\neggs\n${long}`, `content: item 3 ("${'y'.repeat(40)}..."): name: must be at most 120 characters`],
      ['milk\n99999999 eggs', 'content: item 2 ("eggs"): quantity: must be at most 9999999.999'],
      [`milk\neggs (${'n'.repeat(201)})`, 'content: item 2 ("eggs"): note: must be at most 200 characters'],
    ];
    for (const [content, error] of cases) {
      const res = await importTo(app, ana, list.id, { format: 'text', content });
      expect([res.status, res.body]).toEqual([400, { error }]);
    }
    const csv = await importTo(app, ana, list.id, { format: 'csv', content: `name,note\nmilk,\neggs,${'n'.repeat(201)}` });
    expect([csv.status, csv.body]).toEqual([400, { error: 'content: item 2 ("eggs"): note: must be at most 200 characters' }]);
    expect(await count(pool, 'list_items')).toBe(0);
  });

  it('a database failure after the items were written rolls them back (the list bump fails: nothing stays)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'Refuses updates');
    await request(app).post(`/api/lists/${list.id}/items`).set('Authorization', ana.auth).send({ name: 'before' });
    // From now on, changing this list fails inside Postgres, after the item INSERT has run.
    await pool.query(`
      CREATE FUNCTION refuse_list_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name = 'Refuses updates' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER refuse_list_update BEFORE UPDATE ON shopping_lists FOR EACH ROW EXECUTE FUNCTION refuse_list_update();`);
    try {
      const before = await updatedAt(list.id);
      const imported = await importTo(app, ana, list.id, { format: 'text', content: lines(50) });
      const bulk = await bulkTo(app, ana, list.id, { items: [{ name: 'a' }, { name: 'b' }] });
      expect([imported.status, bulk.status]).toEqual([500, 500]);
      expect((await getList(app, ana, list.id)).items.map((i) => i.name)).toEqual(['before']);
      expect(await updatedAt(list.id)).toBe(before);
    } finally {
      await pool.query('DROP TRIGGER refuse_list_update ON shopping_lists; DROP FUNCTION refuse_list_update()');
    }
  });

  it('a database failure on one row of the INSERT writes none of them', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    await pool.query(`
      CREATE FUNCTION refuse_item() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name = 'poison' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER refuse_item BEFORE INSERT ON list_items FOR EACH ROW EXECUTE FUNCTION refuse_item();`);
    try {
      const before = await updatedAt(list.id);
      const res = await importTo(app, ana, list.id, { format: 'text', content: 'milk\neggs\npoison\nbread' });
      expect(res.status).toBe(500);
      expect(await count(pool, 'list_items')).toBe(0);
      expect(await updatedAt(list.id)).toBe(before);
    } finally {
      await pool.query('DROP TRIGGER refuse_item ON list_items; DROP FUNCTION refuse_item()');
    }
  });

  it.each([
    ['an import', (app: App, user: TestUser, listId: string) => importTo(app, user, listId, { format: 'text', content: 'milk\neggs' })],
    ['a bulk add', (app: App, user: TestUser, listId: string) => bulkTo(app, user, listId, { items: [{ name: 'milk' }, { name: 'eggs' }] })],
    ['a single add', (app: App, user: TestUser, listId: string) => request(app).post(`/api/lists/${listId}/items`).set('Authorization', user.auth).send({ name: 'milk' })],
  ])('%s waits for an addition in progress on the same list, then goes after it (the list row lock, D-143)', async (_label, add) => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    // Another addition in progress: list row locked, one item written at position 0, not committed yet.
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT id FROM shopping_lists WHERE id = $1 FOR UPDATE', [list.id]);
      await other.query("INSERT INTO list_items (list_id, name, position) VALUES ($1, 'in progress', 0)", [list.id]);
      let finished = false;
      const pending = add(app, ana, list.id).then((res) => {
        finished = true;
        return res;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(finished).toBe(false); // it waits for the other addition
      await other.query('COMMIT');
      expect((await pending).status).toBe(201);
    } finally {
      await other.query('ROLLBACK').catch(() => undefined);
      other.release();
    }
    // Without the lock it would have read the list before the other item was committed and
    // reused position 0.
    const { rows } = await pool.query<{ name: string; position: number }>('SELECT name, position FROM list_items WHERE list_id = $1 ORDER BY position', [list.id]);
    expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length);
    expect(rows[0]).toEqual({ name: 'in progress', position: 0 });
  });

  it('two imports into one list at the same time: each keeps its items together and in order', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    const [a, b] = await Promise.all([
      importTo(app, ana, list.id, { format: 'text', content: lines(60, (i) => `a${String(i).padStart(2, '0')}`) }),
      importTo(app, ana, list.id, { format: 'text', content: lines(60, (i) => `b${String(i).padStart(2, '0')}`) }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const names = (await getList(app, ana, list.id)).items.map((i) => i.name);
    const blockA = names.filter((n) => n.startsWith('a'));
    const blockB = names.filter((n) => n.startsWith('b'));
    expect(names).toEqual(names[0].startsWith('a') ? [...blockA, ...blockB] : [...blockB, ...blockA]);
    expect(blockA).toEqual([...blockA].sort());
    const { rows } = await pool.query('SELECT count(DISTINCT position)::int AS n FROM list_items WHERE list_id = $1', [list.id]);
    expect(rows[0].n).toBe(120);
  });
});

describe('not found', () => {
  it('someone else\'s list, an unknown list and a malformed id are 404 List not found, even with a bad body', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const list = await createList(app, ana);
    for (const [user, id] of [[bo, list.id], [ana, UNKNOWN], [ana, 'abc']] as const) {
      for (const res of [
        await importTo(app, user, id, { format: 'text', content: 'milk' }),
        await importTo(app, user, id, { format: 'xml' }),
        await bulkTo(app, user, id, { items: [{ name: 'milk' }] }),
        await bulkTo(app, user, id, { items: [] }),
      ]) {
        expect([res.status, res.body]).toEqual([404, { error: 'List not found' }]);
      }
    }
    expect(await count(pool, 'list_items')).toBe(0);
  });
});

describe('logging', () => {
  it('items_imported at info with source, count and matched; never the content', async () => {
    const { app, sink } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana);
    await importTo(app, ana, list.id, { format: 'text', content: 'milk\nSecret Sauce' });
    await importTo(app, ana, list.id, { format: 'csv', content: 'name\neggs' });
    await bulkTo(app, ana, list.id, { items: [{ name: 'Private thing' }] });
    expect(sink.records.filter((r) => r.event === 'items_imported').map((r) => [r.level, r.source, r.count, r.matched, r.listId])).toEqual([
      ['info', 'text', 2, 1, list.id],
      ['info', 'csv', 1, 1, list.id],
      ['info', 'bulk', 1, 0, list.id],
    ]);
    expect(JSON.stringify(sink.records)).not.toMatch(/Secret Sauce|Private thing/);
  });
});
