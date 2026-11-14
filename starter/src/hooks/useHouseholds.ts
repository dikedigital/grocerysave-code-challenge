import { useCallback, useMemo } from 'react';
import type { Household } from '../models';
import { api } from '../services/api';
import { useAsync } from './useAsync';

export interface HouseholdsState {
  households: Household[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  create: (name: string) => Promise<void>;
  addMember: (householdId: string, email: string) => Promise<void>;
  /** Removes a member, or the current user when they leave (the household then disappears from their list). */
  removeMember: (householdId: string, userId: string, isSelf: boolean) => Promise<void>;
  remove: (householdId: string) => Promise<void>;
}

/** The user's households and the mutations on them. Every mutation rejects when the API refuses. */
export function useHouseholds(): HouseholdsState {
  const { data, loading, error, reload, setData } = useAsync('households', api.households.all);
  const households = useMemo(() => data ?? [], [data]);

  const replace = useCallback(
    (updated: Household) =>
      setData(households.map((household) => (household.id === updated.id ? updated : household))),
    [households, setData]
  );
  const drop = useCallback(
    (householdId: string) =>
      setData(households.filter((household) => household.id !== householdId)),
    [households, setData]
  );

  const create = useCallback(
    async (name: string) => {
      const created = await api.households.create(name);
      setData([...households, created]);
    },
    [households, setData]
  );

  const addMember = useCallback(
    async (householdId: string, email: string) => {
      replace(await api.households.addMember(householdId, email));
    },
    [replace]
  );

  const removeMember = useCallback(
    async (householdId: string, userId: string, isSelf: boolean) => {
      const updated = await api.households.removeMember(householdId, userId);
      if (isSelf) drop(householdId);
      else replace(updated);
    },
    [drop, replace]
  );

  const remove = useCallback(
    async (householdId: string) => {
      await api.households.remove(householdId);
      drop(householdId);
    },
    [drop]
  );

  return { households, loading, error, reload, create, addMember, removeMember, remove };
}
