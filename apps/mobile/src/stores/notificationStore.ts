import { useUnreadNotificationCount } from '@grocery-app/shared';

/**
 * Customer notification helpers, now backed by the real `/api/notifications`
 * endpoints. Anything more than the unread count belongs in the inbox screen
 * itself via `useNotifications()` from @grocery-app/shared — kept thin here
 * so AppHeader's badge stays a one-liner.
 */
export function useUnreadCount(): number {
  const { data } = useUnreadNotificationCount({ refetchInterval: 60_000 });
  return data?.count ?? 0;
}
