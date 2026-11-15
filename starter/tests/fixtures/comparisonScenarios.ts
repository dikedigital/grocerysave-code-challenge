/**
 * Small compareBasket inputs for the cases that break naive implementations. Used by the unit tests
 * (src/utils/__tests__/comparison.test.ts) and by tests/manual/compare-edge.ts, so both look at the
 * same data. Prices are chosen so every expected figure can be checked by hand.
 */
import type { BasketLine, PriceTable, Store } from '../../src/models';

export function store(id: string, chainId = id): Store {
  return {
    id,
    chainId,
    chainName: chainId.toUpperCase(),
    name: `Store ${id.toUpperCase()}`,
    address: '',
    city: '',
    location: { lat: 0, lng: 0 },
  };
}

export function line(key: string, productId: string | null, quantity = 1): BasketLine {
  return { key, label: key, quantity, productId };
}

export interface Scenario {
  title: string;
  lines: BasketLine[];
  stores: Store[];
  prices: PriceTable;
}

const A = store('a');
const B = store('b');
const C = store('c');

export const SCENARIOS = {
  /** C sells no eggs. Its total (3.50) is the lowest, but it is incomplete. */
  storeMissingItem: {
    title: 'A store that does not sell one item (C has no eggs)',
    lines: [line('milk', 'p-milk'), line('eggs', 'p-eggs'), line('bread', 'p-bread')],
    stores: [A, B, C],
    prices: {
      'p-milk': { a: 3.0, b: 2.5, c: 2.0 },
      'p-eggs': { a: 4.0, b: 4.5 },
      'p-bread': { a: 2.0, b: 2.2, c: 1.5 },
    },
  },

  /** One item matched no product; another has a product that nobody (in the list) sells. */
  unmatchedItem: {
    title: 'An item with no product (and one whose product nobody sells)',
    lines: [line('milk', 'p-milk'), line('mystery', null), line('discontinued', 'p-gone'), line('milk-2', 'p-milk')],
    stores: [A, B],
    prices: { 'p-milk': { a: 3.0, b: 2.5 } },
  },

  /** Quantities other than 1, including the ones where binary floats drift. */
  quantities: {
    title: 'Quantities of 3 (and 1.5, 0.333)',
    lines: [line('milk', 'p-milk', 3), line('rice', 'p-rice', 1.5), line('cheese', 'p-cheese', 0.333)],
    stores: [A, B],
    prices: {
      'p-milk': { a: 4.35, b: 3.99 }, // x 3: 13.05 and 11.97 (in binary, 4.35 * 3 = 13.049999999999999)
      'p-rice': { a: 1.99, b: 2.1 }, // x 1.5: 2.985 -> 2.99 (half away), 3.15
      'p-cheese': { a: 3.2, b: 3.0 }, // x 0.333: 1.0656 -> 1.07, 0.999 -> 1.00
    },
  },

  noStores: {
    title: 'No stores',
    lines: [line('milk', 'p-milk'), line('mystery', null)],
    stores: [],
    prices: { 'p-milk': { a: 3.0 } },
  },

  noLines: {
    title: 'No lines (an empty list)',
    lines: [],
    stores: [A, B],
    prices: { 'p-milk': { a: 3.0, b: 2.5 } },
  },

  /** A and B charge the same for both items, so they tie on the row lows and on the total. */
  tiedStores: {
    title: 'Two stores tied on price (A and B)',
    lines: [line('milk', 'p-milk'), line('eggs', 'p-eggs')],
    stores: [A, B, C],
    prices: {
      'p-milk': { a: 2.5, b: 2.5, c: 3.0 }, // row low 2.50 at A and B
      'p-eggs': { a: 4.5, b: 4.5, c: 4.25 }, // totals: A 7.00, B 7.00, C 7.25
    },
  },

  /** Z is not in the list: its (much cheaper) prices must not count anywhere. */
  unlistedStorePrices: {
    title: 'Prices supplied for a store that is not in the list (Z)',
    lines: [line('milk', 'p-milk'), line('caviar', 'p-caviar')],
    stores: [A, B],
    prices: {
      'p-milk': { a: 3.0, b: 2.5, z: 0.01 },
      'p-caviar': { z: 99.0 }, // sold only by Z
    },
  },

  /** Every store lacks something. */
  noCompleteStore: {
    title: 'No store sells everything',
    lines: [line('milk', 'p-milk'), line('eggs', 'p-eggs')],
    stores: [A, B],
    prices: { 'p-milk': { a: 3.0 }, 'p-eggs': { b: 4.0 } },
  },

  /** A price that is not a number must not make a store look free. */
  invalidPrice: {
    title: 'A price that is not a finite number (NaN at A)',
    lines: [line('milk', 'p-milk')],
    stores: [A, B],
    prices: { 'p-milk': { a: Number.NaN, b: 2.5 } },
  },
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof SCENARIOS;
