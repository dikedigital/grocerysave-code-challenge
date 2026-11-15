/**
 * Evidence for the planRoute acceptance checklist, for the exact search (5 stops) and the heuristic
 * (12 stops). Every figure is recomputed here from haversineKm and the stated speeds, then compared
 * with what planRoute returns. Exits 1 when a check fails.
 *
 *   npx tsx tests/manual/route-checklist.ts
 */
import type { LatLng, RoutePlan } from '../../src/models';
import { roundTo } from '../../src/utils/money';
import { EARTH_RADIUS_KM, haversineKm, planRoute } from '../../src/utils/route';
import { ROUTE_HOME, ROUTE_STOPS_12, ROUTE_STOPS_5, type RouteStore } from '../fixtures/route';

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failures += 1;
  console.log(`| ${ok ? 'OK' : '**FAIL**'} | ${label} | ${detail} |`);
};
const header = (title: string) => console.log(`\n### ${title}\n\n| | Check | Evidence |\n|---|---|---|`);
const ids = (plan: RoutePlan) => plan.stops.map((s) => s.storeId.replace(/^store-/, ''));
const legsKm = (plan: RoutePlan): number[] => {
  let here: LatLng = plan.origin;
  return plan.stops.map((stop) => {
    const km = haversineKm(here, stop.location);
    here = stop.location;
    return km;
  });
};
const lastPoint = (plan: RoutePlan) => (plan.stops.length ? plan.stops[plan.stops.length - 1].location : plan.origin);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const f5 = (n: number) => n.toFixed(5);
const SPEED = { driving: 40, walking: 5 } as const;

const fixtures: [string, RouteStore[]][] = [
  ['exact search, 5 stops', ROUTE_STOPS_5],
  ['heuristic, 12 stops', ROUTE_STOPS_12],
];

// 1-2. Return leg (round trip) and 0 (one way)
header('1-2. Round trip adds the return leg and reports returnDistanceKm; one way reports 0');
for (const [name, stores] of fixtures) {
  const rt = planRoute(ROUTE_HOME, stores);
  const legs = legsKm(rt);
  const back = haversineKm(lastPoint(rt), ROUTE_HOME);
  check(`${name}, round trip: returnDistanceKm = last stop to home`, rt.returnDistanceKm === roundTo(back, 2),
    `last stop ${ids(rt).at(-1)} to home ${f5(back)} km, reported ${rt.returnDistanceKm}`);
  check(`${name}, round trip: total includes the return leg`, rt.totalDistanceKm === roundTo(sum(legs) + back, 2),
    `legs ${f5(sum(legs))} + return ${f5(back)} = ${f5(sum(legs) + back)}, reported ${rt.totalDistanceKm}`);
  const ow = planRoute(ROUTE_HOME, stores, { roundTrip: false });
  check(`${name}, one way: returnDistanceKm is 0`, ow.returnDistanceKm === 0, `reported ${ow.returnDistanceKm}`);
  check(`${name}, one way: total is the legs only`, ow.totalDistanceKm === roundTo(sum(legsKm(ow)), 2),
    `legs ${f5(sum(legsKm(ow)))}, reported ${ow.totalDistanceKm}`);
}

// 3. Durations
header('3. Durations from the stated speeds (driving 40 km/h, walking 5 km/h)');
for (const [name, stores] of fixtures) {
  for (const mode of ['driving', 'walking'] as const) {
    const plan = planRoute(ROUTE_HOME, stores, { mode });
    const legs = legsKm(plan);
    const total = sum(legs) + haversineKm(lastPoint(plan), ROUTE_HOME);
    const minutes = (km: number) => (km / SPEED[mode]) * 60;
    const legsOk = plan.stops.every((stop, i) => stop.legDurationMin === roundTo(minutes(legs[i]), 0));
    check(`${name}, ${mode}: every leg = km / ${SPEED[mode]} x 60, rounded`, legsOk,
      `first leg ${f5(legs[0])} km = ${minutes(legs[0]).toFixed(2)} min, reported ${plan.stops[0].legDurationMin}`);
    check(`${name}, ${mode}: total from the unrounded total distance`, plan.totalDurationMin === roundTo(minutes(total), 0),
      `${f5(total)} km = ${minutes(total).toFixed(2)} min, reported ${plan.totalDurationMin}`);
  }
  const drive = planRoute(ROUTE_HOME, stores, { mode: 'driving' });
  const walk = planRoute(ROUTE_HOME, stores, { mode: 'walking' });
  check(`${name}: walking and driving give the same order and distances`,
    JSON.stringify(ids(drive)) === JSON.stringify(ids(walk)) && drive.totalDistanceKm === walk.totalDistanceKm,
    `${drive.totalDistanceKm} km: driving ${drive.totalDurationMin} min, walking ${walk.totalDurationMin} min`);
}

// 4. Tie rule
header('4. Tie rule: equally short orders keep the input sequence (D-28, D-38)');
const origin = { lat: 0, lng: 0 };
const north = (k: number): RouteStore => ({ id: `n${k}`, name: `N${k}`, location: { lat: k / 100, lng: 0 } });
const south = (k: number): RouteStore => ({ id: `s${k}`, name: `S${k}`, location: { lat: -k / 100, lng: 0 } });
const tieCase = (label: string, stores: RouteStore[], expected: string[], options = {}) => {
  const got = ids(planRoute(origin, stores, options));
  check(label, JSON.stringify(got) === JSON.stringify(expected), `input ${stores.map((s) => s.id).join(',')} -> ${got.join(',')}`);
};
tieCase('exact, line, round trip: input order kept', [1, 2, 3].map(north), ['n1', 'n2', 'n3']);
tieCase('exact, line, round trip: other direction, input order kept', [3, 2, 1].map(north), ['n3', 'n2', 'n1']);
tieCase('exact, one way from the middle: side listed first goes first', [south(1), north(1), south(2), north(2)], ['s1', 's2', 'n1', 'n2'], { roundTrip: false });
const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(north);
tieCase('heuristic, 10 stops on a line, round trip: input order kept', ten, ten.map((s) => s.id));
tieCase('heuristic, 10 stops on a line, reversed input: reversed order kept', [...ten].reverse(), [...ten].reverse().map((s) => s.id));
const outAndBack = [1, 3, 5, 7, 9, 10, 8, 6, 4, 2].map(north);
tieCase('heuristic, input already a shortest order (out and back): kept', outAndBack, outAndBack.map((s) => s.id));
tieCase('heuristic, one way from the middle, 5 + 5 stops: side listed first goes first',
  [1, 2, 3, 4, 5].flatMap((k) => [south(k), north(k)]), ['s1', 's2', 's3', 's4', 's5', 'n1', 'n2', 'n3', 'n4', 'n5'], { roundTrip: false });
{
  // A regression instance: stores s1 and s5 share a spot; the previous version visited s5 first.
  const points: [number, number][] = [[29.2083, -81.1066], [29.2123, -80.9586], [29.1737, -81.0985], [29.1835, -81.0128], [29.2001, -81.0964], [29.2123, -80.9586], [29.2432, -81.1015], [29.1858, -81.1096], [29.1799, -81.0119]];
  const stores = points.map(([lat, lng], i) => ({ id: `s${i}`, name: `S${i}`, location: { lat, lng } }));
  const order = ids(planRoute(ROUTE_HOME, stores));
  check('heuristic, 9 stops, two at the same spot (s1, s5): visited in input order', order.indexOf('s5') === order.indexOf('s1') + 1,
    `order ${order.join(',')}`);
}

{
  // Mirror image: 5 stores east of home and their mirrors west; the input is the mirror of the
  // route planRoute finds, so it is exactly as short. D-28: the input order must be kept.
  const half: [number, number][] = [[0.016, 0.044], [-0.002, 0.037], [0.018, 0.016], [0.037, 0.054], [0.034, 0.006]];
  const all = [
    ...half.map(([lat, lng], i) => ({ id: `e${i}`, name: `E${i}`, location: { lat, lng } })),
    ...half.map(([lat, lng], i) => ({ id: `w${i}`, name: `W${i}`, location: { lat, lng: -lng } })),
  ];
  const input = ['e1', 'e0', 'e3', 'e2', 'e4', 'w4', 'w2', 'w1', 'w0', 'w3'].map((id) => all.find((s) => s.id === id)!);
  tieCase('heuristic, 10 stops, input = mirror image of a shortest one-way route: kept', input, input.map((s) => s.id), { roundTrip: false });
}

// 5. Permutation
header('5. The heuristic output is a permutation of the input');
for (const roundTrip of [true, false]) {
  const plan = planRoute(ROUTE_HOME, ROUTE_STOPS_12, { roundTrip });
  const got = plan.stops.map((s) => s.storeId);
  const missing = ROUTE_STOPS_12.filter((s) => !got.includes(s.id)).length;
  const repeated = got.length - new Set(got).size;
  check(`12 stops, ${roundTrip ? 'round trip' : 'one way'}: every input store exactly once`,
    got.length === 12 && missing === 0 && repeated === 0, `${got.length} stops, ${missing} missing, ${repeated} repeated`);
}

// 6. No stops
header('6. No stops: zero totals');
for (const mode of ['driving', 'walking'] as const) {
  for (const roundTrip of [true, false]) {
    const plan = planRoute(ROUTE_HOME, [], { mode, roundTrip });
    check(`${mode}, ${roundTrip ? 'round trip' : 'one way'}`,
      plan.stops.length === 0 && plan.returnDistanceKm === 0 && plan.totalDistanceKm === 0 && plan.totalDurationMin === 0 && plan.mode === mode && plan.roundTrip === roundTrip,
      `stops ${plan.stops.length}, return ${plan.returnDistanceKm}, total ${plan.totalDistanceKm} km, ${plan.totalDurationMin} min`);
  }
}

// 7. Rounding
header('7. Rounding: legs to 2 decimals / whole minutes; totals from unrounded legs, then rounded');
const kmPerDegree = (EARTH_RADIUS_KM * Math.PI) / 180;
for (const n of [3, 10]) {
  const stops = Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, name: `E${i + 1}`, location: { lat: 0, lng: (1.004 * (i + 1)) / kmPerDegree } }));
  const plan = planRoute(origin, stops, { roundTrip: false });
  const shownKm = roundTo(sum(plan.stops.map((s) => s.legDistanceKm)), 2);
  const shownMin = sum(plan.stops.map((s) => s.legDurationMin));
  check(`${n} stops 1.004 km apart, one way (${n <= 8 ? 'exact' : 'heuristic'}): distance`,
    plan.stops.every((s) => s.legDistanceKm === 1) && plan.totalDistanceKm === roundTo(1.004 * n, 2),
    `legs shown 1.00 each (sum ${shownKm.toFixed(2)}), total ${plan.totalDistanceKm} (${(1.004 * n).toFixed(3)} rounded)`);
  check(`${n} stops 1.004 km apart, one way: duration`,
    plan.stops.every((s) => s.legDurationMin === 2) && plan.totalDurationMin === roundTo(1.004 * n * 1.5, 0),
    `legs shown 2 min each (sum ${shownMin}), total ${plan.totalDurationMin} (${(1.004 * n * 1.5).toFixed(3)} min rounded)`);
}

console.log(`\nCHECKLIST: ${failures === 0 ? 'all checks OK' : `${failures} FAILED`}`);
process.exit(failures ? 1 : 0);
