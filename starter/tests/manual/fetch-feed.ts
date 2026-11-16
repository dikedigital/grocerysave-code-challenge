/**
 * Manual check of fetchChainFeed (TECH_SPEC 4.1): calls the mocked supermarket API for chains and
 * prints, per snapshot, the date, rows, rows on sale, rows skipped and how many of the 16 golden
 * SKUs (tests/fixtures/spreadsheet.ts) it contains.
 *
 *   npx tsx tests/manual/fetch-feed.ts --all                     every chain in data/stores.csv
 *   npx tsx tests/manual/fetch-feed.ts valugrocer harvest
 *   npx tsx tests/manual/fetch-feed.ts --data-dir /tmp/my-data --provider cents mychain
 *   npx tsx tests/manual/fetch-feed.ts ../x                       rejected chain id (exit 1)
 *
 * The provider of a chain comes from data/stores.csv unless `--provider <id>` is given. The data
 * folder defaults to config.dataDir (DATA_DIR, ./data). The call uses the process logger, so the
 * run writes execution logs (stderr and logs/app/; LOG_CONSOLE=false keeps stderr quiet).
 * Exits 1 when a chain is rejected.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsvRecords } from '../../src/utils/csv';
import { GOLDEN_PRODUCTS } from '../fixtures/spreadsheet';
import { config } from '../../server/src/config';
import { fetchChainFeed } from '../../server/src/providers';

// Stop quietly when the reader goes away (for example `| head`), instead of an EPIPE stack trace.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

function usage(): never {
  console.error('usage: npx tsx tests/manual/fetch-feed.ts [--data-dir <dir>] [--provider <id>] (--all | <chain>...)');
  process.exit(2);
}

const args = process.argv.slice(2);
let dataDir = config.dataDir;
let forced: string | null = null;
let all = false;
const ids: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--data-dir') dataDir = path.resolve(args[++i] ?? usage());
  else if (args[i] === '--provider') forced = args[++i] ?? usage();
  else if (args[i] === '--all') all = true;
  else ids.push(args[i]);
}

const stores = parseCsvRecords(readFileSync(path.join(config.dataDir, 'stores.csv'), 'utf8'));
const providerOf = new Map(stores.map((store) => [store.chain_id, store.provider]));
if (all) ids.push(...new Set(stores.map((store) => store.chain_id)));
if (ids.length === 0) usage();

const golden = GOLDEN_PRODUCTS.map((product) => product.sku);

async function main(): Promise<number> {
  let failed = 0;
  for (const id of ids) {
    const provider = forced ?? providerOf.get(id) ?? 'standard';
    try {
      const snapshots = await fetchChainFeed({ id, provider }, dataDir);
      console.log(`### ${id} [${provider}]: ${snapshots.length} snapshot(s)\n`);
      if (snapshots.length === 0) {
        console.log('(no snapshots: the folder is missing or holds no <YYYY-MM-DD>.csv file)\n');
        continue;
      }
      console.log('| date | rows | on sale | skipped | golden SKUs |');
      console.log('|---|---|---|---|---|');
      for (const snapshot of snapshots) {
        const skus = new Set(snapshot.rows.map((row) => row.sku));
        const present = golden.filter((sku) => skus.has(sku)).length;
        const onSale = snapshot.rows.filter((row) => row.onSale).length;
        console.log(`| ${snapshot.date} | ${snapshot.rows.length} | ${onSale} | ${snapshot.skipped} | ${present}/${golden.length} |`);
      }
      console.log();
    } catch (error) {
      console.log(`### ${JSON.stringify(id)} [${provider}]: rejected: ${(error as Error).message}\n`);
      failed += 1;
    }
  }
  return failed;
}

main().then((failed) => process.exit(failed > 0 ? 1 : 0));
