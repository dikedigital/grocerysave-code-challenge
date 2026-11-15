/**
 * Measures the known limit of D-38: on a shuffled line of 10 stops north of home (round trip), all
 * 512 out-and-back orders are equally short. D-28 asks for the one that keeps the input sequence
 * best (lexicographically smallest input positions). The exact search would find it; the heuristic
 * (more than 8 stops) only compares the orders it reaches. This prints how often it still finds the
 * best one, and checks that every result is shortest and no worse than either straight direction.
 *
 *   npx tsx tests/manual/route-line-ties.ts
 */
import { haversineKm, planRoute } from '../../src/utils/route';

const N = 10;
const TRIES = 200;
const line = Array.from({ length: N }, (_, i) => ({ id: `n${i + 1}`, name: `N${i + 1}`, location: { lat: (i + 1) / 100, lng: 0 } }));
const origin = { lat: 0, lng: 0 };
const shortestKm = 2 * haversineKm(origin, line[N - 1].location);
const earlier = (a: number[], b: number[]) => {
  const i = a.findIndex((value, index) => value !== b[index]);
  return i !== -1 && a[i] < b[i];
};

let seed = 10;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
let best = 0;
let problems = 0;
for (let t = 0; t < TRIES; t += 1) {
  const stores = [...line].sort(() => random() - 0.5);
  const position = (id: string) => stores.findIndex((store) => store.id === id);
  // All out-and-back orders: a subset of n1..n9 on the way out (ascending), n10, the rest back.
  let earliest: number[] | null = null;
  for (let mask = 0; mask < 1 << (N - 1); mask += 1) {
    const out = line.slice(0, N - 1).filter((_, i) => mask & (1 << i));
    const back = line.slice(0, N - 1).filter((_, i) => !(mask & (1 << i))).reverse();
    const order = [...out, line[N - 1], ...back].map((store) => position(store.id));
    if (!earliest || earlier(order, earliest)) earliest = order;
  }
  const plan = planRoute(origin, stores);
  const got = plan.stops.map((stop) => position(stop.storeId));
  const forward = line.map((store) => position(store.id));
  const backward = [...forward].reverse();
  if (plan.totalDistanceKm !== Math.round(shortestKm * 100) / 100 || earlier(forward, got) || earlier(backward, got)) problems += 1;
  if (got.join() === earliest!.join()) best += 1;
}
console.log(`${TRIES} shuffled ${N}-stop lines, round trip (512 equally short orders each):`);
console.log(`- shortest, and no worse in input sequence than either straight direction: ${TRIES - problems}/${TRIES}`);
console.log(`- the input-earliest of all 512 equally short orders: ${best}/${TRIES}`);
process.exit(problems ? 1 : 0);
