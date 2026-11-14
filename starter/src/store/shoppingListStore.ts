import { create } from 'zustand';
import { api, ApiError, type ItemPatch, type NewItemInput } from '../services/api';
import { errorMessage } from '../config/errors';
import type { Household, ImportResponse, ListItem, ShoppingList } from '../models';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The one place the UI reads and changes shopping lists.
 *
 * `lists` backs the overview page, `current` the list that is open on the detail page.
 * Loaders record failures in `...Status` / `...Error`; mutations reject with the original
 * error so the calling form can show it next to the control that failed.
 */
interface ShoppingListState {
  lists: ShoppingList[];
  listsStatus: LoadStatus;
  listsError: string | null;

  current: ShoppingList | null;
  currentStatus: LoadStatus;
  currentError: string | null;

  /** Households the user belongs to: names for the "Shared" badge and options for the share control. */
  households: Household[];
  householdsStatus: LoadStatus;

  loadLists: () => Promise<void>;
  loadHouseholds: () => Promise<void>;
  createList: (name: string) => Promise<ShoppingList>;
  renameList: (listId: string, name: string) => Promise<void>;
  /** Shares the list with a household, or makes it private again with null. Owner only. */
  setListHousehold: (listId: string, householdId: string | null) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;

  openList: (listId: string) => Promise<void>;
  closeList: () => void;
  /** Re-fetches the open list and applies it only when its `updatedAt` changed. Used for polling. */
  refreshCurrent: () => Promise<void>;

  addItem: (listId: string, item: NewItemInput) => Promise<ListItem>;
  updateItem: (listId: string, itemId: string, patch: ItemPatch) => Promise<void>;
  removeItem: (listId: string, itemId: string) => Promise<void>;
  importItems: (listId: string, format: 'text' | 'csv', content: string) => Promise<ImportResponse>;

  /** Forgets everything; called when the signed-in user changes. */
  reset: () => void;
}

const initialState = {
  lists: [] as ShoppingList[],
  listsStatus: 'idle' as LoadStatus,
  listsError: null as string | null,
  current: null as ShoppingList | null,
  currentStatus: 'idle' as LoadStatus,
  currentError: null as string | null,
  households: [] as Household[],
  householdsStatus: 'idle' as LoadStatus,
};

// Bookkeeping that keeps slow responses from overwriting newer state.
/** Bumped on reset(): responses that belong to a previous session are dropped. */
let sessionEpoch = 0;
/** Bumped on openList()/closeList(): only the latest open request may set `current`. */
let openRequest = 0;
/** Local changes that are in flight, and a counter bumped whenever one starts or ends. */
let pendingMutations = 0;
let mutationCounter = 0;

/** Runs a change to the open list; polling results that overlap with it are discarded. */
async function mutation<T>(run: () => Promise<T>): Promise<T> {
  pendingMutations += 1;
  mutationCounter += 1;
  try {
    return await run();
  } finally {
    pendingMutations -= 1;
    mutationCounter += 1;
  }
}

type ListSlices = Pick<ShoppingListState, 'lists' | 'current'>;

/** Applies `change` to one list, both in the overview and (when it is the open one) in `current`. */
function changeList(
  state: ListSlices,
  listId: string,
  change: (list: ShoppingList) => ShoppingList
): ListSlices {
  return {
    lists: state.lists.map((list) => (list.id === listId ? change(list) : list)),
    current: state.current?.id === listId ? change(state.current) : state.current,
  };
}

function changeItems(
  state: ListSlices,
  listId: string,
  change: (items: ListItem[]) => ListItem[]
): ListSlices {
  return changeList(state, listId, (list) => ({ ...list, items: change(list.items) }));
}

export const useShoppingListStore = create<ShoppingListState>((set, get) => ({
  ...initialState,

  loadLists: async () => {
    const epoch = sessionEpoch;
    // Keep showing lists that are already loaded while they refresh.
    if (get().listsStatus !== 'ready') set({ listsStatus: 'loading' });
    set({ listsError: null });
    try {
      const lists = await api.lists.all();
      if (epoch !== sessionEpoch) return;
      set({ lists, listsStatus: 'ready' });
    } catch (error) {
      if (epoch !== sessionEpoch) return;
      set({
        listsStatus: 'error',
        listsError: errorMessage(error, 'Could not load your lists.'),
      });
    }
  },

  loadHouseholds: async () => {
    const epoch = sessionEpoch;
    if (get().householdsStatus !== 'ready') set({ householdsStatus: 'loading' });
    try {
      const households = await api.households.all();
      if (epoch !== sessionEpoch) return;
      set({ households, householdsStatus: 'ready' });
    } catch {
      if (epoch !== sessionEpoch) return;
      set({ householdsStatus: 'error' });
    }
  },

  createList: async (name) => {
    const list = await api.lists.create(name);
    set((state) => ({ lists: [list, ...state.lists] }));
    return list;
  },

  renameList: async (listId, name) => {
    const updated = await mutation(() => api.lists.update(listId, { name }));
    set((state) => changeList(state, listId, () => updated));
  },

  setListHousehold: async (listId, householdId) => {
    const updated = await mutation(() => api.lists.update(listId, { householdId }));
    set((state) => changeList(state, listId, () => updated));
  },

  deleteList: async (listId) => {
    await mutation(() => api.lists.remove(listId));
    set((state) => ({
      lists: state.lists.filter((list) => list.id !== listId),
      current: state.current?.id === listId ? null : state.current,
    }));
  },

  openList: async (listId) => {
    const epoch = sessionEpoch;
    openRequest += 1;
    const request = openRequest;

    // Show what the overview already knows while the fresh copy loads.
    const known =
      get().current?.id === listId
        ? get().current
        : (get().lists.find((list) => list.id === listId) ?? null);
    set({ current: known, currentStatus: 'loading', currentError: null });

    try {
      const list = await api.lists.get(listId);
      if (epoch !== sessionEpoch || request !== openRequest) return;
      set((state) => ({
        ...changeList(state, listId, () => list),
        current: list,
        currentStatus: 'ready',
      }));
    } catch (error) {
      if (epoch !== sessionEpoch || request !== openRequest) return;
      set({
        current: null,
        currentStatus: 'error',
        currentError: errorMessage(error, 'Could not load this list.'),
      });
    }
  },

  closeList: () => {
    openRequest += 1;
    set({ current: null, currentStatus: 'idle', currentError: null });
  },

  refreshCurrent: async () => {
    const before = get().current;
    if (!before || get().currentStatus !== 'ready' || pendingMutations > 0) return;

    const epoch = sessionEpoch;
    const request = openRequest;
    const mutationsBefore = mutationCounter;

    try {
      const fresh = await api.lists.get(before.id);
      // Drop the answer if anything changed locally while it was on its way.
      if (epoch !== sessionEpoch || request !== openRequest) return;
      if (mutationsBefore !== mutationCounter || pendingMutations > 0) return;

      const now = get().current;
      if (!now || now.id !== fresh.id || now.updatedAt === fresh.updatedAt) return;
      set((state) => ({ ...changeList(state, fresh.id, () => fresh), current: fresh }));
    } catch (error) {
      if (epoch !== sessionEpoch || request !== openRequest) return;
      // The list was deleted or is no longer shared with this user.
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        set((state) => ({
          lists: state.lists.filter((list) => list.id !== before.id),
          current: null,
          currentStatus: 'error',
          currentError: 'This list is no longer available. It may have been deleted or unshared.',
        }));
      }
      // Anything else (offline, server restarting) is retried on the next poll.
    }
  },

  addItem: async (listId, item) => {
    const created = await mutation(() => api.lists.addItem(listId, item));
    set((state) => changeItems(state, listId, (items) => [...items, created]));
    return created;
  },

  updateItem: async (listId, itemId, patch) => {
    const previous = get().current?.items.find((item) => item.id === itemId);
    const replaceWith = (next: ListItem) =>
      set((state) =>
        changeItems(state, listId, (items) => items.map((item) => (item.id === itemId ? next : item)))
      );

    await mutation(async () => {
      // Show the change at once; put the old values back if the server refuses it.
      if (previous) replaceWith({ ...previous, ...patch });
      try {
        replaceWith(await api.lists.updateItem(listId, itemId, patch));
      } catch (error) {
        if (previous) replaceWith(previous);
        throw error;
      }
    });
  },

  removeItem: async (listId, itemId) => {
    await mutation(() => api.lists.removeItem(listId, itemId));
    set((state) => changeItems(state, listId, (items) => items.filter((item) => item.id !== itemId)));
  },

  importItems: async (listId, format, content) => {
    const response = await mutation(() => api.lists.importItems(listId, format, content));
    set((state) => changeItems(state, listId, (items) => [...items, ...response.items]));
    return response;
  },

  reset: () => {
    sessionEpoch += 1;
    openRequest += 1;
    set({ ...initialState });
  },
}));

export default useShoppingListStore;
