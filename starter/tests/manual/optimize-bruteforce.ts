/**
 * optimizePurchase next to an independent brute force (tests/fixtures/optimizerSmall.ts: tries every
 * assignment of items to stores and every visiting order) on a small instance, for every maxStores,
 * without and with a home location. Prints both answers side by side and whether every field agrees.
 * Exits 1 on a disagreement.
 *
 *   npx tsx tests/manual/optimize-bruteforce.ts
 */
import type { ShoppingPlan } from '../../src/models';
import { optimizePurchase } from '../../src/utils/optimizer';
import { SMALL_HOME, SMALL_LINES, SMALL_PRICES, SMALL_STORES, bruteForceOptimize, type BrutePlan } from '../fixtures/optimizerSmall';

const RATE = 0.35;
const name = (id: string) => SMALL_STORES.find((s) => s.id === id)!.name;
const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => (c / 100).toFixed(2);
const inInputOrder = (ids: string[]) => [...ids].sort((a, b) => SMALL_STORES.findIndex((s) => s.id === a) - SMALL_STORES.findIndex((s) => s.id === b));
const buyersOf = (p: ShoppingPlan) => Object.fromEntries(p.stores.flatMap((s) => s.lines.map((l) => [l.key, s.storeId])));
/** Item -> store pairs in a fixed order (JSON.stringify depends on key order; the two sides build them differently). */
const canonical = (buyers: Record<string, string>) => JSON.stringify(Object.entries(buyers).sort(([a], [b]) => (a < b ? -1 : 1)));

function same(p: ShoppingPlan | null, b: BrutePlan | null): boolean {
  if (!p || !b) return p === b;
  return JSON.stringify(inInputOrder(p.storeIds)) === JSON.stringify(b.storeIds) && canonical(buyersOf(p)) === canonical(b.buyers) &&
    cents(p.itemsTotal) === b.itemsCents && p.travelDistanceKm === b.travelKm && cents(p.travelCost) === b.travelCents &&
    cents(p.grandTotal) === b.grandCents && JSON.stringify(p.unavailableKeys) === JSON.stringify(b.unavailableKeys);
}

console.log('Stores: ' + SMALL_STORES.map((s) => `${s.name} (${s.id})`).join(', ') + `. Items: ${SMALL_LINES.map((l) => `${l.label} x${l.quantity}`).join(', ')}.`);
let disagreements = 0;
for (const home of [null, SMALL_HOME]) {
  console.log(`\n### ${home ? `With a home (0, 0), ${RATE} per km` : 'Free travel (no home)'}\n`);
  console.log('| maxStores | optimizePurchase: bestPlan | brute force: best | byStoreCount (optimizer) | byCount (brute force) | All fields agree |');
  console.log('|---:|---|---|---|---|---|');
  for (const maxStores of [-2, 0, 1, 2, 3, 4, 5, 9]) {
    const r = optimizePurchase(SMALL_LINES, SMALL_STORES, SMALL_PRICES, { maxStores, travelCostPerKm: RATE, travelMode: 'driving', home });
    const b = bruteForceOptimize(SMALL_LINES, SMALL_STORES, SMALL_PRICES, { maxStores, travelCostPerKm: RATE, home });
    const counts = [...b.byCount.keys()].sort((x, y) => x - y);
    const ok = same(r.bestPlan, b.best) && same(r.cheapestSingleStore, b.single) &&
      JSON.stringify(r.byStoreCount.map((p) => p.storeIds.length)) === JSON.stringify(counts) &&
      r.byStoreCount.every((p) => same(p, b.byCount.get(p.storeIds.length)!)) &&
      cents(r.savingsVsSingleStore) === b.savingsCents && JSON.stringify(r.unpricedKeys) === JSON.stringify(b.unpricedKeys);
    if (!ok) disagreements += 1;
    const show = (ids: string[], grand: number) => `${ids.map(name).join(' + ')} ${money(grand)}`;
    console.log(`| ${maxStores} | ${show(r.bestPlan!.storeIds, cents(r.bestPlan!.grandTotal))} | ${show(b.best!.storeIds, b.best!.grandCents)} | ` +
      `${r.byStoreCount.map((p) => `${p.storeIds.length}: ${money(cents(p.grandTotal))}`).join(', ')} | ${counts.map((k) => `${k}: ${money(b.byCount.get(k)!.grandCents)}`).join(', ')} | ${ok ? 'yes' : '**NO**'} |`);
  }
}
const r = optimizePurchase(SMALL_LINES, SMALL_STORES, SMALL_PRICES, { maxStores: 4, travelCostPerKm: RATE, travelMode: 'driving', home: null });
console.log(`\nunpricedKeys (every case): ${JSON.stringify(r.unpricedKeys)}`);
console.log(`\nBRUTE FORCE: ${16 - disagreements} of 16 cases agree on every field`);
process.exit(disagreements ? 1 : 0);
