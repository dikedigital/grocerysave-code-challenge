/**
 * `POST /api/lists/:id/items`, `PATCH` and `DELETE /api/lists/:id/items/:itemId`,
 * `POST /api/lists/:id/items/bulk` and `POST /api/lists/:id/import` (TECH_SPEC 6.3; decisions D-134
 * to D-148). Every route needs a token (D-117).
 *
 * Order of checks, as for lists (D-129): the list id is a uuid and the list is visible (else 404
 * `List not found`); the item id is a uuid and the item belongs to that list (else 404
 * `Item not found`); then the body (400). Everything runs in one transaction holding the list row
 * lock, so additions get distinct positions and each change sees the one before it.
 */
import type { Request } from 'express';
import { z, type ZodIssue } from 'zod';
import type { ImportResponse, ListItem } from '../../../src/models';
import { parseListCsvDetailed, parseListTextDetailed, type ParsedLine } from '../../../src/utils/parseList';
import { normalizeUnit } from '../../../src/utils/parseList';
import { roundTo } from '../../../src/utils/money';
import type { AppDeps } from '../deps';
import { withTransaction } from '../db/tx';
import { badRequest, notFound } from '../httpError';
import { authUser } from '../middleware/auth';
import { OBJECT_BODY, characters, hasControlCharacters, isBlank, pathId, trimmedName } from '../middleware/validate';
import { loadProducts } from '../services/catalog';
import { DEFAULT_QUANTITY, catalogMatcher, deleteItem, findItem, insertItem, insertItems, newItemFields, planItemPatch, updateItem, type Matcher } from '../services/items';
import { findVisibleList } from '../services/lists';
import type { RouteBuilder } from './define';
import { LIST_NOT_FOUND } from './lists';

export const ITEM_NOT_FOUND = 'Item not found';
/** The add form's limits (AddItemForm: name 120, note 200). */
export const MAX_ITEM_NAME_LENGTH = 120;
export const MAX_NOTE_LENGTH = 200;
export const MAX_UNIT_LENGTH = 20;
/** `list_items.quantity` is numeric(10, 3). */
export const MAX_QUANTITY = 9_999_999.999;
/** Most items one bulk add or import may create (TECH_SPEC 6.3). */
export const MAX_IMPORT_ITEMS = 500;
export const IMPORT_FORMATS = ['text', 'csv'] as const;

/** A number greater than 0, rounded to 3 decimals as stored (D-138). */
const quantity = z.number({ required_error: 'is required', invalid_type_error: 'must be a number' }).transform((value, ctx) => {
  // Size first: JSON reads 1e400 as Infinity, and rounding maps non-finite values to 0, which gave
  // "must be greater than 0" for a number far too large (D-154). Anything above the maximum is
  // refused, so the rounded value can never exceed it.
  if (value > MAX_QUANTITY) {
    ctx.addIssue({ code: 'custom', message: `must be at most ${MAX_QUANTITY}` });
    return z.NEVER;
  }
  const rounded = roundTo(value, 3);
  if (!(rounded > 0)) {
    ctx.addIssue({ code: 'custom', message: value > 0 ? 'must be greater than 0 (at least 0.001)' : 'must be greater than 0' });
    return z.NEVER;
  }
  return rounded;
});

/** A known unit in its canonical spelling (`KG` -> `kg`, `lbs` -> `lb`); any other unit kept as typed, trimmed (D-139). */
const unit = z.string({ invalid_type_error: 'must be text' }).transform((value, ctx) => {
  const trimmed = value.trim();
  if (isBlank(trimmed)) {
    ctx.addIssue({ code: 'custom', message: 'must not be empty' });
    return z.NEVER;
  }
  if (characters(trimmed) > MAX_UNIT_LENGTH || hasControlCharacters(trimmed)) {
    ctx.addIssue({ code: 'custom', message: `must be a unit of at most ${MAX_UNIT_LENGTH} characters on one line` });
    return z.NEVER;
  }
  return normalizeUnit(trimmed) ?? trimmed;
});

/** Trimmed; empty or null means no note (D-139). */
const note = z
  .string({ invalid_type_error: 'must be text or null' })
  .nullable()
  .transform((value, ctx) => {
    const trimmed = isBlank(value ?? '') ? '' : (value ?? '').trim();
    if (characters(trimmed) > MAX_NOTE_LENGTH) {
      ctx.addIssue({ code: 'custom', message: `must be at most ${MAX_NOTE_LENGTH} characters` });
      return z.NEVER;
    }
    if (hasControlCharacters(trimmed)) {
      ctx.addIssue({ code: 'custom', message: 'must not contain control characters' });
      return z.NEVER;
    }
    return trimmed === '' ? null : trimmed;
  });

const name = trimmedName(MAX_ITEM_NAME_LENGTH);

/** `POST` body; `productId`, `category`, `completed` and other fields are not accepted from the client (ignored). */
export const newItemSchema = z.object(
  { name, quantity: quantity.optional(), unit: unit.optional(), note: note.optional() },
  OBJECT_BODY,
);

/** One item of a bulk add: the fields of a single add (D-144). */
const bulkItem = z.object(
  { name, quantity: quantity.optional(), unit: unit.optional(), note: note.optional() },
  { required_error: 'must be an item', invalid_type_error: 'must be an item (an object)' },
);

export const bulkSchema = z.object(
  {
    items: z
      .array(bulkItem, { required_error: 'is required', invalid_type_error: 'must be a list of items' })
      .min(1, 'must contain at least 1 item')
      .max(MAX_IMPORT_ITEMS, `must contain at most ${MAX_IMPORT_ITEMS} items`),
  },
  OBJECT_BODY,
);

export const importSchema = z.object(
  {
    format: z.enum(IMPORT_FORMATS, {
      errorMap: (issue) => ({
        message: issue.code === 'invalid_type' && issue.received === 'undefined' ? 'is required' : 'must be "text" or "csv"',
      }),
    }),
    content: z.string({ required_error: 'is required', invalid_type_error: 'must be text' }),
  },
  OBJECT_BODY,
);

/**
 * Checks what the parser produced against the rules of a single add (D-146). The parser only gives
 * positive quantities and canonical units, but a name, note or quantity can still be too long or
 * too large. Any problem refuses the whole import, naming the item.
 */
function checkParsedItems(parsed: ParsedLine[]): Array<z.output<typeof bulkItem>> {
  // A line without a written unit is sent on without one, so it gets the product's unit like a
  // single add (D-147, option A; scope creep, see DECISIONS). A written unit is kept.
  const items = parsed.map(({ unitWritten, unit: parsedUnit, ...rest }) => (unitWritten ? { ...rest, unit: parsedUnit } : rest));
  const result = z.array(bulkItem).safeParse(items);
  if (result.success) return result.data;
  const describe = (issue: ZodIssue) => {
    const [index, field] = issue.path;
    const item = typeof index === 'number' ? parsed[index] : undefined;
    const label = item ? `item ${index as number + 1} ("${characters(item.name) > 40 ? `${[...item.name].slice(0, 40).join('')}...` : item.name}")` : 'an item';
    return `${label}: ${field !== undefined ? `${String(field)}: ` : ''}${issue.message}`;
  };
  const issues = result.error.issues;
  const shown = issues.slice(0, 5).map(describe);
  if (issues.length > 5) shown.push(`and ${issues.length - 5} more`);
  throw badRequest(`content: ${shown.join('; ')}`);
}

/** The items the content yields, or a 400 (D-145). */
export function parseImport(format: (typeof IMPORT_FORMATS)[number], content: string): ParsedLine[] {
  const parsed = format === 'csv' ? parseListCsvDetailed(content) : parseListTextDetailed(content);
  if (parsed.length === 0) throw badRequest(`content: no items found in the ${format === 'csv' ? 'CSV' : 'text'}`);
  if (parsed.length > MAX_IMPORT_ITEMS) throw badRequest(`content: at most ${MAX_IMPORT_ITEMS} items at a time (found ${parsed.length})`);
  return parsed;
}

export const itemPatchSchema = z
  .object(
    {
      name: name.optional(),
      quantity: quantity.optional(),
      unit: unit.optional(),
      note: note.optional(),
      completed: z.boolean({ invalid_type_error: 'must be true or false' }).optional(),
    },
    OBJECT_BODY,
  )
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Nothing to change: send name, quantity, unit, note and/or completed',
  );

export function itemRoutes(r: RouteBuilder, { pool, logger }: AppDeps): void {
  const log = logger.child('items');

  r.post('/:id/items', async (req, res) => {
    const user = authUser(req);
    const listId = pathId(req.params.id, LIST_NOT_FOUND);
    const item = await withTransaction(pool, async (db) => {
      if (!(await findVisibleList(db, user.id, listId, { forUpdate: true }))) throw notFound(LIST_NOT_FOUND);
      const input = newItemSchema.parse(req.body);
      const match = catalogMatcher(await loadProducts(db));
      return insertItem(db, listId, newItemFields({ name: input.name, quantity: input.quantity ?? DEFAULT_QUANTITY, unit: input.unit, note: input.note ?? null }, match));
    });
    log.info('item_added', `user ${user.id} added item ${item.id} to list ${listId}`, {
      userId: user.id,
      listId,
      itemId: item.id,
      matched: item.productId !== null,
      productId: item.productId ?? undefined,
    });
    res.status(201).json(item);
  });

  r.patch('/:id/items/:itemId', async (req, res) => {
    const user = authUser(req);
    const listId = pathId(req.params.id, LIST_NOT_FOUND);
    const { item, changed } = await withTransaction(pool, async (db) => {
      if (!(await findVisibleList(db, user.id, listId, { forUpdate: true }))) throw notFound(LIST_NOT_FOUND);
      const itemId = pathId(req.params.itemId, ITEM_NOT_FOUND);
      const current = await findItem(db, listId, itemId, { forUpdate: true });
      if (!current) throw notFound(ITEM_NOT_FOUND);
      const patch = itemPatchSchema.parse(req.body);
      // The catalog is read only when the name changes (the only edit that matches again).
      let match: Matcher = () => null;
      if (patch.name !== undefined && patch.name !== current.name) match = catalogMatcher(await loadProducts(db));
      const changes = planItemPatch(current, patch, match);
      const updated = await updateItem(db, listId, itemId, changes);
      return { item: updated ?? current, changed: Object.keys(changes) };
    });
    if (changed.length > 0) {
      log.info('item_updated', `user ${user.id} changed ${changed.join(', ')} of item ${item.id} in list ${listId}`, {
        userId: user.id,
        listId,
        itemId: item.id,
        changed,
      });
    }
    res.json(item);
  });

  r.delete('/:id/items/:itemId', async (req, res) => {
    const user = authUser(req);
    const listId = pathId(req.params.id, LIST_NOT_FOUND);
    const itemId = await withTransaction(pool, async (db) => {
      if (!(await findVisibleList(db, user.id, listId, { forUpdate: true }))) throw notFound(LIST_NOT_FOUND);
      const id = pathId(req.params.itemId, ITEM_NOT_FOUND);
      if (!(await findItem(db, listId, id, { forUpdate: true }))) throw notFound(ITEM_NOT_FOUND);
      await deleteItem(db, listId, id);
      return id;
    });
    log.info('item_removed', `user ${user.id} removed item ${itemId} from list ${listId}`, { userId: user.id, listId, itemId });
    res.status(204).end();
  });

  type ImportSource = 'bulk' | (typeof IMPORT_FORMATS)[number];
  type NewItemInput = { name: string; quantity?: number; unit?: string; note?: string | null };

  /**
   * Creates the items in one transaction: all of them, in the given order, or none (D-143). `read`
   * validates the body (and parses the content) once the list is known to be visible, and says
   * where the items came from (`bulk`, `text` or `csv`, for the log).
   */
  const createMany = async (req: Request, read: () => { source: ImportSource; items: NewItemInput[] }): Promise<ImportResponse> => {
    const user = authUser(req);
    const listId = pathId(req.params.id, LIST_NOT_FOUND);
    // 1. The list first (404 before any 400, D-148), without a lock.
    if (!(await findVisibleList(pool, user.id, listId))) throw notFound(LIST_NOT_FOUND);
    // 2. Parse, validate and match outside any transaction: up to 1 MB of content can take a few
    //    hundred milliseconds to parse, and no database connection or row lock is held meanwhile (D-157).
    const input = read();
    const match = catalogMatcher(await loadProducts(pool));
    const fields = input.items.map((item) =>
      newItemFields({ name: item.name, quantity: item.quantity ?? DEFAULT_QUANTITY, unit: item.unit, note: item.note ?? null }, match),
    );
    const source = input.source;
    // 3. A short transaction: lock the list, check it is still there (it may have been deleted in the
    //    meantime), write everything or nothing (D-143).
    const items = await withTransaction(pool, async (db) => {
      if (!(await findVisibleList(db, user.id, listId, { forUpdate: true }))) throw notFound(LIST_NOT_FOUND);
      return insertItems(db, listId, fields);
    });
    const matched = items.filter((item: ListItem) => item.productId !== null).length;
    log.info('items_imported', `user ${user.id} added ${items.length} items (${matched} matched) to list ${listId} from ${source}`, {
      userId: user.id,
      listId,
      source,
      count: items.length,
      matched,
    });
    return { items, matched };
  };

  r.post('/:id/items/bulk', async (req, res) => {
    res.status(201).json(await createMany(req, () => ({ source: 'bulk', items: bulkSchema.parse(req.body).items })));
  });

  r.post('/:id/import', async (req, res) => {
    res.status(201).json(
      await createMany(req, () => {
        const input = importSchema.parse(req.body);
        return { source: input.format, items: checkParsedItems(parseImport(input.format, input.content)) };
      }),
    );
  });
}
