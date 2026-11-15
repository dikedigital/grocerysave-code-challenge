import type { Product } from '../../../src/models';
import { matchProduct, type ProductMatch } from '../../../src/utils/matching';

/**
 * Minimum score for the API to link a list item to a catalog product. Stricter than the 0.5 default
 * of matchProduct (TECH_SPEC 5.2) by design decision: at exactly 0.5, a two-word name whose only
 * shared word is a one-word alias matched the wrong product ("almond milk" -> Whole Milk via the
 * alias "milk", "chicken thighs" -> Chicken Breast, "rice cakes" -> Long Grain Rice) and was then
 * priced as that product. The cost: a one-word partial name no longer matches ("olive" no longer
 * finds the olive oil); exact names and aliases still score 1 and always match.
 */
export const CATALOG_MATCH_THRESHOLD = 0.51;

/** The catalog product a list item name refers to, as the API matches it; null when none. */
export function matchCatalogItem(name: string, products: Product[]): ProductMatch | null {
  return matchProduct(name, products, CATALOG_MATCH_THRESHOLD);
}
