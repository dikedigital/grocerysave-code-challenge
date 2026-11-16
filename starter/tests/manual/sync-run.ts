/**
 * Manual run of the price sync against a database, with a report: migrate, seedCatalog, syncPrices,
 * then `sync_runs` and the row counts.
 *
 *   TEST_DATABASE_URL=postgres://... npx tsx tests/manual/sync-run.ts --reset        empty DB, then one sync
 *   TEST_DATABASE_URL=postgres://... npx tsx tests/manual/sync-run.ts --syncs 2      two syncs in a row
 *   npx tsx tests/manual/sync-run.ts --data-dir /tmp/my-data ...                     another data folder
 *
 * Uses TEST_DATABASE_URL (config.testDatabaseUrl, which falls back to DATABASE_URL). `--reset` drops
 * and recreates the schema first; it is refused unless the database name contains "test" (D-90).
 * The run writes execution logs like the server (stderr and logs/app/; LOG_CONSOLE=false quiets
 * stderr). Exits 1 when a chain's run ends in error.
 */
import { config } from '../../server/src/config';
import { migrate } from '../../server/src/db/migrate';
import { createPool } from '../../server/src/db/pool';
import { seedCatalog } from '../../server/src/db/seed';
import { syncPrices } from '../../server/src/jobs/syncPrices';

const args = process.argv.slice(2);
let reset = false;
let syncs = 1;
let dataDir = config.dataDir;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--reset') reset = true;
  else if (args[i] === '--syncs') syncs = Number(args[++i]);
  else if (args[i] === '--data-dir') dataDir = args[++i];
  else {
    console.error('usage: npx tsx tests/manual/sync-run.ts [--reset] [--syncs <n>] [--data-dir <dir>]');
    process.exit(2);
  }
}

const url = config.testDatabaseUrl;
if (!url) {
  console.error('TEST_DATABASE_URL (or DATABASE_URL) is not set');
  process.exit(2);
}
const database = new URL(url).pathname.slice(1);
if (reset && !database.includes('test')) {
  console.error(`refusing --reset on database "${database}": its name does not contain "test"`);
  process.exit(2);
}

const table = (rows: Record<string, unknown>[]) => {
  if (rows.length === 0) return '(no rows)';
  const keys = Object.keys(rows[0]);
  const cell = (value: unknown) => (value instanceof Date ? value.toISOString() : value === null ? 'null' : String(value));
  return [`| ${keys.join(' | ')} |`, `|${keys.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${keys.map((key) => cell(row[key])).join(' | ')} |`)].join('\n');
};

async function main(): Promise<number> {
  const pool = createPool(url);
  try {
    console.log(`database: ${database}; data folder: ${dataDir}\n`);
    const applied = await migrate(pool, { reset });
    console.log(`migrate${reset ? ' (reset)' : ''}: ${applied.length === 0 ? 'nothing to apply' : `applied ${applied.join(', ')}`}`);
    await seedCatalog(pool, { dataDir });
    console.log('seedCatalog: done');
    let failed = 0;
    for (let n = 1; n <= syncs; n += 1) {
      const runs = await syncPrices(pool, { dataDir });
      failed += runs.filter((run) => run.status === 'error').length;
      console.log(`\n### syncPrices #${n}: what it returned (SyncRun[])\n`);
      console.log(table(runs.map((run) => ({ ...run }))));
    }

    console.log('\n### sync_runs (the table)\n');
    const runs = await pool.query('SELECT id, chain_id, status, rows_ingested, error, started_at, finished_at - started_at AS took FROM sync_runs ORDER BY id');
    console.log(table(runs.rows.map((row) => ({ ...row, took: row.took === null ? null : `${row.took.milliseconds ?? 0} ms` }))));

    console.log('\n### Row counts\n');
    const counts = await pool.query(`
      SELECT (SELECT count(*) FROM chains) AS chains, (SELECT count(*) FROM stores) AS stores,
             (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM price_history) AS price_history,
             (SELECT count(*) FROM current_prices) AS current_prices, (SELECT count(*) FROM sync_runs) AS sync_runs,
             (SELECT count(DISTINCT effective_date) FROM price_history) AS snapshot_dates`);
    console.log(table(counts.rows));

    console.log('\n### price_history per chain\n');
    const perChain = await pool.query(`
      SELECT c.id AS chain, count(ph.id) AS price_rows, count(DISTINCT ph.product_id) AS products,
             count(DISTINCT ph.effective_date) AS dates, count(*) FILTER (WHERE ph.on_sale) AS on_sale_rows,
             min(ph.effective_date) AS first_date, max(ph.effective_date) AS last_date
      FROM chains c LEFT JOIN stores s ON s.chain_id = c.id LEFT JOIN price_history ph ON ph.store_id = s.id
      GROUP BY c.id ORDER BY c.id`);
    console.log(table(perChain.rows));
    return failed > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`sync-run failed: ${(error as Error).message}`);
    process.exit(1);
  },
);
