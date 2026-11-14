import type { Product } from '../models';
import { notImplemented } from './notImplemented';

export interface ProductMatch {
  product: Product;
  /** 1 for an exact name or alias match, otherwise token overlap between 0 and 1. */
  score: number;
}

/** Lower-cases, strips accents and punctuation, collapses whitespace and singularises simple plurals ("Eggs" -> "egg"). */
export function normalizeName(name: string): string {
  return notImplemented(name);
}

/**
 * Finds the catalog product a typed item name refers to.
 * Exact match on the normalised name or any alias scores 1. Otherwise the best token-overlap
 * (Jaccard) score against the name and aliases is used; below `threshold` returns null.
 * Ties go to the product with the shorter name, then the lower sku.
 */
export function matchProduct(
  name: string,
  products: Product[],
  threshold = 0.5
): ProductMatch | null {
  return notImplemented(name, products, threshold);
}
