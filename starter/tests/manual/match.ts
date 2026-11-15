/**
 * Manual check of normalizeName / matchProduct: for each typed name, prints its normalised form, the
 * product matchProduct picks (default threshold 0.5) and every product that shares a word with it.
 *
 *   npx tsx tests/manual/match.ts "Eggs" "olive"                 (against tests/fixtures/catalog.ts)
 *   npx tsx tests/manual/match.ts --catalog data/products.csv "oj" "loo roll"
 *   npx tsx tests/manual/match.ts --threshold 0.6 "oat milk"
 */
import { readFileSync } from 'node:fs';
import type { Product } from '../../src/models';
import { parseCsvRecords } from '../../src/utils/csv';
import { matchProduct, normalizeName, rankProducts } from '../../src/utils/matching';
import { TEST_CATALOG } from '../fixtures/catalog';

function loadCatalog(path: string): Product[] {
  return parseCsvRecords(readFileSync(path, 'utf8')).map((row) => ({
    id: row.sku,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unit: row.unit,
    aliases: row.aliases ? row.aliases.split('|') : [],
  }));
}

const args = process.argv.slice(2);
let catalog = TEST_CATALOG;
let catalogName = 'tests/fixtures/catalog.ts';
let threshold = 0.5;
const names: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--catalog') catalog = loadCatalog((catalogName = args[++i]));
  else if (args[i] === '--threshold') threshold = Number(args[++i]);
  else names.push(args[i]);
}
if (names.length === 0) {
  console.error('usage: npx tsx tests/manual/match.ts [--catalog file.csv] [--threshold n] "<typed name>" ...');
  process.exit(2);
}

const score = (value: number) => (value === 1 ? '1' : value.toFixed(3));
console.log(`catalog: ${catalogName} (${catalog.length} products), threshold ${threshold}\n`);
console.log('| Typed | normalizeName | Match | Score | Other candidates (score) |');
console.log('|---|---|---|---|---|');
for (const name of names) {
  const match = matchProduct(name, catalog, threshold);
  const others = rankProducts(name, catalog, Number.MIN_VALUE)
    .filter((candidate) => candidate.product !== match?.product)
    .map((candidate) => `${candidate.product.name} (${score(candidate.score)})`);
  console.log(
    `| \`${name}\` | \`${normalizeName(name)}\` | ${match ? `**${match.product.name}** (${match.product.sku})` : '*none*'} | ${
      match ? score(match.score) : ''
    } | ${others.join('; ') || '—'} |`
  );
}
