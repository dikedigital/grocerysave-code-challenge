import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { GOLDEN_CHAINS, GOLDEN_EXPECTED, GOLDEN_PRODUCTS } from '../../tests/fixtures/spreadsheet';
import { config } from '../src/config';
import { seedCatalog } from '../src/db/seed';
import { syncPrices } from '../src/jobs/syncPrices';
import { createLogger, memorySink, type LogRecord } from '../src/logger';
import * as providers from '../src/providers';
import { count, resetDatabase, testPool } from './helpers/db';

jest.setTimeout(60000);

/** rows_ingested per chain for the delivered feeds: known SKUs x 4 snapshots x 1 store (M14.6). */
const EXPECTED_ROWS: Record<string, number> = {
  budgetbasket: 144, citypantry: 148, cornercoop: 140, freshmart: 148, greenleaf: 140, harvest: 136, sunrise: 136, valugrocer: 144,
};
const CHAIN_IDS = Object.keys(EXPECTED_ROWS).sort();

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDatabase(pool);
  await seedCatalog(pool, { logger: createLogger({ level: 'silent', sinks: [] }) });
});

const capture = () => {
  const sink = memorySink();
  return { sink, logger: createLogger({ level: 'debug', sinks: [sink] }) };
};
const events = (records: LogRecord[], event: string) => records.filter((record) => record.event === event);

/** A temporary data folder with `mock-api/<chain>/<date>.csv` files. */
function tempData(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-sync-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, 'mock-api', name)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'mock-api', name), content);
  }
  return dir;
}
const STANDARD = 'sku,product_name,price,regular_price,on_sale\n';

describe('syncPrices on the delivered feeds', () => {
  it('one ok run per chain, in chain id order, with the rows written', async () => {
    const runs = await syncPrices(pool);
    expect(runs.map((run) => [run.chainId, run.status, run.rowsIngested, run.error])).toEqual(
      CHAIN_IDS.map((id) => [id, 'ok', EXPECTED_ROWS[id], null]),
    );
    for (const run of runs) {
      expect(Number.isInteger(run.id)).toBe(true);
      expect(run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Date.parse(run.finishedAt as string)).toBeGreaterThanOrEqual(Date.parse(run.startedAt));
    }
  });

  it('the sync_runs table holds the same runs', async () => {
    const runs = await syncPrices(pool);
    const { rows } = await pool.query('SELECT id, chain_id, status, rows_ingested, error, finished_at IS NOT NULL AS finished FROM sync_runs ORDER BY id');
    expect(rows).toEqual(runs.map((run) => ({ id: String(run.id), chain_id: run.chainId, status: 'ok', rows_ingested: run.rowsIngested, error: null, finished: true })));
  });

  it('price_history holds 1136 rows (4 dates) and current_prices 284; unknown and skipped rows are not stored', async () => {
    await syncPrices(pool);
    expect(await count(pool, 'price_history')).toBe(1136);
    expect(await count(pool, 'current_prices')).toBe(284);
    expect(Number((await pool.query('SELECT count(DISTINCT effective_date) AS n FROM price_history')).rows[0].n)).toBe(4);
    expect(await count(pool, 'products', "WHERE sku IN ('GS-999', 'GS-099')")).toBe(0);
  });

  it('reproduces the golden spreadsheet: every price of GS-001..GS-016 and every store total (TECH_SPEC 9)', async () => {
    await syncPrices(pool);
    const { rows } = await pool.query<{ chain_id: string; sku: string; price: number; effective_date: string }>(`
      SELECT s.chain_id, p.sku, cp.price, cp.effective_date FROM current_prices cp
      JOIN stores s ON s.id = cp.store_id JOIN products p ON p.id = cp.product_id WHERE p.sku BETWEEN 'GS-001' AND 'GS-016'`);
    const price = new Map(rows.map((row) => [`${row.chain_id}/${row.sku}`, row.price]));
    expect(new Set(rows.map((row) => row.effective_date))).toEqual(new Set(['2026-11-09']));
    for (const product of GOLDEN_PRODUCTS) {
      expect(GOLDEN_CHAINS.map((chain) => price.get(`${chain.id}/${product.sku}`))).toEqual(product.prices);
    }
    const totals = GOLDEN_CHAINS.map((chain) =>
      Math.round(GOLDEN_PRODUCTS.reduce((sum, product) => sum + (price.get(`${chain.id}/${product.sku}`) as number) * 100, 0)) / 100,
    );
    expect(totals).toEqual(GOLDEN_EXPECTED.storeTotals);
  });

  it('stores sale rows with the price paid and the regular price (harvest salmon, 2026-11-09)', async () => {
    await syncPrices(pool);
    const { rows } = await pool.query(`
      SELECT ph.price, ph.regular_price, ph.on_sale, ph.effective_date FROM price_history ph
      JOIN stores s ON s.id = ph.store_id JOIN products p ON p.id = ph.product_id
      WHERE s.chain_id = 'harvest' AND p.sku = 'GS-012' ORDER BY ph.effective_date DESC LIMIT 1`);
    expect(rows).toEqual([{ price: 7.9, regular_price: 9.49, on_sale: true, effective_date: '2026-11-09' }]);
  });

  it('running it twice adds no price rows but one more run per chain, with the same counts (D-87)', async () => {
    await syncPrices(pool);
    const second = await syncPrices(pool);
    expect(await count(pool, 'price_history')).toBe(1136);
    expect(await count(pool, 'sync_runs')).toBe(16);
    expect(second.map((run) => [run.status, run.rowsIngested])).toEqual(CHAIN_IDS.map((id) => ['ok', EXPECTED_ROWS[id]]));
  });

  it('logs the run at info: sync_started, one sync_chain_ok per chain, sync_finished; GS-999 as a warning', async () => {
    const { sink, logger } = capture();
    await syncPrices(pool, { logger });
    const info = sink.records.filter((record) => record.level === 'info' && record.component.startsWith('app') && !['feed_parsed', 'feed_fetched'].includes(record.event));
    expect(info.map((record) => record.event)).toEqual(['sync_started', ...CHAIN_IDS.map(() => 'sync_chain_ok'), 'sync_finished']);
    expect(events(sink.records, 'sync_chain_ok').map((record) => [record.chain, record.rowsWritten])).toEqual(CHAIN_IDS.map((id) => [id, EXPECTED_ROWS[id]]));
    expect(events(sink.records, 'sync_finished')[0]).toMatchObject({ ok: 8, failed: [], rowsWritten: 1136 });
    expect(events(sink.records, 'unknown_skus_ignored')).toEqual([
      expect.objectContaining({ level: 'warn', chain: 'budgetbasket', skus: ['GS-999'], rows: 1 }),
    ]);
    // The feed's own records come through, under the chain: the two bad ValuGrocer lines.
    expect(events(sink.records, 'row_skipped').map((record) => [record.component, record.chain, record.line])).toEqual([
      ['app.valugrocer.fetch.standard', 'valugrocer', 38],
      ['app.valugrocer.fetch.standard', 'valugrocer', 39],
    ]);
  });
});

describe('syncPrices: one chain never stops the others', () => {
  it('in ONE sync: unknown provider, a feed that throws, a feed that rejects (twice), no feed files; the real chains unaffected', async () => {
    for (const [id, provider] of [['mystery', 'toString'], ['exploding', 'standard'], ['rejecting', 'cents'], ['vanishing', 'flyer'], ['nofeed', 'standard']]) {
      await pool.query('INSERT INTO chains (id, name, provider) VALUES ($1, $1, $2)', [id, provider]);
      await pool.query('INSERT INTO stores (chain_id, name, latitude, longitude) VALUES ($1, $1, 29.2, -81.0)', [id]);
    }
    // The feed call of three chains fails in different ways; every other chain gets the real one.
    const realFetch = providers.fetchChainFeed;
    const fetchSpy = jest.spyOn(providers, 'fetchChainFeed').mockImplementation(((chain: { id: string; provider: string }, ...rest: unknown[]) => {
      if (chain.id === 'exploding') throw new Error('feed exploded'); // synchronous throw
      if (chain.id === 'rejecting') return Promise.reject('network down'); // rejection with a string
      if (chain.id === 'vanishing') return Promise.reject(undefined); // rejection with nothing at all
      return (realFetch as (...args: unknown[]) => unknown)(chain, ...rest);
    }) as typeof providers.fetchChainFeed);
    const { sink, logger } = capture();
    let runs;
    try {
      runs = await syncPrices(pool, { logger });
    } finally {
      fetchSpy.mockRestore();
    }

    const byChain = Object.fromEntries(runs.map((run) => [run.chainId, [run.status, run.rowsIngested, run.error]]));
    expect(byChain).toEqual({
      ...Object.fromEntries(CHAIN_IDS.map((id) => [id, ['ok', EXPECTED_ROWS[id], null]])),
      mystery: ['error', 0, 'Unknown price provider "toString" (known: standard, cents, flyer)'],
      exploding: ['error', 0, 'feed exploded'],
      rejecting: ['error', 0, 'network down'],
      vanishing: ['error', 0, 'non-Error value thrown: undefined'],
      nofeed: ['ok', 0, null],
    });
    // Every chain ran (13 runs, in chain id order), the table agrees, and only the real chains wrote prices.
    expect(runs.map((run) => run.chainId)).toEqual([...CHAIN_IDS, 'exploding', 'mystery', 'nofeed', 'rejecting', 'vanishing'].sort());
    const { rows: table } = await pool.query("SELECT chain_id, status, rows_ingested, error FROM sync_runs WHERE status <> 'running' ORDER BY chain_id");
    expect(table).toEqual(runs.map((run) => ({ chain_id: run.chainId, status: run.status, rows_ingested: run.rowsIngested, error: run.error })).sort((a, b) => String(a.chain_id).localeCompare(String(b.chain_id))));
    expect(await count(pool, 'sync_runs', "WHERE status = 'running' OR finished_at IS NULL")).toBe(0);
    expect(await count(pool, 'price_history')).toBe(1136);
    // Logged: one error per failed chain, the missing folder, and a summary at warn naming the failures.
    expect(events(sink.records, 'sync_chain_failed').map((record) => [record.chain, record.error])).toEqual([
      ['exploding', 'feed exploded'],
      ['mystery', 'Unknown price provider "toString" (known: standard, cents, flyer)'],
      ['rejecting', 'network down'],
      ['vanishing', 'non-Error value thrown: undefined'],
    ]);
    expect(events(sink.records, 'feed_folder_missing').map((record) => record.chain)).toEqual(['nofeed']);
    expect(events(sink.records, 'sync_finished')).toEqual([
      expect.objectContaining({ level: 'warn', ok: 9, failed: ['exploding', 'mystery', 'rejecting', 'vanishing'], rowsWritten: 1136 }),
    ]);
  });

  it('an unknown provider: that run is error, naming the provider; the other chains are ok', async () => {
    await pool.query("INSERT INTO chains (id, name, provider) VALUES ('mystery', 'Mystery Mart', 'toString')");
    await pool.query("INSERT INTO stores (chain_id, name, latitude, longitude) VALUES ('mystery', 'Mystery One', 29.2, -81.0)");
    const { sink, logger } = capture();
    const runs = await syncPrices(pool, { logger });
    const mystery = runs.find((run) => run.chainId === 'mystery');
    expect(mystery).toMatchObject({ status: 'error', rowsIngested: 0 });
    expect(mystery?.error).toContain('toString');
    expect(runs.filter((run) => run.status === 'ok')).toHaveLength(8);
    expect(await count(pool, 'price_history')).toBe(1136);
    expect(events(sink.records, 'sync_chain_failed')).toEqual([expect.objectContaining({ level: 'error', chain: 'mystery' })]);
    expect(events(sink.records, 'sync_finished')[0]).toMatchObject({ level: 'warn', ok: 8, failed: ['mystery'] });
  });

  it('a chain without feed files is an ok run with 0 rows; a chain without stores too (warned)', async () => {
    await pool.query("INSERT INTO chains (id, name, provider) VALUES ('newchain', 'New Chain', 'standard')");
    await pool.query("INSERT INTO stores (chain_id, name, latitude, longitude) VALUES ('newchain', 'New One', 29.2, -81.0)");
    await pool.query("DELETE FROM stores WHERE chain_id = 'sunrise'");
    const { sink, logger } = capture();
    const runs = await syncPrices(pool, { logger });
    expect(runs.find((run) => run.chainId === 'newchain')).toMatchObject({ status: 'ok', rowsIngested: 0, error: null });
    expect(runs.find((run) => run.chainId === 'sunrise')).toMatchObject({ status: 'ok', rowsIngested: 0, error: null });
    expect(events(sink.records, 'feed_folder_missing').map((record) => record.chain)).toEqual(['newchain']);
    expect(events(sink.records, 'chain_has_no_stores').map((record) => record.chain)).toEqual(['sunrise']);
  });

  it('a feed that cannot be read (a file where the folder should be) is an error run', async () => {
    const dir = tempData({ freshmart: 'not a folder', 'valugrocer/2026-11-09.csv': `${STANDARD}GS-001,Milk,2.99,,false\n` });
    try {
      const runs = await syncPrices(pool, { dataDir: dir });
      expect(runs.find((run) => run.chainId === 'freshmart')).toMatchObject({ status: 'error', rowsIngested: 0 });
      expect(runs.find((run) => run.chainId === 'freshmart')?.error).toMatch(/ENOTDIR/);
      expect(runs.find((run) => run.chainId === 'valugrocer')).toMatchObject({ status: 'ok', rowsIngested: 1 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a database error part-way through a chain rolls that chain back completely (D-89)', async () => {
    // A pool whose clients fail cornercoop's 2nd price batch, after its 1st batch really wrote rows.
    // Clients are wrapped in a Proxy, never modified: a patched client would go back to the pool
    // patched, and the next connect() would wrap it again (round 7 found exactly that: the hook
    // then fired several times per statement and failed the 1st batch, which hid a missing BEGIN).
    let cornercoopBatches = 0;
    let writtenBeforeFailure = 0;
    let statusSeenDuringWrite: string | null = null;
    const failing = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property !== 'query') {
              const value = Reflect.get(target, property, target);
              return typeof value === 'function' ? value.bind(target) : value;
            }
            return async (...args: unknown[]) => {
              const [sql, values] = args as [string, unknown[][]];
              const isPriceInsert = typeof sql === 'string' && sql.includes('INSERT INTO price_history');
              const isCornercoop = isPriceInsert && (await pool.query('SELECT chain_id FROM stores WHERE id = $1', [values[0][0]])).rows[0].chain_id === 'cornercoop';
              if (isCornercoop) {
                cornercoopBatches += 1;
                statusSeenDuringWrite = (await pool.query("SELECT status FROM sync_runs WHERE chain_id = 'cornercoop' ORDER BY id DESC LIMIT 1")).rows[0].status;
                if (cornercoopBatches === 2) throw new Error('simulated failure in the second batch');
              }
              const result = await (target.query as (...a: unknown[]) => Promise<{ rowCount: number | null }>)(...args);
              if (isCornercoop) writtenBeforeFailure += result.rowCount ?? 0;
              return result;
            };
          },
        });
      },
    } as unknown as Pool;

    const runs = await syncPrices(failing, { batchSize: 50 });
    expect(cornercoopBatches).toBe(2);
    expect(writtenBeforeFailure).toBe(50); // the 1st batch did reach the database...
    expect(statusSeenDuringWrite).toBe('running');
    expect(runs.find((run) => run.chainId === 'cornercoop')).toMatchObject({ status: 'error', rowsIngested: 0, error: 'simulated failure in the second batch' });
    // ...and was rolled back with the rest of the chain.
    expect(await count(pool, 'price_history ph JOIN stores s ON s.id = ph.store_id', "WHERE s.chain_id = 'cornercoop'")).toBe(0);
    expect(await count(pool, 'price_history')).toBe(1136 - 140);
    expect(runs.filter((run) => run.status === 'ok').map((run) => run.rowsIngested)).toEqual(
      CHAIN_IDS.filter((id) => id !== 'cornercoop').map((id) => EXPECTED_ROWS[id]),
    );
  });

  it('rejects, and logs sync_failed, only when the chains or products cannot be read at all', async () => {
    await pool.query('DROP TABLE products CASCADE');
    const { sink, logger } = capture();
    await expect(syncPrices(pool, { logger })).rejects.toThrow(/products/);
    expect(events(sink.records, 'sync_failed')).toEqual([expect.objectContaining({ level: 'error' })]);
  });
});

describe('syncPrices: upserts', () => {
  it('every store of the chain gets the rows (a second FreshMart store doubles its rows)', async () => {
    await pool.query("INSERT INTO stores (chain_id, name, latitude, longitude) VALUES ('freshmart', 'FreshMart Second', 29.3, -81.1)");
    const runs = await syncPrices(pool);
    expect(runs.find((run) => run.chainId === 'freshmart')?.rowsIngested).toBe(296);
    expect(await count(pool, 'price_history')).toBe(1136 + 148);
  });

  it('a changed price is updated in place; a new snapshot adds rows; current_prices shows the latest', async () => {
    const dir = tempData({
      'freshmart/2026-11-09.csv': `${STANDARD}GS-001,Milk,3.20,,false\nGS-002,Oil,17.25,,false\n`,
    });
    try {
      await syncPrices(pool, { dataDir: dir });
      fs.writeFileSync(path.join(dir, 'mock-api/freshmart/2026-11-09.csv'), `${STANDARD}GS-001,Milk,2.99,3.20,true\nGS-002,Oil,17.25,,false\n`);
      fs.writeFileSync(path.join(dir, 'mock-api/freshmart/2026-11-16.csv'), `${STANDARD}GS-001,Milk,3.10,,false\n`);
      const runs = await syncPrices(pool, { dataDir: dir });
      expect(runs.find((run) => run.chainId === 'freshmart')?.rowsIngested).toBe(3);
      const { rows } = await pool.query(`
        SELECT p.sku, ph.effective_date, ph.price, ph.regular_price, ph.on_sale FROM price_history ph
        JOIN stores s ON s.id = ph.store_id JOIN products p ON p.id = ph.product_id
        WHERE s.chain_id = 'freshmart' ORDER BY p.sku, ph.effective_date`);
      expect(rows).toEqual([
        { sku: 'GS-001', effective_date: '2026-11-09', price: 2.99, regular_price: 3.2, on_sale: true },
        { sku: 'GS-001', effective_date: '2026-11-16', price: 3.1, regular_price: 3.1, on_sale: false },
        { sku: 'GS-002', effective_date: '2026-11-09', price: 17.25, regular_price: 17.25, on_sale: false },
      ]);
      const { rows: current } = await pool.query(`
        SELECT p.sku, cp.effective_date, cp.price FROM current_prices cp JOIN stores s ON s.id = cp.store_id
        JOIN products p ON p.id = cp.product_id WHERE s.chain_id = 'freshmart' ORDER BY p.sku`);
      expect(current).toEqual([
        { sku: 'GS-001', effective_date: '2026-11-16', price: 3.1 },
        { sku: 'GS-002', effective_date: '2026-11-09', price: 17.25 },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a SKU repeated in one snapshot is written once, with its last row, and logged', async () => {
    const dir = tempData({ 'greenleaf/2026-11-09.csv': `${STANDARD}GS-001,Milk,3.21,,false\nGS-001,Milk,2.50,3.21,true\n` });
    const { sink, logger } = capture();
    try {
      const runs = await syncPrices(pool, { dataDir: dir, logger });
      expect(runs.find((run) => run.chainId === 'greenleaf')).toMatchObject({ status: 'ok', rowsIngested: 1 });
      const { rows } = await pool.query("SELECT ph.price, ph.on_sale FROM price_history ph JOIN stores s ON s.id = ph.store_id WHERE s.chain_id = 'greenleaf'");
      expect(rows).toEqual([{ price: 2.5, on_sale: true }]);
      expect(events(sink.records, 'duplicate_skus')).toEqual([
        expect.objectContaining({ level: 'warn', chain: 'greenleaf', duplicates: [{ date: '2026-11-09', sku: 'GS-001' }] }),
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses config.dataDir by default', async () => {
    expect(config.dataDir).toBe(path.resolve(process.cwd(), 'data'));
    expect((await syncPrices(pool)).every((run) => run.status === 'ok')).toBe(true);
  });
});
