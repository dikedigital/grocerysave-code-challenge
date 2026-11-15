import {
  PORT_MARLOWE_STORES,
  ROUTE_HOME,
  ROUTE_STOPS_12,
  ROUTE_STOPS_5,
  ROUTE_STOPS_5_BEST_ORDER,
  type RouteStore,
} from '../../../tests/fixtures/route';
import type { LatLng, RoutePlan } from '../../models';
import { roundTo } from '../money';
import { EARTH_RADIUS_KM, EXACT_ROUTE_MAX_STOPS, TRAVEL_SPEED_KMH, haversineKm, planRoute } from '../route';

// ---------- Independent brute force ----------

/**
 * Every visiting order, in lexicographic order of input positions: pick each unused position in
 * ascending order, then recurse. (Written independently of the planner, which it is checking.)
 */
const orderCache = new Map<number, number[][]>();
function allOrders(n: number): number[][] {
  const cached = orderCache.get(n);
  if (cached) return cached;
  const orders: number[][] = [];
  const extend = (prefix: number[]) => {
    if (prefix.length === n) {
      orders.push(prefix);
      return;
    }
    for (let index = 0; index < n; index += 1) if (!prefix.includes(index)) extend([...prefix, index]);
  };
  extend([]);
  orderCache.set(n, orders);
  return orders;
}

function routeLength(origin: LatLng, stops: LatLng[], roundTrip: boolean): number {
  const path = roundTrip ? [origin, ...stops, origin] : [origin, ...stops];
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += haversineKm(path[i - 1], path[i]);
  return total;
}

/** Shortest length, and the first order (input-lexicographic) within 1e-9 km of it. */
function bruteForce(origin: LatLng, stores: RouteStore[], roundTrip: boolean) {
  const scored = allOrders(stores.length).map((order) => ({
    ids: order.map((index) => stores[index].id),
    length: routeLength(origin, order.map((index) => stores[index].location), roundTrip),
  }));
  const best = Math.min(...scored.map((entry) => entry.length));
  const winner = scored.find((entry) => entry.length <= best + 1e-9)!;
  const worst = Math.max(...scored.map((entry) => entry.length));
  return { bestLength: best, bestIds: winner.ids, worstLength: worst, orderCount: scored.length };
}

const stopIds = (plan: RoutePlan) => plan.stops.map((stop) => stop.storeId);
const planLength = (plan: RoutePlan) =>
  routeLength(plan.origin, plan.stops.map((stop) => stop.location), plan.roundTrip);

/** Every field of the plan, recomputed independently from the order the planner chose. */
function expectConsistentPlan(plan: RoutePlan, origin: LatLng, stores: RouteStore[], mode: 'driving' | 'walking', roundTrip: boolean) {
  const speed = mode === 'driving' ? 40 : 5;
  expect(plan.mode).toBe(mode);
  expect(plan.roundTrip).toBe(roundTrip);
  expect(plan.origin).toEqual(origin);
  expect([...stopIds(plan)].sort()).toEqual(stores.map((store) => store.id).sort());
  let previous = origin;
  for (const stop of plan.stops) {
    const store = stores.find((candidate) => candidate.id === stop.storeId)!;
    expect(stop.name).toBe(store.name);
    expect(stop.location).toEqual(store.location);
    const km = haversineKm(previous, stop.location);
    expect(stop.legDistanceKm).toBe(roundTo(km, 2));
    expect(stop.legDurationMin).toBe(Math.round((km / speed) * 60));
    previous = stop.location;
  }
  const back = roundTrip && plan.stops.length > 0 ? haversineKm(previous, origin) : 0;
  expect(plan.returnDistanceKm).toBe(roundTo(back, 2));
  const total = planLength(plan);
  expect(plan.totalDistanceKm).toBe(roundTo(total, 2));
  expect(plan.totalDurationMin).toBe(Math.round((total / speed) * 60));
}

/** All n! arrangements of an array (for feeding the planner every input order). */
const arrangements = <T>(items: T[]): T[][] => allOrders(items.length).map((order) => order.map((index) => items[index]));

// ---------- haversineKm ----------

describe('haversineKm', () => {
  it('puts two points one degree of latitude apart about 111.19 km apart (6371 x pi / 180)', () => {
    const km = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(roundTo(km, 2)).toBe(111.19);
    expect(km).toBeCloseTo((EARTH_RADIUS_KM * Math.PI) / 180, 9);
  });

  it('gives the same degree of latitude anywhere along a meridian', () => {
    for (const [lat, lng] of [[29.2, -81.05], [-45, 170], [51, -0.1], [89, 0]]) {
      expect(haversineKm({ lat, lng }, { lat: lat + 1, lng })).toBeCloseTo(111.19492664, 6);
    }
  });

  it('is zero for the same point and symmetric', () => {
    expect(haversineKm(ROUTE_HOME, ROUTE_HOME)).toBe(0);
    for (const a of PORT_MARLOWE_STORES) {
      for (const b of PORT_MARLOWE_STORES) {
        expect(haversineKm(a.location, b.location)).toBe(haversineKm(b.location, a.location));
      }
    }
  });

  it('gives half the circumference for antipodal points (no NaN from rounding past 1)', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(EARTH_RADIUS_KM * Math.PI, 6);
    expect(haversineKm({ lat: 90, lng: 0 }, { lat: -90, lng: 0 })).toBeCloseTo(EARTH_RADIUS_KM * Math.PI, 6);
    expect(haversineKm({ lat: 29.2, lng: -81.05 }, { lat: -29.2, lng: 98.95 })).toBeCloseTo(EARTH_RADIUS_KM * Math.PI, 6);
  });

  it('shrinks a degree of longitude by cos(latitude)', () => {
    // Along a parallel the great circle is slightly shorter than the parallel itself, so compare
    // with the closed form 2R asin(cos(lat) sin(dLng/2)).
    const closedForm = (lat: number) => 2 * EARTH_RADIUS_KM * Math.asin(Math.cos((lat * Math.PI) / 180) * Math.sin(Math.PI / 360));
    expect(haversineKm({ lat: 0, lng: 10 }, { lat: 0, lng: 11 })).toBeCloseTo(111.19492664, 6);
    expect(haversineKm({ lat: 60, lng: 10 }, { lat: 60, lng: 11 })).toBeCloseTo(closedForm(60), 9);
    expect(roundTo(haversineKm({ lat: 60, lng: 10 }, { lat: 60, lng: 11 }), 2)).toBe(55.6);
  });

  it('treats longitudes across the antimeridian as neighbours', () => {
    expect(haversineKm({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 })).toBeCloseTo(111.19492664, 6);
  });
});

// ---------- planRoute against brute force ----------

describe('planRoute: exact search agrees with brute force on the 5-stop fixture', () => {
  const cases = [
    { roundTrip: true, mode: 'driving' as const },
    { roundTrip: false, mode: 'driving' as const },
    { roundTrip: true, mode: 'walking' as const },
    { roundTrip: false, mode: 'walking' as const },
  ];

  it('the fixture is not trivial: the input order is far from optimal', () => {
    const reference = bruteForce(ROUTE_HOME, ROUTE_STOPS_5, true);
    expect(reference.orderCount).toBe(120);
    const inputOrderLength = routeLength(ROUTE_HOME, ROUTE_STOPS_5.map((store) => store.location), true);
    expect(inputOrderLength - reference.bestLength).toBeGreaterThan(10);
    expect(reference.bestIds).toEqual(ROUTE_STOPS_5_BEST_ORDER);
    expect(bruteForce(ROUTE_HOME, ROUTE_STOPS_5, false).bestIds).toEqual(ROUTE_STOPS_5_BEST_ORDER);
  });

  it.each(cases)('roundTrip $roundTrip, $mode: same order and length as brute force', ({ roundTrip, mode }) => {
    const reference = bruteForce(ROUTE_HOME, ROUTE_STOPS_5, roundTrip);
    const plan = planRoute(ROUTE_HOME, ROUTE_STOPS_5, { roundTrip, mode });
    expect(stopIds(plan)).toEqual(reference.bestIds);
    expect(Math.abs(planLength(plan) - reference.bestLength)).toBeLessThanOrEqual(1e-9);
    expect(plan.totalDistanceKm).toBe(roundTo(reference.bestLength, 2));
    expectConsistentPlan(plan, ROUTE_HOME, ROUTE_STOPS_5, mode, roundTrip);
  });

  it('reports the fixture figures', () => {
    const roundTrip = planRoute(ROUTE_HOME, ROUTE_STOPS_5);
    expect(roundTrip.totalDistanceKm).toBe(27);
    expect(roundTrip.totalDurationMin).toBe(41); // 27.0046 km at 40 km/h = 40.5 min
    const oneWay = planRoute(ROUTE_HOME, ROUTE_STOPS_5, { roundTrip: false });
    expect(oneWay.totalDistanceKm).toBe(22.58);
    expect(oneWay.returnDistanceKm).toBe(0);
  });

  it.each([true, false])('roundTrip %s: matches brute force for all 120 input orders of the fixture', (roundTrip) => {
    for (const stores of arrangements(ROUTE_STOPS_5)) {
      const reference = bruteForce(ROUTE_HOME, stores, roundTrip);
      const plan = planRoute(ROUTE_HOME, stores, { roundTrip });
      expect(stopIds(plan)).toEqual(reference.bestIds);
      expect(Math.abs(planLength(plan) - reference.bestLength)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('matches brute force from other origins (each store as home, and far away)', () => {
    const origins: LatLng[] = [...PORT_MARLOWE_STORES.map((store) => store.location), { lat: 30.5, lng: -82 }];
    for (const origin of origins) {
      for (const roundTrip of [true, false]) {
        const reference = bruteForce(origin, ROUTE_STOPS_5, roundTrip);
        const plan = planRoute(origin, ROUTE_STOPS_5, { roundTrip });
        expect(stopIds(plan)).toEqual(reference.bestIds);
        expectConsistentPlan(plan, origin, ROUTE_STOPS_5, 'driving', roundTrip);
      }
    }
  });
});

/** mulberry32: small deterministic PRNG, so failures are reproducible. */
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** n stores at random points around Port Marlowe. */
function randomStores(random: () => number, n: number, prefix = 's'): RouteStore[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    name: `${prefix.toUpperCase()}${i}`,
    location: { lat: 29.1 + random() * 0.2, lng: -81.15 + random() * 0.2 },
  }));
}

describe('planRoute: brute force on random instances and on 8 stops', () => {
  it('agrees with brute force on 200 random instances of 1 to 6 stops', () => {
    const random = prng(20261109);
    for (let instance = 0; instance < 200; instance += 1) {
      const n = 1 + (instance % 6);
      const point = () => ({ lat: 29.1 + random() * 0.2, lng: -81.15 + random() * 0.2 });
      const stores = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `S${i}`, location: point() }));
      const origin = point();
      const roundTrip = instance % 2 === 0;
      const reference = bruteForce(origin, stores, roundTrip);
      const plan = planRoute(origin, stores, { roundTrip });
      expect(stopIds(plan)).toEqual(reference.bestIds);
      expect(Math.abs(planLength(plan) - reference.bestLength)).toBeLessThanOrEqual(1e-9);
    }
  });

  it.each([true, false])('8 stops (the most it solves exactly), roundTrip %s: agrees with brute force', (roundTrip) => {
    const reference = bruteForce(ROUTE_HOME, PORT_MARLOWE_STORES, roundTrip);
    expect(reference.orderCount).toBe(40320);
    const started = Date.now();
    const plan = planRoute(ROUTE_HOME, PORT_MARLOWE_STORES, { roundTrip });
    expect(Date.now() - started).toBeLessThan(500);
    expect(stopIds(plan)).toEqual(reference.bestIds);
    expectConsistentPlan(plan, ROUTE_HOME, PORT_MARLOWE_STORES, 'driving', roundTrip);
  });
});

// ---------- Ties ----------

describe('planRoute: equally short orders keep the input sequence', () => {
  const origin = { lat: 0, lng: 0 };
  const a = { id: 'a', name: 'A', location: { lat: 1, lng: 0 } };
  const b = { id: 'b', name: 'B', location: { lat: 2, lng: 0 } };
  const c = { id: 'c', name: 'C', location: { lat: 3, lng: 0 } };

  it('a round trip along a line: both directions are equal, the input order wins', () => {
    expect(stopIds(planRoute(origin, [a, b, c]))).toEqual(['a', 'b', 'c']);
    expect(stopIds(planRoute(origin, [c, b, a]))).toEqual(['c', 'b', 'a']);
    // Any order that goes out monotonically and comes back monotonically is 6 km (2 + 1 + 2 + 1
    // for b, c, a). From the input [b, a, c] the earliest of those is b, c, a (b, a, c is 8 km).
    expect(stopIds(planRoute(origin, [b, a, c]))).toEqual(['b', 'c', 'a']);
    expect(stopIds(planRoute(origin, [b, c, a]))).toEqual(['b', 'c', 'a']);
    for (const stores of arrangements([a, b, c])) {
      expect(stopIds(planRoute(origin, stores))).toEqual(bruteForce(origin, stores, true).bestIds);
    }
  });

  it('one way along a line: only the outward direction is shortest', () => {
    expect(stopIds(planRoute(origin, [c, b, a], { roundTrip: false }))).toEqual(['a', 'b', 'c']);
  });

  it('one way from the middle of a line: either side first is equally long, the input order wins', () => {
    const north = { id: 'n', name: 'N', location: { lat: 1, lng: 0 } };
    const south = { id: 's', name: 'S', location: { lat: -1, lng: 0 } };
    expect(stopIds(planRoute(origin, [north, south], { roundTrip: false }))).toEqual(['n', 's']);
    expect(stopIds(planRoute(origin, [south, north], { roundTrip: false }))).toEqual(['s', 'n']);
  });

  it('stores at the same spot stay in input order', () => {
    const twin1 = { id: 't1', name: 'T1', location: { lat: 1, lng: 1 } };
    const twin2 = { id: 't2', name: 'T2', location: { lat: 1, lng: 1 } };
    expect(stopIds(planRoute(origin, [twin2, twin1]))).toEqual(['t2', 't1']);
    // The twins are visited back to back (0 km between them), in input order.
    expect(stopIds(planRoute(origin, [twin1, a, twin2]))).toEqual(['t1', 't2', 'a']);
    expect(stopIds(planRoute(origin, [twin2, a, twin1]))).toEqual(['t2', 't1', 'a']);
  });

  it('the real fixture: the reverse of the best round trip is tied; citypantry (earlier in input) goes first', () => {
    const plan = planRoute(ROUTE_HOME, ROUTE_STOPS_5);
    const reversed = [...plan.stops].reverse().map((stop) => stop.location);
    expect(routeLength(ROUTE_HOME, reversed, true)).toBeCloseTo(planLength(plan), 9);
    expect(stopIds(plan)[0]).toBe('store-citypantry');
    const reversedInput = [...ROUTE_STOPS_5].reverse(); // valugrocer first in the input now
    expect(stopIds(planRoute(ROUTE_HOME, reversedInput))).toEqual([...ROUTE_STOPS_5_BEST_ORDER].reverse());
  });
});

// ---------- Rounding, units, defaults, shape ----------

describe('planRoute: rounding and durations', () => {
  // Three stops due east on the equator, 1.004 km apart: each leg rounds down to 1.00 km and
  // 1.506 min rounds up to 2 min, but totals come from the unrounded legs.
  const kmPerDegree = (EARTH_RADIUS_KM * Math.PI) / 180;
  const east = (km: number) => ({ lat: 0, lng: km / kmPerDegree });
  const stores = [1, 2, 3].map((k) => ({ id: `e${k}`, name: `E${k}`, location: east(1.004 * k) }));

  it('one way: legs 1.00 km / 2 min each, but total 3.01 km / 5 min (not 3.00 km / 6 min)', () => {
    const plan = planRoute({ lat: 0, lng: 0 }, stores, { roundTrip: false });
    expect(plan.stops.map((stop) => [stop.legDistanceKm, stop.legDurationMin])).toEqual([[1, 2], [1, 2], [1, 2]]);
    expect(plan.totalDistanceKm).toBe(3.01);
    expect(plan.totalDurationMin).toBe(5); // 3.012 km at 40 km/h = 4.518 min
    expect(plan.returnDistanceKm).toBe(0);
  });

  it('round trip: the return leg is reported and included in the totals', () => {
    const plan = planRoute({ lat: 0, lng: 0 }, stores);
    expect(plan.returnDistanceKm).toBe(3.01);
    expect(plan.totalDistanceKm).toBe(6.02); // 6.024
    expect(plan.totalDurationMin).toBe(9); // 9.036
  });

  it('uses 40 km/h driving and 5 km/h walking', () => {
    expect(TRAVEL_SPEED_KMH).toEqual({ driving: 40, walking: 5 });
    const oneDegree = [{ id: 'n', name: 'N', location: { lat: 1, lng: 0 } }];
    const drive = planRoute({ lat: 0, lng: 0 }, oneDegree, { roundTrip: false });
    const walk = planRoute({ lat: 0, lng: 0 }, oneDegree, { roundTrip: false, mode: 'walking' });
    expect([drive.stops[0].legDistanceKm, drive.stops[0].legDurationMin, drive.totalDurationMin]).toEqual([111.19, 167, 167]); // 166.79
    expect([walk.stops[0].legDistanceKm, walk.stops[0].legDurationMin, walk.totalDurationMin]).toEqual([111.19, 1334, 1334]); // 1334.34
  });

  it('rounds half a minute up (half away from zero)', () => {
    // 0.35 km at 40 km/h = 0.525 min -> 1; a 0.3 km leg is 0.45 min -> 0
    const at = (km: number) => [{ id: 'x', name: 'X', location: east(km) }];
    expect(planRoute({ lat: 0, lng: 0 }, at(0.35), { roundTrip: false }).totalDurationMin).toBe(1);
    expect(planRoute({ lat: 0, lng: 0 }, at(0.3), { roundTrip: false }).totalDurationMin).toBe(0);
  });
});

describe('planRoute: defaults, empty input and shape', () => {
  it('defaults to driving and a round trip', () => {
    const plan = planRoute(ROUTE_HOME, ROUTE_STOPS_5.slice(0, 2));
    expect(plan.mode).toBe('driving');
    expect(plan.roundTrip).toBe(true);
    expect(plan.returnDistanceKm).toBeGreaterThan(0);
  });

  it.each([true, false])('no stores (roundTrip %s): no stops and zero totals', (roundTrip) => {
    expect(planRoute(ROUTE_HOME, [], { roundTrip, mode: 'walking' })).toEqual({
      mode: 'walking',
      origin: ROUTE_HOME,
      stops: [],
      roundTrip,
      returnDistanceKm: 0,
      totalDistanceKm: 0,
      totalDurationMin: 0,
    });
  });

  it('one store: out and back', () => {
    const [store] = ROUTE_STOPS_5;
    const plan = planRoute(ROUTE_HOME, [store]);
    const km = haversineKm(ROUTE_HOME, store.location);
    expect(stopIds(plan)).toEqual([store.id]);
    expect(plan.returnDistanceKm).toBe(roundTo(km, 2));
    expect(plan.totalDistanceKm).toBe(roundTo(2 * km, 2));
  });

  it('a store at home is a 0 km stop', () => {
    const plan = planRoute(ROUTE_HOME, [{ id: 'h', name: 'Home Store', location: { ...ROUTE_HOME } }]);
    expect(plan.stops[0].legDistanceKm).toBe(0);
    expect(plan.totalDistanceKm).toBe(0);
    expect(Object.is(plan.totalDistanceKm, -0)).toBe(false);
  });

  it('returns plain data: keeps only the stop fields, copies locations, leaves the input alone', () => {
    const stores = ROUTE_STOPS_5.map((store) => ({ ...store, chainId: 'extra', location: { ...store.location } }));
    const before = JSON.stringify(stores);
    const origin = { ...ROUTE_HOME };
    const plan = planRoute(origin, stores);
    expect(JSON.stringify(stores)).toBe(before);
    expect(Object.keys(plan.stops[0]).sort()).toEqual(['legDistanceKm', 'legDurationMin', 'location', 'name', 'storeId']);
    expect(plan.origin).not.toBe(origin);
    plan.stops.forEach((stop) => expect(stores.some((store) => store.location === stop.location)).toBe(false));
  });
});

describe('planRoute: limits and invalid input', () => {
  it.each([
    ['a NaN origin latitude', { lat: NaN, lng: 0 }, ROUTE_STOPS_5],
    ['an infinite origin longitude', { lat: 0, lng: Infinity }, ROUTE_STOPS_5],
    ['a store without coordinates', ROUTE_HOME, [{ id: 'x', name: 'X', location: { lat: 29.2, lng: undefined as unknown as number } }]],
    ['a store with a string coordinate', ROUTE_HOME, [{ id: 'x', name: 'X', location: { lat: '29.2' as unknown as number, lng: -81 } }]],
  ])('rejects %s with a RangeError instead of a 0 km route', (_label, origin, stores) => {
    expect(() => planRoute(origin as LatLng, stores as RouteStore[])).toThrow(RangeError);
  });

  it('rejects an unknown travel mode (including inherited keys)', () => {
    expect(() => planRoute(ROUTE_HOME, [], { mode: 'flying' as never })).toThrow(RangeError);
    expect(() => planRoute(ROUTE_HOME, [], { mode: 'toString' as never })).toThrow(RangeError);
  });
});

// ---------- More than 8 stops: nearest neighbour + 2-opt ----------

/** Plain nearest neighbour, written independently: closest unvisited stop next, ties to input order. */
function nearestNeighbourLength(origin: LatLng, stores: RouteStore[], roundTrip: boolean): number {
  const left = [...stores];
  const path: LatLng[] = [];
  let here = origin;
  while (left.length > 0) {
    let pick = 0;
    left.forEach((store, index) => {
      if (haversineKm(here, store.location) < haversineKm(here, left[pick].location) - 1e-9) pick = index;
    });
    here = left[pick].location;
    path.push(here);
    left.splice(pick, 1);
  }
  return routeLength(origin, path, roundTrip);
}

/** The true optimum by Held-Karp dynamic programming (O(2^n n^2); fine up to about 13 stops). */
function optimalLength(origin: LatLng, stores: RouteStore[], roundTrip: boolean): number {
  const n = stores.length;
  if (n === 0) return 0;
  const fromOrigin = stores.map((store) => haversineKm(origin, store.location));
  const between = stores.map((a) => stores.map((b) => haversineKm(a.location, b.location)));
  const full = (1 << n) - 1;
  const best = Array.from({ length: 1 << n }, () => new Array<number>(n).fill(Infinity));
  for (let i = 0; i < n; i += 1) best[1 << i][i] = fromOrigin[i];
  for (let set = 1; set <= full; set += 1) {
    for (let last = 0; last < n; last += 1) {
      const here = best[set][last];
      if (here === Infinity) continue;
      for (let next = 0; next < n; next += 1) {
        if (set & (1 << next)) continue;
        const grown = set | (1 << next);
        best[grown][next] = Math.min(best[grown][next], here + between[last][next]);
      }
    }
  }
  return Math.min(...best[full].map((length, last) => length + (roundTrip ? fromOrigin[last] : 0)));
}

/**
 * The heuristic's result, checked by recomputing whole routes (D-28 applied to the orders 2-opt
 * compares, D-38):
 * - no reversal of a run of consecutive stops makes the route shorter;
 * - no reversal gives an equally short order that keeps the input sequence better (first differing
 *   position holds a store earlier in the input);
 * - if the input order itself is equally short, the result is the input order.
 */
function expectHeuristicRules(plan: RoutePlan, stores: RouteStore[]) {
  const positions = plan.stops.map((stop) => stores.findIndex((store) => store.id === stop.storeId));
  const lengthOf = (order: number[]) => routeLength(plan.origin, order.map((i) => stores[i].location), plan.roundTrip);
  const current = lengthOf(positions);
  for (let first = 0; first < positions.length - 1; first += 1) {
    for (let last = first + 1; last < positions.length; last += 1) {
      const flipped = [...positions.slice(0, first), ...positions.slice(first, last + 1).reverse(), ...positions.slice(last + 1)];
      const length = lengthOf(flipped);
      if (length < current - 1e-9) throw new Error(`reversing stops ${first}..${last} saves ${current - length} km`);
      if (length <= current + 1e-9 && flipped[first] < positions[first]) {
        throw new Error(`reversing stops ${first}..${last} is equally short and keeps the input sequence better`);
      }
    }
  }
  const inputOrder = stores.map((_, i) => i);
  if (lengthOf(inputOrder) <= current + 1e-9) expect(positions).toEqual(inputOrder);
}

/** Every store exactly once (a valid permutation of the input). */
function expectPermutationOf(plan: RoutePlan, stores: RouteStore[]) {
  expect(plan.stops).toHaveLength(stores.length);
  expect(new Set(stopIds(plan)).size).toBe(stores.length);
  expect([...stopIds(plan)].sort()).toEqual(stores.map((store) => store.id).sort());
}

describe('planRoute: 12-stop fixture (heuristic)', () => {
  it('has more stops than the exact search handles', () => {
    expect(ROUTE_STOPS_12.length).toBeGreaterThan(EXACT_ROUTE_MAX_STOPS);
    expect(new Set(ROUTE_STOPS_12.map((store) => store.id)).size).toBe(12);
  });

  it.each([
    { roundTrip: true, mode: 'driving' as const },
    { roundTrip: false, mode: 'driving' as const },
    { roundTrip: true, mode: 'walking' as const },
    { roundTrip: false, mode: 'walking' as const },
  ])('roundTrip $roundTrip, $mode: a valid permutation, no longer than nearest neighbour, 2-opt optimal, tie rule', ({ roundTrip, mode }) => {
    const plan = planRoute(ROUTE_HOME, ROUTE_STOPS_12, { roundTrip, mode });
    expectPermutationOf(plan, ROUTE_STOPS_12);
    expectConsistentPlan(plan, ROUTE_HOME, ROUTE_STOPS_12, mode, roundTrip);
    const length = planLength(plan);
    expect(length).toBeLessThanOrEqual(nearestNeighbourLength(ROUTE_HOME, ROUTE_STOPS_12, roundTrip) + 1e-9);
    expect(length).toBeGreaterThanOrEqual(optimalLength(ROUTE_HOME, ROUTE_STOPS_12, roundTrip) - 1e-9);
    expectHeuristicRules(plan, ROUTE_STOPS_12);
  });

  it('2-opt really improves on nearest neighbour here (by more than 4 km), and the input order is far worse', () => {
    for (const roundTrip of [true, false]) {
      const length = planLength(planRoute(ROUTE_HOME, ROUTE_STOPS_12, { roundTrip }));
      expect(nearestNeighbourLength(ROUTE_HOME, ROUTE_STOPS_12, roundTrip) - length).toBeGreaterThan(4);
      expect(routeLength(ROUTE_HOME, ROUTE_STOPS_12.map((store) => store.location), roundTrip)).toBeGreaterThan(2 * length);
    }
  });

  it('reports the fixture figures (round trip optimal; one way 22 m above the optimum)', () => {
    const roundTrip = planRoute(ROUTE_HOME, ROUTE_STOPS_12);
    expect(roundTrip.totalDistanceKm).toBe(33.94); // 33.94496 km
    expect(roundTrip.totalDistanceKm).toBe(roundTo(optimalLength(ROUTE_HOME, ROUTE_STOPS_12, true), 2));
    const oneWay = planRoute(ROUTE_HOME, ROUTE_STOPS_12, { roundTrip: false });
    expect(oneWay.totalDistanceKm).toBe(30.41);
    expect(roundTo(optimalLength(ROUTE_HOME, ROUTE_STOPS_12, false), 2)).toBe(30.39); // a heuristic, not exact
    expect(oneWay.returnDistanceKm).toBe(0);
  });

  it('walking and driving: same order and distances; durations at 5 and 40 km/h', () => {
    for (const roundTrip of [true, false]) {
      const drive = planRoute(ROUTE_HOME, ROUTE_STOPS_12, { roundTrip, mode: 'driving' });
      const walk = planRoute(ROUTE_HOME, ROUTE_STOPS_12, { roundTrip, mode: 'walking' });
      expect(stopIds(walk)).toEqual(stopIds(drive));
      expect(walk.stops.map((stop) => stop.legDistanceKm)).toEqual(drive.stops.map((stop) => stop.legDistanceKm));
      expect([walk.totalDistanceKm, walk.returnDistanceKm]).toEqual([drive.totalDistanceKm, drive.returnDistanceKm]);
      const km = planLength(drive);
      expect(drive.totalDurationMin).toBe(Math.round(km * 1.5)); // 60 / 40 min per km
      expect(walk.totalDurationMin).toBe(Math.round(km * 12)); // 60 / 5 min per km
    }
    expect(planRoute(ROUTE_HOME, ROUTE_STOPS_12, { mode: 'walking' }).totalDurationMin).toBe(407); // 33.94496 km x 12 = 407.34
    expect(planRoute(ROUTE_HOME, ROUTE_STOPS_12, { mode: 'driving' }).totalDurationMin).toBe(51); // 33.94496 km x 1.5 = 50.92
  });

  it('gives the same route, up to direction, whatever the input order (no ties in this fixture)', () => {
    const random = prng(12);
    for (const roundTrip of [true, false]) {
      const reference = stopIds(planRoute(ROUTE_HOME, ROUTE_STOPS_12, { roundTrip }));
      for (let shuffle = 0; shuffle < 40; shuffle += 1) {
        const stores = [...ROUTE_STOPS_12].sort(() => random() - 0.5);
        const ids = stopIds(planRoute(ROUTE_HOME, stores, { roundTrip }));
        if (roundTrip) expect([reference, [...reference].reverse()]).toContainEqual(ids);
        else expect(ids).toEqual(reference);
      }
    }
  });
});

describe('planRoute: heuristic on random instances', () => {
  it('9 to 12 stops: valid, never longer than nearest neighbour, never shorter than the optimum, 2-opt optimal', () => {
    const random = prng(9122026);
    for (let instance = 0; instance < 48; instance += 1) {
      const n = 9 + (instance % 4);
      const stores = randomStores(random, n);
      const origin = randomStores(random, 1, 'o')[0].location;
      const roundTrip = instance % 2 === 0;
      const plan = planRoute(origin, stores, { roundTrip });
      expectPermutationOf(plan, stores);
      const length = planLength(plan);
      expect(length).toBeLessThanOrEqual(nearestNeighbourLength(origin, stores, roundTrip) + 1e-9);
      expect(length).toBeGreaterThanOrEqual(optimalLength(origin, stores, roundTrip) - 1e-9);
      expectHeuristicRules(plan, stores);
    }
  });

  it.each([20, 60])('%i stops: valid, never longer than nearest neighbour, 2-opt optimal, fields consistent', (n) => {
    const random = prng(n);
    for (const roundTrip of [true, false]) {
      const stores = randomStores(random, n);
      const plan = planRoute(ROUTE_HOME, stores, { roundTrip, mode: 'walking' });
      expectPermutationOf(plan, stores);
      expectConsistentPlan(plan, ROUTE_HOME, stores, 'walking', roundTrip);
      expect(planLength(plan)).toBeLessThanOrEqual(nearestNeighbourLength(ROUTE_HOME, stores, roundTrip) + 1e-9);
      expectHeuristicRules(plan, stores);
    }
  });

  it('is fast: 500 stops in well under 2 seconds', () => {
    const stores = randomStores(prng(500), 500);
    const started = Date.now();
    const plan = planRoute(ROUTE_HOME, stores);
    expect(Date.now() - started).toBeLessThan(2000);
    expectPermutationOf(plan, stores);
  });
});

describe('planRoute: heuristic ties keep the input sequence', () => {
  const origin = { lat: 0, lng: 0 };
  const north = (k: number) => ({ id: `n${k}`, name: `N${k}`, location: { lat: k / 100, lng: 0 } });
  const south = (k: number) => ({ id: `s${k}`, name: `S${k}`, location: { lat: -k / 100, lng: 0 } });
  const line = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(north);
  const ids = (stores: RouteStore[]) => stores.map((store) => store.id);

  it('a round trip along a line (10 stops): both directions are equal, the input order wins', () => {
    expect(stopIds(planRoute(origin, line))).toEqual(ids(line));
    const reversed = [...line].reverse();
    expect(stopIds(planRoute(origin, reversed))).toEqual(ids(reversed));
  });

  it('a round trip along a shuffled line: shortest, and keeps the input sequence at least as well as either direction', () => {
    // Every out-and-back order along a line is equally short (2 x the farthest stop). The result
    // must be one of them, no worse in input sequence than the two straight directions, and pass
    // the local tie checks. (It is not always the best of all 512 such orders: see D-38.)
    const random = prng(10);
    const positionsOf = (stores: RouteStore[], order: string[]) => order.map((id) => stores.findIndex((store) => store.id === id));
    const earlierOrEqual = (a: number[], b: number[]) => {
      const i = a.findIndex((value, index) => value !== b[index]);
      return i === -1 || a[i] < b[i];
    };
    for (let shuffle = 0; shuffle < 30; shuffle += 1) {
      const stores = [...line].sort(() => random() - 0.5);
      const plan = planRoute(origin, stores);
      expect(plan.totalDistanceKm).toBe(roundTo(2 * haversineKm(origin, north(10).location), 2));
      const got = positionsOf(stores, stopIds(plan));
      expect(earlierOrEqual(got, positionsOf(stores, ids(line)))).toBe(true);
      expect(earlierOrEqual(got, positionsOf(stores, ids(line).reverse()))).toBe(true);
      expectHeuristicRules(plan, stores);
    }
  });

  it('an input that is already a shortest order is kept, even when it is not a straight direction', () => {
    const outAndBack = ['n1', 'n3', 'n5', 'n7', 'n9', 'n10', 'n8', 'n6', 'n4', 'n2'].map((id) => line.find((store) => store.id === id)!);
    expect(stopIds(planRoute(origin, outAndBack))).toEqual(ids(outAndBack));
    const twelve = planRoute(ROUTE_HOME, ROUTE_STOPS_12, { roundTrip: false });
    const asGiven = twelve.stops.map((stop) => ROUTE_STOPS_12.find((store) => store.id === stop.storeId)!);
    expect(stopIds(planRoute(ROUTE_HOME, asGiven, { roundTrip: false }))).toEqual(ids(asGiven));
  });

  it('an input that is the mirror image of a shortest route is kept (only the final input-order check can see it)', () => {
    // Five stores east of home and their mirror images west of it (same latitude, opposite
    // longitude): a route and its mirror are equally long, and one is not a reversal of the other.
    // The input is the mirror of the route planRoute finds one way. 2-opt alone returns the other
    // mirror image; D-28 wants the input order. Found by a seeded search.
    const half: [number, number][] = [[0.016, 0.044], [-0.002, 0.037], [0.018, 0.016], [0.037, 0.054], [0.034, 0.006]];
    const stores = [
      ...half.map(([lat, lng], i) => ({ id: `e${i}`, name: `E${i}`, location: { lat, lng } })),
      ...half.map(([lat, lng], i) => ({ id: `w${i}`, name: `W${i}`, location: { lat, lng: -lng } })),
    ];
    const byId = (id: string) => stores.find((store) => store.id === id)!;
    const input = ['e1', 'e0', 'e3', 'e2', 'e4', 'w4', 'w2', 'w1', 'w0', 'w3'].map(byId);
    const mirrored = ['w1', 'w0', 'w3', 'w2', 'w4', 'e4', 'e2', 'e1', 'e0', 'e3'].map(byId);
    const lengthOf = (order: RouteStore[]) => routeLength(origin, order.map((store) => store.location), false);
    expect(Math.abs(lengthOf(input) - lengthOf(mirrored))).toBeLessThanOrEqual(1e-9);
    const plan = planRoute(origin, input, { roundTrip: false });
    expect(stopIds(plan)).toEqual(ids(input));
    expectHeuristicRules(plan, input);
  });

  it('stores at the same spot are visited in input order (regressions found by a random search)', () => {
    // Three instances where the previous version (2-opt rejecting every equally short move) visited
    // twin stores against the input order. Coordinates as found.
    const cases: { roundTrip: boolean; twins: [string, string]; points: [number, number][] }[] = [
      { roundTrip: true, twins: ['s1', 's5'], points: [[29.2083, -81.1066], [29.2123, -80.9586], [29.1737, -81.0985], [29.1835, -81.0128], [29.2001, -81.0964], [29.2123, -80.9586], [29.2432, -81.1015], [29.1858, -81.1096], [29.1799, -81.0119]] },
      { roundTrip: true, twins: ['s1', 's5'], points: [[29.247, -81.0978], [29.2058, -81.1345], [29.2382, -81.1308], [29.2516, -81.0805], [29.28, -81.1309], [29.2058, -81.1345], [29.1295, -81.0906], [29.2348, -81.1261], [29.2677, -81.0688], [29.1125, -80.9928], [29.177, -81.1102]] },
      { roundTrip: false, twins: ['s1', 's4'], points: [[29.2478, -80.9838], [29.1677, -80.9761], [29.246, -81.0224], [29.2681, -81.0589], [29.1677, -80.9761], [29.2893, -81.0638], [29.297, -81.0954], [29.2158, -81.0939], [29.1734, -81.1362], [29.1819, -81.1248], [29.199, -81.0375], [29.1116, -81.1461]] },
    ];
    for (const { roundTrip, twins, points } of cases) {
      const stores = points.map(([lat, lng], i) => ({ id: `s${i}`, name: `S${i}`, location: { lat, lng } }));
      const plan = planRoute(ROUTE_HOME, stores, { roundTrip });
      const order = stopIds(plan);
      expect(order.indexOf(twins[1])).toBe(order.indexOf(twins[0]) + 1);
      expectHeuristicRules(plan, stores);
    }
  });

  it('random instances with two stores at one spot: tie rule holds, the pair is visited back to back in input order', () => {
    const random = prng(4242);
    for (let instance = 0; instance < 40; instance += 1) {
      const stores = randomStores(random, 9 + (instance % 4));
      const a = Math.floor(random() * stores.length);
      const b = (a + 1 + Math.floor(random() * (stores.length - 1))) % stores.length;
      stores[b] = { ...stores[b], location: { ...stores[a].location } };
      const plan = planRoute(ROUTE_HOME, stores, { roundTrip: instance % 2 === 0 });
      expectPermutationOf(plan, stores);
      expectHeuristicRules(plan, stores);
      const order = stopIds(plan);
      const [early, late] = a < b ? [stores[a].id, stores[b].id] : [stores[b].id, stores[a].id];
      expect(order.indexOf(late)).toBe(order.indexOf(early) + 1);
    }
  });

  it('one way along a line: nearest first, whatever the input order', () => {
    expect(stopIds(planRoute(origin, [...line].reverse(), { roundTrip: false }))).toEqual(ids(line));
  });

  it('one way from the middle of a line (5 stops each side): the side listed first in the input goes first', () => {
    const both = [1, 2, 3, 4, 5].flatMap((k) => [north(k), south(k)]); // n1, s1, n2, s2, ...
    expect(stopIds(planRoute(origin, both, { roundTrip: false }))).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 's1', 's2', 's3', 's4', 's5']);
    const southFirst = [1, 2, 3, 4, 5].flatMap((k) => [south(k), north(k)]);
    expect(stopIds(planRoute(origin, southFirst, { roundTrip: false }))).toEqual(['s1', 's2', 's3', 's4', 's5', 'n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('all stops at home: zero-length route in input order', () => {
    const here = Array.from({ length: 10 }, (_, i) => ({ id: `h${i}`, name: `H${i}`, location: { ...origin } }));
    const reversed = [...here].reverse();
    const plan = planRoute(origin, reversed);
    expect(stopIds(plan)).toEqual(ids(reversed));
    expect([plan.totalDistanceKm, plan.totalDurationMin, plan.returnDistanceKm]).toEqual([0, 0, 0]);
  });
});

describe('planRoute: exact and heuristic both hold at the boundary', () => {
  it('8 stops is exact (the brute-force optimum); 9 stops uses the heuristic and stays valid', () => {
    const random = prng(89);
    for (let instance = 0; instance < 10; instance += 1) {
      const eight = randomStores(random, 8);
      expect(planLength(planRoute(ROUTE_HOME, eight))).toBeCloseTo(optimalLength(ROUTE_HOME, eight, true), 9);
      const nine = [...eight, ...randomStores(random, 1, 'z')];
      const plan = planRoute(ROUTE_HOME, nine);
      expectPermutationOf(plan, nine);
      expect(planLength(plan)).toBeGreaterThanOrEqual(optimalLength(ROUTE_HOME, nine, true) - 1e-9);
      expect(planLength(plan)).toBeLessThanOrEqual(nearestNeighbourLength(ROUTE_HOME, nine, true) + 1e-9);
    }
  });

  it.each([
    ['driving', true],
    ['driving', false],
    ['walking', true],
    ['walking', false],
  ] as const)('no stores (%s, roundTrip %s): no stops, zero totals', (mode, roundTrip) => {
    expect(planRoute(ROUTE_HOME, [], { mode, roundTrip })).toEqual({
      mode,
      origin: ROUTE_HOME,
      stops: [],
      roundTrip,
      returnDistanceKm: 0,
      totalDistanceKm: 0,
      totalDurationMin: 0,
    });
  });
});

describe('planRoute beyond 8 stops: return leg, durations and rounding', () => {
  // Ten stops due east along the equator, 1.004 km apart (as in the 3-stop rounding test above).
  const kmPerDegree = (EARTH_RADIUS_KM * Math.PI) / 180;
  const east = (km: number) => ({ lat: 0, lng: km / kmPerDegree });
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: `e${i + 1}`, name: `E${i + 1}`, location: east(1.004 * (i + 1)) }));

  it('one way: returnDistanceKm 0, legs 1.00 km / 2 min each, total 10.04 km / 15 min from unrounded legs', () => {
    const plan = planRoute({ lat: 0, lng: 0 }, [...ten].reverse(), { roundTrip: false });
    expect(stopIds(plan)).toEqual(ten.map((store) => store.id));
    expect(plan.stops.every((stop) => stop.legDistanceKm === 1 && stop.legDurationMin === 2)).toBe(true);
    expect(plan.returnDistanceKm).toBe(0);
    expect(plan.totalDistanceKm).toBe(10.04); // the rounded legs add up to 10.00
    expect(plan.totalDurationMin).toBe(15); // 10.04 km at 40 km/h = 15.06 min; the rounded legs add up to 20
  });

  it('round trip: the return leg is added to the totals and reported as returnDistanceKm', () => {
    const plan = planRoute({ lat: 0, lng: 0 }, ten);
    expect(plan.returnDistanceKm).toBe(10.04);
    expect(plan.totalDistanceKm).toBe(20.08);
    expect(plan.totalDurationMin).toBe(30); // 20.08 km x 1.5 min/km = 30.12
    const walking = planRoute({ lat: 0, lng: 0 }, ten, { mode: 'walking' });
    expect(walking.totalDurationMin).toBe(241); // 20.08 km x 12 min/km = 240.96
    expect(walking.stops.every((stop) => stop.legDurationMin === 12)).toBe(true); // 1.004 km x 12 = 12.05
  });

  it('12-stop fixture: total = sum of unrounded legs + return leg, rounded once', () => {
    for (const roundTrip of [true, false]) {
      const plan = planRoute(ROUTE_HOME, ROUTE_STOPS_12, { roundTrip });
      const last = plan.stops[plan.stops.length - 1].location;
      expect(plan.returnDistanceKm).toBe(roundTrip ? roundTo(haversineKm(last, ROUTE_HOME), 2) : 0);
      expect(plan.totalDistanceKm).toBe(roundTo(planLength(plan), 2));
      expectConsistentPlan(plan, ROUTE_HOME, ROUTE_STOPS_12, 'driving', roundTrip);
    }
  });
});
