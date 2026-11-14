import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ShoppingList } from '../models';
import { api } from '../services/api';
import { useAsync } from './useAsync';

const LIST_PARAM = 'list';

export interface ListOptions {
  lists: ShoppingList[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** The list named by `?list=`, or the first list; null while loading or when there are none. */
  selectedId: string | null;
  selectedList: ShoppingList | null;
  select: (listId: string) => void;
}

/** The user's lists plus the one picked through the `?list=<id>` query parameter. */
export function useListOptions(): ListOptions {
  const { data, loading, error, reload } = useAsync('lists', api.lists.all);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get(LIST_PARAM);

  const lists = data ?? [];
  const selectedList = lists.find((list) => list.id === requestedId) ?? lists[0] ?? null;
  const selectedId = selectedList?.id ?? null;

  // Keep the address bar in step when the parameter is missing or names an unknown list.
  useEffect(() => {
    if (selectedId === null || selectedId === requestedId) return;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(LIST_PARAM, selectedId);
        return next;
      },
      { replace: true }
    );
  }, [selectedId, requestedId, setSearchParams]);

  const select = useCallback(
    (listId: string) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set(LIST_PARAM, listId);
        return next;
      });
    },
    [setSearchParams]
  );

  return { lists, loading, error, reload, selectedId, selectedList, select };
}
