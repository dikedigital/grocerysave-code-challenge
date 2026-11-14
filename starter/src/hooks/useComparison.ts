import type { ComparisonResponse } from '../models';
import { api } from '../services/api';
import { useAsync, type AsyncState } from './useAsync';

/** Price matrix of a list. `allStores` ignores the user's chain preferences. */
export function useComparison(
  listId: string | null,
  allStores: boolean
): AsyncState<ComparisonResponse> {
  return useAsync(listId === null ? null : `comparison:${listId}:${allStores}`, () =>
    api.lists.comparison(listId ?? '', allStores)
  );
}
