/**
 * Golden dataset: the reference price-comparison spreadsheet (16 SKUs x 8 supermarkets).
 * The seed data's latest price snapshot reproduces these prices exactly, and the tests
 * assert that the comparison engine returns the spreadsheet's totals.
 */

export interface GoldenChain {
  id: string;
  name: string;
}

export interface GoldenProduct {
  sku: string;
  name: string;
  /** Prices in GOLDEN_CHAINS order (Supermarket 1 to 8). */
  prices: number[];
}

export const GOLDEN_CHAINS: GoldenChain[] = [
  { id: 'freshmart', name: 'FreshMart' },
  { id: 'valugrocer', name: 'ValuGrocer' },
  { id: 'greenleaf', name: 'GreenLeaf Market' },
  { id: 'harvest', name: 'Harvest Foods' },
  { id: 'citypantry', name: 'City Pantry' },
  { id: 'budgetbasket', name: 'Budget Basket' },
  { id: 'cornercoop', name: 'Corner Co-op' },
  { id: 'sunrise', name: 'Sunrise Market' },
];

export const GOLDEN_PRODUCTS: GoldenProduct[] = [
  { sku: 'GS-001', name: 'Whole Milk 1 gal', prices: [3.2, 2.99, 3.21, 3.6, 3.19, 3.12, 3.46, 4.01] },
  { sku: 'GS-002', name: 'Extra Virgin Olive Oil 1 L', prices: [17.25, 16.14, 16.0, 18.13, 14.9, 14.2, 18.9, 15.2] },
  { sku: 'GS-003', name: 'Chicken Breast 2 lb', prices: [12.33, 13.7, 14.03, 13.9, 14.03, 13.9, 9.13, 10.0] },
  { sku: 'GS-004', name: 'Ground Beef 2 lb', prices: [14.03, 13.9, 12.0, 12.33, 15.03, 17.9, 13.9, 13.0] },
  { sku: 'GS-005', name: 'Cheddar Cheese 1 lb', prices: [9.13, 10.9, 8.8, 10.2, 11.13, 7.99, 14.32, 12.0] },
  { sku: 'GS-006', name: 'Large Eggs dozen', prices: [4.99, 5.0, 5.99, 9.13, 4.5, 6.2, 6.0, 4.3] },
  { sku: 'GS-007', name: 'Ground Coffee 12 oz', prices: [8.17, 9.13, 12.33, 8.5, 7.99, 10.0, 9.13, 11.0] },
  { sku: 'GS-008', name: 'Butter 1 lb', prices: [5.99, 4.99, 3.9, 7.0, 4.35, 5.0, 6.12, 5.5] },
  { sku: 'GS-009', name: 'Laundry Detergent 64 oz', prices: [10.0, 11.03, 11.9, 14.03, 9.99, 13.9, 10.0, 9.0] },
  { sku: 'GS-010', name: 'Toilet Paper 12 rolls', prices: [9.12, 13.0, 10.5, 10.5, 6.89, 11.2, 10.9, 8.9] },
  { sku: 'GS-011', name: 'Bananas 1 lb', prices: [1.09, 2.07, 2.2, 2.9, 4.99, 3.1, 3.18, 1.5] },
  { sku: 'GS-012', name: 'Salmon Fillet 1 lb', prices: [8.12, 10.5, 9.13, 7.9, 11.03, 10.0, 7.99, 8.5] },
  { sku: 'GS-013', name: 'Whole Wheat Bread', prices: [3.79, 4.99, 5.99, 5.5, 4.0, 4.12, 5.0, 3.9] },
  { sku: 'GS-014', name: 'Orange Juice 52 oz', prices: [6.2, 9.13, 5.5, 5.99, 7.0, 6.9, 5.9, 6.8] },
  { sku: 'GS-015', name: 'Diapers 60 count', prices: [17.9, 15.5, 14.99, 21.0, 19.0, 18.2, 16.99, 17.0] },
  { sku: 'GS-016', name: 'Pasta Sauce 24 oz', prices: [4.2, 4.3, 5.2, 3.9, 4.0, 4.5, 6.0, 4.0] },
];

/** Expected results for a basket holding one unit of each of the 16 products. */
export const GOLDEN_EXPECTED = {
  /** "Total cost" row, per supermarket. */
  storeTotals: [135.51, 147.27, 141.67, 154.51, 142.02, 150.23, 146.92, 134.61],
  /** "Comp optimal": store total minus the optimal split total. */
  vsOptimal: [19.95, 31.71, 26.11, 38.95, 26.46, 34.67, 31.36, 19.05],
  vsOptimalPct: [17.26, 27.44, 22.59, 33.71, 22.9, 30.0, 27.14, 16.48],
  /** "Comp lower": store total minus the cheapest single store total. */
  vsCheapestStore: [0.9, 12.66, 7.06, 19.9, 7.41, 15.62, 12.31, 0],
  vsCheapestStorePct: [0.67, 9.4, 5.24, 14.78, 5.5, 11.6, 9.14, 0],
  /** Totals row: Average, High, Low, Economia, %. */
  averageTotal: 144.09,
  highTotal: 182.79,
  optimalTotal: 115.56,
  savings: 28.53,
  savingsPct: 19.8,
  cheapestChainId: 'sunrise',
  /** Per-row Average / High / Low / Economia / %, in GOLDEN_PRODUCTS order. */
  rows: [
    { average: 3.35, high: 4.01, low: 2.99, savings: 0.36, savingsPct: 10.68 },
    { average: 16.34, high: 18.9, low: 14.2, savings: 2.14, savingsPct: 13.1 },
    { average: 12.63, high: 14.03, low: 9.13, savings: 3.5, savingsPct: 27.7 },
    { average: 14.01, high: 17.9, low: 12.0, savings: 2.01, savingsPct: 14.35 },
    { average: 10.56, high: 14.32, low: 7.99, savings: 2.57, savingsPct: 24.33 },
    { average: 5.76, high: 9.13, low: 4.3, savings: 1.46, savingsPct: 25.4 },
    { average: 9.53, high: 12.33, low: 7.99, savings: 1.54, savingsPct: 16.17 },
    { average: 5.36, high: 7.0, low: 3.9, savings: 1.46, savingsPct: 27.19 },
    { average: 11.23, high: 14.03, low: 9.0, savings: 2.23, savingsPct: 19.87 },
    { average: 10.13, high: 13.0, low: 6.89, savings: 3.24, savingsPct: 31.96 },
    { average: 2.63, high: 4.99, low: 1.09, savings: 1.54, savingsPct: 58.54 },
    { average: 9.15, high: 11.03, low: 7.9, savings: 1.25, savingsPct: 13.63 },
    { average: 4.66, high: 5.99, low: 3.79, savings: 0.87, savingsPct: 18.69 },
    { average: 6.68, high: 9.13, low: 5.5, savings: 1.18, savingsPct: 17.63 },
    { average: 17.57, high: 21.0, low: 14.99, savings: 2.58, savingsPct: 14.7 },
    { average: 4.51, high: 6.0, low: 3.9, savings: 0.61, savingsPct: 13.57 },
  ],
};
