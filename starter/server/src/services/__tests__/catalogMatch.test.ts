import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Product } from '../../../../src/models';
import { parseCsvRecords } from '../../../../src/utils/csv';
import { matchProduct } from '../../../../src/utils/matching';
import { CATALOG_MATCH_THRESHOLD, matchCatalogItem } from '../catalogMatch';

const catalog: Product[] = parseCsvRecords(readFileSync(join(__dirname, '../../../../data/products.csv'), 'utf8')).map((row) => ({
  id: row.sku,
  sku: row.sku,
  name: row.name,
  category: row.category,
  unit: row.unit,
  aliases: row.aliases === '' ? [] : row.aliases.split('|'),
}));

const sku = (name: string) => matchCatalogItem(name, catalog)?.product.sku ?? null;

describe('matchCatalogItem (the API threshold)', () => {
  it('is stricter than the spec default of matchProduct', () => {
    expect(CATALOG_MATCH_THRESHOLD).toBe(0.51);
    expect(CATALOG_MATCH_THRESHOLD).toBeGreaterThan(0.5);
  });

  it.each(['oat milk', 'almond milk', 'chicken thighs', 'rice cakes'])(
    'rejects the 0.5 false positive %p, which matchProduct alone accepts',
    (name) => {
      expect(matchProduct(name, catalog)?.score).toBe(0.5);
      expect(matchCatalogItem(name, catalog)).toBeNull();
    }
  );

  it('no longer matches a one-word partial name (the accepted cost)', () => {
    expect(matchProduct('olive', catalog)?.product.sku).toBe('GS-002');
    expect(matchCatalogItem('olive', catalog)).toBeNull();
  });

  it.each([
    ['Milk', 'GS-001'],
    ['chicken', 'GS-003'],
    ['pasta', 'GS-028'],
    ['Tomato', 'GS-018'],
    ['loo rolls', 'GS-010'],
    ['large eggs dozen', 'GS-006'],
    ['Ground Beef 2 lb', 'GS-004'],
  ])('still matches exact names and aliases: %p -> %p', (name, expected) => {
    expect(sku(name)).toBe(expected);
    expect(matchCatalogItem(name, catalog)?.score).toBe(1);
  });

  it('still matches a partial name above 0.5', () => {
    // {boneless, chicken} vs alias {boneless, chicken, breast}: 2/3
    expect(matchCatalogItem('boneless chicken', catalog)).toMatchObject({ product: { sku: 'GS-003' }, score: 2 / 3 });
  });

  it('matches every name and alias of the catalog to its own product', () => {
    for (const product of catalog) {
      for (const form of [product.name, ...product.aliases]) expect(sku(form)).toBe(product.sku);
    }
  });
});
