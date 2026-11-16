import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import type { Product } from '../../src/models';
import { config } from '../src/config';
import {
  DEMO_EMAIL, DEMO_PASSWORD, PARTNER_EMAIL, PARTY_SUPPLIES, PARTY_SUPPLIES_ITEMS, WEEKLY_BASICS, WEEKLY_BASICS_ITEMS,
  seed, seedCatalog, seedDemo,
} from '../src/db/seed';
import { createLogger, memorySink } from '../src/logger';
import { matchCatalogItem } from '../src/services/catalogMatch';
import { count, resetDatabase, testPool } from './helpers/db';

jest.setTimeout(60000);

const quiet = { logger: createLogger({ level: 'silent', sinks: [] }) };
let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDatabase(pool);
});

const TABLES = ['chains', 'stores', 'products', 'price_history', 'users', 'user_preferences', 'households', 'household_members', 'shopping_lists', 'list_items'];
async function tableCounts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of [...TABLES, 'sync_runs']) result[table] = await count(pool, table);
  return result;
}
const userId = async (email: string) => (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0]?.id as string;
async function listItems(name: string) {
  const { rows } = await pool.query(`
    SELECT i.position, i.name, i.quantity, i.unit, i.category, p.sku, i.completed, i.note
    FROM list_items i JOIN shopping_lists l ON l.id = i.list_id LEFT JOIN products p ON p.id = i.product_id
    WHERE l.name = $1 ORDER BY i.position`, [name]);
  return rows;
}

describe('seedDemo: the demo data of TECH_SPEC 4.3', () => {
  beforeEach(async () => {
    await seedCatalog(pool, quiet);
  });

  it('rejects when the catalog is missing, and writes nothing', async () => {
    await resetDatabase(pool);
    const sink = memorySink();
    await expect(seedDemo(pool, { logger: createLogger({ level: 'info', sinks: [sink] }) })).rejects.toThrow(/seedDemo: the catalog is missing .*GS-001.*run seedCatalog first/);
    expect(await count(pool, 'users')).toBe(0);
    expect(sink.records).toEqual([expect.objectContaining({ level: 'error', event: 'demo_seed_failed' })]);
  });

  it('rejects when only some needed products exist', async () => {
    await pool.query("DELETE FROM products WHERE sku = 'GS-033'");
    await expect(seedDemo(pool, quiet)).rejects.toThrow(/products GS-033 not found/);
    expect(await count(pool, 'users')).toBe(0);
  });

  it('two users, with the demo password hashed by bcrypt at cost 10', async () => {
    await seedDemo(pool, quiet);
    const { rows } = await pool.query('SELECT email, display_name, password_hash FROM users ORDER BY email');
    expect(rows.map((row) => [row.email, row.display_name])).toEqual([[DEMO_EMAIL, 'Demo Shopper'], [PARTNER_EMAIL, 'Demo Partner']]);
    expect(DEMO_EMAIL).toBe('demo@grocerysave.test');
    expect(PARTNER_EMAIL).toBe('partner@grocerysave.test');
    expect(DEMO_PASSWORD).toBe('demo1234');
    for (const row of rows) {
      expect(row.password_hash).not.toContain(DEMO_PASSWORD);
      expect(bcrypt.getRounds(row.password_hash)).toBe(10);
      expect(await bcrypt.compare('demo1234', row.password_hash)).toBe(true);
      expect(await bcrypt.compare('wrong', row.password_hash)).toBe(false);
    }
  });

  it('preferences for the demo user only, home 29.2000 / -81.0450, the rest the defaults', async () => {
    await seedDemo(pool, quiet);
    const { rows } = await pool.query(`
      SELECT u.email, p.home_latitude, p.home_longitude, p.max_stores, p.travel_cost_per_km, p.travel_mode, p.notify_deals,
             p.deal_threshold_pct, p.included_chains, p.excluded_chains
      FROM user_preferences p JOIN users u ON u.id = p.user_id`);
    expect(rows).toEqual([{
      email: DEMO_EMAIL, home_latitude: 29.2, home_longitude: -81.045, max_stores: 3, travel_cost_per_km: 0,
      travel_mode: 'driving', notify_deals: true, deal_threshold_pct: 10, included_chains: [], excluded_chains: [],
    }]);
  });

  it('"Demo household": the demo user owns it, both users are members', async () => {
    await seedDemo(pool, quiet);
    const { rows } = await pool.query(`
      SELECT h.name, o.email AS owner, u.email AS member, m.role FROM households h JOIN users o ON o.id = h.owner_id
      JOIN household_members m ON m.household_id = h.id JOIN users u ON u.id = m.user_id ORDER BY u.email`);
    expect(rows).toEqual([
      { name: 'Demo household', owner: DEMO_EMAIL, member: DEMO_EMAIL, role: 'owner' },
      { name: 'Demo household', owner: DEMO_EMAIL, member: PARTNER_EMAIL, role: 'member' },
    ]);
  });

  it('"Weekly basics": GS-001..GS-016 in SKU order, quantity 1, positions 0-15, product, category and unit set; not shared', async () => {
    await seedDemo(pool, quiet);
    const { rows: [list] } = await pool.query("SELECT l.household_id, u.email FROM shopping_lists l JOIN users u ON u.id = l.owner_id WHERE l.name = 'Weekly basics'");
    expect(list).toEqual({ household_id: null, email: DEMO_EMAIL });
    const items = await listItems(WEEKLY_BASICS);
    expect(items.map((item) => item.sku)).toEqual(Array.from({ length: 16 }, (_, i) => `GS-${String(i + 1).padStart(3, '0')}`));
    expect(items.map((item) => item.position)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(items.every((item) => item.quantity === 1 && item.completed === false && item.note === null)).toBe(true);
    expect(items[0]).toMatchObject({ name: 'Milk', category: 'Dairy', unit: 'gal' });
    const { rows: products } = await pool.query("SELECT sku, category, unit FROM products WHERE sku BETWEEN 'GS-001' AND 'GS-016' ORDER BY sku");
    expect(items.map((item) => [item.category, item.unit])).toEqual(products.map((product) => [product.category, product.unit]));
  });

  it('"Party supplies": shared with the household; matched items plus "Birthday candles" with no product', async () => {
    await seedDemo(pool, quiet);
    const { rows: [list] } = await pool.query(`
      SELECT h.name AS household, u.email FROM shopping_lists l JOIN users u ON u.id = l.owner_id
      JOIN households h ON h.id = l.household_id WHERE l.name = 'Party supplies'`);
    expect(list).toEqual({ household: 'Demo household', email: DEMO_EMAIL });
    const items = await listItems(PARTY_SUPPLIES);
    expect(items.filter((item) => item.sku !== null).length).toBeGreaterThanOrEqual(4);
    expect(items.find((item) => item.name === 'Birthday candles')).toMatchObject({ sku: null, category: 'Other', unit: 'each' });
  });

  it('the item names are what the API matcher maps to the same products; "Birthday candles" matches nothing', async () => {
    const { rows } = await pool.query('SELECT id, sku, name, category, unit, aliases FROM products');
    const catalog = rows as Product[];
    for (const item of [...WEEKLY_BASICS_ITEMS, ...PARTY_SUPPLIES_ITEMS]) {
      expect([item.name, matchCatalogItem(item.name, catalog)?.product.sku ?? null]).toEqual([item.name, item.sku]);
    }
  });

  it('is idempotent: a second run changes no row count and no id, and keeps the password hashes', async () => {
    await seedDemo(pool, quiet);
    const before = await tableCounts();
    const ids = (await pool.query('SELECT id, password_hash FROM users UNION ALL SELECT id, name FROM shopping_lists UNION ALL SELECT id, name FROM households ORDER BY 1')).rows;
    const sink = memorySink();
    await seedDemo(pool, { logger: createLogger({ level: 'info', sinks: [sink] }) });
    expect(await tableCounts()).toEqual(before);
    expect((await pool.query('SELECT id, password_hash FROM users UNION ALL SELECT id, name FROM shopping_lists UNION ALL SELECT id, name FROM households ORDER BY 1')).rows).toEqual(ids);
    expect(sink.records).toEqual([expect.objectContaining({
      level: 'info', event: 'demo_seeded', usersCreated: 0, preferencesCreated: false, householdCreated: false, membersAdded: 0,
      listsCreated: [], listsKept: [WEEKLY_BASICS, PARTY_SUPPLIES], partyListReattached: false,
    })]);
  });

  it('never overwrites: changed preferences, a changed password and an edited list are kept', async () => {
    await seedDemo(pool, quiet);
    const demo = await userId(DEMO_EMAIL);
    await pool.query("UPDATE users SET password_hash = 'changed-by-the-user' WHERE id = $1", [demo]);
    await pool.query('UPDATE user_preferences SET max_stores = 5, home_latitude = NULL, home_longitude = NULL WHERE user_id = $1', [demo]);
    await pool.query("UPDATE list_items SET name = 'Oat milk', quantity = 2 WHERE name = 'Milk'");
    await pool.query("DELETE FROM list_items WHERE name = 'Diapers'");
    await pool.query("INSERT INTO list_items (list_id, name, position) SELECT id, 'Honey', 16 FROM shopping_lists WHERE name = 'Weekly basics'");
    await seedDemo(pool, quiet);
    expect((await pool.query('SELECT password_hash FROM users WHERE id = $1', [demo])).rows[0].password_hash).toBe('changed-by-the-user');
    expect((await pool.query('SELECT max_stores, home_latitude FROM user_preferences WHERE user_id = $1', [demo])).rows[0]).toEqual({ max_stores: 5, home_latitude: null });
    const names = (await listItems(WEEKLY_BASICS)).map((item) => item.name);
    expect(names).toContain('Oat milk');
    expect(names).toContain('Honey');
    expect(names).not.toContain('Diapers');
    expect(names).toHaveLength(16);
  });

  it('re-attaches "Party supplies" to the household on every run', async () => {
    await seedDemo(pool, quiet);
    await pool.query("UPDATE shopping_lists SET household_id = NULL WHERE name = 'Party supplies'");
    const sink = memorySink();
    await seedDemo(pool, { logger: createLogger({ level: 'info', sinks: [sink] }) });
    const { rows } = await pool.query("SELECT h.name FROM shopping_lists l JOIN households h ON h.id = l.household_id WHERE l.name = 'Party supplies'");
    expect(rows).toEqual([{ name: 'Demo household' }]);
    expect(sink.records[0]).toMatchObject({ partyListReattached: true, listsCreated: [] });
  });

  it('a deleted demo list is created again; a deleted household is created again and the party list attached to it', async () => {
    await seedDemo(pool, quiet);
    await pool.query("DELETE FROM shopping_lists WHERE name = 'Weekly basics'");
    await pool.query('DELETE FROM households');
    await seedDemo(pool, quiet);
    expect(await listItems(WEEKLY_BASICS)).toHaveLength(16);
    expect(await count(pool, 'households')).toBe(1);
    expect(await count(pool, 'household_members')).toBe(2);
    const { rows } = await pool.query("SELECT h.name FROM shopping_lists l JOIN households h ON h.id = l.household_id WHERE l.name = 'Party supplies'");
    expect(rows).toEqual([{ name: 'Demo household' }]);
  });

  it('a partner removed from the household is added back (D-100)', async () => {
    await seedDemo(pool, quiet);
    await pool.query('DELETE FROM household_members WHERE user_id = $1', [await userId(PARTNER_EMAIL)]);
    await seedDemo(pool, quiet);
    expect(await count(pool, 'household_members')).toBe(2);
  });

  it('two runs at the same time still make one household and two lists (advisory lock)', async () => {
    const second = testPool();
    try {
      await Promise.all([seedDemo(pool, quiet), seedDemo(second, quiet), seedDemo(pool, quiet)]);
    } finally {
      await second.end();
    }
    expect(await count(pool, 'users')).toBe(2);
    expect(await count(pool, 'households')).toBe(1);
    expect(await count(pool, 'shopping_lists')).toBe(2);
    expect(await count(pool, 'list_items')).toBe(22);
  });
});

describe('seed: catalog, price sync, demo data', () => {
  it('fills an empty database: every table, as db:reset does', async () => {
    await seed(pool, quiet);
    expect(await tableCounts()).toEqual({
      chains: 8, stores: 8, products: 40, price_history: 1136, users: 2, user_preferences: 1, households: 1,
      household_members: 2, shopping_lists: 2, list_items: 22, sync_runs: 8,
    });
  });

  it('a second run changes no data row count; only sync_runs grows, by one run per chain (D-101)', async () => {
    await seed(pool, quiet);
    const before = await tableCounts();
    await seed(pool, quiet);
    const after = await tableCounts();
    expect(Object.fromEntries(TABLES.map((table) => [table, after[table]]))).toEqual(Object.fromEntries(TABLES.map((table) => [table, before[table]])));
    expect(after.sync_runs).toBe(before.sync_runs + 8);
  });

  it('throws, naming the chain, when a chain\'s sync fails; the demo data is then not seeded (D-102)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-seed-'));
    try {
      fs.cpSync(config.dataDir, dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'stores.csv'), 'mystery,Mystery Mart,toString,Mystery One,1 Road,Port Marlowe,29.2,-81.0\n');
      const sink = memorySink();
      await expect(seed(pool, { dataDir: dir, logger: createLogger({ level: 'info', sinks: [sink] }) })).rejects.toThrow(
        /^seed: price sync failed for mystery \(mystery: Unknown price provider "toString"/,
      );
      expect(await count(pool, 'users')).toBe(0);
      expect(await count(pool, 'price_history')).toBe(1136);
      expect(sink.records.filter((record) => record.event === 'seed_failed')).toEqual([expect.objectContaining({ level: 'error', failed: ['mystery'] })]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('logs seed_completed at info', async () => {
    const sink = memorySink();
    await seed(pool, { logger: createLogger({ level: 'info', sinks: [sink] }) });
    expect(sink.records.filter((record) => ['catalog_seeded', 'sync_finished', 'demo_seeded', 'seed_completed'].includes(record.event)).map((record) => record.event))
      .toEqual(['catalog_seeded', 'sync_finished', 'demo_seeded', 'seed_completed']);
  });
});
