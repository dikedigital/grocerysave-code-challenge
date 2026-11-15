/**
 * The edge cases a real caller hits, each run without and with a home location: no stores, no lines,
 * items sold nowhere, an item with no product, everything unpriced, and maxStores below 1 or above
 * the number of stores. Prints what comes back; exits 1 if any case throws.
 *
 *   npx tsx tests/manual/optimize-edges.ts
 */
import type { BasketLine, OptimizationResult, PriceTable, ShoppingPlan, Store } from '../../src/models';
import { optimizePurchase } from '../../src/utils/optimizer';

const store = (id: string, lat: number): Store => ({ id, chainId: id, chainName: id, name: id, address: '', city: '', location: { lat, lng: 0 } });
const line = (key: string, productId: string | null): BasketLine => ({ key, label: key, quantity: 1, productId });
const A = store('a', 0.01);
const B = store('b', 0.02);
const C = store('c', 0.03);
const prices: PriceTable = {
  milk: { a: 1, b: 1.2, c: 0.9 },
  eggs: { b: 2, c: 2.5 },
  caviar: { z: 90 }, // only at a store that is not in the list
  gold: { a: NaN }, // a broken price
  nothing: {}, // a product nobody sells
};
const items = [line('milk', 'milk'), line('eggs', 'eggs')];

const cases: [string, BasketLine[], Store[], number][] = [
  ['no stores', items, [], 3],
  ['no lines', [], [A, B, C], 3],
  ['no stores and no lines', [], [], 3],
  ['an item sold nowhere (product nobody sells)', [...items, line('nothing', 'nothing')], [A, B, C], 3],
  ['an item sold only by a store not in the list', [...items, line('caviar', 'caviar')], [A, B, C], 3],
  ['an item whose only price is NaN', [...items, line('gold', 'gold')], [A, B, C], 3],
  ['an item with no product (productId null)', [...items, line('mystery', null)], [A, B, C], 3],
  ['every item unpriced', [line('mystery', null), line('nothing', 'nothing')], [A, B, C], 3],
  ['maxStores 0', items, [A, B, C], 0],
  ['maxStores -3', items, [A, B, C], -3],
  ['maxStores 0.5', items, [A, B, C], 0.5],
  ['maxStores -Infinity', items, [A, B, C], -Infinity],
  ['maxStores 3 (= number of stores)', items, [A, B, C], 3],
  ['maxStores 10 (> number of stores)', items, [A, B, C], 10],
  ['maxStores Infinity', items, [A, B, C], Infinity],
];

const plan = (p: ShoppingPlan | null) =>
  p === null ? 'null' : `${JSON.stringify(p.storeIds)} ${p.grandTotal.toFixed(2)}${p.unavailableKeys.length ? ` missing ${JSON.stringify(p.unavailableKeys)}` : ''}${p.route ? ` ${p.travelDistanceKm} km` : ''}`;
const summary = (r: OptimizationResult) =>
  `best ${plan(r.bestPlan)}; single ${plan(r.cheapestSingleStore)}; byStoreCount [${r.byStoreCount.map((p) => p.storeIds.length).join(', ')}]; ` +
  `savings ${r.savingsVsSingleStore.toFixed(2)}; unpriced ${JSON.stringify(r.unpricedKeys)}`;

let thrown = 0;
for (const home of [null, { lat: 0, lng: 0 }]) {
  console.log(`\n### ${home ? 'With a home (0,0), 0.35 per km' : 'Without a home (free travel)'}\n`);
  console.log('| Case | Result |\n|---|---|');
  for (const [name, lines, stores, maxStores] of cases) {
    try {
      const r = optimizePurchase(lines, stores, prices, { maxStores, travelCostPerKm: 0.35, travelMode: 'driving', home });
      console.log(`| ${name} | ${summary(r)} |`);
    } catch (error) {
      thrown += 1;
      console.log(`| ${name} | **THREW** ${(error as Error).message} |`);
    }
  }
}
console.log(`\nEDGE CASES: ${cases.length * 2 - thrown} ran, ${thrown} threw`);
process.exit(thrown ? 1 : 0);
