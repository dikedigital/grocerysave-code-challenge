import { create } from 'zustand';
import { api } from '../services/api';

interface NotificationState {
  /** Notifications the user has not read yet; shown as a badge on the Deals link. */
  unreadCount: number;
  /** Re-reads the count from the API. Rejects with the API error so callers can react to a 401. */
  refresh: () => Promise<void>;
  reset: () => void;
}

/**
 * Unread-notification count for the navbar badge. The navbar refreshes it every minute;
 * call `useNotificationStore.getState().refresh()` after marking notifications read to update it at once.
 */
export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: 0,

  refresh: async () => {
    const notifications = await api.notifications.all();
    set({ unreadCount: notifications.filter((notification) => notification.readAt === null).length });
  },

  reset: () => set({ unreadCount: 0 }),
}));
