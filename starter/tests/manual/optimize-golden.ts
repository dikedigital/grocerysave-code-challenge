/**
 * Manual check of optimizePurchase on the golden basket (16 products, 8 chains, one unit each),
 * free travel (no home). For each maxStores prints the best plan: its stores, what each buys, the
 * items total and the grand total; then checks the acceptance numbers of TECH_SPEC 9
 * (maxStores 1 -> 134.61, 8 -> 115.56). Exits 1 on a mismatch.
 *
 *   npx tsx tests/manual/optimize-golden.ts            maxStores 1, 2, 3 and 8
 *   npx tsx tests/manual/optimize-golden.ts 4 5        other values
 */
import { optimizePurchase } from '../../src/utils/optimizer';
import { GOLDEN_LINES, GOLDEN_PRICES, GOLDEN_STORES } from '../fixtures/golden';

const args = process.argv.slice(2).map(Number);
const counts = args.length ? args : [1, 2, 3, 8];
const chainOf = (storeId: string) => GOLDEN_STORES.find((s) => s.id === storeId)!.chainName;
const money = (n: number) => n.toFixed(2);
const options = { travelCostPerKm: 0, travelMode: 'driving' as const, home: null };

console.log('### Best plan by maxStores (golden basket, free travel)\n');
console.log('| maxStores | Stores | Items total | Grand total | Savings vs single store |');
console.log('|---:|---|---:|---:|---:|');
const results = counts.map((maxStores) => ({ maxStores, result: optimizePurchase(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, { ...options, maxStores }) }));
for (const { maxStores, result } of results) {
  const plan = result.bestPlan!;
  console.log(`| ${maxStores} | ${plan.storeIds.map(chainOf).join(', ')} | ${money(plan.itemsTotal)} | **${money(plan.grandTotal)}** | ${money(result.savingsVsSingleStore)} |`);
}

for (const { maxStores, result } of results) {
  const plan = result.bestPlan!;
  console.log(`\n### maxStores ${maxStores}: what each store buys\n`);
  for (const store of plan.stores) {
    console.log(`- **${chainOf(store.storeId)}** (${store.lines.length} items, subtotal ${money(store.subtotal)}): ` +
      store.lines.map((l) => `${l.label} ${money(l.lineTotal)}`).join('; '));
  }
  console.log(`\nItems total ${money(plan.itemsTotal)}, travel ${money(plan.travelCost)} (${plan.travelDistanceKm} km), grand total ${money(plan.grandTotal)}; unavailable: ${plan.unavailableKeys.length ? plan.unavailableKeys.join(', ') : 'none'}.`);
}

const all = optimizePurchase(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, { ...options, maxStores: 8 });
console.log('\n### byStoreCount (maxStores 8): best plan using exactly k stores\n');
console.log('| k | Stores | Grand total |\n|---:|---|---:|');
for (const plan of all.byStoreCount) console.log(`| ${plan.storeIds.length} | ${plan.storeIds.map(chainOf).join(', ')} | ${money(plan.grandTotal)} |`);
console.log(`\ncheapestSingleStore: ${chainOf(all.cheapestSingleStore!.storeIds[0])} ${money(all.cheapestSingleStore!.grandTotal)}; unpricedKeys: ${JSON.stringify(all.unpricedKeys)}`);

const acceptance: [number, number][] = [[1, 134.61], [8, 115.56]];
let mismatches = 0;
console.log('\n### Acceptance numbers (TECH_SPEC 9)\n');
for (const [maxStores, expected] of acceptance) {
  const got = optimizePurchase(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, { ...options, maxStores }).bestPlan!.grandTotal;
  const ok = got === expected;
  if (!ok) mismatches += 1;
  console.log(`- maxStores ${maxStores}: expected ${money(expected)}, got ${got} ${ok ? 'OK' : 'MISMATCH'}`);
}
console.log(`\nACCEPTANCE: ${acceptance.length - mismatches} OK, ${mismatches} mismatched`);
process.exit(mismatches ? 1 : 0);
