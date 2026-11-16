/**
 * Seed data (TECH_SPEC 4.3): `seedCatalog` (chains, stores and products from `data/stores.csv` and
 * `data/products.csv`), `seedDemo` (demo users, preferences, household and lists) and `seed` (all
 * of it, with a price sync in between). All idempotent. Decisions D-84 and D-98 to D-103.
 */
import bcrypt from 'bcryptjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { parseCsvRecords } from '../../../src/utils/csv';
import { config } from '../config';
import { errorMessage } from '../errors';
import { syncPrices } from '../jobs/syncPrices';
import { logger as rootLogger, type Logger } from '../logger';

export interface SeedOptions {
  /** Folder holding stores.csv and products.csv; default config.dataDir (DATA_DIR, ./data). */
  dataDir?: string;
  /** Receives the log records; default the process logger (`app.seed`). */
  logger?: Logger;
}

interface ChainRow { id: string; name: string; provider: string }
interface StoreRow { chainId: string; name: string; address: string; city: string; latitude: number; longitude: number }
interface ProductRow { sku: string; name: string; category: string; unit: string; aliases: string[] }

const seedLogger = rootLogger.child('seed');

/** Reads a catalog CSV; rejects when a required column is missing. */
async function readCatalogFile(file: string, required: string[]): Promise<Record<string, string>[]> {
  const records = parseCsvRecords(await fs.readFile(file, 'utf8'));
  const header = records.length > 0 ? Object.keys(records[0]) : [];
  const missing = required.filter((column) => !header.includes(column));
  if (records.length > 0 && missing.length > 0) {
    throw new Error(`${file}: missing column(s) ${missing.join(', ')}`);
  }
  return records;
}

/** Parses and validates the two catalog files. Throws on the first invalid row, naming it (D-84). */
export async function readCatalog(dataDir: string): Promise<{ chains: ChainRow[]; stores: StoreRow[]; products: ProductRow[] }> {
  const storesFile = path.join(dataDir, 'stores.csv');
  const productsFile = path.join(dataDir, 'products.csv');
  const storeRecords = await readCatalogFile(storesFile, ['chain_id', 'chain_name', 'provider', 'store_name', 'latitude', 'longitude']);
  const productRecords = await readCatalogFile(productsFile, ['sku', 'name']);

  const chains = new Map<string, ChainRow>();
  const stores: StoreRow[] = [];
  storeRecords.forEach((record, index) => {
    const where = `${storesFile} row ${index + 1}`;
    const latitude = Number(record.latitude);
    const longitude = Number(record.longitude);
    if (!record.chain_id || !record.chain_name || !record.provider || !record.store_name) {
      throw new Error(`${where}: chain_id, chain_name, provider and store_name are required`);
    }
    if (record.latitude === '' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error(`${where}: latitude ${JSON.stringify(record.latitude)} is not a number between -90 and 90`);
    }
    if (record.longitude === '' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error(`${where}: longitude ${JSON.stringify(record.longitude)} is not a number between -180 and 180`);
    }
    const chain = { id: record.chain_id, name: record.chain_name, provider: record.provider };
    const known = chains.get(chain.id);
    if (known && (known.name !== chain.name || known.provider !== chain.provider)) {
      throw new Error(`${where}: chain ${chain.id} is listed with a different name or provider than before`);
    }
    chains.set(chain.id, chain);
    stores.push({ chainId: chain.id, name: record.store_name, address: record.address ?? '', city: record.city ?? '', latitude, longitude });
  });

  const skus = new Set<string>();
  const products: ProductRow[] = productRecords.map((record, index) => {
    const where = `${productsFile} row ${index + 1}`;
    if (!record.sku || !record.name) throw new Error(`${where}: sku and name are required`);
    if (skus.has(record.sku)) throw new Error(`${where}: SKU ${record.sku} appears twice`);
    skus.add(record.sku);
    const aliases = (record.aliases ?? '').split('|').map((alias) => alias.trim()).filter((alias) => alias !== '');
    return { sku: record.sku, name: record.name, category: record.category || 'Other', unit: record.unit || 'each', aliases };
  });

  return { chains: [...chains.values()], stores, products };
}

/** Runs an upsert and returns how many rows were inserted and how many updated. */
async function upsert(client: PoolClient, sql: string, values: unknown[]): Promise<{ inserted: number; updated: number }> {
  const { rows } = await client.query<{ inserted: boolean }>(`${sql} RETURNING (xmax = 0) AS inserted`, values);
  const inserted = rows.filter((row) => row.inserted).length;
  return { inserted, updated: rows.length - inserted };
}

/**
 * Upserts the catalog: chains (by id), stores (by chain and name) and products (by SKU), in one
 * transaction. Idempotent: a second call changes no row counts (TECH_SPEC 4.3). Rows that are no
 * longer in the files are kept. Logs `catalog_seeded` (info) with what was inserted and updated,
 * or `catalog_seed_failed` (error) before rejecting.
 */
export async function seedCatalog(pool: Pool, options: SeedOptions = {}): Promise<void> {
  const startedAt = Date.now();
  const dataDir = options.dataDir ?? config.dataDir;
  const log = options.logger ?? seedLogger;
  let client: PoolClient | null = null;
  try {
    const { chains, stores, products } = await readCatalog(dataDir);
    client = await pool.connect();
    await client.query('BEGIN');
    const chainCounts = await upsert(
      client,
      `INSERT INTO chains (id, name, provider)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, provider = EXCLUDED.provider`,
      [chains.map((c) => c.id), chains.map((c) => c.name), chains.map((c) => c.provider)],
    );
    const storeCounts = await upsert(
      client,
      `INSERT INTO stores (chain_id, name, address, city, latitude, longitude)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::float8[], $6::float8[])
       ON CONFLICT (chain_id, name) DO UPDATE
         SET address = EXCLUDED.address, city = EXCLUDED.city, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`,
      [stores.map((s) => s.chainId), stores.map((s) => s.name), stores.map((s) => s.address), stores.map((s) => s.city),
        stores.map((s) => s.latitude), stores.map((s) => s.longitude)],
    );
    // Aliases travel as one '|'-joined string per product (a text[] of arrays cannot be unnested
    // into rows), split back in SQL; '|' never occurs inside an alias, it is the file's separator.
    const productCounts = await upsert(
      client,
      `INSERT INTO products (sku, name, category, unit, aliases)
       SELECT sku, name, category, unit, CASE WHEN aliases = '' THEN '{}'::text[] ELSE string_to_array(aliases, '|') END
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) AS t(sku, name, category, unit, aliases)
       ON CONFLICT (sku) DO UPDATE
         SET name = EXCLUDED.name, category = EXCLUDED.category, unit = EXCLUDED.unit, aliases = EXCLUDED.aliases`,
      [products.map((p) => p.sku), products.map((p) => p.name), products.map((p) => p.category), products.map((p) => p.unit),
        products.map((p) => p.aliases.join('|'))],
    );
    await client.query('COMMIT');
    log.info(
      'catalog_seeded',
      `catalog seeded from ${dataDir}: ${chains.length} chains (${chainCounts.inserted} new), ${stores.length} stores (${storeCounts.inserted} new), ${products.length} products (${productCounts.inserted} new)`,
      {
        dataDir,
        chains: { total: chains.length, ...chainCounts },
        stores: { total: stores.length, ...storeCounts },
        products: { total: products.length, ...productCounts },
        durationMs: Date.now() - startedAt,
      },
    );
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    log.error('catalog_seed_failed', `catalog seed from ${dataDir} failed: ${errorMessage(error)}`, { dataDir });
    throw error;
  } finally {
    client?.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Demo data (TECH_SPEC 4.3)

export const DEMO_EMAIL = 'demo@grocerysave.test';
export const PARTNER_EMAIL = 'partner@grocerysave.test';
export const DEMO_PASSWORD = 'demo1234';
export const DEMO_DISPLAY_NAME = 'Demo Shopper';
/** Not fixed by the spec (D-98). */
export const PARTNER_DISPLAY_NAME = 'Demo Partner';
export const DEMO_HOME = { lat: 29.2, lng: -81.045 } as const;
export const DEMO_HOUSEHOLD_NAME = 'Demo household';
export const WEEKLY_BASICS = 'Weekly basics';
export const PARTY_SUPPLIES = 'Party supplies';
/** bcryptjs cost (TECH_SPEC 6.1). */
const BCRYPT_COST = 10;

/** One demo list item: a catalog SKU (or null for an unmatched item), a short name and a quantity. */
interface DemoItem { sku: string | null; name: string; quantity: number }

/**
 * "Weekly basics": GS-001 to GS-016 in SKU order, quantity 1, short names. Each name is an alias of
 * its product, so the API's matcher (`matchCatalogItem`) maps it back to the same SKU (tested, D-99).
 */
export const WEEKLY_BASICS_ITEMS: readonly DemoItem[] = [
  'Milk', 'Olive oil', 'Chicken breast', 'Ground beef', 'Cheddar cheese', 'Eggs', 'Coffee', 'Butter',
  'Laundry detergent', 'Toilet paper', 'Bananas', 'Salmon', 'Bread', 'Orange juice', 'Diapers', 'Pasta sauce',
].map((name, index) => ({ sku: `GS-${String(index + 1).padStart(3, '0')}`, name, quantity: 1 }));

/** "Party supplies": five matched items and "Birthday candles", which matches no product (D-99). */
export const PARTY_SUPPLIES_ITEMS: readonly DemoItem[] = [
  { sku: 'GS-031', name: 'Tortilla chips', quantity: 2 },
  { sku: 'GS-035', name: 'Cola', quantity: 3 },
  { sku: 'GS-036', name: 'Sparkling water', quantity: 1 },
  { sku: 'GS-032', name: 'Frozen pizza', quantity: 2 },
  { sku: 'GS-033', name: 'Vanilla ice cream', quantity: 1 },
  { sku: null, name: 'Birthday candles', quantity: 1 },
];

/** What a seedDemo call did (also logged as `demo_seeded`). */
export interface DemoSeedReport {
  usersCreated: number;
  preferencesCreated: boolean;
  householdCreated: boolean;
  membersAdded: number;
  listsCreated: string[];
  listsKept: string[];
  partyListReattached: boolean;
}

const DEMO_LOCK_KEY = 'grocerysave.seedDemo';

/**
 * Creates the demo data of TECH_SPEC 4.3, in one transaction: the users `demo@grocerysave.test`
 * ("Demo Shopper") and `partner@grocerysave.test` with the password `demo1234` (bcrypt, cost 10);
 * preferences for the demo user (home 29.2000, -81.0450); the "Demo household" (demo user owner,
 * both members); the list "Weekly basics" (GS-001..GS-016) and the list "Party supplies", shared
 * with the household, including the unmatched "Birthday candles".
 *
 * Idempotent (D-100): existing users (and their passwords), preferences and lists are never
 * overwritten; a list that no longer exists is created again; missing household memberships are
 * added back; "Party supplies" is re-attached to the household on every run. A transaction-level
 * advisory lock keeps two concurrent runs from creating two households or lists.
 * Rejects, writing nothing, when a product it needs is missing (run seedCatalog first).
 */
export async function seedDemo(pool: Pool, options: { logger?: Logger } = {}): Promise<void> {
  const startedAt = Date.now();
  const log = options.logger ?? seedLogger;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [DEMO_LOCK_KEY]);

    const skus = [...WEEKLY_BASICS_ITEMS, ...PARTY_SUPPLIES_ITEMS].flatMap((item) => (item.sku ? [item.sku] : []));
    const { rows: products } = await client.query<{ id: string; sku: string; category: string; unit: string }>(
      'SELECT id, sku, category, unit FROM products WHERE sku = ANY($1::text[])',
      [skus],
    );
    const bySku = new Map(products.map((product) => [product.sku, product]));
    const missing = skus.filter((sku) => !bySku.has(sku));
    if (missing.length > 0) {
      throw new Error(`seedDemo: the catalog is missing (products ${missing.join(', ')} not found); run seedCatalog first`);
    }

    const report: DemoSeedReport = {
      usersCreated: 0, preferencesCreated: false, householdCreated: false, membersAdded: 0,
      listsCreated: [], listsKept: [], partyListReattached: false,
    };

    const ensureUser = async (email: string, displayName: string): Promise<string> => {
      const existing = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows[0]) return existing.rows[0].id;
      const hash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id',
        [email, hash, displayName],
      );
      report.usersCreated += 1;
      return inserted.rows[0].id;
    };
    const demoId = await ensureUser(DEMO_EMAIL, DEMO_DISPLAY_NAME);
    const partnerId = await ensureUser(PARTNER_EMAIL, PARTNER_DISPLAY_NAME);

    const preferences = await client.query(
      `INSERT INTO user_preferences (user_id, home_latitude, home_longitude) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [demoId, DEMO_HOME.lat, DEMO_HOME.lng],
    );
    report.preferencesCreated = (preferences.rowCount ?? 0) > 0;

    let householdId = (await client.query<{ id: string }>(
      'SELECT id FROM households WHERE owner_id = $1 AND name = $2 ORDER BY created_at, id LIMIT 1',
      [demoId, DEMO_HOUSEHOLD_NAME],
    )).rows[0]?.id;
    if (!householdId) {
      householdId = (await client.query<{ id: string }>('INSERT INTO households (name, owner_id) VALUES ($1, $2) RETURNING id', [DEMO_HOUSEHOLD_NAME, demoId])).rows[0].id;
      report.householdCreated = true;
    }
    for (const [userId, role] of [[demoId, 'owner'], [partnerId, 'member']] as const) {
      const added = await client.query(
        'INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (household_id, user_id) DO NOTHING',
        [householdId, userId, role],
      );
      report.membersAdded += added.rowCount ?? 0;
    }

    const ensureList = async (name: string, items: readonly DemoItem[], listHouseholdId: string | null): Promise<string> => {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM shopping_lists WHERE owner_id = $1 AND name = $2 ORDER BY created_at, id LIMIT 1',
        [demoId, name],
      );
      if (existing.rows[0]) {
        report.listsKept.push(name);
        return existing.rows[0].id;
      }
      const listId = (await client.query<{ id: string }>(
        'INSERT INTO shopping_lists (owner_id, household_id, name) VALUES ($1, $2, $3) RETURNING id',
        [demoId, listHouseholdId, name],
      )).rows[0].id;
      const product = (item: DemoItem) => (item.sku ? bySku.get(item.sku) : undefined);
      await client.query(
        `INSERT INTO list_items (list_id, name, quantity, unit, category, product_id, position)
         SELECT $1, name, quantity, unit, category, product_id, position
         FROM unnest($2::text[], $3::numeric[], $4::text[], $5::text[], $6::uuid[], $7::int[])
           AS t(name, quantity, unit, category, product_id, position)`,
        [
          listId,
          items.map((item) => item.name),
          items.map((item) => item.quantity),
          items.map((item) => product(item)?.unit ?? 'each'),
          items.map((item) => product(item)?.category ?? 'Other'),
          items.map((item) => product(item)?.id ?? null),
          items.map((_, index) => index),
        ],
      );
      report.listsCreated.push(name);
      return listId;
    };
    await ensureList(WEEKLY_BASICS, WEEKLY_BASICS_ITEMS, null);
    const partyId = await ensureList(PARTY_SUPPLIES, PARTY_SUPPLIES_ITEMS, householdId);
    const reattached = await client.query(
      'UPDATE shopping_lists SET household_id = $2, updated_at = now() WHERE id = $1 AND household_id IS DISTINCT FROM $2',
      [partyId, householdId],
    );
    report.partyListReattached = (reattached.rowCount ?? 0) > 0;

    await client.query('COMMIT');
    const created = [
      report.usersCreated > 0 ? `${report.usersCreated} user(s)` : null,
      report.preferencesCreated ? 'preferences' : null,
      report.householdCreated ? 'household' : null,
      report.membersAdded > 0 ? `${report.membersAdded} membership(s)` : null,
      ...report.listsCreated.map((name) => `list "${name}"`),
    ].filter((part) => part !== null);
    log.info(
      'demo_seeded',
      `demo data ready: ${created.length > 0 ? `created ${created.join(', ')}` : 'nothing new'}${report.listsKept.length > 0 ? `; kept existing list(s) ${report.listsKept.map((name) => `"${name}"`).join(', ')}` : ''}${report.partyListReattached ? `; "${PARTY_SUPPLIES}" re-attached to "${DEMO_HOUSEHOLD_NAME}"` : ''}`,
      { ...report, durationMs: Date.now() - startedAt },
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    log.error('demo_seed_failed', `demo seed failed, nothing written: ${errorMessage(error)}`, {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The whole seed (TECH_SPEC 4.3): `seedCatalog`, then `syncPrices`, then `seedDemo`. Idempotent for
 * the data (a second call adds no catalog, price or demo rows); each call adds one `sync_runs` row
 * per chain, as every sync does (TECH_SPEC 4.2, D-101). Throws, naming the chains, when any chain's
 * sync ends in `error`; the demo data is then not seeded (D-102).
 */
export async function seed(pool: Pool, options: SeedOptions = {}): Promise<void> {
  const startedAt = Date.now();
  const log = options.logger ?? seedLogger;
  await seedCatalog(pool, options);
  const runs = await syncPrices(pool, { dataDir: options.dataDir, logger: options.logger });
  const failed = runs.filter((run) => run.status === 'error');
  if (failed.length > 0) {
    const detail = failed.map((run) => `${run.chainId}: ${run.error}`).join('; ');
    log.error('seed_failed', `seed failed: the price sync failed for ${failed.length} chain(s) (${detail}); demo data not seeded`, {
      failed: failed.map((run) => run.chainId),
    });
    throw new Error(`seed: price sync failed for ${failed.map((run) => run.chainId).join(', ')} (${detail})`);
  }
  await seedDemo(pool, { logger: options.logger });
  log.info('seed_completed', `seed completed: catalog, prices (${runs.length} chains, ${runs.reduce((sum, run) => sum + run.rowsIngested, 0)} rows) and demo data`, {
    chains: runs.length,
    rowsWritten: runs.reduce((sum, run) => sum + run.rowsIngested, 0),
    durationMs: Date.now() - startedAt,
  });
}
