/**
 * Manual check of planRoute beyond 8 stops (nearest neighbour + 2-opt), on the 12-stop fixture of
 * tests/fixtures/route.ts (8 real stores + 4 fictional ones). Prints:
 *   1. the route leg by leg, with driving and walking minutes for the same stops;
 *   2. checks: a valid permutation of the input, no longer than plain nearest neighbour (computed
 *      here independently), no single 2-opt reversal left that helps, the tie rule (no equally short
 *      reversal that keeps the input sequence better; the input order kept when equally short), and
 *      the gap to the true optimum (Held-Karp dynamic programming, exact for 12 stops);
 *   3. the empty input case.
 * Exits 1 when a check fails.
 *
 *   npx tsx tests/manual/route-heuristic.ts             round trip
 *   npx tsx tests/manual/route-heuristic.ts --one-way   one way
 */
import type { LatLng, RoutePlan } from '../../src/models';
import { haversineKm, planRoute } from '../../src/utils/route';
import { ROUTE_HOME, ROUTE_STOPS_12 } from '../fixtures/route';

const roundTrip = !process.argv.includes('--one-way');
const stores = ROUTE_STOPS_12;
const short = (id: string) => id.replace(/^store-/, '');
const km = (value: number) => value.toFixed(5);

const drive = planRoute(ROUTE_HOME, stores, { roundTrip, mode: 'driving' });
const walk = planRoute(ROUTE_HOME, stores, { roundTrip, mode: 'walking' });

console.log(`### planRoute: ${stores.length} stops (heuristic), ${roundTrip ? 'round trip' : 'one way'}\n`);
console.log(`Input order: ${stores.map((s) => short(s.id)).join(', ')}\n`);
console.log('| # | Stop | Leg km | Driving min | Walking min |');
console.log('|---:|---|---:|---:|---:|');
drive.stops.forEach((stop, i) => {
  console.log(`| ${i + 1} | ${stop.name} | ${stop.legDistanceKm.toFixed(2)} | ${stop.legDurationMin} | ${walk.stops[i].legDurationMin} |`);
});
if (roundTrip) console.log(`| | back home | ${drive.returnDistanceKm.toFixed(2)} | | |`);
console.log(`| | **Total** | **${drive.totalDistanceKm.toFixed(2)}** | **${drive.totalDurationMin}** | **${walk.totalDurationMin}** |`);
const sameRoute = JSON.stringify(drive.stops.map((s) => [s.storeId, s.legDistanceKm])) === JSON.stringify(walk.stops.map((s) => [s.storeId, s.legDistanceKm]));
console.log(`\nWalking and driving: same order and distances: ${sameRoute ? 'yes' : 'NO'}; ` +
  `walking/driving total minutes = ${(walk.totalDurationMin / drive.totalDurationMin).toFixed(2)} (speeds 40 / 5 = 8)\n`);

// ---------- checks ----------
const lengthOf = (path: LatLng[]) => {
  const full = [ROUTE_HOME, ...path, ...(roundTrip ? [ROUTE_HOME] : [])];
  return full.slice(1).reduce((sum, point, i) => sum + haversineKm(full[i], point), 0);
};
const planKm = (plan: RoutePlan) => lengthOf(plan.stops.map((s) => s.location));

const ids = drive.stops.map((s) => s.storeId);
const missing = stores.filter((s) => !ids.includes(s.id)).map((s) => s.id);
const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
const permutation = ids.length === stores.length && missing.length === 0 && duplicated.length === 0;

const nnPath: LatLng[] = [];
const left = [...stores];
for (let here = ROUTE_HOME; left.length > 0; ) {
  let pick = 0;
  left.forEach((s, i) => { if (haversineKm(here, s.location) < haversineKm(here, left[pick].location) - 1e-9) pick = i; });
  here = left[pick].location;
  nnPath.push(here);
  left.splice(pick, 1);
}
const nnKm = lengthOf(nnPath);

let bestReversalGain = 0;
let earlierTie = 'none';
const positions = drive.stops.map((s) => stores.findIndex((store) => store.id === s.storeId));
const lengthOfPositions = (order: number[]) => lengthOf(order.map((i) => stores[i].location));
for (let a = 0; a < positions.length - 1; a += 1) {
  for (let b = a + 1; b < positions.length; b += 1) {
    const flipped = [...positions.slice(0, a), ...positions.slice(a, b + 1).reverse(), ...positions.slice(b + 1)];
    const length = lengthOfPositions(flipped);
    bestReversalGain = Math.max(bestReversalGain, planKm(drive) - length);
    if (Math.abs(length - planKm(drive)) <= 1e-9 && flipped[a] < positions[a]) earlierTie = `reversing stops ${a + 1}..${b + 1}`;
  }
}
const inputOrderTies = Math.abs(lengthOfPositions(stores.map((_, i) => i)) - planKm(drive)) <= 1e-9;
const inputKept = positions.every((p, i) => p === i);

// Held-Karp: exact optimum over all 12! orders.
const n = stores.length;
const from0 = stores.map((s) => haversineKm(ROUTE_HOME, s.location));
const d = stores.map((a) => stores.map((b) => haversineKm(a.location, b.location)));
const best = Array.from({ length: 1 << n }, () => new Array<number>(n).fill(Infinity));
stores.forEach((_, i) => (best[1 << i][i] = from0[i]));
for (let set = 1; set < 1 << n; set += 1) {
  for (let last = 0; last < n; last += 1) {
    if (best[set][last] === Infinity) continue;
    for (let next = 0; next < n; next += 1) {
      if (set & (1 << next)) continue;
      const grown = set | (1 << next);
      best[grown][next] = Math.min(best[grown][next], best[set][last] + d[last][next]);
    }
  }
}
const optimumKm = Math.min(...best[(1 << n) - 1].map((v, last) => v + (roundTrip ? from0[last] : 0)));
const inputKm = lengthOf(stores.map((s) => s.location));

const checks: [string, boolean, string][] = [
  ['valid permutation of the 12 input stops', permutation, `${ids.length} stops, ${new Set(ids).size} distinct, missing [${missing}], duplicated [${duplicated}]`],
  ['no longer than plain nearest neighbour', planKm(drive) <= nnKm + 1e-9, `${km(planKm(drive))} km vs nearest neighbour ${km(nnKm)} km (saves ${km(nnKm - planKm(drive))} km)`],
  ['no 2-opt reversal left that helps', bestReversalGain <= 1e-9, `best remaining reversal saves ${Math.max(0, bestReversalGain).toExponential(1)} km (up to 1e-9 km is float noise, D-29)`],
  ['tie rule: no equally short reversal keeps the input sequence better', earlierTie === 'none', `found: ${earlierTie}`],
  ['tie rule: input order kept if it is equally short', !inputOrderTies || inputKept, inputOrderTies ? 'input order is equally short' : 'input order is longer, so not applicable'],
  ['not shorter than the true optimum', planKm(drive) >= optimumKm - 1e-9, `optimum ${km(optimumKm)} km; gap ${km(planKm(drive) - optimumKm)} km (${(((planKm(drive) - optimumKm) / optimumKm) * 100).toFixed(2)}%)`],
  ['walking and driving share the route', sameRoute, ''],
];
console.log('| Check | Result | Detail |');
console.log('|---|---|---|');
for (const [label, ok, detail] of checks) console.log(`| ${label} | ${ok ? 'OK' : 'FAIL'} | ${detail} |`);
console.log(`\nFor scale: the input order is ${km(inputKm)} km.\n`);

// ---------- empty input ----------
console.log('### Empty input\n');
for (const mode of ['driving', 'walking'] as const) {
  console.log(`planRoute(home, [], { mode: '${mode}', roundTrip: ${roundTrip} }) = ${JSON.stringify(planRoute(ROUTE_HOME, [], { mode, roundTrip }))}`);
}
const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\nHEURISTIC CHECKS: ${checks.length - failed} OK, ${failed} failed`);
process.exit(failed ? 1 : 0);
