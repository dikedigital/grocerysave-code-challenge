/**
 * Database CLI (TECH_SPEC 4.3): `tsx server/src/db/cli.ts <migrate|seed|reset|sync>`, behind
 * `npm run db:migrate`, `db:seed`, `db:reset` and `sync-prices`.
 *
 * - `migrate`: applies pending migrations.
 * - `seed`: migrates, then seeds (catalog, price sync, demo data).
 * - `reset`: drops everything and migrates (`reset: true`), then seeds.
 * - `sync`: runs `syncPrices`.
 *
 * Uses DATABASE_URL (config.databaseUrl). Prints one summary line on stdout (the execution log goes
 * to stderr and logs/app/), closes the pool, and exits 0 on success, 1 on failure (for `sync`: when
 * a chain's run ends in `error`, after printing the summary), 2 for a wrong command (D-103).
 */
import type { Pool } from 'pg';
import { config } from '../config';
import { errorMessage } from '../errors';
import { syncPrices } from '../jobs/syncPrices';
import { logger as rootLogger } from '../logger';
import { migrate } from './migrate';
import { closePool, getPool } from './pool';
import { seed } from './seed';

const COMMANDS = ['migrate', 'seed', 'reset', 'sync'] as const;
type Command = (typeof COMMANDS)[number];
const log = rootLogger.child('cli');

/** The database name of a connection URL, for messages (never the password). */
function databaseName(url: string): string {
  try {
    return new URL(url).pathname.slice(1) || '(default)';
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/** Row counts shown after a seed. */
async function counts(pool: Pool): Promise<Record<string, number>> {
  const { rows } = await pool.query<Record<string, string>>(`
    SELECT (SELECT count(*) FROM chains) AS chains, (SELECT count(*) FROM stores) AS stores,
           (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM price_history) AS price_history,
           (SELECT count(*) FROM sync_runs) AS sync_runs, (SELECT count(*) FROM users) AS users,
           (SELECT count(*) FROM households) AS households, (SELECT count(*) FROM shopping_lists) AS lists,
           (SELECT count(*) FROM list_items) AS list_items`);
  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
}

const describeCounts = (c: Record<string, number>) =>
  `${c.chains} chains, ${c.stores} stores, ${c.products} products, ${c.price_history} price rows, ${c.sync_runs} sync runs, ${c.users} users, ${c.households} household(s), ${c.lists} lists (${c.list_items} items)`;

/** Runs one command; returns the summary line and whether it succeeded. */
async function run(command: Command, pool: Pool): Promise<{ line: string; ok: boolean }> {
  switch (command) {
    case 'migrate': {
      const applied = await migrate(pool);
      return { ok: true, line: applied.length > 0 ? `migrate: applied ${applied.join(', ')}` : 'migrate: already up to date' };
    }
    case 'seed':
    case 'reset': {
      const applied = await migrate(pool, { reset: command === 'reset' });
      await seed(pool);
      const prefix = command === 'reset' ? `reset: schema recreated (${applied.join(', ')}) and seeded` : `seed: ${applied.length > 0 ? `applied ${applied.join(', ')}, ` : ''}seeded`;
      return { ok: true, line: `${prefix}: ${describeCounts(await counts(pool))}` };
    }
    case 'sync': {
      const runs = await syncPrices(pool);
      const failed = runs.filter((r) => r.status === 'error');
      const rows = runs.reduce((sum, r) => sum + r.rowsIngested, 0);
      const failures = failed.length > 0 ? ` (${failed.map((r) => `${r.chainId}: ${r.error}`).join('; ')})` : '';
      return { ok: failed.length === 0, line: `sync: ${runs.length - failed.length} chains ok, ${failed.length} failed${failures}, ${rows} price rows written` };
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (argv.length !== 1 || !(COMMANDS as readonly string[]).includes(command)) {
    process.stderr.write(`usage: tsx server/src/db/cli.ts <${COMMANDS.join('|')}>\n`);
    log.error('cli_usage', `wrong command line: ${JSON.stringify(argv)}`, { argv });
    return 2;
  }
  const startedAt = Date.now();
  const database = databaseName(config.databaseUrl);
  log.info('cli_started', `db ${command} started on database "${database}"`, { command, database });
  const pool = getPool();
  try {
    const { line, ok } = await run(command as Command, pool);
    process.stdout.write(`${line}\n`);
    const fields = { command, database, durationMs: Date.now() - startedAt };
    if (ok) log.info('cli_finished', `db ${command} finished: ${line}`, fields);
    else log.error('cli_failed', `db ${command} finished with failures: ${line}`, fields);
    return ok ? 0 : 1;
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${command} failed: ${message}\n`);
    log.error('cli_failed', `db ${command} failed on database "${database}": ${message}`, { command, database, durationMs: Date.now() - startedAt });
    return 1;
  } finally {
    await closePool().catch(() => undefined);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`cli failed: ${errorMessage(error)}\n`);
    process.exit(1);
  },
);
