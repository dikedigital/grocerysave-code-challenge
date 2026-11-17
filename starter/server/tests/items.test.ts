/**
 * List items through HTTP against TEST_DATABASE_URL (TECH_SPEC 6.3; decisions D-134 to D-140):
 * POST /api/lists/:id/items, PATCH and DELETE /api/lists/:id/items/:itemId, with the real catalog.
 */
import type { Pool } from 'pg';
import request from 'supertest';
import type { ListItem, ShoppingList } from '../../src/models';
import { createApp } from '../src/app';
import { seedCatalog } from '../src/db/seed';
import { createLogger, memorySink, silentLogger } from '../src/logger';
import { signToken } from '../src/services/tokens';
import { count, resetDatabase, testPool } from './helpers/db';

jest.setTimeout(60000);

const SECRET = 'items-test-secret';
const UNKNOWN = '3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69';

let pool: Pool;
/** Product id by SKU, from the seeded catalog. */
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
const as = (user: TestUser) => ({
  createList: async (app: App, name = 'Groceries'): Promise<ShoppingList> => {
    const res = await request(app).post('/api/lists').set('Authorization', user.auth).send({ name });
    expect(res.status).toBe(201);
    return res.body;
  },
  getList: (app: App, listId: string) => request(app).get(`/api/lists/${listId}`).set('Authorization', user.auth),
  lists: async (app: App) => (await request(app).get('/api/lists').set('Authorization', user.auth)).body as ShoppingList[],
  add: (app: App, listId: string, body: unknown) => request(app).post(`/api/lists/${listId}/items`).set('Authorization', user.auth).send(body as object),
  patch: (app: App, listId: string, itemId: string, body: unknown) => request(app).patch(`/api/lists/${listId}/items/${itemId}`).set('Authorization', user.auth).send(body as object),
  remove: (app: App, listId: string, itemId: string) => request(app).delete(`/api/lists/${listId}/items/${itemId}`).set('Authorization', user.auth),
});

/** Adds an item and returns it (expects 201). */
async function added(app: App, user: TestUser, listId: string, body: unknown): Promise<ListItem> {
  const res = await as(user).add(app, listId, body);
  expect([res.status, res.body.error]).toEqual([201, undefined]);
  return res.body;
}

const updatedAt = async (listId: string) => (await pool.query<{ updated_at: Date }>('SELECT updated_at FROM shopping_lists WHERE id = $1', [listId])).rows[0].updated_at.toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('POST /api/lists/:id/items: matching the name to the catalog', () => {
  it('201 with the item: a match sets productId, the product category and, by default, its unit', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const res = await as(ana).add(app, list.id, { name: '  Milk ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      listId: list.id,
      name: 'Milk',
      quantity: 1,
      unit: 'gal',
      category: 'Dairy',
      note: null,
      productId: sku['GS-001'],
      completed: false,
    });
    expect((await as(ana).getList(app, list.id)).body.items).toEqual([res.body]);
  });

  it.each([
    ['milk', 'GS-001', 'Dairy', 'gal'],
    ['WHOLE MILK', 'GS-001', 'Dairy', 'gal'],
    ['gallon of milk', 'GS-001', 'Dairy', 'gal'],
    ['eggs', 'GS-006', 'Dairy', 'dozen'],
    ['Bananas', 'GS-011', 'Produce', 'lb'],
    ['olive oil', 'GS-002', 'Pantry', 'bottle'],
    ['Salmon fillet', 'GS-012', 'Meat & Seafood', 'lb'],
  ])('%p matches %s (%s, %s)', async (name, productSku, category, unit) => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    expect(await added(app, ana, list.id, { name })).toMatchObject({ name, productId: sku[productSku], category, unit });
  });

  it.each(['Birthday candles', 'almond milk', 'chicken thighs', 'olive', 'xyz'])(
    '%p matches nothing: productId null, category Other, unit each (API threshold 0.51, D-18)',
    async (name) => {
      const { app } = appWithLog();
      const ana = await makeUser('ana@example.com');
      const list = await as(ana).createList(app);
      expect(await added(app, ana, list.id, { name })).toMatchObject({ name, productId: null, category: 'Other', unit: 'each' });
    },
  );

  it('an explicit unit and quantity are kept, matched or not; "each" sent by the add form is kept too (D-140)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    expect(await added(app, ana, list.id, { name: 'milk', quantity: 2.5, unit: 'l' })).toMatchObject({ quantity: 2.5, unit: 'l', productId: sku['GS-001'], category: 'Dairy' });
    expect(await added(app, ana, list.id, { name: 'milk', quantity: 1, unit: 'each' })).toMatchObject({ unit: 'each', productId: sku['GS-001'] });
    expect(await added(app, ana, list.id, { name: 'Birthday candles', quantity: 3, unit: 'box' })).toMatchObject({ quantity: 3, unit: 'box', productId: null });
  });

  it('known units are written the canonical way; other units are kept as typed (D-139)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const units = [];
    for (const unit of [' KG ', 'lbs', 'Litre', 'ea', 'Doz.', 'tub', 'Sachet']) units.push((await added(app, ana, list.id, { name: 'flour', unit })).unit);
    expect(units).toEqual(['kg', 'lb', 'l', 'each', 'dozen', 'tub', 'Sachet']);
  });

  it('the note is trimmed; empty or null is no note', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    expect((await added(app, ana, list.id, { name: 'a', note: '  ripe ' })).note).toBe('ripe');
    expect((await added(app, ana, list.id, { name: 'b', note: '   ' })).note).toBeNull();
    expect((await added(app, ana, list.id, { name: 'c', note: null })).note).toBeNull();
  });

  it('quantities are stored to 3 decimals, like the list parser (0.33333 -> 0.333)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    expect((await added(app, ana, list.id, { name: 'a', quantity: 0.33333 })).quantity).toBe(0.333);
    expect((await added(app, ana, list.id, { name: 'b', quantity: 0.0005 })).quantity).toBe(0.001);
    expect((await added(app, ana, list.id, { name: 'c', quantity: 9999999.999 })).quantity).toBe(9999999.999);
  });

  it('productId, category, completed, listId and other fields in the body are ignored', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const other = await as(ana).createList(app, 'Other');
    const item = await added(app, ana, list.id, { name: 'Birthday candles', productId: sku['GS-001'], category: 'Dairy', completed: true, listId: other.id, position: 99 });
    expect(item).toMatchObject({ productId: null, category: 'Other', completed: false, listId: list.id });
  });

  it.each([
    [{}, 'name: is required'],
    [{ name: '' }, 'name: is required'],
    [{ name: '   ' }, 'name: is required'],
    [{ name: 5 }, 'name: must be text'],
    [{ name: 'x'.repeat(121) }, 'name: must be at most 120 characters'],
    [{ name: 'two\nlines' }, 'name: must not contain control characters'],
    [{ name: 'milk', quantity: 0 }, 'quantity: must be greater than 0'],
    [{ name: 'milk', quantity: -1 }, 'quantity: must be greater than 0'],
    [{ name: 'milk', quantity: 0.0004 }, 'quantity: must be greater than 0 (at least 0.001)'],
    [{ name: 'milk', quantity: '2' }, 'quantity: must be a number'],
    [{ name: 'milk', quantity: null }, 'quantity: must be a number'],
    [{ name: 'milk', quantity: 1e7 }, 'quantity: must be at most 9999999.999'],
    [{ name: 'milk', unit: '' }, 'unit: must not be empty'],
    [{ name: 'milk', unit: 3 }, 'unit: must be text'],
    [{ name: 'milk', unit: 'u'.repeat(21) }, 'unit: must be a unit of at most 20 characters on one line'],
    [{ name: 'milk', note: 'n'.repeat(201) }, 'note: must be at most 200 characters'],
    [{ name: 'milk', note: 7 }, 'note: must be text or null'],
    [[], 'The request body must be a JSON object'],
  ])('%j is 400 %p, and nothing is added', async (body, error) => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const res = await as(ana).add(app, list.id, body);
    expect([res.status, res.body]).toEqual([400, { error }]);
    expect(await count(pool, 'list_items')).toBe(0);
  });

  it('limits that are exactly met are accepted (120-character name, 200-character note, 20-character unit)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'x'.repeat(120), note: 'n'.repeat(200), unit: 'u'.repeat(20) });
    expect([item.name.length, item.note?.length, item.unit.length]).toEqual([120, 200, 20]);
  });
});

describe('order: items stay in the order they were added', () => {
  it('each new item goes last, also after items were deleted or completed', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const ids: Record<string, string> = {};
    for (const name of ['first', 'second', 'third']) ids[name] = (await added(app, ana, list.id, { name })).id;
    await as(ana).patch(app, list.id, ids.first, { completed: true });
    await as(ana).remove(app, list.id, ids.third);
    await added(app, ana, list.id, { name: 'fourth' });
    await as(ana).remove(app, list.id, ids.second);
    await added(app, ana, list.id, { name: 'fifth' });
    expect(((await as(ana).getList(app, list.id)).body as ShoppingList).items.map((i) => i.name)).toEqual(['first', 'fourth', 'fifth']);
  });

  it('new items go after items that were already there (seeded positions 0..n)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    await pool.query("INSERT INTO list_items (list_id, name, position) VALUES ($1, 'at 7', 7), ($1, 'at 2', 2)", [list.id]);
    await added(app, ana, list.id, { name: 'new' });
    expect(((await as(ana).getList(app, list.id)).body as ShoppingList).items.map((i) => i.name)).toEqual(['at 2', 'at 7', 'new']);
    expect((await pool.query("SELECT position FROM list_items WHERE name = 'new'")).rows[0].position).toBe(8);
  });

  it('editing never reorders: a renamed or completed item keeps its place', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const a = await added(app, ana, list.id, { name: 'a' });
    await added(app, ana, list.id, { name: 'b' });
    await as(ana).patch(app, list.id, a.id, { name: 'z renamed', completed: true, quantity: 3 });
    expect(((await as(ana).getList(app, list.id)).body as ShoppingList).items.map((i) => i.name)).toEqual(['z renamed', 'b']);
  });

  it('10 simultaneous additions to one list: all 201, 10 distinct positions (the list row lock)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => as(ana).add(app, list.id, { name: `item ${i}` })));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    const { rows } = await pool.query<{ position: number }>('SELECT position FROM list_items WHERE list_id = $1 ORDER BY position', [list.id]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('every item change bumps the list (D-137)', () => {
  it('adding, editing and removing an item each move updatedAt on and bring the list to the top', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app, 'Mine');
    await as(ana).createList(app, 'Newer');
    const top = async () => (await as(ana).lists(app))[0].name;
    expect(await top()).toBe('Newer');

    let before = await updatedAt(list.id);
    const item = await added(app, ana, list.id, { name: 'milk' });
    expect(await updatedAt(list.id) > before).toBe(true);
    expect(await top()).toBe('Mine');

    for (const change of [{ completed: true }, { quantity: 2 }, { unit: 'l' }, { note: 'semi' }, { name: 'eggs' }]) {
      await as(ana).createList(app, 'Newer still');
      before = await updatedAt(list.id);
      const res = await as(ana).patch(app, list.id, item.id, change);
      expect([JSON.stringify(change), res.status]).toEqual([JSON.stringify(change), 200]);
      expect(await updatedAt(list.id) > before).toBe(true);
      expect(await top()).toBe('Mine');
    }

    await as(ana).createList(app, 'Newest');
    before = await updatedAt(list.id);
    expect((await as(ana).remove(app, list.id, item.id)).status).toBe(204);
    expect(await updatedAt(list.id) > before).toBe(true);
    expect(await top()).toBe('Mine');
  });

  it('rapid changes give strictly increasing updatedAt values (each at least 1 ms later)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'milk' });
    await pool.query("UPDATE shopping_lists SET updated_at = now() + interval '1 hour' WHERE id = $1", [list.id]);
    const seen = [await updatedAt(list.id)];
    for (let i = 0; i < 6; i += 1) {
      await as(ana).patch(app, list.id, item.id, { completed: i % 2 === 0 });
      seen.push((await as(ana).getList(app, list.id)).body.updatedAt);
    }
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual(seen);
  });

  it('a change that changes nothing does not bump the list', async () => {
    const { app, sink } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'milk', note: 'x' });
    await sleep(5);
    const before = await updatedAt(list.id);
    const res = await as(ana).patch(app, list.id, item.id, { name: ' milk ', quantity: 1, unit: 'gal', note: 'x', completed: false });
    expect([res.status, res.body]).toEqual([200, item]);
    expect(await updatedAt(list.id)).toBe(before);
    expect(sink.records.filter((r) => r.event === 'item_updated')).toEqual([]);
  });

  it('a refused change does not bump the list either', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'milk' });
    const before = await updatedAt(list.id);
    expect((await as(ana).patch(app, list.id, item.id, { quantity: 0 })).status).toBe(400);
    expect((await as(ana).add(app, list.id, { name: '' })).status).toBe(400);
    expect((await as(ana).remove(app, list.id, UNKNOWN)).status).toBe(404);
    expect(await updatedAt(list.id)).toBe(before);
  });
});

describe('PATCH /api/lists/:id/items/:itemId', () => {
  it('quantity, unit, note and completed change; productId and category stay (other edits do not touch the product)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'milk' });
    const res = await as(ana).patch(app, list.id, item.id, { quantity: 1.5, unit: 'kg', note: ' organic ', completed: true });
    expect([res.status, res.body]).toEqual([200, { ...item, quantity: 1.5, unit: 'kg', note: 'organic', completed: true }]);
    expect((await as(ana).getList(app, list.id)).body.items).toEqual([res.body]);
    // The ListItemRow edit form sends exactly { quantity, unit, note } (TECH_SPEC 7.3.5):
    const fromForm = await as(ana).patch(app, list.id, item.id, { quantity: 2, unit: 'l', note: null });
    expect(fromForm.body).toMatchObject({ quantity: 2, unit: 'l', note: null, productId: sku['GS-001'], category: 'Dairy' });
    const unchecked = await as(ana).patch(app, list.id, item.id, { completed: false });
    expect(unchecked.body.completed).toBe(false);
  });

  it('a rename starts the item afresh: matched again, unit and quantity back to what a new item gets (D-136)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'milk', quantity: 2, unit: 'l', note: 'semi-skimmed' });
    await as(ana).patch(app, list.id, item.id, { completed: true });
    const toBananas = (await as(ana).patch(app, list.id, item.id, { name: 'Bananas' })).body;
    expect(toBananas).toEqual({ ...item, name: 'Bananas', productId: sku['GS-011'], category: 'Produce', unit: 'lb', quantity: 1, completed: true });
    await as(ana).patch(app, list.id, item.id, { quantity: 6, unit: 'bunch' });
    const toOat = (await as(ana).patch(app, list.id, item.id, { name: 'oat milk' })).body; // the product owner's example
    expect(toOat).toMatchObject({ name: 'oat milk', productId: null, category: 'Other', unit: 'each', quantity: 1, note: 'semi-skimmed', completed: true });
    await as(ana).patch(app, list.id, item.id, { quantity: 3, unit: 'l' });
    const toEggs = (await as(ana).patch(app, list.id, item.id, { name: 'eggs' })).body;
    expect(toEggs).toMatchObject({ name: 'eggs', productId: sku['GS-006'], category: 'Dairy', unit: 'dozen', quantity: 1 });
  });

  it('a rename to the same product resets too; a unit or quantity sent with the rename wins', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'milk', unit: 'l', quantity: 2 });
    expect((await as(ana).patch(app, list.id, item.id, { name: 'whole milk' })).body).toMatchObject({ productId: sku['GS-001'], unit: 'gal', quantity: 1 });
    expect((await as(ana).patch(app, list.id, item.id, { name: 'bananas', unit: 'bunch', quantity: 6 })).body).toMatchObject({ productId: sku['GS-011'], unit: 'bunch', quantity: 6 });
    expect((await as(ana).patch(app, list.id, item.id, { name: 'eggs', quantity: 12 })).body).toMatchObject({ productId: sku['GS-006'], unit: 'dozen', quantity: 12 });
  });

  it('sending the current name (trimmed) is not a rename: nothing is reset', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'milk', unit: 'l', quantity: 2 });
    expect((await as(ana).patch(app, list.id, item.id, { name: '  milk ', note: 'x' })).body).toEqual({ ...item, note: 'x' });
  });

  it('a product link that matching would not give is left alone by every edit except a rename', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'my usual' });
    await pool.query("UPDATE list_items SET product_id = $1, category = 'Pantry' WHERE id = $2", [sku['GS-002'], item.id]);
    const edited = (await as(ana).patch(app, list.id, item.id, { quantity: 4, note: 'big bottle', completed: true, unit: 'bottle' })).body;
    expect(edited).toMatchObject({ productId: sku['GS-002'], category: 'Pantry' });
    expect((await as(ana).patch(app, list.id, item.id, { name: 'my usual one' })).body).toMatchObject({ productId: null, category: 'Other' });
  });

  it.each([
    [{}, 'Nothing to change: send name, quantity, unit, note and/or completed'],
    [{ productId: UNKNOWN, category: 'Dairy' }, 'Nothing to change: send name, quantity, unit, note and/or completed'],
    [{ name: '' }, 'name: is required'],
    [{ name: null }, 'name: must be text'],
    [{ quantity: 0 }, 'quantity: must be greater than 0'],
    [{ quantity: -2 }, 'quantity: must be greater than 0'],
    [{ quantity: 'x' }, 'quantity: must be a number'],
    [{ quantity: null }, 'quantity: must be a number'],
    [{ unit: '' }, 'unit: must not be empty'],
    [{ unit: null }, 'unit: must be text'],
    [{ note: 5 }, 'note: must be text or null'],
    [{ completed: 'yes' }, 'completed: must be true or false'],
    [{ completed: 1 }, 'completed: must be true or false'],
    [{ completed: null }, 'completed: must be true or false'],
    [{ quantity: 0, completed: 'no' }, 'quantity: must be greater than 0; completed: must be true or false'],
    [[], 'The request body must be a JSON object'],
  ])('%j is 400 %p, and nothing changes', async (body, error) => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'milk' });
    const res = await as(ana).patch(app, list.id, item.id, body);
    expect([res.status, res.body]).toEqual([400, { error }]);
    expect((await as(ana).getList(app, list.id)).body.items).toEqual([item]);
  });
});

describe('DELETE /api/lists/:id/items/:itemId', () => {
  it('204 with no body; the item is gone, the others stay in order; a second delete is 404', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const a = await added(app, ana, list.id, { name: 'a' });
    const b = await added(app, ana, list.id, { name: 'b' });
    const c = await added(app, ana, list.id, { name: 'c' });
    const res = await as(ana).remove(app, list.id, b.id);
    expect([res.status, res.text]).toEqual([204, '']);
    expect((await as(ana).getList(app, list.id)).body.items).toEqual([a, c]);
    const again = await as(ana).remove(app, list.id, b.id);
    expect([again.status, again.body]).toEqual([404, { error: 'Item not found' }]);
  });
});

describe('not found: lists and items that are not yours, do not exist or are malformed', () => {
  it('another user\'s list is 404 "List not found" on all three routes, and nothing changes', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'milk' });
    const before = await updatedAt(list.id);
    for (const res of [
      await as(bo).add(app, list.id, { name: 'sneaky' }),
      await as(bo).patch(app, list.id, item.id, { completed: true }),
      await as(bo).patch(app, list.id, item.id, {}), // a bad body does not turn the 404 into a 400
      await as(bo).remove(app, list.id, item.id),
    ]) {
      expect([res.status, res.body]).toEqual([404, { error: 'List not found' }]);
    }
    expect((await as(ana).getList(app, list.id)).body.items).toEqual([item]);
    expect(await updatedAt(list.id)).toBe(before);
  });

  it('an item of another list (even one of your own) is 404 "Item not found", like an unknown one', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const first = await as(ana).createList(app, 'First');
    const second = await as(ana).createList(app, 'Second');
    const item = await added(app, ana, first.id, { name: 'milk' });
    for (const itemId of [item.id, UNKNOWN]) {
      for (const res of [await as(ana).patch(app, second.id, itemId, { completed: true }), await as(ana).remove(app, second.id, itemId)]) {
        expect([res.status, res.body]).toEqual([404, { error: 'Item not found' }]);
      }
    }
    expect((await as(ana).getList(app, first.id)).body.items).toEqual([item]);
  });

  it.each(['abc', '123', `${UNKNOWN}x`, UNKNOWN.replace(/-/g, ''), "' OR '1'='1"])(
    'malformed ids (%p) are 404 before any query: the list id gives "List not found", the item id "Item not found"',
    async (bad) => {
      const { app, sink } = appWithLog();
      const ana = await makeUser('ana@example.com');
      const list = await as(ana).createList(app);
      const item = await added(app, ana, list.id, { name: 'milk' });
      const badPath = encodeURIComponent(bad);
      const listResults = [await as(ana).add(app, badPath, { name: 'x' }), await as(ana).patch(app, badPath, item.id, { completed: true }), await as(ana).remove(app, badPath, item.id)];
      for (const res of listResults) expect([res.status, res.body]).toEqual([404, { error: 'List not found' }]);
      for (const res of [await as(ana).patch(app, list.id, badPath, { completed: true }), await as(ana).remove(app, list.id, badPath)]) {
        expect([res.status, res.body]).toEqual([404, { error: 'Item not found' }]);
      }
      expect(sink.records.filter((r) => r.event === 'database_input_rejected')).toEqual([]);
      expect(await count(pool, 'list_items')).toBe(1);
    },
  );

  it('a malformed item id on someone else\'s list says "List not found" (the list is checked first)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const list = await as(ana).createList(app);
    const res = await as(bo).patch(app, list.id, 'abc', { completed: true });
    expect([res.status, res.body]).toEqual([404, { error: 'List not found' }]);
  });
});

describe('logging', () => {
  it('item_added / item_updated / item_removed at info with ids and what changed, never names or notes', async () => {
    const { app, sink } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await as(ana).createList(app);
    const item = await added(app, ana, list.id, { name: 'Secret Sauce', note: 'private note' });
    await as(ana).patch(app, list.id, item.id, { name: 'milk', completed: true });
    await as(ana).remove(app, list.id, item.id);
    const records = sink.records.filter((r) => r.event.startsWith('item_'));
    expect(records.map((r) => [r.event, r.level, r.itemId])).toEqual([
      ['item_added', 'info', item.id],
      ['item_updated', 'info', item.id],
      ['item_removed', 'info', item.id],
    ]);
    expect(records[0]).toMatchObject({ matched: false, listId: list.id, userId: ana.id });
    expect(records[1].changed).toEqual(['name', 'completed', 'productId', 'category', 'unit']);
    const logged = JSON.stringify(sink.records);
    expect(logged).not.toContain('Secret Sauce');
    expect(logged).not.toContain('private note');
  });
});
