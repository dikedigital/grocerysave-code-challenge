/**
 * `GET /api/lists`, `POST /api/lists`, `GET|PATCH|DELETE /api/lists/:id` (TECH_SPEC 6.3; D-125 to D-131).
 * Every route needs a token (declared through the RouteBuilder, D-117).
 *
 * On `/:id` routes the checks run in this order: the id is a uuid and the list is visible (else 404
 * `List not found`, the same for "malformed", "does not exist" and "someone else's"), then the body
 * (400), then the caller's rights (403), then the target household (404).
 */
import type { Request } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import { withTransaction } from '../db/tx';
import { notFound } from '../httpError';
import { authUser } from '../middleware/auth';
import { OBJECT_BODY, isUuid, pathId, trimmedName } from '../middleware/validate';
import { isHouseholdMember } from '../services/households';
import {
  assertCanDelete,
  createList,
  deleteList,
  findVisibleList,
  getVisibleList,
  listVisibleLists,
  planListPatch,
  updateList,
} from '../services/lists';
import type { RouteBuilder } from './define';

export const LIST_NOT_FOUND = 'List not found';
export const HOUSEHOLD_NOT_FOUND = 'Household not found';
/** The client's limit (CreateListForm, ListDetailPage). */
export const MAX_LIST_NAME_LENGTH = 100;

/** `null` (private) or a household id; a value that is not a uuid is a 400, not a 404 (D-130). */
const householdIdField = z.union([z.null(), z.string().refine(isUuid, 'must be a household id')], {
  errorMap: () => ({ message: 'must be a household id or null' }),
});

export const createListSchema = z.object(
  { name: trimmedName(MAX_LIST_NAME_LENGTH), householdId: householdIdField.optional() },
  OBJECT_BODY,
);

export const patchListSchema = z
  .object({ name: trimmedName(MAX_LIST_NAME_LENGTH).optional(), householdId: householdIdField.optional() }, OBJECT_BODY)
  .refine((patch) => patch.name !== undefined || patch.householdId !== undefined, 'Nothing to change: send name and/or householdId');

const listId = (req: Request) => pathId(req.params.id, LIST_NOT_FOUND);

export function listRoutes(r: RouteBuilder, { pool, logger }: AppDeps): void {
  const log = logger.child('lists');

  /** 404 unless the user belongs to the household (D-130). */
  const assertMember = async (db: Parameters<typeof isHouseholdMember>[0], userId: string, householdId: string) => {
    if (!(await isHouseholdMember(db, userId, householdId.toLowerCase()))) throw notFound(HOUSEHOLD_NOT_FOUND);
  };

  r.get('/', async (req, res) => {
    res.json(await listVisibleLists(pool, authUser(req).id));
  });

  r.post('/', async (req, res) => {
    const user = authUser(req);
    const input = createListSchema.parse(req.body);
    const householdId = input.householdId ? input.householdId.toLowerCase() : null;
    if (householdId) await assertMember(pool, user.id, householdId);
    const list = await createList(pool, user.id, input.name, householdId);
    log.info('list_created', `user ${user.id} created list ${list.id}`, { userId: user.id, listId: list.id, shared: householdId !== null });
    res.status(201).json(list);
  });

  r.get('/:id', async (req, res) => {
    const list = await getVisibleList(pool, authUser(req).id, listId(req));
    if (!list) throw notFound(LIST_NOT_FOUND);
    res.json(list);
  });

  r.patch('/:id', async (req, res) => {
    const user = authUser(req);
    const id = listId(req);
    const list = await withTransaction(pool, async (db) => {
      const found = await findVisibleList(db, user.id, id, { forUpdate: true });
      if (!found) throw notFound(LIST_NOT_FOUND);
      const patch = patchListSchema.parse(req.body);
      const changes = planListPatch(
        found.access,
        { name: found.row.name, householdId: found.row.household_id },
        { name: patch.name, householdId: patch.householdId === undefined || patch.householdId === null ? patch.householdId : patch.householdId.toLowerCase() },
      );
      if (changes.householdId) await assertMember(db, user.id, changes.householdId);
      await updateList(db, id, changes);
      if (Object.keys(changes).length > 0) {
        log.info('list_updated', `user ${user.id} changed ${Object.keys(changes).join(' and ')} of list ${id}`, { userId: user.id, listId: id, changed: Object.keys(changes) });
      }
      return getVisibleList(db, user.id, id);
    });
    res.json(list);
  });

  r.delete('/:id', async (req, res) => {
    const user = authUser(req);
    const id = listId(req);
    await withTransaction(pool, async (db) => {
      const found = await findVisibleList(db, user.id, id, { forUpdate: true });
      if (!found) throw notFound(LIST_NOT_FOUND);
      assertCanDelete(found.access);
      await deleteList(db, id);
    });
    log.info('list_deleted', `user ${user.id} deleted list ${id}`, { userId: user.id, listId: id });
    res.status(204).end();
  });
}
