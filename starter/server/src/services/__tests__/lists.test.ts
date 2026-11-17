import { HttpError } from '../../httpError';
import { pathId, trimmedName } from '../../middleware/validate';
import { assertCanDelete, planListPatch, visibleListCondition } from '../lists';

const HOUSE = '3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69';
const OTHER = '00000000-0000-4000-8000-000000000000';

/** The HttpError `run` throws, or null. */
function thrown(run: () => unknown): { status: number; message: string } | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, message: error.message };
    throw error;
  }
}

describe('planListPatch (D-129): what a PATCH changes, by access', () => {
  const current = { name: 'Weekly', householdId: HOUSE };

  it('keeps only real changes', () => {
    expect(planListPatch('owner', current, {})).toEqual({});
    expect(planListPatch('owner', current, { name: 'Weekly', householdId: HOUSE })).toEqual({});
    expect(planListPatch('owner', current, { name: 'Party' })).toEqual({ name: 'Party' });
    expect(planListPatch('owner', current, { householdId: null })).toEqual({ householdId: null });
    expect(planListPatch('owner', current, { name: 'Party', householdId: OTHER })).toEqual({ name: 'Party', householdId: OTHER });
  });

  it('a member may rename and may resend the current householdId, but not change it (403)', () => {
    expect(planListPatch('member', current, { name: 'Party' })).toEqual({ name: 'Party' });
    expect(planListPatch('member', current, { name: 'Party', householdId: HOUSE })).toEqual({ name: 'Party' });
    const expected = { status: 403, message: 'Only the owner can change who the list is shared with' };
    expect(thrown(() => planListPatch('member', current, { householdId: null }))).toEqual(expected);
    expect(thrown(() => planListPatch('member', current, { householdId: OTHER }))).toEqual(expected);
    expect(thrown(() => planListPatch('member', { name: 'x', householdId: null }, { householdId: HOUSE }))).toEqual(expected);
  });
});

describe('assertCanDelete (D-129)', () => {
  it('the owner may delete; a member gets 403', () => {
    expect(thrown(() => assertCanDelete('owner'))).toBeNull();
    expect(thrown(() => assertCanDelete('member'))).toEqual({ status: 403, message: 'Only the owner can delete this list' });
  });
});

describe('visibleListCondition (D-125)', () => {
  it('is, for now, ownership only, written against the given alias and parameter', () => {
    expect(visibleListCondition('l', '$2')).toBe('l.owner_id = $2');
  });
});

describe('pathId and trimmedName', () => {
  it('pathId lower-cases a uuid and turns anything else into 404 with the given message', () => {
    expect(pathId(HOUSE.toUpperCase(), 'List not found')).toBe(HOUSE);
    for (const value of [undefined, '', 'abc', `${HOUSE}0`, HOUSE.replace(/-/g, '')]) {
      expect(thrown(() => pathId(value, 'List not found'))).toEqual({ status: 404, message: 'List not found' });
    }
  });

  it('trimmedName trims, requires content and counts characters, not UTF-16 units', () => {
    const name = trimmedName(3);
    expect(name.parse('  ab ')).toBe('ab');
    expect(name.parse('🛒🛒🛒')).toBe('🛒🛒🛒');
    expect(name.safeParse('   ').error?.issues[0].message).toBe('is required');
    expect(name.safeParse('abcd').error?.issues[0].message).toBe('must be at most 3 characters');
    expect(name.safeParse(3).error?.issues[0].message).toBe('must be text');
  });
});
