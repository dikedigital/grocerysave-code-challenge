/**
 * Manual check of detectDeals on the scenarios of tests/fixtures/dealScenarios.ts: prints the input
 * points, the deals found, and whether they equal the hand-worked expectation. Exits 1 on a mismatch.
 *
 *   npx tsx tests/manual/deals-cases.ts                 every scenario
 *   npx tsx tests/manual/deals-cases.ts mixedSortOrder  one scenario
 */
import type { Deal } from '../../src/models';
import { detectDeals } from '../../src/utils/deals';
import { DEAL_SCENARIOS, type DealScenarioName } from '../fixtures/dealScenarios';

const wanted = process.argv.slice(2) as DealScenarioName[];
const names = (wanted.length ? wanted : (Object.keys(DEAL_SCENARIOS) as DealScenarioName[]));
const money = (n: number) => n.toFixed(2);
const row = (d: Deal) => `| ${d.productId} | ${d.storeId} | ${money(d.oldPrice)} | ${money(d.newPrice)} | ${d.dropPct} | ${d.date} | ${d.onSale} |`;
let mismatches = 0;

for (const name of names) {
  const scenario = DEAL_SCENARIOS[name];
  if (!scenario) throw new Error(`unknown scenario ${name}; known: ${Object.keys(DEAL_SCENARIOS).join(', ')}`);
  const deals = detectDeals(scenario.points, scenario.thresholdPct);
  const ok = JSON.stringify(deals) === JSON.stringify(scenario.expected);
  if (!ok) mismatches += 1;
  console.log(`### ${name}: ${scenario.title}\n`);
  console.log(`Threshold ${scenario.thresholdPct}%. ${scenario.why}\n`);
  console.log('Input points, in the order given:\n');
  console.log('| # | store | product | date | price | onSale |\n|---:|---|---|---|---:|---|');
  scenario.points.forEach((p, i) => console.log(`| ${i + 1} | ${p.storeId} | ${p.productId} | ${p.date} | ${money(p.price)} | ${p.onSale} |`));
  console.log(`\nDeals returned (${deals.length}):\n`);
  if (deals.length) {
    console.log('| product | store | old | new | dropPct | date | onSale |\n|---|---|---:|---:|---:|---|---|');
    deals.forEach((d) => console.log(row(d)));
  } else {
    console.log('(none)');
  }
  console.log(`\n${ok ? 'OK: equals the expected result' : `MISMATCH: expected ${JSON.stringify(scenario.expected)}`}\n`);
}
console.log(`DEAL SCENARIOS: ${names.length - mismatches} OK, ${mismatches} mismatched`);
process.exit(mismatches ? 1 : 0);
