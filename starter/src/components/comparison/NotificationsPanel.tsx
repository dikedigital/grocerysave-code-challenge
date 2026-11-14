import React, { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { errorMessage } from '../../hooks/useAsync';
import { useNotifications } from '../../hooks/useNotifications';
import type { Notification } from '../../models';
import { formatMoney } from '../../utils/money';
import Button from '../ui/Button';
import { formatDateTime } from './format';
import { ErrorPanel, LoadingPanel } from './StatusPanel';
import { cardClass } from './styles';

/** Unread first, then newest first. */
function byUnreadThenNewest(a: Notification, b: Notification): number {
  const unreadA = a.readAt === null ? 0 : 1;
  const unreadB = b.readAt === null ? 0 : 1;
  if (unreadA !== unreadB) return unreadA - unreadB;
  return b.createdAt.localeCompare(a.createdAt);
}

const NotificationItem: React.FC<{
  notification: Notification;
  busy: boolean;
  onMarkRead: (id: string) => void;
}> = ({ notification, busy, onMarkRead }) => {
  const unread = notification.readAt === null;
  return (
    <li className={`flex items-start gap-3 p-4 ${unread ? 'bg-green-50' : ''}`}>
      <span
        className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${unread ? 'bg-green-600' : 'bg-gray-300'}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">
          {unread && <span className="mr-2 rounded bg-green-600 px-1.5 py-0.5 text-xs font-semibold text-white">New</span>}
          {notification.title}
        </p>
        <p className="mt-0.5 text-sm text-gray-700">{notification.body}</p>
        {notification.oldPrice !== null && notification.newPrice !== null && (
          <p className="mt-0.5 text-sm text-gray-600">
            <span className="line-through">{formatMoney(notification.oldPrice)}</span>
            {' → '}
            <span className="font-semibold text-gray-900">{formatMoney(notification.newPrice)}</span>
          </p>
        )}
        <p className="mt-1 text-xs text-gray-500">{formatDateTime(notification.createdAt)}</p>
      </div>
      {unread && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onMarkRead(notification.id)}>
          Mark read
          <span className="sr-only">: {notification.title}</span>
        </Button>
      )}
    </li>
  );
};

/** Price-drop notifications with mark-one and mark-all-read. */
const NotificationsPanel: React.FC = () => {
  const { notifications, unreadCount, loading, error, reload, markRead, markAllRead } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="notifications-heading" className={cardClass}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-gray-500" aria-hidden="true" />
          <h2 id="notifications-heading" className="text-lg font-semibold text-gray-900">
            Notifications
          </h2>
          {unreadCount > 0 && (
            <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">
              {unreadCount} unread
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || unreadCount === 0}
          onClick={() => void run(markAllRead)}
        >
          <CheckCheck className="mr-2 h-4 w-4" aria-hidden="true" />
          Mark all read
        </Button>
      </header>

      {actionError && (
        <div className="p-4">
          <ErrorPanel message={actionError} />
        </div>
      )}
      {loading && <LoadingPanel label="Loading notifications..." />}
      {error && (
        <div className="p-4">
          <ErrorPanel message={error} onRetry={reload} />
        </div>
      )}
      {!loading && !error && notifications.length === 0 && (
        <p className="px-6 py-10 text-center text-sm text-gray-600">
          No notifications yet. You are told here when a product on your lists drops in price (turn this on in
          Settings).
        </p>
      )}
      {notifications.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {[...notifications].sort(byUnreadThenNewest).map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              busy={busy}
              onMarkRead={(id) => void run(() => markRead(id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

export default NotificationsPanel;
