/**
 * Shopping lists (TECH_SPEC 6.3; decisions D-125 to D-131).
 *
 * **Visibility lives in one place**, `visibleListCondition`, and every list query uses it (D-125).
 * For now a user sees only the lists they own. Household sharing (next stage) adds one branch to
 * that condition and to `accessExpression`. The rules that depend on who the caller is (only the
 * owner deletes or moves a list) are already written against the access level (`ListAccess`), in the
 * pure `planListPatch` / `assertCanDelete`, so they need no change when members can see lists.
 */
import type { ListItem, ShoppingList } from '../../../src/models';
import type { Queryable } from '../db/pool';
import { forbidden } from '../httpError';

/** How the caller reaches a list: they own it, or (next stage) they belong to its household. */
export type ListAccess = 'owner' | 'member';

/**
 * SQL condition: the list row `list` is visible to the user whose id is in parameter `userParam`.
 * Both arguments are fixed SQL text chosen by the caller (an alias and a `$n`), never user input.
 * Next stage: `(${list}.owner_id = ${userParam} OR EXISTS (SELECT 1 FROM household_members m
 * WHERE m.household_id = ${list}.household_id AND m.user_id = ${userParam}))`.
 */
export function visibleListCondition(list: string, userParam: string): string {
  return `${list}.owner_id = ${userParam}`;
}

/** SQL expression giving the caller's `ListAccess` for a visible list. */
function accessExpression(list: string, userParam: string): string {
  return `CASE WHEN ${list}.owner_id = ${userParam} THEN 'owner' ELSE 'member' END`;
}

/**
 * Moves `updated_at` forward on every change: to now, and always at least 1 ms past its old value.
 * The API sends timestamps with millisecond precision, and the client's polling compares
 * `updatedAt` strings (TECH_SPEC 7), so two changes within one millisecond must still differ (D-128).
 */
export const BUMP_UPDATED_AT = "greatest(now(), updated_at + interval '1 millisecond')";

interface ListRow {
  id: string;
  name: string;
  owner_id: string;
  household_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ItemRow {
  id: string;
  list_id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  note: string | null;
  product_id: string | null;
  completed: boolean;
}

const LIST_COLUMNS = 'l.id, l.name, l.owner_id, l.household_id, l.created_at, l.updated_at';
/** Most recently changed first; ties (lists created in one transaction) by newest created, then id (D-127). */
const LIST_ORDER = 'l.updated_at DESC, l.created_at DESC, l.id';

export function toListItem(row: ItemRow): ListItem {
  return {
    id: row.id,
    listId: row.list_id,
    name: row.name,
    quantity: Number(row.quantity),
    unit: row.unit,
    category: row.category,
    note: row.note,
    productId: row.product_id,
    completed: row.completed,
  };
}

function toShoppingList(row: ListRow, items: ListItem[]): ShoppingList {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    householdId: row.household_id,
    items,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** The items of several lists in **one** query, each list's items by position, then creation (D-126). */
export async function loadItems(db: Queryable, listIds: string[]): Promise<Map<string, ListItem[]>> {
  const byList = new Map<string, ListItem[]>(listIds.map((id) => [id, []]));
  if (listIds.length === 0) return byList;
  const { rows } = await db.query<ItemRow>(
    `SELECT id, list_id, name, quantity, unit, category, note, product_id, completed
       FROM list_items
      WHERE list_id = ANY($1::uuid[])
      ORDER BY list_id, position, created_at, id`,
    [listIds],
  );
  for (const row of rows) byList.get(row.list_id)?.push(toListItem(row));
  return byList;
}

async function withItems(db: Queryable, rows: ListRow[]): Promise<ShoppingList[]> {
  const items = await loadItems(db, rows.map((row) => row.id));
  return rows.map((row) => toShoppingList(row, items.get(row.id) ?? []));
}

/** Every list the user can see, with items, most recently changed first. Two queries in all. */
export async function listVisibleLists(db: Queryable, userId: string): Promise<ShoppingList[]> {
  const { rows } = await db.query<ListRow>(
    `SELECT ${LIST_COLUMNS} FROM shopping_lists l WHERE ${visibleListCondition('l', '$1')} ORDER BY ${LIST_ORDER}`,
    [userId],
  );
  return withItems(db, rows);
}

export interface VisibleList {
  row: ListRow;
  access: ListAccess;
}

/**
 * The list if the user can see it, with their access; null otherwise (not found and not visible
 * are the same answer). `forUpdate` locks the row until the transaction ends.
 */
export async function findVisibleList(db: Queryable, userId: string, listId: string, options: { forUpdate?: boolean } = {}): Promise<VisibleList | null> {
  const { rows } = await db.query<ListRow & { access: ListAccess }>(
    `SELECT ${LIST_COLUMNS}, ${accessExpression('l', '$2')} AS access
       FROM shopping_lists l
      WHERE l.id = $1 AND ${visibleListCondition('l', '$2')}
      ${options.forUpdate ? 'FOR UPDATE OF l' : ''}`,
    [listId, userId],
  );
  if (!rows[0]) return null;
  const { access, ...row } = rows[0];
  return { row, access };
}

/** The list with its items, if visible to the user. */
export async function getVisibleList(db: Queryable, userId: string, listId: string): Promise<ShoppingList | null> {
  const found = await findVisibleList(db, userId, listId);
  return found ? (await withItems(db, [found.row]))[0] : null;
}

export async function createList(db: Queryable, ownerId: string, name: string, householdId: string | null): Promise<ShoppingList> {
  const { rows } = await db.query<ListRow>(
    `INSERT INTO shopping_lists AS l (owner_id, name, household_id) VALUES ($1, $2, $3)
     RETURNING ${LIST_COLUMNS}`,
    [ownerId, name, householdId],
  );
  return toShoppingList(rows[0], []);
}

export interface ListPatch {
  name?: string;
  householdId?: string | null;
}

/**
 * What a PATCH really changes, given who the caller is (pure; D-129). Unchanged values are dropped,
 * so resending the current `householdId` is allowed for anyone. Changing `householdId` is for the
 * owner only: 403 for a member. Whether the target household is the caller's is checked afterwards,
 * against the database.
 */
export function planListPatch(access: ListAccess, current: { name: string; householdId: string | null }, patch: ListPatch): ListPatch {
  const changes: ListPatch = {};
  if (patch.name !== undefined && patch.name !== current.name) changes.name = patch.name;
  if (patch.householdId !== undefined && patch.householdId !== current.householdId) {
    if (access !== 'owner') throw forbidden('Only the owner can change who the list is shared with');
    changes.householdId = patch.householdId;
  }
  return changes;
}

/** Only the owner deletes a list: 403 for a member (D-129). */
export function assertCanDelete(access: ListAccess): void {
  if (access !== 'owner') throw forbidden('Only the owner can delete this list');
}

/** Applies the changes and bumps `updated_at` (D-128); nothing is written when there are none. */
export async function updateList(db: Queryable, listId: string, changes: ListPatch): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [listId];
  if (changes.name !== undefined) {
    values.push(changes.name);
    sets.push(`name = $${values.length}`);
  }
  if (changes.householdId !== undefined) {
    values.push(changes.householdId);
    sets.push(`household_id = $${values.length}`);
  }
  if (sets.length === 0) return;
  await db.query(`UPDATE shopping_lists SET ${sets.join(', ')}, updated_at = ${BUMP_UPDATED_AT} WHERE id = $1`, values);
}

/** Deletes the list; its items go with it (ON DELETE CASCADE). */
export async function deleteList(db: Queryable, listId: string): Promise<void> {
  await db.query('DELETE FROM shopping_lists WHERE id = $1', [listId]);
}
