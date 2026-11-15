/**
 * Manual check of planRoute on the 5-stop fixture (tests/fixtures/route.ts): prints the planned
 * route leg by leg, then ranks every possible visiting order by brute force, so the planner's choice
 * can be checked by eye against the shortest. Exits 1 when the planner disagrees with brute force.
 *
 *   npx tsx tests/manual/route-fixture.ts              round trip, driving (the default)
 *   npx tsx tests/manual/route-fixture.ts --one-way    one way
 *   npx tsx tests/manual/route-fixture.ts --walking    walking speed (5 km/h)
 *   npx tsx tests/manual/route-fixture.ts --all8       the 8 stores of data/stores.csv (40 320 orders)
 */
import type { LatLng } from '../../src/models';
import { haversineKm, planRoute } from '../../src/utils/route';
import { PORT_MARLOWE_STORES, ROUTE_HOME, ROUTE_STOPS_5 } from '../fixtures/route';

const args = new Set(process.argv.slice(2));
const roundTrip = !args.has('--one-way');
const mode = args.has('--walking') ? 'walking' : 'driving';
const stores = args.has('--all8') ? PORT_MARLOWE_STORES : ROUTE_STOPS_5;
const short = (id: string) => id.replace(/^store-/, '');

const plan = planRoute(ROUTE_HOME, stores, { roundTrip, mode });

console.log(`### planRoute: ${stores.length} stops, ${roundTrip ? 'round trip' : 'one way'}, ${mode}\n`);
console.log(`Home ${ROUTE_HOME.lat}, ${ROUTE_HOME.lng}. Input order: ${stores.map((s) => short(s.id)).join(', ')}\n`);
console.log('| # | Stop | From | Leg km | Leg min |');
console.log('|---:|---|---|---:|---:|');
let from = 'home';
plan.stops.forEach((stop, index) => {
  console.log(`| ${index + 1} | ${stop.name} | ${from} | ${stop.legDistanceKm.toFixed(2)} | ${stop.legDurationMin} |`);
  from = stop.name;
});
if (plan.roundTrip) console.log(`| | back home | ${from} | ${plan.returnDistanceKm.toFixed(2)} | |`);
console.log(`\nTotal: **${plan.totalDistanceKm.toFixed(2)} km**, **${plan.totalDurationMin} min** (returnDistanceKm ${plan.returnDistanceKm})\n`);

// ---------- brute force ----------
const orders: number[][] = [];
const extend = (prefix: number[]) => {
  if (prefix.length === stores.length) return void orders.push(prefix);
  for (let i = 0; i < stores.length; i += 1) if (!prefix.includes(i)) extend([...prefix, i]);
};
extend([]);
const lengthOf = (order: number[]) => {
  const path: LatLng[] = [ROUTE_HOME, ...order.map((i) => stores[i].location), ...(roundTrip ? [ROUTE_HOME] : [])];
  return path.slice(1).reduce((sum, point, i) => sum + haversineKm(path[i], point), 0);
};
const ranked = orders
  .map((order, inputRank) => ({ ids: order.map((i) => short(stores[i].id)), km: lengthOf(order), inputRank }))
  // Lengths within 1e-9 km are ties (float noise), shown in input order like the planner breaks them.
  .sort((a, b) => (Math.abs(a.km - b.km) <= 1e-9 ? a.inputRank - b.inputRank : a.km - b.km));
const planned = plan.stops.map((stop) => short(stop.storeId)).join(' > ');

console.log(`### Brute force: all ${orders.length} orders, shortest first (top 6 and the input order)\n`);
console.log('| Rank | Order | km (unrounded) | |');
console.log('|---:|---|---:|---|');
const inputOrder = stores.map((s) => short(s.id)).join(' > ');
ranked.forEach((entry, index) => {
  const ids = entry.ids.join(' > ');
  if (index >= 6 && ids !== inputOrder) return;
  const marks = [ids === planned ? '<- planRoute' : '', ids === inputOrder ? '(input order)' : ''].filter(Boolean).join(' ');
  console.log(`| ${index + 1} | ${ids} | ${entry.km.toFixed(6)} | ${marks} |`);
});
const best = ranked[0].km;
const agrees = Math.abs(lengthOf(plan.stops.map((stop) => stores.findIndex((s) => s.id === stop.storeId))) - best) <= 1e-9;
console.log(`\nBRUTE FORCE: shortest ${best.toFixed(6)} km; planRoute ${agrees ? 'agrees' : 'DISAGREES'} (${planned})`);
process.exit(agrees ? 0 : 1);
