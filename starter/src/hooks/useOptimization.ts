import type { OptimizationResponse } from '../models';
import { api, type OptimizeQuery } from '../services/api';
import { useAsync, type AsyncState } from './useAsync';

/**
 * Purchase plans for a list. `options` override the saved preferences; pass null to wait
 * (for example until the preferences that initialise the controls have loaded).
 */
export function useOptimization(
  listId: string | null,
  options: OptimizeQuery | null
): AsyncState<OptimizationResponse> {
  const key =
    listId === null || options === null
      ? null
      : `optimization:${listId}:${options.maxStores ?? ''}:${options.travelCostPerKm ?? ''}`;
  return useAsync(key, () => api.lists.optimization(listId ?? '', options ?? {}));
}
