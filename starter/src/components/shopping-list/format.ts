import { notImplemented } from '../../utils/notImplemented';

/** "Nov 13, 2026" (en-US, in the local time zone); empty when the timestamp is not a date. */
export function formatDate(iso: string): string {
  return notImplemented(iso);
}

/** 2 -> "2", 1.5 -> "1.5", 0.333333 -> "0.333". */
export function formatQuantity(quantity: number): string {
  return notImplemented(quantity);
}

/** Groups items by category: alphabetical, with "Other" last. Items keep their order within a group. */
export function groupByCategory<T extends { category: string }>(items: T[]): { category: string; items: T[] }[] {
  return notImplemented(items);
}
