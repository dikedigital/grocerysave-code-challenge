/**
 * Households (TECH_SPEC 6.3). Only what the lists need so far; the household endpoints arrive with
 * sharing in the next stage.
 */
import type { Queryable } from '../db/pool';

/** True when `userId` is a member (owner included) of the household. */
export async function isHouseholdMember(db: Queryable, userId: string, householdId: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM household_members WHERE household_id = $1 AND user_id = $2', [householdId, userId]);
  return (rowCount ?? 0) > 0;
}
