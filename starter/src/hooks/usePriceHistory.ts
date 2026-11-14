import type { PriceHistoryResponse } from '../models';
import { api } from '../services/api';
import { useAsync, type AsyncState } from './useAsync';

/** Weekly price snapshots of one product across stores; null disables loading. */
export function usePriceHistory(productId: string | null): AsyncState<PriceHistoryResponse> {
  return useAsync(productId === null ? null : `price-history:${productId}`, () =>
    api.catalog.priceHistory(productId ?? '')
  );
}
