/**
 * Small detectDeals inputs, one per behaviour the spec (TECH_SPEC 5.6) and decisions D-39 to D-45
 * pin down. Used by the unit tests (src/utils/__tests__/deals.test.ts) and by
 * tests/manual/deals-cases.ts, so both look at the same data. Every expected figure is worked out
 * by hand in the `why` text; dropPct = (old - new) / old x 100.
 */
import type { Deal, PricePoint } from '../../src/models';

/** A price point; regularPrice equals price unless on sale. */
export function point(storeId: string, productId: string, date: string, price: number, onSale = false, regularPrice = price): PricePoint {
  return { storeId, productId, date, price, regularPrice, onSale };
}

export interface DealScenario {
  title: string;
  why: string;
  thresholdPct: number;
  points: PricePoint[];
  expected: Deal[];
}

const W1 = '2026-10-19';
const W2 = '2026-10-26';
const W3 = '2026-11-02';
const W4 = '2026-11-09';

export const DEAL_SCENARIOS = {
  exactlyAtThreshold: {
    title: 'A drop of exactly the threshold',
    why: '1.00 -> 0.90 is exactly 10%; at threshold 10 it counts. (The float formula gives 9.999999999999998 and would miss it.) 5.00 -> 4.50 is exactly 10% too.',
    thresholdPct: 10,
    points: [point('a', 'milk', W1, 1.0), point('a', 'milk', W2, 0.9), point('a', 'eggs', W1, 5.0), point('a', 'eggs', W2, 4.5)],
    expected: [
      { storeId: 'a', productId: 'eggs', date: W2, oldPrice: 5, newPrice: 4.5, dropPct: 10, onSale: false },
      { storeId: 'a', productId: 'milk', date: W2, oldPrice: 1, newPrice: 0.9, dropPct: 10, onSale: false },
    ],
  },
  justUnderThreshold: {
    title: 'A drop just under the threshold',
    why: '1.00 -> 0.91 is 9%, and 5.00 -> 4.51 is 9.8% (one cent short of 10%): no deal at threshold 10.',
    thresholdPct: 10,
    points: [point('a', 'milk', W1, 1.0), point('a', 'milk', W2, 0.91), point('a', 'eggs', W1, 5.0), point('a', 'eggs', W2, 4.51)],
    expected: [],
  },
  singleSnapshot: {
    title: 'A product with a single snapshot',
    why: 'Only one snapshot of milk at store a (even a very low price) gives nothing to compare: no deal. Eggs at b have two snapshots and drop 50%.',
    thresholdPct: 10,
    points: [point('a', 'milk', W4, 0.01), point('b', 'eggs', W3, 4.0), point('b', 'eggs', W4, 2.0)],
    expected: [{ storeId: 'b', productId: 'eggs', date: W4, oldPrice: 4, newPrice: 2, dropPct: 50, onSale: false }],
  },
  threeSnapshotsNoDeal: {
    title: 'Three snapshots: only the last two matter (no deal)',
    why: '10.00 -> 5.00 -> 4.80. The latest drop is 5.00 -> 4.80 = 4%: no deal, although 10.00 -> 4.80 would be 52%.',
    thresholdPct: 10,
    points: [point('a', 'milk', W1, 10.0), point('a', 'milk', W2, 5.0), point('a', 'milk', W3, 4.8)],
    expected: [],
  },
  threeSnapshotsDeal: {
    title: 'Three snapshots: only the last two matter (deal)',
    why: '4.00 -> 5.00 -> 4.50. The latest drop is 5.00 -> 4.50 = 10%: a deal, although 4.50 is dearer than 4.00 three weeks ago. Points are given out of date order on purpose: dates decide, not input order.',
    thresholdPct: 10,
    points: [point('a', 'milk', W3, 4.5, true, 5.0), point('a', 'milk', W1, 4.0), point('a', 'milk', W2, 5.0)],
    expected: [{ storeId: 'a', productId: 'milk', date: W3, oldPrice: 5, newPrice: 4.5, dropPct: 10, onSale: true }],
  },
  sameDateLastWins: {
    title: 'Two points on the same date: the last one given wins',
    why: 'W2 has 4.00 and then 4.80; the later point (4.80) is the W2 snapshot: 5.00 -> 4.80 = 4%, no deal. For eggs the same two prices come in the other order, so 4.00 wins: 5.00 -> 4.00 = 20%, a deal.',
    thresholdPct: 10,
    points: [
      point('a', 'milk', W1, 5.0), point('a', 'milk', W2, 4.0), point('a', 'milk', W2, 4.8),
      point('a', 'eggs', W1, 5.0), point('a', 'eggs', W2, 4.8), point('a', 'eggs', W2, 4.0),
    ],
    expected: [{ storeId: 'a', productId: 'eggs', date: W2, oldPrice: 5, newPrice: 4, dropPct: 20, onSale: false }],
  },
  sameDateNotTwoSnapshots: {
    title: 'Two points on the same date are one snapshot, not two',
    why: 'Both points are on W2, so the pair has a single snapshot: no deal (it is not compared with itself).',
    thresholdPct: 10,
    points: [point('a', 'milk', W2, 5.0), point('a', 'milk', W2, 2.0)],
    expected: [],
  },
  mixedSortOrder: {
    title: 'Sort order of a mixed result',
    why: 'dropPct descending: 50% first, then 25%, then the 20% ties ordered by productId (bread < milk) and, within milk, by storeId (a < b < c), then 10%. Input is deliberately shuffled. A 5% drop and a rise are left out.',
    thresholdPct: 10,
    points: [
      point('c', 'milk', W1, 5.0), point('c', 'milk', W2, 4.0), // 20%
      point('b', 'tea', W1, 3.0), point('b', 'tea', W2, 2.7), // 10%
      point('b', 'milk', W1, 2.5), point('b', 'milk', W2, 2.0), // 20%
      point('a', 'rice', W1, 4.0), point('a', 'rice', W2, 3.0), // 25%
      point('z', 'bread', W1, 1.0), point('z', 'bread', W2, 0.8), // 20%
      point('a', 'milk', W1, 10.0), point('a', 'milk', W2, 8.0), // 20%
      point('a', 'coffee', W1, 8.0), point('a', 'coffee', W2, 4.0, true, 8.0), // 50%
      point('a', 'soap', W1, 2.0), point('a', 'soap', W2, 1.9), // 5%: under the threshold
      point('b', 'soap', W1, 2.0), point('b', 'soap', W2, 2.2), // a rise
    ],
    expected: [
      { storeId: 'a', productId: 'coffee', date: W2, oldPrice: 8, newPrice: 4, dropPct: 50, onSale: true },
      { storeId: 'a', productId: 'rice', date: W2, oldPrice: 4, newPrice: 3, dropPct: 25, onSale: false },
      { storeId: 'z', productId: 'bread', date: W2, oldPrice: 1, newPrice: 0.8, dropPct: 20, onSale: false },
      { storeId: 'a', productId: 'milk', date: W2, oldPrice: 10, newPrice: 8, dropPct: 20, onSale: false },
      { storeId: 'b', productId: 'milk', date: W2, oldPrice: 2.5, newPrice: 2, dropPct: 20, onSale: false },
      { storeId: 'c', productId: 'milk', date: W2, oldPrice: 5, newPrice: 4, dropPct: 20, onSale: false },
      { storeId: 'b', productId: 'tea', date: W2, oldPrice: 3, newPrice: 2.7, dropPct: 10, onSale: false },
    ],
  },
} satisfies Record<string, DealScenario>;

export type DealScenarioName = keyof typeof DEAL_SCENARIOS;
