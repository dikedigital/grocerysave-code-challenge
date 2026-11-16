/**
 * Manual run of the price sync scheduler against TEST_DATABASE_URL: starts
 * `startPriceSyncScheduler` with the given interval, prints a line per completed sync (from the
 * after-sync callback), stops after the given number of seconds, then prints the sync_runs summary.
 *
 *   TEST_DATABASE_URL=postgres://... npx tsx tests/manual/scheduler-run.ts --minutes 0.005 --seconds 2
 *   ... --minutes 0.0005 --seconds 2        interval far shorter than a sync: watch the skipped ticks
 *   ... --minutes 0 --seconds 1             disabled: nothing runs
 *   ... --fail-callback                     the after-sync callback throws: logged, scheduler goes on
 *
 * The database must already hold the catalog (run tests/manual/sync-run.ts --reset first). The
 * scheduler's records (ticks, skips, failures) go to stderr and logs/app/ (execution logs).
 */
import { config } from '../../server/src/config';
import { createPool } from '../../server/src/db/pool';
import { startPriceSyncScheduler } from '../../server/src/jobs/syncPrices';
import type { SyncRun } from '../../src/models';

const args = process.argv.slice(2);
let minutes = 0.005;
let seconds = 2;
let failCallback = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--minutes') minutes = Number(args[++i]);
  else if (args[i] === '--seconds') seconds = Number(args[++i]);
  else if (args[i] === '--fail-callback') failCallback = true;
  else {
    console.error('usage: npx tsx tests/manual/scheduler-run.ts [--minutes <n>] [--seconds <n>] [--fail-callback]');
    process.exit(2);
  }
}
if (!config.testDatabaseUrl) {
  console.error('TEST_DATABASE_URL (or DATABASE_URL) is not set');
  process.exit(2);
}

async function main(): Promise<void> {
  const pool = createPool(config.testDatabaseUrl);
  const before = Number((await pool.query('SELECT count(*) AS n FROM sync_runs')).rows[0].n);
  const t0 = Date.now();
  let completed = 0;
  console.log(`scheduler: every ${minutes} minute(s) (${Math.round(minutes * 60_000)} ms), for ${seconds} s\n`);
  const stop = startPriceSyncScheduler(pool, minutes, (runs: SyncRun[]) => {
    completed += 1;
    const ok = runs.filter((run) => run.status === 'ok').length;
    const first = Math.min(...runs.map((run) => Date.parse(run.startedAt))) - t0;
    const last = Math.max(...runs.map((run) => Date.parse(run.finishedAt ?? run.startedAt))) - t0;
    console.log(`sync #${completed}: ${runs.length} runs (${ok} ok), from +${first} ms to +${last} ms`);
    if (failCallback) throw new Error('simulated failure in the after-sync callback');
  });
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  console.log(`\nstopping at +${Date.now() - t0} ms ...`);
  await stop();
  console.log(`stopped at +${Date.now() - t0} ms (after any sync in progress finished)`);
  const after = Number((await pool.query('SELECT count(*) AS n FROM sync_runs')).rows[0].n);
  const overlapping = Number((await pool.query(`
    SELECT count(*) AS n FROM sync_runs a JOIN sync_runs b
      ON a.id < b.id AND b.started_at < a.finished_at AND a.finished_at IS NOT NULL`)).rows[0].n);
  console.log(`\nsyncs completed: ${completed}; sync_runs added: ${after - before}; overlapping runs in the table: ${overlapping}`);
  await pool.end();
}

main().catch((error) => {
  console.error(`scheduler-run failed: ${(error as Error).message}`);
  process.exit(1);
});
