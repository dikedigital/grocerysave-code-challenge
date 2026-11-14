import { useCallback, useMemo } from 'react';
import type { Notification } from '../models';
import { api } from '../services/api';
import { useAsync } from './useAsync';

export interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export function useNotifications(): NotificationsState {
  const { data, loading, error, reload, setData } = useAsync(
    'notifications',
    api.notifications.all
  );
  const notifications = useMemo(() => data ?? [], [data]);
  const unreadCount = notifications.filter((notification) => notification.readAt === null).length;

  const markRead = useCallback(
    async (id: string) => {
      const updated = await api.notifications.markRead(id);
      setData(notifications.map((notification) => (notification.id === id ? updated : notification)));
    },
    [notifications, setData]
  );

  const markAllRead = useCallback(async () => {
    await api.notifications.markAllRead();
    // The endpoint only returns a count, so read the list back for the server's timestamps.
    reload();
  }, [reload]);

  return { notifications, unreadCount, loading, error, reload, markRead, markAllRead };
}
