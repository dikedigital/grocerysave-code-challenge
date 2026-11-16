import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { config } from '../src/config';
import { seedCatalog } from '../src/db/seed';
import { createLogger, memorySink } from '../src/logger';
import { count, resetDatabase, testPool } from './helpers/db';

jest.setTimeout(30000);

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

/** A data folder holding copies of the real catalog files, edited by `edit`. */
function dataCopy(edit: (files: { stores: string; products: string }) => { stores?: string; products?: string } = () => ({})) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-catalog-'));
  const files = {
    stores: fs.readFileSync(path.join(config.dataDir, 'stores.csv'), 'utf8'),
    products: fs.readFileSync(path.join(config.dataDir, 'products.csv'), 'utf8'),
  };
  const edited = { ...files, ...edit(files) };
  fs.writeFileSync(path.join(dir, 'stores.csv'), edited.stores);
  fs.writeFileSync(path.join(dir, 'products.csv'), edited.products);
  return dir;
}

const counts = async () => ({ chains: await count(pool, 'chains'), stores: await count(pool, 'stores'), products: await count(pool, 'products') });

describe('seedCatalog', () => {
  it('loads the 8 chains, 8 stores and 40 products of data/', async () => {
    await expect(seedCatalog(pool)).resolves.toBeUndefined();
    expect(await counts()).toEqual({ chains: 8, stores: 8, products: 40 });
    const { rows: chains } = await pool.query('SELECT id, name, provider FROM chains ORDER BY id');
    expect(chains.map((chain) => `${chain.id}:${chain.provider}`)).toEqual([
      'budgetbasket:cents', 'citypantry:cents', 'cornercoop:flyer', 'freshmart:standard',
      'greenleaf:standard', 'harvest:cents', 'sunrise:flyer', 'valugrocer:standard',
    ]);
  });

  it('stores keep their coordinates; products their category, unit and aliases', async () => {
    await seedCatalog(pool);
    const { rows: [store] } = await pool.query("SELECT name, address, city, latitude, longitude FROM stores WHERE chain_id = 'sunrise'");
    expect(store).toEqual({ name: 'Sunrise Market Harbor View', address: '640 Harbor View Road', city: 'Port Marlowe', latitude: 29.1798, longitude: -81.0143 });
    const { rows: [milk] } = await pool.query("SELECT name, category, unit, aliases FROM products WHERE sku = 'GS-001'");
    expect(milk).toEqual({ name: 'Whole Milk 1 gal', category: 'Dairy', unit: 'gal', aliases: ['milk', 'whole milk', 'gallon of milk', 'milk gallon', 'gallon milk'] });
  });

  it('is idempotent: a second call changes no row counts and no ids', async () => {
    await seedCatalog(pool);
    const before = (await pool.query('SELECT id, sku FROM products ORDER BY sku')).rows;
    const sink = memorySink();
    await seedCatalog(pool, { logger: createLogger({ level: 'info', sinks: [sink] }) });
    expect(await counts()).toEqual({ chains: 8, stores: 8, products: 40 });
    expect((await pool.query('SELECT id, sku FROM products ORDER BY sku')).rows).toEqual(before);
    expect(sink.records).toEqual([
      expect.objectContaining({
        level: 'info', event: 'catalog_seeded',
        chains: { total: 8, inserted: 0, updated: 8 }, stores: { total: 8, inserted: 0, updated: 8 }, products: { total: 40, inserted: 0, updated: 40 },
      }),
    ]);
  });

  it('upserts: changed rows are updated, new rows inserted, rows no longer in the files kept', async () => {
    await seedCatalog(pool);
    const dir = dataCopy(({ products }) => ({
      products: products.replace('GS-001,Whole Milk 1 gal,Dairy,gal,', 'GS-001,Whole Milk 1 gallon,Dairy,gal,').replace(/GS-040,.*\n/, '') + 'GS-041,Almond Milk 64 oz,Dairy,carton,almond milk\n',
    }));
    try {
      await seedCatalog(pool, { dataDir: dir });
      expect(await counts()).toEqual({ chains: 8, stores: 8, products: 41 });
      const { rows } = await pool.query("SELECT sku, name FROM products WHERE sku IN ('GS-001', 'GS-040', 'GS-041') ORDER BY sku");
      expect(rows).toEqual([
        { sku: 'GS-001', name: 'Whole Milk 1 gallon' },
        { sku: 'GS-040', name: 'Baby Wipes 72 count' },
        { sku: 'GS-041', name: 'Almond Milk 64 oz' },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['a latitude that is not a number', ({ stores }: { stores: string }) => ({ stores: stores.replace('29.2105', 'abc') }), /stores\.csv row 1: latitude "abc"/],
    ['a missing store name', ({ stores }: { stores: string }) => ({ stores: stores.replace('FreshMart Beacon Street', '') }), /stores\.csv row 1: chain_id, chain_name, provider and store_name are required/],
    ['a chain with two providers', ({ stores }: { stores: string }) => ({ stores: `${stores}freshmart,FreshMart,cents,FreshMart Two,1 Road,Port Marlowe,29.2,-81.0\n` }), /row 9: chain freshmart is listed with a different name or provider/],
    ['a duplicate SKU', ({ products }: { products: string }) => ({ products: `${products}GS-001,Milk again,Dairy,gal,\n` }), /products\.csv row 41: SKU GS-001 appears twice/],
    ['a missing column', ({ products }: { products: string }) => ({ products: products.replace('sku,name,', 'code,name,') }), /products\.csv: missing column\(s\) sku/],
  ])('rejects %s, names the row, logs it and writes nothing', async (_label, edit, message) => {
    const dir = dataCopy(edit as never);
    const sink = memorySink();
    try {
      await expect(seedCatalog(pool, { dataDir: dir, logger: createLogger({ level: 'info', sinks: [sink] }) })).rejects.toThrow(message);
      expect(await counts()).toEqual({ chains: 0, stores: 0, products: 0 });
      expect(sink.records).toEqual([expect.objectContaining({ level: 'error', event: 'catalog_seed_failed' })]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a database error rolls the whole catalog back', async () => {
    await pool.query('ALTER TABLE products ADD CONSTRAINT no_gs_040 CHECK (sku <> \'GS-040\')');
    await expect(seedCatalog(pool)).rejects.toThrow(/no_gs_040/);
    expect(await counts()).toEqual({ chains: 0, stores: 0, products: 0 });
  });
});
