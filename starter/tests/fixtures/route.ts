/**
 * Route-planning fixtures. Coordinates are copied from data/stores.csv (Port Marlowe); ROUTE_HOME is
 * a made-up home near the town centre.
 *
 * ROUTE_STOPS_5 is deliberately listed in a poor order (39.57 km as a round trip from home), so a
 * planner that keeps the input order fails. By brute force over all 120 orders (see route.test.ts):
 * - round trip: citypantry > greenleaf > harvest > valugrocer > budgetbasket, 27.00 km (its exact
 *   reverse is equally short; the tie rule picks this one because citypantry is first in the input);
 * - one way: the same order, 22.58 km (the reverse is not optimal one way).
 */
import type { LatLng, Store } from '../../src/models';

export type RouteStore = Pick<Store, 'id' | 'name' | 'location'>;

export const ROUTE_HOME: LatLng = { lat: 29.2, lng: -81.05 };

/** All 8 stores of data/stores.csv, in file order. */
export const PORT_MARLOWE_STORES: RouteStore[] = [
  { id: 'store-freshmart', name: 'FreshMart Beacon Street', location: { lat: 29.2105, lng: -81.0312 } },
  { id: 'store-valugrocer', name: 'ValuGrocer Westgate', location: { lat: 29.1873, lng: -81.0921 } },
  { id: 'store-greenleaf', name: 'GreenLeaf Market Old Town', location: { lat: 29.2251, lng: -81.0228 } },
  { id: 'store-harvest', name: 'Harvest Foods Lakeside', location: { lat: 29.2418, lng: -81.0764 } },
  { id: 'store-citypantry', name: 'City Pantry Downtown', location: { lat: 29.2012, lng: -81.0189 } },
  { id: 'store-budgetbasket', name: 'Budget Basket Southside', location: { lat: 29.1602, lng: -81.0497 } },
  { id: 'store-cornercoop', name: 'Corner Co-op Mill Lane', location: { lat: 29.2156, lng: -81.0583 } },
  { id: 'store-sunrise', name: 'Sunrise Market Harbor View', location: { lat: 29.1798, lng: -81.0143 } },
];

const byId = (id: string): RouteStore => {
  const store = PORT_MARLOWE_STORES.find((candidate) => candidate.id === id);
  if (!store) throw new Error(`no fixture store ${id}`);
  return store;
};

/** Five stops, in the (poor) order a caller might pass them. */
export const ROUTE_STOPS_5: RouteStore[] = [
  'store-citypantry',
  'store-harvest',
  'store-budgetbasket',
  'store-greenleaf',
  'store-valugrocer',
].map(byId);

/** The optimal order of ROUTE_STOPS_5 from ROUTE_HOME (round trip and one way alike). */
export const ROUTE_STOPS_5_BEST_ORDER = [
  'store-citypantry',
  'store-greenleaf',
  'store-harvest',
  'store-valugrocer',
  'store-budgetbasket',
];

/**
 * Four FICTIONAL stores (not in data/stores.csv), placed around Port Marlowe so that, with the 8 real
 * stores, a 12-stop trip is big enough for the heuristic (more than 8 stops) and nearest neighbour
 * alone is clearly beaten by 2-opt. Chosen by a seeded search; see docs/DECISIONS.md D-37.
 */
export const FICTIONAL_STORES: RouteStore[] = [
  { id: 'extra-seaside', name: 'Seaside Grocer (fictional)', location: { lat: 29.1667, lng: -81.0102 } },
  { id: 'extra-westfield', name: 'Westfield Foods (fictional)', location: { lat: 29.1789, lng: -81.0826 } },
  { id: 'extra-northridge', name: 'Northridge Market (fictional)', location: { lat: 29.2493, lng: -81.0947 } },
  { id: 'extra-pinecrest', name: 'Pinecrest Pantry (fictional)', location: { lat: 29.1946, lng: -81.0973 } },
];

/** Twelve stops for the heuristic: the last four real stores, the fictional ones, the first four. */
export const ROUTE_STOPS_12: RouteStore[] = [
  ...PORT_MARLOWE_STORES.slice(4),
  ...FICTIONAL_STORES,
  ...PORT_MARLOWE_STORES.slice(0, 4),
];
