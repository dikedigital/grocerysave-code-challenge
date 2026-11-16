/**
 * Price feed adapters (TECH_SPEC 4.1). Each chain publishes a weekly CSV snapshot in one of three
 * formats; an adapter turns one snapshot into normalised price rows.
 */
import type { Logger } from '../logger';

/** One normalised price from a feed. Amounts are currency units with at most two decimals. */
export interface ProviderPriceRow {
  /** The product SKU as written in the feed (trimmed); not checked against the catalog here. */
  sku: string;
  /** What the shopper pays: the sale price when on sale. Always greater than 0. */
  price: number;
  /** The shelf price. Equals `price` when not on sale; never lower than `price` when on sale. */
  regularPrice: number;
  onSale: boolean;
}

export interface ProviderParseResult {
  /** The valid rows, in file order. */
  rows: ProviderPriceRow[];
  /** How many data rows were malformed and left out (blank lines are not rows). */
  skipped: number;
}

/** Optional context for `parse` (D-78): where the text comes from, and where to log. */
export interface ParseOptions {
  /** Names the feed in log records, e.g. `data/mock-api/valugrocer/2026-11-09.csv`. Default `(text)`. */
  source?: string;
  /** Receives the log records; default: the process logger (`providers.<id>`). */
  logger?: Logger;
}

export interface PriceProvider {
  /** The id stored in `chains.provider` (`standard`, `cents` or `flyer`). */
  id: string;
  /**
   * Parses one snapshot. Never throws on bad data: malformed rows are counted in `skipped`, and each
   * one is logged with its line number and reason (D-77).
   */
  parse(csvText: string, options?: ParseOptions): ProviderParseResult;
}
