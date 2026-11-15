/**
 * Times optimizePurchase for the size TECH_SPEC 5.4 budgets: 8 stores, 16 lines, maxStores 8, with a
 * home location (limit: 2 seconds). Two inputs:
 *   - golden: the golden basket at the real store locations (data/stores.csv), 0.35 per km;
 *   - worst case: every store is the only cheapest seller of 2 of the 16 items, so each of the 255
 *     subsets visits all of its stores and needs its own exact route (no sharing in the route cache).
 * Prints the first (cold) call, then min / median / max of 50 more calls, in milliseconds.
 *
 *   npx tsx tests/manual/optimize-timing.ts
 */
import { performance } from 'node:perf_hooks';
import type { BasketLine, PriceTable } from '../../src/models';
import { optimizePurchase } from '../../src/utils/optimizer';
import { GOLDEN_LINES, GOLDEN_PRICES, GOLDEN_STORES_PORT_MARLOWE } from '../fixtures/golden';
import { ROUTE_HOME } from '../fixtures/route';

const stores = GOLDEN_STORES_PORT_MARLOWE;
const options = { maxStores: 8, travelCostPerKm: 0.35, travelMode: 'driving' as const, home: ROUTE_HOME };

const worstLines: BasketLine[] = Array.from({ length: 16 }, (_, i) => ({ key: `w${i}`, label: `item ${i}`, quantity: 1, productId: `w${i}` }));
const worstPrices: PriceTable = Object.fromEntries(
  worstLines.map((line, i) => [line.productId!, Object.fromEntries(stores.map((s, j) => [s.id, j === Math.floor(i / 2) ? 1 : 5 + j]))])
);

function time(label: string, lines: BasketLine[], prices: PriceTable) {
  let started = performance.now();
  const first = optimizePurchase(lines, stores, prices, options);
  const cold = performance.now() - started;
  const runs: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    started = performance.now();
    optimizePurchase(lines, stores, prices, options);
    runs.push(performance.now() - started);
  }
  runs.sort((a, b) => a - b);
  const ms = (n: number) => n.toFixed(1);
  console.log(`| ${label} | ${lines.length} | ${first.bestPlan!.storeIds.length} | ${ms(cold)} | ${ms(runs[0])} | ${ms(runs[25])} | ${ms(runs[49])} | ${cold < 2000 && runs[49] < 2000 ? 'yes' : '**NO**'} |`);
  return Math.max(cold, runs[49]);
}

console.log(`Node ${process.version}; 8 stores, maxStores 8, home ${ROUTE_HOME.lat},${ROUTE_HOME.lng}, 0.35 per km\n`);
console.log('| Input | Lines | Stores in best plan | First call ms | Min ms | Median ms | Max ms | Under 2 s |');
console.log('|---|---:|---:|---:|---:|---:|---:|---|');
const worst = Math.max(time('golden basket', GOLDEN_LINES, GOLDEN_PRICES), time('worst case (255 distinct routes)', worstLines, worstPrices));
console.log(`\nSlowest call: ${worst.toFixed(1)} ms of the 2000 ms budget`);
process.exit(worst < 2000 ? 0 : 1);
