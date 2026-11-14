import { useCallback } from 'react';
import type { UserPreferences } from '../models';
import { api } from '../services/api';
import { useAsync } from './useAsync';

export interface PreferencesState {
  preferences: UserPreferences | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Saves a partial update and resolves with the stored preferences; rejects when the API refuses. */
  save: (patch: Partial<UserPreferences>) => Promise<UserPreferences>;
}

export function usePreferences(): PreferencesState {
  const { data, loading, error, reload, setData } = useAsync('preferences', api.preferences.get);

  const save = useCallback(
    async (patch: Partial<UserPreferences>) => {
      const saved = await api.preferences.update(patch);
      setData(saved);
      return saved;
    },
    [setData]
  );

  return { preferences: data, loading, error, reload, save };
}
