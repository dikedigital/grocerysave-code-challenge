/**
 * Shows how optimizePurchase ranks plans (TECH_SPEC 5.4, decision D-47), on small scenarios. For each
 * scenario it lists every candidate plan (one per set of stores: each item at the cheapest store of
 * the set, ties to the store listed first, stores buying nothing dropped), sorted by the ranking,
 * with the criterion that puts each plan below the one above it. Then it checks that optimizePurchase
 * returns the top plan as bestPlan and the top one-store plan as cheapestSingleStore. Exits 1 if not.
 *
 *   npx tsx tests/manual/optimize-ranking.ts
 */
import type { BasketLine, LatLng, PriceTable, Store } from '../../src/models';
import { fromCents, toCents } from '../../src/utils/money';
import { optimizePurchase } from '../../src/utils/optimizer';
import { haversineKm, planRoute } from '../../src/utils/route';

const home: LatLng = { lat: 0, lng: 0 };
const kmPerDegree = (6371 * Math.PI) / 180;
/** A store `km` kilometres north of home. */
const storeAt = (id: string, km: number): Store => ({ id, chainId: id, chainName: id, name: id, address: '', city: '', location: { lat: km / kmPerDegree, lng: 0 } });
const item = (key: string): BasketLine => ({ key, label: key, quantity: 1, productId: key });

interface Scenario { title: string; point: string; stores: Store[]; lines: BasketLine[]; prices: PriceTable; rate: number; maxStores: number }

const scenarios: Scenario[] = [
  {
    title: '1. A plan that cannot buy every item never beats one that can',
    point: 'Near sells milk and bread for 2.00 and is 0.5 km away, but has no coffee. Far has all three for 12.00 and is 20 km away. maxStores 1.',
    stores: [storeAt('near', 0.5), storeAt('far', 20)],
    lines: [item('milk'), item('bread'), item('coffee')],
    prices: { milk: { near: 1, far: 2 }, bread: { near: 1, far: 2 }, coffee: { far: 8 } },
    rate: 0.35,
    maxStores: 1,
  },
  {
    title: '2. Same stores, maxStores 2: buying at both is complete and cheapest',
    point: 'Milk and bread at near, coffee at far: every item, and cheaper than far alone.',
    stores: [storeAt('near', 0.5), storeAt('far', 20)],
    lines: [item('milk'), item('bread'), item('coffee')],
    prices: { milk: { near: 1, far: 2 }, bread: { near: 1, far: 2 }, coffee: { far: 8 } },
    rate: 0.35,
    maxStores: 2,
  },
  {
    title: '3. Equal grand totals: fewer stores wins',
    point: 'c sells milk 1.00 and eggs 2.00 (3.00); a has milk at 1.00, b eggs at 2.00. c alone, {a, b} and {a, c} all cost 3.00: c wins with one store; between the two-store plans, {a, b} (positions 1, 2) beats {a, c} (1, 3). Travel is free (0 per km) so that the totals really tie.',
    stores: [storeAt('a', 1), storeAt('b', 2), storeAt('c', 3)],
    lines: [item('milk'), item('eggs')],
    prices: { milk: { a: 1, c: 1 }, eggs: { b: 2, c: 2 } },
    rate: 0,
    maxStores: 3,
  },
  {
    title: '4. Equal totals and store counts: the stores listed earliest win',
    point: 'a and b have identical prices, c is cheap for eggs: {a, c} and {b, c} cost the same with two stores each, and positions (1, 3) beat (2, 3). The three one-store plans all cost 8.00: a, listed first, is cheapestSingleStore.',
    stores: [storeAt('a', 1), storeAt('b', 1), storeAt('c', 1)],
    lines: [item('milk'), item('eggs'), item('tea')],
    prices: { milk: { a: 1, b: 1, c: 5 }, eggs: { a: 5, b: 5, c: 1 }, tea: { a: 2, b: 2, c: 2 } },
    rate: 0,
    maxStores: 2,
  },
  {
    title: '5. Travel: a saving smaller than the detour is not worth it',
    point: 'far sells the TV 6.00 cheaper, but is 10 km beyond near: 20 km more there and back, 7.00 at 0.35 per km.',
    stores: [storeAt('near', 1), storeAt('far', 11)],
    lines: [item('milk'), item('tv')],
    prices: { milk: { near: 2, far: 2 }, tv: { near: 100, far: 94 } },
    rate: 0.35,
    maxStores: 2,
  },
];

const money = (cents: number) => fromCents(cents).toFixed(2);
let failures = 0;

for (const sc of scenarios) {
  const n = sc.stores.length;
  interface Cand { set: string[]; used: number[]; order: string[]; unavailable: number; items: number; km: number; travel: number; grand: number }
  const cands = new Map<string, Cand>();
  for (let mask = 1; mask < 1 << n; mask += 1) {
    const subset = [...Array(n).keys()].filter((i) => mask & (1 << i));
    if (subset.length > sc.maxStores) continue;
    let unavailable = 0;
    let items = 0;
    const used = new Set<number>();
    for (const l of sc.lines) {
      let bestStore = -1;
      for (const s of subset) {
        const p = sc.prices[l.productId!][sc.stores[s].id];
        if (p === undefined) continue;
        if (bestStore === -1 || toCents(p) < toCents(sc.prices[l.productId!][sc.stores[bestStore].id])) bestStore = s;
      }
      if (bestStore === -1) unavailable += 1;
      else { used.add(bestStore); items += toCents(sc.prices[l.productId!][sc.stores[bestStore].id]); }
    }
    const u = [...used].sort((a, b) => a - b);
    const route = planRoute(home, u.map((i) => sc.stores[i]));
    const travel = toCents(route.totalDistanceKm * sc.rate);
    cands.set(u.join(','), { set: subset.map((i) => sc.stores[i].id), used: u, order: route.stops.map((s) => s.storeId), unavailable, items, km: route.totalDistanceKm, travel, grand: items + travel });
  }
  const why = (a: Cand, b: Cand) =>
    a.unavailable !== b.unavailable ? 'more items missing' :
    a.grand !== b.grand ? 'higher grand total' :
    a.used.length !== b.used.length ? 'same total, more stores' :
    'same total and stores, listed later';
  const cmp = (a: Cand, b: Cand) => a.unavailable - b.unavailable || a.grand - b.grand || a.used.length - b.used.length ||
    (a.used.find((v, i) => v !== b.used[i]) ?? 0) - (b.used.find((v, i) => v !== a.used[i]) ?? 0);
  const ranked = [...cands.values()].sort(cmp);

  console.log(`### ${sc.title}\n\n${sc.point}\n`);
  console.log(`Stores (km from home): ${sc.stores.map((s) => `${s.id} ${haversineKm(home, s.location).toFixed(1)}`).join(', ')}; ${sc.rate.toFixed(2)} per km; maxStores ${sc.maxStores}.\n`);
  console.log('| Rank | Stores visited | Missing items | Items | km | Travel | Grand total | Below the one above because |');
  console.log('|---:|---|---:|---:|---:|---:|---:|---|');
  ranked.forEach((c, i) => console.log(`| ${i + 1} | ${c.order.join(' → ') || '(none)'} | ${c.unavailable} | ${money(c.items)} | ${c.km.toFixed(2)} | ${money(c.travel)} | ${money(c.grand)} | ${i === 0 ? '**best**' : why(c, ranked[i - 1])} |`));

  const result = optimizePurchase(sc.lines, sc.stores, sc.prices, { maxStores: sc.maxStores, travelCostPerKm: sc.rate, travelMode: 'driving', home });
  const single = ranked.filter((c) => c.set.length === 1 || c.used.length <= 1).sort(cmp)[0];
  const okBest = JSON.stringify(result.bestPlan!.storeIds) === JSON.stringify(ranked[0].order) && toCents(result.bestPlan!.grandTotal) === ranked[0].grand;
  const okSingle = JSON.stringify(result.cheapestSingleStore!.storeIds) === JSON.stringify(single.order);
  if (!okBest || !okSingle) failures += 1;
  console.log(`\noptimizePurchase: bestPlan ${JSON.stringify(result.bestPlan!.storeIds)} ${result.bestPlan!.grandTotal.toFixed(2)} ` +
    `(missing ${JSON.stringify(result.bestPlan!.unavailableKeys)}) ${okBest ? 'OK' : 'MISMATCH'}; ` +
    `cheapestSingleStore ${JSON.stringify(result.cheapestSingleStore!.storeIds)} ${okSingle ? 'OK' : 'MISMATCH'}; ` +
    `byStoreCount ${JSON.stringify(result.byStoreCount.map((p) => p.storeIds))}\n`);
}
console.log(`RANKING SCENARIOS: ${scenarios.length - failures} OK, ${failures} mismatched`);
process.exit(failures ? 1 : 0);
