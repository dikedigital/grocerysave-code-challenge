/**
 * Manual check of the price feed adapters (TECH_SPEC 4.1): parses feed files and prints what the
 * adapter returns, as markdown, on stdout.
 *
 *   npx tsx tests/manual/feed.ts data/mock-api/valugrocer/2026-11-09.csv
 *   npx tsx tests/manual/feed.ts --summary data/mock-api/freshmart/*.csv
 *   printf 'sku,product_name,price,regular_price,on_sale\nGS-1,x,abc,,false\n' | npx tsx tests/manual/feed.ts --provider standard -
 *   npx tsx tests/manual/feed.ts --raw --sku GS-012 --sku GS-040 data/mock-api/harvest/2026-11-09.csv
 *   npx tsx tests/manual/feed.ts --provider toString data/mock-api/sunrise/2026-11-09.csv   (getProvider error)
 *
 * The provider comes from the chain folder (`data/mock-api/<chain>/...`, looked up in
 * data/stores.csv) unless `--provider <id>` is given; `-` reads stdin. `--summary` prints one line
 * per file instead of the rows. `--raw` prints every data line next to what the adapter returns
 * for it (or why it was skipped); `--sku <code>` (repeatable) keeps only the lines of those SKUs.
 *
 * Logging (D-76 to D-80): each file is parsed once with the process logger, exactly as the server
 * does, so the execution log (stderr and logs/app/grocerysave-<date>.log) gets the real records;
 * set LOG_CONSOLE=false to keep stderr quiet. The skipped lines and the --raw view come from the
 * records the adapter logs (`row_skipped`, `row_parsed`), captured by a second, in-memory parse.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseCsvRecords } from '../../src/utils/csv';
import { createLogger, memorySink, type LogRecord } from '../../server/src/logger';
import { getProvider, type PriceProvider } from '../../server/src/providers';

const chainProviders = new Map(
  parseCsvRecords(readFileSync('data/stores.csv', 'utf8')).map((store) => [store.chain_id, store.provider]),
);

// Stop quietly when the reader goes away (for example `| head`), instead of an EPIPE stack trace.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

function usage(): never {
  console.error('usage: npx tsx tests/manual/feed.ts [--summary | --raw [--sku <code>]...] [--provider <id>] <file.csv|->...');
  process.exit(2);
}

const args = process.argv.slice(2);
let summary = false;
let raw = false;
const skus = new Set<string>();
let forced: string | null = null;
const files: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--summary') summary = true;
  else if (args[i] === '--raw') raw = true;
  else if (args[i] === '--sku') skus.add(args[++i] ?? usage());
  else if (args[i] === '--provider') forced = args[++i] ?? usage();
  else files.push(args[i]);
}
if (files.length === 0) usage();

const money = (value: number) => value.toFixed(2);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
/** A raw line as a markdown code cell (a record spanning lines is shown on one line with ⏎). */
const code = (text: unknown) => `\`${String(text).replace(/\r\n|\r|\n/g, '⏎').replace(/\|/g, '\\|')}\``;

let failed = false;
for (const file of files) {
  const providerId = forced ?? chainProviders.get(basename(dirname(file))) ?? null;
  const label = file === '-' ? 'stdin' : file;
  if (providerId === null) {
    console.log(`${label}: cannot tell the provider (not under data/mock-api/<chain>/); use --provider\n`);
    failed = true;
    continue;
  }
  let provider: PriceProvider;
  try {
    provider = getProvider(providerId);
  } catch (error) {
    console.log(`${label}: ${(error as Error).message}\n`);
    failed = true;
    continue;
  }
  const text = readFileSync(file === '-' ? 0 : file, 'utf8');
  // 1. The real run: the process logger writes the execution log.
  const result = provider.parse(text, { source: label });
  // 2. The same parse, captured in memory at debug level, for the display below.
  const sink = memorySink();
  provider.parse(text, { source: label, logger: createLogger({ level: 'debug', sinks: [sink] }) });
  const logged = (event: string) => sink.records.filter((record) => record.event === event);
  const onSale = result.rows.filter((row) => row.onSale).length;

  if (summary) {
    console.log(`${label} [${providerId}]: ${plural(result.rows.length, 'row')} (${onSale} on sale), ${result.skipped} skipped`);
    continue;
  }

  if (raw) {
    console.log(`### ${label} [${providerId}]: each line next to what the adapter returns\n`);
    const physical = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const headerIndex = physical.findIndex((line) => line.trim() !== '');
    console.log(`Header (line ${headerIndex + 1}): \`${physical[headerIndex] ?? ''}\`\n`);
    for (const record of logged('header_invalid')) console.log(`**${record.message}**\n`);
    console.log('| line | raw text | sku | price | regularPrice | onSale |');
    console.log('|---|---|---|---|---|---|');
    const lines: LogRecord[] = [...logged('row_parsed'), ...logged('row_skipped')].sort((a, b) => Number(a.line) - Number(b.line));
    for (const record of lines) {
      const wanted = skus.size === 0 || skus.has(String(record.sku)) || [...skus].some((sku) => String(record.raw).startsWith(sku));
      if (!wanted) continue;
      if (record.event === 'row_parsed') {
        console.log(`| ${record.line} | ${code(record.raw)} | ${record.sku} | ${money(Number(record.price))} | ${money(Number(record.regularPrice))} | ${record.onSale ? 'yes' : 'no'} |`);
      } else {
        console.log(`| ${record.line} | ${code(record.raw)} | **skipped** (${record.reason}) | | | |`);
      }
    }
    console.log(`\nWhole file: ${plural(result.rows.length, 'row')} (${onSale} on sale), ${result.skipped} skipped\n`);
    continue;
  }

  console.log(`### ${label} [${providerId}]: ${plural(result.rows.length, 'row')} (${onSale} on sale), ${result.skipped} skipped\n`);
  console.log('| # | sku | price | regularPrice | onSale |');
  console.log('|---|---|---|---|---|');
  result.rows.forEach((row, index) =>
    console.log(`| ${index + 1} | ${row.sku} | ${money(row.price)} | ${money(row.regularPrice)} | ${row.onSale ? 'yes' : 'no'} |`),
  );
  const skipped = logged('row_skipped');
  console.log(`\nSkipped lines (${skipped.length}):${skipped.length === 0 ? ' none' : ''}`);
  for (const record of skipped) console.log(`- line ${record.line}: ${code(record.raw)}: ${record.reason}, ${record.detail}`);
  for (const record of logged('header_invalid')) console.log(`- ${record.message}`);
  const adjusted = logged('row_adjusted');
  if (adjusted.length > 0) {
    console.log(`\nAdjusted rows (${adjusted.length}):`);
    for (const record of adjusted) console.log(`- line ${record.line}: ${code(record.raw)}: ${String(record.message).split(': ').slice(1).join(': ')}`);
  }
  console.log();
}
process.exit(failed ? 1 : 0);
