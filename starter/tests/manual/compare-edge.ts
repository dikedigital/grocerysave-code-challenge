/**
 * Manual check of compareBasket on the edge-case scenarios of tests/fixtures/comparisonScenarios.ts:
 * prints, for each scenario, the rows, the store totals and the summary exactly as returned
 * (unrounded fields included), so they can be compared with the hand-computed values in
 * docs/MANUAL_TESTING.md (M7).
 *
 *   npx tsx tests/manual/compare-edge.ts              (all scenarios)
 *   npx tsx tests/manual/compare-edge.ts tiedStores   (one scenario)
 */
import { compareBasket } from '../../src/utils/comparison';
import { SCENARIOS, type ScenarioName } from '../fixtures/comparisonScenarios';

const show = (value: unknown) => JSON.stringify(value);
const names = (process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SCENARIOS)) as ScenarioName[];

for (const name of names) {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.error(`unknown scenario ${name}; known: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(2);
  }
  const result = compareBasket(scenario.lines, scenario.stores, scenario.prices);
  console.log(`## ${name}: ${scenario.title}\n`);
  console.log(`storeIds ${show(result.storeIds)}`);
  console.log('rows:');
  for (const row of result.rows) {
    console.log(
      `  ${row.key} (qty ${row.quantity}, product ${row.productId}): lineTotals ${show(row.lineTotals)} average ${row.average} ` +
        `high ${row.high} low ${row.low} lowStoreIds ${show(row.lowStoreIds)} savings ${row.savings} savingsPct ${row.savingsPct}`
    );
  }
  console.log('storeTotals:');
  for (const total of result.storeTotals) {
    console.log(
      `  ${total.storeId}: total ${total.total} complete ${total.complete} missing ${show(total.missingKeys)} ` +
        `vsOptimal ${total.vsOptimal} (${total.vsOptimalPct}%) vsCheapest ${total.vsCheapestStore} (${total.vsCheapestStorePct}%)`
    );
  }
  console.log(`summary: ${show(result.summary)}\n`);
}
