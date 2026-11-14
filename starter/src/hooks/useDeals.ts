import type { DealView } from '../models';
import { api } from '../services/api';
import { useAsync, type AsyncState } from './useAsync';

/** Current price drops on products in the user's lists. */
export function useDeals(): AsyncState<DealView[]> {
  return useAsync('deals', api.deals.current);
}
