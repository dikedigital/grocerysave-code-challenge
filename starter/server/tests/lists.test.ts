/**
 * Lists through HTTP against TEST_DATABASE_URL (TECH_SPEC 6.3; decisions D-125 to D-131):
 * GET /api/lists, POST /api/lists, GET|PATCH|DELETE /api/lists/:id, with two users.
 */
import type { Pool } from 'pg';
import request from 'supertest';
import type { ShoppingList } from '../../src/models';
import { createApp } from '../src/app';
import { DEMO_EMAIL, PARTNER_EMAIL, PARTY_SUPPLIES, WEEKLY_BASICS, seedCatalog, seedDemo } from '../src/db/seed';
import { createLogger, memorySink, silentLogger } from '../src/logger';
import { withTransaction } from '../src/db/tx';
import { BUMP_UPDATED_AT, updateList } from '../src/services/lists';
import { signToken } from '../src/services/tokens';
import { count, resetDatabase, testPool } from './helpers/db';

jest.setTimeout(60000);

const SECRET = 'lists-test-secret';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NOBODYS_LIST = '3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69';

let pool: Pool;
beforeAll(async () => {
  pool = testPool();
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE users, households CASCADE');
});

interface TestUser {
  id: string;
  auth: string;
}

/** A user straight in the database (login is auth.test.ts's business) with a valid token. */
async function makeUser(email: string): Promise<TestUser> {
  const { rows } = await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, 'not-a-hash') RETURNING id", [email]);
  return { id: rows[0].id, auth: `Bearer ${signToken(rows[0].id, SECRET)}` };
}

/** A household owned by `owner` with the given extra members. */
async function makeHousehold(owner: TestUser, members: TestUser[] = []): Promise<string> {
  const { rows } = await pool.query<{ id: string }>("INSERT INTO households (name, owner_id) VALUES ('Home', $1) RETURNING id", [owner.id]);
  await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')", [rows[0].id, owner.id]);
  for (const member of members) await pool.query('INSERT INTO household_members (household_id, user_id) VALUES ($1, $2)', [rows[0].id, member.id]);
  return rows[0].id;
}

function appWithLog() {
  const sink = memorySink();
  const app = createApp(pool, { jwtSecret: SECRET, logger: createLogger({ level: 'debug', sinks: [sink], component: 'test.http' }) });
  return { app, sink };
}

type App = ReturnType<typeof createApp>;
const get = (app: App, user: TestUser, path: string) => request(app).get(`/api/lists${path}`).set('Authorization', user.auth);
const post = (app: App, user: TestUser, body: unknown) => request(app).post('/api/lists').set('Authorization', user.auth).send(body as object);
const patch = (app: App, user: TestUser, id: string, body: unknown) => request(app).patch(`/api/lists/${id}`).set('Authorization', user.auth).send(body as object);
const del = (app: App, user: TestUser, id: string) => request(app).delete(`/api/lists/${id}`).set('Authorization', user.auth);

async function createList(app: App, user: TestUser, name: string, householdId?: string | null): Promise<ShoppingList> {
  const res = await post(app, user, householdId === undefined ? { name } : { name, householdId });
  expect(res.status).toBe(201);
  return res.body as ShoppingList;
}

/** Items straight in the database (the item endpoints are a later round). */
async function addItems(listId: string, items: Array<{ name: string; position: number; quantity?: number; note?: string | null; completed?: boolean; createdAt?: string }>) {
  for (const item of items) {
    await pool.query(
      `INSERT INTO list_items (list_id, name, quantity, note, completed, position, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
      [listId, item.name, item.quantity ?? 1, item.note ?? null, item.completed ?? false, item.position, item.createdAt ?? null],
    );
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('POST /api/lists', () => {
  it('201 with the new list: trimmed name, the caller as owner, private, no items, ISO timestamps', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const res = await post(app, ana, { name: '  Weekly shop  ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Weekly shop',
      ownerId: ana.id,
      householdId: null,
      items: [],
      createdAt: expect.stringMatching(ISO),
      updatedAt: expect.stringMatching(ISO),
    });
    expect(res.body.updatedAt).toBe(res.body.createdAt);
    expect((await get(app, ana, `/${res.body.id}`)).body).toEqual(res.body);
  });

  it('householdId null is a private list, like leaving it out (the client always sends it)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    expect((await createList(app, ana, 'A', null)).householdId).toBeNull();
  });

  it('householdId of a household the caller belongs to is kept; any other household is 404', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const anas = await makeHousehold(ana);
    const shared = await makeHousehold(bo, [ana]);
    const bos = await makeHousehold(bo);
    expect((await createList(app, ana, 'Own household', anas)).householdId).toBe(anas);
    expect((await createList(app, ana, 'As a member', shared)).householdId).toBe(shared);
    expect((await createList(app, ana, 'Upper-case id', shared.toUpperCase())).householdId).toBe(shared);
    for (const householdId of [bos, NOBODYS_LIST]) {
      const res = await post(app, ana, { name: 'Sneaky', householdId });
      expect([res.status, res.body]).toEqual([404, { error: 'Household not found' }]);
    }
    expect(await count(pool, 'shopping_lists')).toBe(3);
  });

  it.each([
    [{}, 'name: is required'],
    [{ name: '' }, 'name: is required'],
    [{ name: '   ' }, 'name: is required'],
    [{ name: 42 }, 'name: must be text'],
    [{ name: 'x'.repeat(101) }, 'name: must be at most 100 characters'],
    [{ name: 'two\nlines' }, 'name: must not contain control characters'],
    [{ name: 'A', householdId: 'not-a-uuid' }, 'householdId: must be a household id'],
    [{ name: 'A', householdId: 7 }, 'householdId: must be a household id or null'],
    [[], 'The request body must be a JSON object'],
  ])('%j is 400 %p', async (body, error) => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const res = await post(app, ana, body);
    expect([res.status, res.body]).toEqual([400, { error }]);
    expect(await count(pool, 'shopping_lists')).toBe(0);
  });

  it('a name of exactly 100 characters (emoji count as one) is accepted', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    expect((await createList(app, ana, 'x'.repeat(100))).name).toHaveLength(100);
    expect([...(await createList(app, ana, '🛒'.repeat(100))).name]).toHaveLength(100);
  });

  it('fields other than name and householdId are ignored (no choosing another owner)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const res = await post(app, ana, { name: 'Mine', ownerId: bo.id, id: NOBODYS_LIST, items: [{ name: 'x' }] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ownerId: ana.id, items: [] });
    expect(res.body.id).not.toBe(NOBODYS_LIST);
  });
});

describe('GET /api/lists', () => {
  it('a new user has no lists', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const res = await get(app, ana, '');
    expect([res.status, res.body]).toEqual([200, []]);
  });

  it('most recently changed first: creating and renaming move a list to the top', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const a = await createList(app, ana, 'A');
    const b = await createList(app, ana, 'B');
    const c = await createList(app, ana, 'C');
    const names = async () => ((await get(app, ana, '')).body as ShoppingList[]).map((l) => l.name);
    expect(await names()).toEqual(['C', 'B', 'A']);
    await patch(app, ana, a.id, { name: 'A2' });
    expect(await names()).toEqual(['A2', 'C', 'B']);
    await patch(app, ana, b.id, { name: 'B2' });
    expect(await names()).toEqual(['B2', 'A2', 'C']);
    void c;
  });

  it('lists changed at the same moment come newest-created first, then by id: a stable order', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    await pool.query(
      `INSERT INTO shopping_lists (owner_id, name, created_at, updated_at) VALUES
       ($1, 'older', '2026-01-01T10:00:00Z', '2026-02-01T10:00:00Z'),
       ($1, 'newer', '2026-01-02T10:00:00Z', '2026-02-01T10:00:00Z'),
       ($1, 'changed later', '2026-01-01T09:00:00Z', '2026-02-02T10:00:00Z')`,
      [ana.id],
    );
    for (let i = 0; i < 3; i += 1) {
      expect(((await get(app, ana, '')).body as ShoppingList[]).map((l) => l.name)).toEqual(['changed later', 'newer', 'older']);
    }
  });

  it('each list comes with its own items, by position then creation time, with every ListItem field', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const first = await createList(app, ana, 'First');
    const second = await createList(app, ana, 'Second');
    await addItems(first.id, [
      { name: 'third', position: 2 },
      { name: 'first', position: 0, quantity: 0.333, note: 'ripe', completed: true },
      // Same position: creation decides. The names sort the other way, so a name order would show.
      { name: 'a: second (created later)', position: 1, createdAt: '2026-01-02T00:00:00Z' },
      { name: 'b: second (created earlier)', position: 1, createdAt: '2026-01-01T00:00:00Z' },
    ]);
    await addItems(second.id, [{ name: 'only', position: 5 }]);

    const lists = (await get(app, ana, '')).body as ShoppingList[];
    const byName = Object.fromEntries(lists.map((l) => [l.name, l]));
    expect(byName.First.items.map((i) => i.name)).toEqual(['first', 'b: second (created earlier)', 'a: second (created later)', 'third']);
    expect(byName.Second.items.map((i) => i.name)).toEqual(['only']);
    expect(byName.First.items[0]).toEqual({
      id: expect.any(String),
      listId: first.id,
      name: 'first',
      quantity: 0.333,
      unit: 'each',
      category: 'Other',
      note: 'ripe',
      productId: null,
      completed: true,
    });
    expect(byName.First.items[1]).toMatchObject({ quantity: 1, note: null, completed: false });
    expect((await get(app, ana, `/${first.id}`)).body.items).toEqual(byName.First.items);
  });

  it('does not run one query per list: the same number of queries for 1 list and for 12', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const queriesFor = async () => {
      const spy = jest.spyOn(pool, 'query');
      try {
        expect((await get(app, ana, '')).status).toBe(200);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };
    const one = await createList(app, ana, 'one');
    await addItems(one.id, [{ name: 'x', position: 0 }]);
    const withOne = await queriesFor();
    for (let i = 0; i < 11; i += 1) {
      const list = await createList(app, ana, `list ${i}`);
      await addItems(list.id, [{ name: 'a', position: 0 }, { name: 'b', position: 1 }]);
    }
    expect(await queriesFor()).toBe(withOne);
    expect(withOne).toBe(3); // the token's user, the lists, all their items
  });

  it('the seeded demo data: the demo user gets both lists with their items; the partner gets none yet', async () => {
    await seedCatalog(pool, { logger: silentLogger });
    await seedDemo(pool, { logger: silentLogger });
    const ids = Object.fromEntries((await pool.query<{ email: string; id: string }>('SELECT email, id FROM users')).rows.map((r) => [r.email, r.id]));
    const demo = { id: ids[DEMO_EMAIL], auth: `Bearer ${signToken(ids[DEMO_EMAIL], SECRET)}` };
    const partner = { id: ids[PARTNER_EMAIL], auth: `Bearer ${signToken(ids[PARTNER_EMAIL], SECRET)}` };
    const { app } = appWithLog();

    const lists = (await get(app, demo, '')).body as ShoppingList[];
    expect(lists.map((l) => l.name).sort()).toEqual([PARTY_SUPPLIES, WEEKLY_BASICS]);
    const weekly = lists.find((l) => l.name === WEEKLY_BASICS)!;
    expect(weekly.items).toHaveLength(16);
    expect(weekly.items[0]).toMatchObject({ name: 'Milk', category: 'Dairy', quantity: 1, productId: expect.any(String) });
    const party = lists.find((l) => l.name === PARTY_SUPPLIES)!;
    expect(party.householdId).toEqual(expect.any(String));
    expect(party.items.find((i) => i.name === 'Birthday candles')).toMatchObject({ productId: null, category: 'Other', unit: 'each' });

    // The partner is in "Demo household", but sharing arrives in the next stage (D-125).
    expect((await get(app, partner, '')).body).toEqual([]);
    expect((await get(app, partner, `/${party.id}`)).status).toBe(404);
  });
});

describe('two users: someone else\'s list is a 404 on every route', () => {
  it('Bo never sees Ana\'s lists, and gets exactly the answer of a list that does not exist', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const anas = await createList(app, ana, 'Ana private');
    await addItems(anas.id, [{ name: 'secret item', position: 0 }]);
    const bos = await createList(app, bo, 'Bo private');

    expect(((await get(app, bo, '')).body as ShoppingList[]).map((l) => l.name)).toEqual(['Bo private']);
    expect(((await get(app, ana, '')).body as ShoppingList[]).map((l) => l.name)).toEqual(['Ana private']);

    for (const id of [anas.id, NOBODYS_LIST]) {
      for (const res of [await get(app, bo, `/${id}`), await patch(app, bo, id, { name: 'Hacked' }), await del(app, bo, id)]) {
        expect([res.status, res.body]).toEqual([404, { error: 'List not found' }]);
      }
    }
    // Ana's list is untouched: same name, same updatedAt, items still there.
    const after = (await get(app, ana, `/${anas.id}`)).body as ShoppingList;
    expect(after).toEqual({ ...anas, items: [expect.objectContaining({ name: 'secret item' })] });
    expect((await get(app, bo, `/${bos.id}`)).status).toBe(200);
  });

  it('a bad body on someone else\'s list is still 404, not 400: nothing is revealed', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const anas = await createList(app, ana, 'Ana private');
    for (const body of [{}, { name: '' }, { householdId: 'x' }]) {
      const res = await patch(app, bo, anas.id, body);
      expect([res.status, res.body]).toEqual([404, { error: 'List not found' }]);
    }
  });

  it('a list shared with a household Bo belongs to is still only Ana\'s in this stage (D-125)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const shared = await createList(app, ana, 'Shared', await makeHousehold(ana, [bo]));
    expect((await get(app, bo, '')).body).toEqual([]);
    expect((await get(app, bo, `/${shared.id}`)).status).toBe(404);
    expect((await patch(app, bo, shared.id, { name: 'x' })).status).toBe(404);
    expect((await del(app, bo, shared.id)).status).toBe(404);
  });
});

describe('malformed ids are 404 before any query', () => {
  it.each(['abc', '123', `${NOBODYS_LIST}x`, NOBODYS_LIST.replace(/-/g, ''), `{${NOBODYS_LIST}}`, "' OR '1'='1", '%20', 'null', 'undefined'])(
    '%p: GET, PATCH and DELETE are 404 List not found; Postgres never sees it',
    async (id) => {
      const { app, sink } = appWithLog();
      const ana = await makeUser('ana@example.com');
      await createList(app, ana, 'Mine');
      const path = encodeURIComponent(id).replace(/%2520/g, '%20');
      for (const res of [await get(app, ana, `/${path}`), await patch(app, ana, path, { name: 'x' }), await del(app, ana, path)]) {
        expect([id, res.status, res.body]).toEqual([id, 404, { error: 'List not found' }]);
      }
      expect(sink.records.filter((r) => r.event === 'database_input_rejected')).toEqual([]);
      expect(await count(pool, 'shopping_lists')).toBe(1);
    },
  );

  it('an upper-case id is the same list', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'Mine');
    const res = await get(app, ana, `/${list.id.toUpperCase()}`);
    expect([res.status, res.body.id]).toEqual([200, list.id]);
  });
});

describe('PATCH /api/lists/:id', () => {
  it('rename: 200 with the whole list, trimmed name, updatedAt moves on, createdAt stays', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'Old');
    await addItems(list.id, [{ name: 'kept', position: 0 }]);
    await sleep(5);
    const res = await patch(app, ana, list.id, { name: '  New name ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...list, name: 'New name', items: [expect.objectContaining({ name: 'kept' })], updatedAt: expect.stringMatching(ISO) });
    expect(res.body.updatedAt > list.updatedAt).toBe(true);
    expect((await get(app, ana, `/${list.id}`)).body).toEqual(res.body);
  });

  it('two changes in a row always give two different, increasing updatedAt values (even within 1 ms)', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'L');
    // Make the stored time run ahead of the clock, so that now() alone would not move it forward.
    await pool.query("UPDATE shopping_lists SET updated_at = now() + interval '1 hour' WHERE id = $1", [list.id]);
    const seen: string[] = [(await get(app, ana, `/${list.id}`)).body.updatedAt];
    for (let i = 0; i < 5; i += 1) seen.push((await patch(app, ana, list.id, { name: `L${i}` })).body.updatedAt);
    expect(new Set(seen).size).toBe(6);
    expect([...seen].sort()).toEqual(seen);
  });

  it('two changes inside one transaction (where now() does not move) still give two different updatedAt values', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'L');
    const stamps = await withTransaction(pool, async (db) => {
      const read = async () => (await db.query<{ updated_at: Date }>('SELECT updated_at FROM shopping_lists WHERE id = $1', [list.id])).rows[0].updated_at.toISOString();
      await updateList(db, list.id, { name: 'first change' });
      const first = await read();
      await updateList(db, list.id, { name: 'second change' });
      return [first, await read()];
    });
    expect(stamps[1] > stamps[0]).toBe(true);
  });

  it('waits for a change in progress on the same list and decides on its result (row lock, D-131)', async () => {
    const { app, sink } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'Before');
    // Another change to the list, in progress: row locked and renamed, not yet committed.
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT id FROM shopping_lists WHERE id = $1 FOR UPDATE', [list.id]);
      await other.query(`UPDATE shopping_lists SET name = 'Renamed elsewhere', updated_at = ${BUMP_UPDATED_AT} WHERE id = $1`, [list.id]);
      let finished = false;
      const pending = patch(app, ana, list.id, { name: 'Renamed elsewhere' }).then((res) => {
        finished = true;
        return res;
      });
      await sleep(300);
      expect(finished).toBe(false); // it waits for the other change
      await other.query('COMMIT');
      const res = await pending;
      const committed = (await pool.query<{ updated_at: Date }>('SELECT updated_at FROM shopping_lists WHERE id = $1', [list.id])).rows[0].updated_at;
      // It saw "Renamed elsewhere" and had nothing left to change: no second write, no second bump.
      expect([res.status, res.body.name, res.body.updatedAt]).toEqual([200, 'Renamed elsewhere', committed.toISOString()]);
      expect(sink.records.filter((r) => r.event === 'list_updated')).toEqual([]);
    } finally {
      await other.query('ROLLBACK').catch(() => undefined);
      other.release();
    }
  });

  it('sending the current values changes nothing: 200, same updatedAt, not moved to the top', async () => {
    const { app, sink } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const household = await makeHousehold(ana);
    const list = await createList(app, ana, 'Same', household);
    await createList(app, ana, 'Newer');
    const res = await patch(app, ana, list.id, { name: ' Same ', householdId: household });
    expect([res.status, res.body]).toEqual([200, list]);
    expect(((await get(app, ana, '')).body as ShoppingList[])[0].name).toBe('Newer');
    expect(sink.records.filter((r) => r.event === 'list_updated')).toEqual([]);
  });

  it('share with a household the owner belongs to, move it, make it private again', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const home = await makeHousehold(ana);
    const bosHome = await makeHousehold(bo, [ana]);
    const list = await createList(app, ana, 'L');
    expect((await patch(app, ana, list.id, { householdId: home })).body.householdId).toBe(home);
    expect((await patch(app, ana, list.id, { householdId: bosHome })).body.householdId).toBe(bosHome);
    expect((await patch(app, ana, list.id, { householdId: null })).body.householdId).toBeNull();
  });

  it('a household the owner does not belong to is 404 and nothing changes', async () => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const bo = await makeUser('bo@example.com');
    const bos = await makeHousehold(bo);
    const list = await createList(app, ana, 'L');
    for (const householdId of [bos, NOBODYS_LIST]) {
      const res = await patch(app, ana, list.id, { name: 'Renamed too', householdId });
      expect([res.status, res.body]).toEqual([404, { error: 'Household not found' }]);
    }
    expect((await get(app, ana, `/${list.id}`)).body).toEqual(list); // the rename sent in the same request was not applied either
  });

  it.each([
    [{}, 'Nothing to change: send name and/or householdId'],
    [{ ownerId: '3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69' }, 'Nothing to change: send name and/or householdId'],
    [{ name: '' }, 'name: is required'],
    [{ name: '  ' }, 'name: is required'],
    [{ name: null }, 'name: must be text'],
    [{ name: 'x'.repeat(101) }, 'name: must be at most 100 characters'],
    [{ name: 'tab\there' }, 'name: must not contain control characters'],
    [{ householdId: 'abc' }, 'householdId: must be a household id'],
    [{ householdId: false }, 'householdId: must be a household id or null'],
    [[], 'The request body must be a JSON object'],
  ])('%j is 400 %p, and nothing changes', async (body, error) => {
    const { app } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'L');
    const res = await patch(app, ana, list.id, body);
    expect([res.status, res.body]).toEqual([400, { error }]);
    expect((await get(app, ana, `/${list.id}`)).body).toEqual(list);
  });
});

describe('DELETE /api/lists/:id', () => {
  it('204 with no body; the list and its items are gone; a second delete is 404', async () => {
    const { app, sink } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'Doomed');
    const kept = await createList(app, ana, 'Kept');
    await addItems(list.id, [{ name: 'a', position: 0 }, { name: 'b', position: 1 }]);
    await addItems(kept.id, [{ name: 'c', position: 0 }]);
    const res = await del(app, ana, list.id);
    expect([res.status, res.text]).toEqual([204, '']);
    expect((await get(app, ana, `/${list.id}`)).status).toBe(404);
    expect(((await get(app, ana, '')).body as ShoppingList[]).map((l) => l.name)).toEqual(['Kept']);
    expect(await count(pool, 'list_items')).toBe(1);
    expect((await del(app, ana, list.id)).status).toBe(404);
    expect(sink.records.find((r) => r.event === 'list_deleted')).toMatchObject({ level: 'info', userId: ana.id, listId: list.id });
  });
});

describe('logging', () => {
  it('creations and changes are logged at info with ids, never the list name', async () => {
    const { app, sink } = appWithLog();
    const ana = await makeUser('ana@example.com');
    const list = await createList(app, ana, 'Private Name');
    await patch(app, ana, list.id, { name: 'Other Private Name' });
    expect(sink.records.filter((r) => r.event.startsWith('list_')).map((r) => [r.event, r.level, r.listId])).toEqual([
      ['list_created', 'info', list.id],
      ['list_updated', 'info', list.id],
    ]);
    expect(sink.records.find((r) => r.event === 'list_updated')?.changed).toEqual(['name']);
    expect(JSON.stringify(sink.records)).not.toContain('Private Name');
  });
});
