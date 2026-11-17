/** The product catalog (TECH_SPEC 3). The list items are matched against all of it (TECH_SPEC 6.3). */
import type { Product } from '../../../src/models';
import type { Queryable } from '../db/pool';

/** Every product, by SKU: one query (about 40 rows in the seeded catalog). */
export async function loadProducts(db: Queryable): Promise<Product[]> {
  const { rows } = await db.query<Product>('SELECT id, sku, name, category, unit, aliases FROM products ORDER BY sku');
  return rows;
}
