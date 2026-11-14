import { notImplemented } from './notImplemented';

/**
 * Converts a currency amount to a whole number of cents (half cents round away from zero).
 * Non-finite input yields 0 so that a bad value can never poison a sum.
 */
export function toCents(amount: number): number {
  return notImplemented(amount);
}

/** Converts a whole number of cents back to currency units (1234 -> 12.34). */
export function fromCents(cents: number): number {
  return notImplemented(cents);
}

/** Rounds a currency amount to whole cents, avoiding binary float drift (1.005 -> 1.01). */
export function roundCents(amount: number): number {
  return notImplemented(amount);
}

/** Rounds to `digits` decimals, half away from zero, without binary float drift (2.675 -> 2.68). */
export function roundTo(value: number, digits = 2): number {
  return notImplemented(value, digits);
}

/** Sums amounts exactly by working in integer cents. */
export function sumMoney(amounts: number[]): number {
  return notImplemented(amounts);
}

/** "$1,234.50". */
export function formatMoney(amount: number, currency = 'USD'): string {
  return notImplemented(amount, currency);
}

/** "19.80%" (two decimals by default). */
export function formatPct(value: number, digits = 2): string {
  return notImplemented(value, digits);
}
