import type { ComparisonResponse } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

/** The comparison matrix as CSV text: one row per item, then the same footer rows as the table. */
export function buildComparisonCsv(data: ComparisonResponse): string {
  return notImplemented(data);
}

/** Offers `text` to the browser as a CSV download (with a BOM so spreadsheets read UTF-8). */
export function downloadCsv(filename: string, text: string): void {
  return notImplemented(filename, text);
}

/** "Weekly shop" -> "weekly-shop-comparison.csv". */
export function csvFilename(listName: string): string {
  return notImplemented(listName);
}
