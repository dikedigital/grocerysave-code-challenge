import type { CSSProperties } from 'react';
import { notImplemented } from '../../utils/notImplemented';

export type HeatRank = 'lowest' | 'highest' | 'middle';

export interface Heat {
  style: CSSProperties;
  rank: HeatRank;
}

/**
 * Heat colour of `value` between the lowest and highest value of its row (or column).
 * The lowest value is deep green with white bold text; everything above it is a pastel on the
 * green -> yellow -> orange -> red scale with dark text, so text stays readable on every step.
 * When every value is equal they are all "lowest".
 */
export function heatColor(value: number, low: number, high: number): Heat {
  return notImplemented(value, low, high);
}

/** Swatches for a legend, from lowest to highest, using the same colours as the table. */
export function heatLegendSteps(count = 5): Heat[] {
  return notImplemented(count);
}
