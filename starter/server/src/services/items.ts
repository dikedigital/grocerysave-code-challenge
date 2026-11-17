/**
 * List items (TECH_SPEC 6.3; decisions D-134 to D-140).
 *
 * - Adding matches the name against the whole catalog (`matchCatalogItem`: `matchProduct` with the
 *   API threshold of D-18). A match sets `productId` and takes the product's category, and the unit
 *   defaults to the product's; no match means `productId` null, category `Other`, unit `each`.
 *   An explicit unit and quantity are kept.
 * - Renaming matches again; every other edit leaves `productId` and `category` alone (D-136).
 * - Items keep the order they were added in: each new item goes after the list's last position
 *   (D-135).
 * - **Every** item change bumps the list's `updated_at` (BUMP_UPDATED_AT, D-128) in the same
 *   transaction, so the list moves to the top and polling clients see the change (D-137).
 */
import type { ListItem, Product } from '../../../src/models';
import type { ProductMatch } from '../../../src/utils/matching';
import type { Queryable } from '../db/pool';
import { matchCatalogItem } from './catalogMatch';
import { BUMP_UPDATED_AT, toListItem, type ItemRow } from './lists';

export const DEFAULT_CATEGORY = 'Other';
export const DEFAULT_UNIT = 'each';
/** A new item's quantity, and an item's quantity after a rename (D-136). */
export const DEFAULT_QUANTITY = 1;

/** A validated new item: `unit` undefined means "not given" (the product's unit, else `each`). */
export interface NewItem {
  name: string;
  quantity: number;
  unit?: string;
  note: string | null;
}

/** What the name match decides for an item. */
export interface ItemMatch {
  productId: string | null;
  category: string;
  /** The product's unit, or `each` without a product: the default when no unit is given. */
  unit: string;
}

export type Matcher = (name: string) => ProductMatch | null;

/** A matcher over these products, with the API threshold. */
export function catalogMatcher(products: Product[]): Matcher {
  return (name) => matchCatalogItem(name, products);
}

export function matchFields(match: ProductMatch | null): ItemMatch {
  return match
    ? { productId: match.product.id, category: match.product.category, unit: match.product.unit }
    : { productId: null, category: DEFAULT_CATEGORY, unit: DEFAULT_UNIT };
}

/** The stored fields of a new item (pure). */
export function newItemFields(input: NewItem, match: Matcher) {
  const matched = matchFields(match(input.name));
  return {
    name: input.name,
    quantity: input.quantity,
    unit: input.unit ?? matched.unit,
    note: input.note,
    productId: matched.productId,
    category: matched.category,
  };
}

/** A validated PATCH: only the fields that were sent. */
export interface ItemPatch {
  name?: string;
  quantity?: number;
  unit?: string;
  note?: string | null;
  completed?: boolean;
}

/** The columns a PATCH really changes. */
export interface ItemChanges extends ItemPatch {
  productId?: string | null;
  category?: string;
}

/**
 * What a PATCH changes (pure; D-136). Values equal to the current ones are dropped.
 *
 * **A rename starts the item afresh** (product owner, API round 5: "on a rename, the unit has to be
 * cleared ... he has to add unit and quantity again"): the new name is matched again and the
 * product, category, unit and quantity become what a new item of that name would get. So the
 * quantity goes back to 1 and the unit to the default (the new product's unit, or `each`), unless
 * the same PATCH sends a quantity or a unit. Note and completed are kept.
 * Every other edit leaves the product, category, unit and quantity as they are.
 */
export function planItemPatch(current: ListItem, patch: ItemPatch, match: Matcher): ItemChanges {
  const target: ItemChanges = { ...patch };
  if (patch.name !== undefined && patch.name !== current.name) {
    const matched = matchFields(match(patch.name));
    target.productId = matched.productId;
    target.category = matched.category;
    target.unit = patch.unit ?? matched.unit;
    target.quantity = patch.quantity ?? DEFAULT_QUANTITY;
  }
  const changes: ItemChanges = {};
  for (const key of Object.keys(target) as Array<keyof ItemChanges>) {
    const value = target[key];
    if (value !== undefined && value !== current[key]) (changes as Record<string, unknown>)[key] = value;
  }
  return changes;
}

const ITEM_COLUMNS = 'id, list_id, name, quantity, unit, category, note, product_id, completed';

/** Moves the list to the top: its `updated_at` moves on by at least 1 ms (D-128). */
export async function touchList(db: Queryable, listId: string): Promise<void> {
  await db.query(`UPDATE shopping_lists SET updated_at = ${BUMP_UPDATED_AT} WHERE id = $1`, [listId]);
}

export type NewItemFields = ReturnType<typeof newItemFields>;

/**
 * Appends the items, in the given order, after the list's last position, and bumps the list once.
 * **One** INSERT for all of them (D-143): it succeeds or fails as a whole, and inside the caller's
 * transaction the bump goes with it. The caller holds the list row lock (FOR UPDATE), so two
 * additions to one list never get the same positions (D-135).
 */
export async function insertItems(db: Queryable, listId: string, items: NewItemFields[]): Promise<ListItem[]> {
  if (items.length === 0) return [];
  const { rows } = await db.query<ItemRow & { position: number }>(
    `WITH base AS (
       SELECT COALESCE(MAX(position), -1) + 1 AS start FROM list_items WHERE list_id = $1
     ), inserted AS (
       INSERT INTO list_items (list_id, name, quantity, unit, category, note, product_id, position)
       SELECT $1, t.name, t.quantity, t.unit, t.category, t.note, t.product_id, base.start + t.n - 1
         FROM unnest($2::text[], $3::numeric[], $4::text[], $5::text[], $6::text[], $7::uuid[])
              WITH ORDINALITY AS t(name, quantity, unit, category, note, product_id, n), base
       RETURNING ${ITEM_COLUMNS}, position
     )
     SELECT * FROM inserted ORDER BY position`,
    [
      listId,
      items.map((item) => item.name),
      items.map((item) => item.quantity),
      items.map((item) => item.unit),
      items.map((item) => item.category),
      items.map((item) => item.note),
      items.map((item) => item.productId),
    ],
  );
  await touchList(db, listId);
  return rows.map(toListItem);
}

/** One item: the same path as many (D-143). */
export async function insertItem(db: Queryable, listId: string, fields: NewItemFields): Promise<ListItem> {
  return (await insertItems(db, listId, [fields]))[0];
}

/** The item if it belongs to this list; null otherwise (an item of another list is "not found"). */
export async function findItem(db: Queryable, listId: string, itemId: string, options: { forUpdate?: boolean } = {}): Promise<ListItem | null> {
  const { rows } = await db.query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM list_items WHERE id = $1 AND list_id = $2 ${options.forUpdate ? 'FOR UPDATE' : ''}`,
    [itemId, listId],
  );
  return rows[0] ? toListItem(rows[0]) : null;
}

const COLUMN: Record<keyof ItemChanges, string> = {
  name: 'name',
  quantity: 'quantity',
  unit: 'unit',
  note: 'note',
  completed: 'completed',
  productId: 'product_id',
  category: 'category',
};

/** Writes the changes (item `updated_at` too) and bumps the list; nothing is written when there are none. */
export async function updateItem(db: Queryable, listId: string, itemId: string, changes: ItemChanges): Promise<ListItem | null> {
  const keys = (Object.keys(changes) as Array<keyof ItemChanges>).filter((key) => changes[key] !== undefined);
  if (keys.length === 0) return findItem(db, listId, itemId);
  const values: unknown[] = [itemId, listId];
  const sets = keys.map((key) => {
    // Column names come only from the fixed COLUMN map; values travel as parameters. A key without a
    // column is a programming error, never SQL text (security pass, D-153).
    if (!Object.prototype.hasOwnProperty.call(COLUMN, key)) throw new Error(`updateItem: no column for "${String(key)}"`);
    values.push(changes[key]);
    return `${COLUMN[key]} = $${values.length}`;
  });
  const { rows } = await db.query<ItemRow>(
    `UPDATE list_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND list_id = $2 RETURNING ${ITEM_COLUMNS}`,
    values,
  );
  await touchList(db, listId);
  return rows[0] ? toListItem(rows[0]) : null;
}

/** Deletes the item and bumps the list. */
export async function deleteItem(db: Queryable, listId: string, itemId: string): Promise<void> {
  await db.query('DELETE FROM list_items WHERE id = $1 AND list_id = $2', [itemId, listId]);
  await touchList(db, listId);
}
