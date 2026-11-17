import type { ListItem, Product } from '../../../../src/models';
import { catalogMatcher, newItemFields, planItemPatch, updateItem } from '../items';

const products: Product[] = [
  { id: 'p-milk', sku: 'GS-001', name: 'Whole Milk 1 gal', category: 'Dairy', unit: 'gal', aliases: ['milk', 'whole milk'] },
  { id: 'p-banana', sku: 'GS-011', name: 'Bananas 1 lb', category: 'Produce', unit: 'lb', aliases: ['bananas', 'banana'] },
  { id: 'p-cheddar', sku: 'GS-005', name: 'Cheddar Cheese 8 oz', category: 'Dairy', unit: 'oz', aliases: ['cheddar'] },
];
const match = catalogMatcher(products);

const item = (overrides: Partial<ListItem> = {}): ListItem => ({
  id: 'i1',
  listId: 'l1',
  name: 'milk',
  quantity: 2,
  unit: 'gal',
  category: 'Dairy',
  note: null,
  productId: 'p-milk',
  completed: false,
  ...overrides,
});

describe('newItemFields (D-134)', () => {
  it('a match sets productId and category; the unit defaults to the product unit', () => {
    expect(newItemFields({ name: 'milk', quantity: 1, note: null }, match)).toEqual({
      name: 'milk', quantity: 1, unit: 'gal', note: null, productId: 'p-milk', category: 'Dairy',
    });
  });

  it('an explicit unit is kept, even "each" (TECH_SPEC 6.3: explicit quantity and unit are kept)', () => {
    expect(newItemFields({ name: 'milk', quantity: 3, unit: 'l', note: 'x' }, match)).toMatchObject({ unit: 'l', quantity: 3, productId: 'p-milk' });
    expect(newItemFields({ name: 'milk', quantity: 1, unit: 'each', note: null }, match).unit).toBe('each');
  });

  it('no match: productId null, category Other, unit each (or the explicit one)', () => {
    expect(newItemFields({ name: 'Birthday candles', quantity: 1, note: null }, match)).toMatchObject({ productId: null, category: 'Other', unit: 'each' });
    expect(newItemFields({ name: 'Birthday candles', quantity: 1, unit: 'box', note: null }, match).unit).toBe('box');
  });
});

describe('planItemPatch (D-136)', () => {
  const never = () => {
    throw new Error('the catalog must not be consulted');
  };

  it('quantity, unit, note and completed never touch the product, and do not match again', () => {
    expect(planItemPatch(item(), { quantity: 5, unit: 'l', note: 'semi-skimmed', completed: true }, never)).toEqual({
      quantity: 5, unit: 'l', note: 'semi-skimmed', completed: true,
    });
  });

  it('values equal to the current ones are dropped (nothing to write)', () => {
    expect(planItemPatch(item(), { name: 'milk', quantity: 2, unit: 'gal', note: null, completed: false }, never)).toEqual({});
  });

  it('a rename starts the item afresh: product, category, unit and quantity as for a new item (D-136)', () => {
    expect(planItemPatch(item(), { name: 'bananas' }, match)).toEqual({ name: 'bananas', productId: 'p-banana', category: 'Produce', unit: 'lb', quantity: 1 });
  });

  it('a rename to the same product also resets the unit and the quantity (milk, 2 l -> whole milk, 1 gal)', () => {
    expect(planItemPatch(item({ unit: 'l' }), { name: 'whole milk' }, match)).toEqual({ name: 'whole milk', unit: 'gal', quantity: 1 });
  });

  it('a rename that matches nothing: no product, Other, each, quantity 1 (milk -> oat milk, product owner\'s example)', () => {
    expect(planItemPatch(item({ unit: 'l', quantity: 3 }), { name: 'oat drink' }, match)).toEqual({
      name: 'oat drink', productId: null, category: 'Other', unit: 'each', quantity: 1,
    });
  });

  it('a unit or quantity sent with the rename wins (the user "adds them again" in the same request)', () => {
    expect(planItemPatch(item(), { name: 'bananas', unit: 'bunch', quantity: 6 }, match)).toEqual({
      name: 'bananas', productId: 'p-banana', category: 'Produce', unit: 'bunch', quantity: 6,
    });
    expect(planItemPatch(item(), { name: 'bananas', quantity: 6 }, match)).toMatchObject({ unit: 'lb', quantity: 6 });
  });

  it('a rename to another product of the same category: category unchanged, so not listed', () => {
    expect(planItemPatch(item(), { name: 'cheddar' }, match)).toEqual({ name: 'cheddar', productId: 'p-cheddar', unit: 'oz', quantity: 1 });
  });

  it('an unmatched item renamed to a product gets it', () => {
    const candles = item({ name: 'candles', productId: null, category: 'Other', unit: 'each', quantity: 2 });
    expect(planItemPatch(candles, { name: 'banana' }, match)).toEqual({ name: 'banana', productId: 'p-banana', category: 'Produce', unit: 'lb', quantity: 1 });
  });

  it('note and completed survive a rename; values that already match are not listed', () => {
    const done = item({ note: 'semi', completed: true, quantity: 1 });
    expect(planItemPatch(done, { name: 'bananas' }, match)).toEqual({ name: 'bananas', productId: 'p-banana', category: 'Produce', unit: 'lb' });
  });

  it('a case-only change is a rename too (the name differs), so it resets as well', () => {
    expect(planItemPatch(item({ quantity: 3 }), { name: 'Milk' }, match)).toEqual({ name: 'Milk', quantity: 1 });
  });
});

describe('updateItem: column names only from the fixed map (security pass, D-153)', () => {
  it('a change key without a column throws before any SQL is sent', async () => {
    const query = jest.fn();
    const db = { query } as unknown as Parameters<typeof updateItem>[0];
    await expect(updateItem(db, 'l1', 'i1', { ['name = name; DROP TABLE users; --' as 'name']: 'x' })).rejects.toThrow('updateItem: no column for');
    await expect(updateItem(db, 'l1', 'i1', { ['constructor' as 'name']: 'x' })).rejects.toThrow('updateItem: no column for');
    expect(query).not.toHaveBeenCalled();
  });
});

