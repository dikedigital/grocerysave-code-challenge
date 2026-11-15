/**
 * A small product catalog for the matching tests and the manual matching script. It is built to
 * exercise the interesting cases: plurals, accents, several products sharing a word ("olive",
 * "milk", "tomato"), and names that differ only in word order.
 */
import type { Product } from '../../src/models';

function product(sku: string, name: string, category: string, unit: string, aliases: string[]): Product {
  return { id: `p-${sku}`, sku, name, category, unit, aliases };
}

export const TEST_CATALOG: Product[] = [
  product('T-001', 'Whole Milk 1 gal', 'Dairy', 'gal', ['milk', 'whole milk']),
  product('T-002', 'Almond Milk 64 oz', 'Dairy', 'bottle', ['almond milk']),
  product('T-003', 'Large Eggs dozen', 'Dairy', 'dozen', ['eggs', 'large eggs', 'dozen eggs']),
  product('T-004', 'Extra Virgin Olive Oil 1 L', 'Pantry', 'bottle', ['olive oil', 'extra virgin olive oil', 'evoo']),
  product('T-005', 'Green Olives', 'Pantry', 'jar', ['green olives', 'pitted olives']),
  product('T-006', 'Chicken Breast 2 lb', 'Meat & Seafood', 'pack', ['chicken', 'chicken breast', 'boneless chicken breast']),
  product('T-007', 'Ground Coffee 12 oz', 'Beverages', 'bag', ['coffee', 'ground coffee', 'café']),
  product('T-008', 'Roma Tomatoes 1 lb', 'Produce', 'lb', ['tomatoes', 'roma tomatoes']),
  product('T-009', 'Cherry Tomatoes', 'Produce', 'pack', ['cherry tomatoes']),
  product('T-010', 'Tomato Sauce 24 oz', 'Pantry', 'jar', ['tomato sauce', 'marinara']),
  product('T-011', 'Crème Fraîche 8 oz', 'Dairy', 'tub', ['creme fraiche', 'sour cream']),
  product('T-012', 'Bananas 1 lb', 'Produce', 'lb', ['banana']),
];
