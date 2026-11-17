/**
 * Cross-user access, for EVERY route of a list (security pass, D-149): walks the app's route table,
 * so routes added later (comparison, optimisation...) are checked without editing this file.
 */
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp, listApiRoutes } from '../src/app';
import { seedCatalog } from '../src/db/seed';
import { silentLogger } from '../src/logger';
import { signToken } from '../src/services/tokens';
import { resetDatabase, testPool } from './helpers/db';

jest.setTimeout(60000);
const SECRET = 'security-test-secret';

let pool: Pool;
beforeAll(async () => {
  pool = testPool();
  await resetDatabase(pool);
  await seedCatalog(pool, { logger: silentLogger });
});
afterAll(async () => {
  await pool.end();
});

async function makeUser(email: string) {
  const { rows } = await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id", [email]);
  return { id: rows[0].id, auth: `Bearer ${signToken(rows[0].id, SECRET)}` };
}

/** Everything Postgres holds about a list: its row and every column of every item. */
async function fingerprint(listId: string): Promise<string> {
  const list = await pool.query('SELECT * FROM shopping_lists WHERE id = $1', [listId]);
  const items = await pool.query('SELECT * FROM list_items WHERE list_id = $1 ORDER BY id', [listId]);
  return createHash('sha256').update(JSON.stringify([list.rows, items.rows])).digest('hex');
}

/** A body that would be valid for the route, so that only access decides the answer. */
function validBody(method: string, path: string, householdId: string): object | undefined {
  if (method === 'GET' || method === 'DELETE') return undefined;
  if (path.endsWith('/import')) return { format: 'text', content: 'milk\neggs' };
  if (path.endsWith('/items/bulk')) return { items: [{ name: 'milk' }] };
  if (path.endsWith('/items')) return { name: 'milk' };
  if (path.endsWith('/items/:itemId')) return { name: 'changed', completed: true };
  if (path === '/api/lists/:id') return { name: 'changed', householdId };
  return {};
}

describe('user B against every route of user A\'s list', () => {
  it('is 404 "List not found" everywhere, exactly like a list that does not exist, and changes nothing', async () => {
    const app = createApp(pool, { jwtSecret: SECRET, logger: silentLogger });
    const alice = await makeUser('alice@example.com');
    const bob = await makeUser('bob@example.com');
    const { rows: [home] } = await pool.query<{ id: string }>('INSERT INTO households (name, owner_id) VALUES ($1, $2) RETURNING id', ['Bob home', bob.id]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')", [home.id, bob.id]);
    const list = (await request(app).post('/api/lists').set('Authorization', alice.auth).send({ name: 'Alice' })).body.id as string;
    const item = (await request(app).post(`/api/lists/${list}/items`).set('Authorization', alice.auth).send({ name: 'milk' })).body.id as string;

    const routes = listApiRoutes(app).filter((route) => route.path.startsWith('/api/lists/:id'));
    expect(routes.length).toBeGreaterThanOrEqual(8);
    for (const route of routes) {
      const before = await fingerprint(list);
      const path = route.path.replace(':id', list).replace(':itemId', item);
      const method = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete' | 'put';
      const body = validBody(route.method, route.path, home.id);
      let req = request(app)[method](path).set('Authorization', bob.auth);
      if (body) req = req.send(body);
      const res = await req;
      // The same request on a list id that does not exist gives the same answer.
      let ghost = request(app)[method](route.path.replace(':id', '3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69').replace(':itemId', item)).set('Authorization', bob.auth);
      if (body) ghost = ghost.send(body);
      const ghostRes = await ghost;
      expect([route.method, route.path, res.status, res.body]).toEqual([route.method, route.path, 404, { error: 'List not found' }]);
      expect([route.method, route.path, res.text]).toEqual([route.method, route.path, ghostRes.text]);
      expect([route.method, route.path, await fingerprint(list)]).toEqual([route.method, route.path, before]);
    }
    // And Alice herself gets through on the same routes (the routes work).
    for (const route of routes.filter((r) => r.method !== 'DELETE')) {
      const path = route.path.replace(':id', list).replace(':itemId', item);
      const method = route.method.toLowerCase() as 'get' | 'post' | 'patch';
      const body = route.path === '/api/lists/:id' && route.method === 'PATCH' ? { name: 'still Alice' } : validBody(route.method, route.path, home.id);
      let req = request(app)[method](path).set('Authorization', alice.auth);
      if (body) req = req.send(body);
      expect([route.method, route.path, (await req).status < 300]).toEqual([route.method, route.path, true]);
    }
  });
});
