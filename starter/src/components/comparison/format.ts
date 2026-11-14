import type { Store } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

/** "2", "0.5", "1.25". */
export function formatQuantity(quantity: number): string {
  return notImplemented(quantity);
}

/** "+$2.10" for a surcharge, "$0.00" for none, "-$1.00" for a saving. */
export function formatMoneyDelta(amount: number): string {
  return notImplemented(amount);
}

/** "+3.50%" for a surcharge, "0.00%" for none. */
export function formatPctDelta(value: number): string {
  return notImplemented(value);
}

/** "3.2 km". */
export function formatKm(km: number): string {
  return notImplemented(km);
}

/** "45 min", "1 h", "1 h 20 min". */
export function formatDuration(minutes: number): string {
  return notImplemented(minutes);
}

/** "Nov 13, 2026, 8:30 AM" from an ISO timestamp. */
export function formatDateTime(iso: string): string {
  return notImplemented(iso);
}

/** "Nov 13, 2026" from a feed date 'YYYY-MM-DD' (read as a calendar date, so no timezone shift). */
export function formatFeedDate(feedDate: string): string {
  return notImplemented(feedDate);
}

/** Store name, with the chain appended when the name does not already contain it. */
export function storeLabel(store: Pick<Store, 'name' | 'chainName'>): string {
  return notImplemented(store);
}
