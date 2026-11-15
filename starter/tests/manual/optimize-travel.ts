/**
 * Manual check of optimizePurchase with travel: the golden basket (16 products, one unit each) at the
 * 8 stores of data/stores.csv (real Port Marlowe coordinates), a home location and a cost per km.
 * Prints the best plan for each number of stores (byStoreCount), the overall winner (bestPlan) and
 * why, and the cheapest single store.
 *
 *   npx tsx tests/manual/optimize-travel.ts                        home 29.2,-81.05, 0.35/km, maxStores 3
 *   npx tsx tests/manual/optimize-travel.ts --rate 1 --max 8 --home 29.22,-81.06 --walking
 */
import { optimizePurchase } from '../../src/utils/optimizer';
import { planRoute } from '../../src/utils/route';
import { toCents, fromCents } from '../../src/utils/money';
import { GOLDEN_LINES, GOLDEN_PRICES, GOLDEN_STORES_PORT_MARLOWE } from '../fixtures/golden';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const [lat, lng] = arg('home', '29.2,-81.05').split(',').map(Number);
const rate = Number(arg('rate', '0.35'));
const maxStores = Number(arg('max', '3'));
const travelMode = process.argv.includes('--walking') ? ('walking' as const) : ('driving' as const);
const stores = GOLDEN_STORES_PORT_MARLOWE;
const chainOf = (id: string) => stores.find((s) => s.id === id)!.chainName;
const money = (n: number) => n.toFixed(2);

const result = optimizePurchase(GOLDEN_LINES, stores, GOLDEN_PRICES, { maxStores, travelCostPerKm: rate, travelMode, home: { lat, lng } });
const best = result.bestPlan!;

console.log(`### Golden basket with travel: home ${lat}, ${lng}; ${rate.toFixed(2)} per km; maxStores ${maxStores}; ${travelMode}\n`);
console.log('Best plan for each number of stores (`byStoreCount`); stores in route order:\n');
console.log('| Stores | Route from home and back | Items total | Distance km | Travel cost | Grand total | Minutes |');
console.log('|---:|---|---:|---:|---:|---:|---:|');
for (const plan of result.byStoreCount) {
  const mark = plan === best || JSON.stringify(plan.storeIds) === JSON.stringify(best.storeIds) ? ' ← bestPlan' : '';
  console.log(`| ${plan.storeIds.length} | ${plan.storeIds.map(chainOf).join(' → ')} | ${money(plan.itemsTotal)} | ${plan.travelDistanceKm.toFixed(2)} | ${money(plan.travelCost)} | **${money(plan.grandTotal)}**${mark} | ${plan.route!.totalDurationMin} |`);
}

console.log(`\n**Winner (bestPlan)**: ${best.storeIds.map(chainOf).join(' → ')}, grand total ${money(best.grandTotal)} ` +
  `(items ${money(best.itemsTotal)} + travel ${money(best.travelCost)} for ${best.travelDistanceKm.toFixed(2)} km).`);
console.log('\nWhy, against each other plan (every plan buys all 16 items, so the grand total decides):\n');
for (const plan of result.byStoreCount) {
  if (JSON.stringify(plan.storeIds) === JSON.stringify(best.storeIds)) continue;
  const items = plan.itemsTotal - best.itemsTotal;
  const travel = plan.travelCost - best.travelCost;
  console.log(`- ${plan.storeIds.length} store(s): items ${items >= 0 ? '+' : ''}${money(items)}, travel ${travel >= 0 ? '+' : ''}${money(travel)}, ` +
    `grand total ${money(plan.grandTotal)} (${money(plan.grandTotal - best.grandTotal)} more than the winner)`);
}
// The plans that win when travel is free, costed with this trip: why travel changes the pick.
console.log('\nThe free-travel winners, with the cost of reaching them from this home:\n');
console.log('| Stores | Stores (free-travel winner) | Items total | Distance km | Travel cost | Grand total |');
console.log('|---:|---|---:|---:|---:|---:|');
const free = optimizePurchase(GOLDEN_LINES, stores, GOLDEN_PRICES, { maxStores, travelCostPerKm: 0, travelMode, home: null });
for (const plan of free.byStoreCount) {
  const route = planRoute({ lat, lng }, plan.storeIds.map((id) => stores.find((s) => s.id === id)!), { mode: travelMode });
  const travelCents = toCents(route.totalDistanceKm * rate);
  const grand = fromCents(toCents(plan.itemsTotal) + travelCents);
  console.log(`| ${plan.storeIds.length} | ${route.stops.map((stop) => chainOf(stop.storeId)).join(' → ')} | ${money(plan.itemsTotal)} | ${route.totalDistanceKm.toFixed(2)} | ${money(fromCents(travelCents))} | ${money(grand)} |`);
}
const single = result.cheapestSingleStore!;
console.log(`\ncheapestSingleStore: ${single.storeIds.map(chainOf).join('')} ${money(single.grandTotal)} ` +
  `(items ${money(single.itemsTotal)} + travel ${money(single.travelCost)}); savingsVsSingleStore ${money(result.savingsVsSingleStore)}; ` +
  `unpricedKeys ${JSON.stringify(result.unpricedKeys)}`);
for (const stop of best.route!.stops) console.log(`  leg to ${stop.name}: ${stop.legDistanceKm.toFixed(2)} km, ${stop.legDurationMin} min`);
console.log(`  back home: ${best.route!.returnDistanceKm.toFixed(2)} km; total ${best.route!.totalDistanceKm.toFixed(2)} km, ${best.route!.totalDurationMin} min`);
