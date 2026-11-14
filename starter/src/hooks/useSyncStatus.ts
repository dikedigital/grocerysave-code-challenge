import { useCallback, useState } from 'react';
import type { SyncRun } from '../models';
import { api } from '../services/api';
import { errorMessage, useAsync } from './useAsync';

export interface SyncStatusState {
  runs: SyncRun[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** True while a manual refresh is in flight. */
  refreshing: boolean;
  /** Failure of the last manual refresh, or null. */
  refreshError: string | null;
  /** Runs produced by the last successful manual refresh, or null. */
  lastRefresh: SyncRun[] | null;
  refresh: () => Promise<void>;
}

/** Recent price-feed refreshes and a way to trigger one now. */
export function useSyncStatus(): SyncStatusState {
  const { data, loading, error, reload } = useAsync('sync-status', api.sync.status);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<SyncRun[] | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    setLastRefresh(null);
    try {
      const { runs } = await api.sync.run();
      setLastRefresh(runs);
      reload();
    } catch (caught) {
      setRefreshError(errorMessage(caught));
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  return {
    runs: data ?? [],
    loading,
    error,
    reload,
    refreshing,
    refreshError,
    lastRefresh,
    refresh,
  };
}
