/**
 * Manual check of compareBasket on the golden basket: prints the computed matrix laid out like the
 * reference spreadsheet, the unrounded summary values, and a comparison of every GOLDEN_EXPECTED
 * number with the computed one (exact-cent fields compared exactly, unrounded ones to 2 decimals).
 *
 *   npx tsx tests/manual/compare-golden.ts
 */
import { compareBasket } from '../../src/utils/comparison';
import { roundTo } from '../../src/utils/money';
import { GOLDEN_LINES, GOLDEN_PRICES, GOLDEN_STORES } from '../fixtures/golden';
import { GOLDEN_CHAINS, GOLDEN_EXPECTED, GOLDEN_PRODUCTS } from '../fixtures/spreadsheet';

const result = compareBasket(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES);
const money = (value: number | null) => (value === null ? '—' : value.toFixed(2));
const pct = (value: number) => `${roundTo(value, 2).toFixed(2)}%`;
const header = GOLDEN_CHAINS.map((chain) => chain.name);

console.log('### Matrix (unit price x quantity 1; the lowest price of each row in bold)\n');
console.log(`| Product | ${header.join(' | ')} | Average | High | Low | Savings | % |`);
console.log(`|---|${header.map(() => '---:').join('|')}|---:|---:|---:|---:|---:|`);
for (const row of result.rows) {
  const cells = result.storeIds.map((id) => {
    const value = money(row.lineTotals[id]);
    return row.lowStoreIds.includes(id) ? `**${value}**` : value;
  });
  console.log(
    `| ${row.label} | ${cells.join(' | ')} | ${money(roundTo(row.average ?? NaN, 2))} | ${money(row.high)} | ${money(row.low)} | ${money(
      roundTo(row.savings, 2)
    )} | ${pct(row.savingsPct)} |`
  );
}
const { summary } = result;
const line = (label: string, values: string[], tail = '') => console.log(`| **${label}** | ${values.join(' | ')} | ${tail}`);
line('Total cost', result.storeTotals.map((entry) => money(entry.total)), `${money(roundTo(summary.averageTotal, 2))} | ${money(summary.highTotal)} | ${money(summary.optimalTotal)} | ${money(roundTo(summary.savings, 2))} | ${pct(summary.savingsPct)} |`);
line('vs optimal', result.storeTotals.map((entry) => money(entry.vsOptimal)), '| | | | |');
line('vs optimal %', result.storeTotals.map((entry) => pct(entry.vsOptimalPct)), '| | | | |');
line('vs cheapest', result.storeTotals.map((entry) => money(entry.vsCheapestStore)), '| | | | |');
line('vs cheapest %', result.storeTotals.map((entry) => pct(entry.vsCheapestStorePct)), '| | | | |');

const cheapest = GOLDEN_STORES.find((store) => store.id === summary.cheapestStoreId);
console.log('\n### Summary, unrounded as returned\n');
console.log(`averageTotal ${summary.averageTotal}  highTotal ${summary.highTotal}  optimalTotal ${summary.optimalTotal}`);
console.log(`savings ${summary.savings}  savingsPct ${summary.savingsPct}`);
console.log(`cheapestStoreId ${summary.cheapestStoreId} (chain ${cheapest?.chainId})  unpricedKeys ${JSON.stringify(summary.unpricedKeys)}`);

// ---------- every GOLDEN_EXPECTED number vs the computed one ----------
let checked = 0;
const mismatches: string[] = [];
const exact = (label: string, actual: unknown, expected: unknown) => {
  checked++;
  if (actual !== expected) mismatches.push(`${label}: computed ${String(actual)}, expected ${String(expected)}`);
};
const rounded = (label: string, actual: number | null, expected: number) => exact(label, roundTo(actual ?? NaN, 2), expected);
result.storeTotals.forEach((entry, i) => {
  const chain = GOLDEN_CHAINS[i].id;
  exact(`storeTotals[${chain}]`, entry.total, GOLDEN_EXPECTED.storeTotals[i]);
  exact(`vsOptimal[${chain}]`, entry.vsOptimal, GOLDEN_EXPECTED.vsOptimal[i]);
  rounded(`vsOptimalPct[${chain}]`, entry.vsOptimalPct, GOLDEN_EXPECTED.vsOptimalPct[i]);
  exact(`vsCheapestStore[${chain}]`, entry.vsCheapestStore, GOLDEN_EXPECTED.vsCheapestStore[i]);
  rounded(`vsCheapestStorePct[${chain}]`, entry.vsCheapestStorePct, GOLDEN_EXPECTED.vsCheapestStorePct[i]);
});
rounded('averageTotal', summary.averageTotal, GOLDEN_EXPECTED.averageTotal);
exact('highTotal', summary.highTotal, GOLDEN_EXPECTED.highTotal);
exact('optimalTotal', summary.optimalTotal, GOLDEN_EXPECTED.optimalTotal);
rounded('savings', summary.savings, GOLDEN_EXPECTED.savings);
rounded('savingsPct', summary.savingsPct, GOLDEN_EXPECTED.savingsPct);
exact('cheapestChainId', cheapest?.chainId, GOLDEN_EXPECTED.cheapestChainId);
result.rows.forEach((row, i) => {
  const expected = GOLDEN_EXPECTED.rows[i];
  const sku = GOLDEN_PRODUCTS[i].sku;
  rounded(`rows[${sku}].average`, row.average, expected.average);
  exact(`rows[${sku}].high`, row.high, expected.high);
  exact(`rows[${sku}].low`, row.low, expected.low);
  rounded(`rows[${sku}].savings`, row.savings, expected.savings);
  rounded(`rows[${sku}].savingsPct`, row.savingsPct, expected.savingsPct);
});
console.log(`\n### GOLDEN_EXPECTED: ${checked} numbers checked, ${mismatches.length} mismatches`);
mismatches.forEach((mismatch) => console.log(`  MISMATCH ${mismatch}`));
process.exit(mismatches.length === 0 ? 0 : 1);
