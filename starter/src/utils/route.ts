import type { LatLng, RoutePlan, RouteStop, Store, TravelMode } from '../models';
import { roundTo } from './money';

/** Average speeds used to turn distance into time. */
export const TRAVEL_SPEED_KMH: Record<TravelMode, number> = { driving: 40, walking: 5 };

/** Mean Earth radius used by every distance in the app (TECH_SPEC 5.5). */
export const EARTH_RADIUS_KM = 6371;

/** Up to this many stops planRoute tries every visiting order (8! = 40 320 orders). */
export const EXACT_ROUTE_MAX_STOPS = 8;

/**
 * Two route lengths closer than this are equal (decision D-29). Reversing a round trip gives the
 * same length, but summing the legs in another order can differ in the last bit; without a
 * tolerance the tie rule would depend on float noise. One micrometre is far below anything real.
 */
export const ROUTE_TIE_TOLERANCE_KM = 1e-9;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometres (Earth radius 6371 km). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  // min(1, ...) guards asin against rounding just above 1 for (nearly) antipodal points.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RouteOptions {
  mode?: TravelMode; // default 'driving'
  roundTrip?: boolean; // default true: return to the origin after the last stop
}

type RouteStore = Pick<Store, 'id' | 'name' | 'location'>;

/** Decision D-30: a point without finite coordinates cannot be routed; never guess a 0 km leg. */
function assertFinitePoint(point: LatLng | null | undefined, what: string): void {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    throw new RangeError(`planRoute: ${what} needs finite lat and lng`);
  }
}

/**
 * Exact search (decision D-28): tries every visiting order of the points 1..n of `dist` starting
 * from point 0, in lexicographic order of input positions, and keeps an order only when it is
 * shorter than the best so far by more than ROUTE_TIE_TOLERANCE_KM. Equally short orders therefore
 * resolve to the one that keeps the input sequence earliest. Returns store positions (0-based).
 */
function exactOrder(dist: number[][], stopCount: number, roundTrip: boolean): number[] {
  const order: number[] = [];
  const used: boolean[] = new Array<boolean>(stopCount).fill(false);
  let best: number[] = [];
  let bestLength = Infinity;

  const visit = (from: number, lengthSoFar: number): void => {
    if (order.length === stopCount) {
      const length = roundTrip ? lengthSoFar + dist[from][0] : lengthSoFar;
      if (length < bestLength - ROUTE_TIE_TOLERANCE_KM) {
        bestLength = length;
        best = order.slice();
      }
      return;
    }
    for (let stop = 0; stop < stopCount; stop += 1) {
      if (used[stop]) continue;
      used[stop] = true;
      order.push(stop);
      visit(stop + 1, lengthSoFar + dist[from][stop + 1]);
      order.pop();
      used[stop] = false;
    }
  };

  visit(0, 0);
  return best;
}

/**
 * Nearest neighbour: from the origin, repeatedly go to the closest unvisited stop. Between equally
 * near stops (within ROUTE_TIE_TOLERANCE_KM) it takes the one earlier in the input. That choice only
 * picks a starting route; the tie rule for equally short orders (D-28) is applied to complete orders
 * by improveOrder and heuristicOrder. Returns store positions (0-based).
 */
function nearestNeighbourOrder(dist: number[][], stopCount: number): number[] {
  const visited: boolean[] = new Array<boolean>(stopCount).fill(false);
  const order: number[] = [];
  let from = 0;
  while (order.length < stopCount) {
    let next = -1;
    let nextKm = Infinity;
    for (let stop = 0; stop < stopCount; stop += 1) {
      if (!visited[stop] && dist[from][stop + 1] < nextKm - ROUTE_TIE_TOLERANCE_KM) {
        next = stop;
        nextKm = dist[from][stop + 1];
      }
    }
    visited[next] = true;
    order.push(next);
    from = next + 1;
  }
  return order;
}

/** Total length of a visiting order (store positions), origin first, with the return leg if any. */
function orderLength(dist: number[][], order: number[], roundTrip: boolean): number {
  let total = 0;
  let from = 0;
  for (const stop of order) {
    total += dist[from][stop + 1];
    from = stop + 1;
  }
  return roundTrip ? total + dist[from][0] : total;
}

/** Reverses order[first..last] in place. */
function reverseRun(order: number[], first: number, last: number): void {
  for (let i = first, j = last; i < j; i += 1, j -= 1) [order[i], order[j]] = [order[j], order[i]];
}

/**
 * 2-opt with the tie rule (decisions D-35, D-28), in place. A move reverses the run of stops
 * first..last: the legs (before, first) and (last, after) become (before, last) and (first, after);
 * one way, a run ending at the final stop has no "after", so only its first leg changes.
 *
 * 1. Shorter: every reversal that shortens the route by more than ROUTE_TIE_TOLERANCE_KM is applied,
 *    scanning (first, last) in ascending order, in passes until none is left.
 * 2. Equally short: a reversal that leaves the length unchanged (within the tolerance) is applied
 *    when it keeps the input sequence earlier. The reversed order differs first at position
 *    `first`, where it puts order[last] instead of order[first], so that is the case exactly when
 *    order[last] < order[first]. Reversing the whole round trip is one such move, so a round trip
 *    runs in the direction that keeps the input sequence.
 * Both steps repeat until neither changes anything.
 *
 * Termination: an equally short move must keep the recomputed length within the tolerance of the
 * shortest length seen so far, and makes the order strictly earlier in input sequence; a shorter
 * move lowers the shortest length seen. Neither can repeat forever over finitely many orders.
 */
function improveOrder(dist: number[][], order: number[], roundTrip: boolean): void {
  const n = order.length;
  const point = (position: number) => (position < 0 || position >= n ? 0 : order[position] + 1); // 0: origin
  const lengthChange = (first: number, last: number) => {
    const before = point(first - 1);
    const hasAfter = roundTrip || last < n - 1;
    const after = point(last + 1);
    const removed = dist[before][point(first)] + (hasAfter ? dist[point(last)][after] : 0);
    const added = dist[before][point(last)] + (hasAfter ? dist[point(first)][after] : 0);
    return added - removed;
  };

  let shortest = orderLength(dist, order, roundTrip);
  let changed = true;
  while (changed) {
    changed = false;

    let improved = true;
    while (improved) {
      improved = false;
      for (let first = 0; first < n - 1; first += 1) {
        for (let last = first + 1; last < n; last += 1) {
          if (lengthChange(first, last) < -ROUTE_TIE_TOLERANCE_KM) {
            reverseRun(order, first, last);
            improved = changed = true;
          }
        }
      }
    }
    shortest = Math.min(shortest, orderLength(dist, order, roundTrip));

    for (let first = 0; first < n - 1; first += 1) {
      for (let last = first + 1; last < n; last += 1) {
        if (order[last] > order[first] || Math.abs(lengthChange(first, last)) > ROUTE_TIE_TOLERANCE_KM) continue;
        reverseRun(order, first, last);
        if (orderLength(dist, order, roundTrip) <= shortest + ROUTE_TIE_TOLERANCE_KM) {
          changed = true;
        } else {
          reverseRun(order, first, last); // float drift would take it past the tolerance: undo
        }
      }
    }
  }
}

/**
 * Heuristic for more than EXACT_ROUTE_MAX_STOPS stops: nearest neighbour, then 2-opt with the tie
 * rule (improveOrder). Finally, the input order itself is compared with the result: when it is
 * equally short, it is returned (D-28: equally short orders keep the input sequence). Never longer
 * than plain nearest neighbour; not guaranteed optimal.
 */
function heuristicOrder(dist: number[][], stopCount: number, roundTrip: boolean): number[] {
  const order = nearestNeighbourOrder(dist, stopCount);
  improveOrder(dist, order, roundTrip);
  const inputOrder = order.map((_, position) => position);
  const inputLength = orderLength(dist, inputOrder, roundTrip);
  if (Math.abs(inputLength - orderLength(dist, order, roundTrip)) <= ROUTE_TIE_TOLERANCE_KM) return inputOrder;
  return order;
}

/**
 * Orders the stores to minimise total travel distance starting from `origin`.
 * Exact (tries every order) for up to 8 stores; nearest-neighbour followed by 2-opt beyond that.
 * Distances are straight-line (haversine); durations use TRAVEL_SPEED_KMH.
 * Distances are rounded to 2 decimals and durations to whole minutes in the returned plan;
 * totals are computed from unrounded legs and then rounded.
 * Ties between equally short orders go to the order that keeps the input sequence earliest
 * (decision D-28; for the heuristic, among the orders it compares: D-38).
 * With no stores the plan has no stops and zero totals.
 *
 * The heuristic (9 stops or more) is not guaranteed optimal, but never longer than plain nearest
 * neighbour. Throws RangeError for non-finite coordinates or an unknown mode (decision D-30).
 */
export function planRoute(origin: LatLng, stores: RouteStore[], options: RouteOptions = {}): RoutePlan {
  const mode: TravelMode = options.mode ?? 'driving';
  const roundTrip = options.roundTrip ?? true;
  if (!Object.prototype.hasOwnProperty.call(TRAVEL_SPEED_KMH, mode)) {
    throw new RangeError(`planRoute: unknown travel mode ${JSON.stringify(mode)}`);
  }
  assertFinitePoint(origin, 'the origin');
  stores.forEach((store, index) => assertFinitePoint(store?.location, `store ${index} (${store?.id})`));

  const speedKmh = TRAVEL_SPEED_KMH[mode];
  const minutes = (km: number) => (km / speedKmh) * 60;

  // Point 0 is the origin, point i + 1 is stores[i]. haversineKm is symmetric, so each pair is
  // computed once and both directions hold the identical number.
  const points: LatLng[] = [origin, ...stores.map((store) => store.location)];
  const dist: number[][] = points.map(() => new Array<number>(points.length).fill(0));
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      dist[i][j] = dist[j][i] = haversineKm(points[i], points[j]);
    }
  }

  const order =
    stores.length <= EXACT_ROUTE_MAX_STOPS
      ? exactOrder(dist, stores.length, roundTrip)
      : heuristicOrder(dist, stores.length, roundTrip);

  let previous = 0;
  let totalKm = 0;
  const stops: RouteStop[] = order.map((storeIndex) => {
    const store = stores[storeIndex];
    const legKm = dist[previous][storeIndex + 1];
    totalKm += legKm;
    previous = storeIndex + 1;
    return {
      storeId: store.id,
      name: store.name,
      location: { lat: store.location.lat, lng: store.location.lng },
      legDistanceKm: roundTo(legKm, 2),
      legDurationMin: roundTo(minutes(legKm), 0),
    };
  });
  const returnKm = roundTrip ? dist[previous][0] : 0;
  totalKm += returnKm;

  return {
    mode,
    origin: { lat: origin.lat, lng: origin.lng },
    stops,
    roundTrip,
    returnDistanceKm: roundTo(returnKm, 2),
    totalDistanceKm: roundTo(totalKm, 2),
    totalDurationMin: roundTo(minutes(totalKm), 0),
  };
}
