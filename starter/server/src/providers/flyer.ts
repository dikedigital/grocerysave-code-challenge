/**
 * The `flyer` feed format (TECH_SPEC 4 and 4.1), used by Corner Co-op and Sunrise Market:
 *
 *   SKU,Name,Unit Price,Sale?,Was
 *   GS-001,Whole Milk 1 gal,$3.46,N,
 *   GS-003,Chicken Breast 2 lb,$9.13,Y,$11.49
 *
 * Comma-separated, prices like `$4.01` (the `$` is optional, D-63), `Sale?` a flag (`Y`/`N` and the
 * other recognised flags), `Was` the regular price or empty. `Unit Price` is what the shopper pays.
 * - `Sale? = Y` with a `Was`: on sale, regularPrice = Was (raised to the price if lower, D-65);
 * - `Sale? = Y` with an empty `Was`: on sale, regularPrice = price (spec);
 * - `Sale? = N`: not on sale, regularPrice = price; a valid `Was` is ignored (D-65).
 *
 * A row is skipped (and counted) when the SKU is empty, the unit price is not a positive amount,
 * `Sale?` is not a recognised flag, `Was` is present but not a positive amount (whatever the flag),
 * or the row has too few fields: a row without its `Was` cell is skipped too, by the product owner's
 * decision (D-62, stricter than the spec). `Name` is not read and may be absent (D-61).
 * Every skipped or adjusted row is logged with its line number and reason (D-77).
 */
import { parseAmountCents, parseFeed, parseSaleFlag, priceRow, quote, skip } from './parse';
import type { PriceProvider } from './types';

const COLUMNS = {
  sku: 'SKU',
  unitPrice: 'Unit Price',
  sale: 'Sale?',
  was: 'Was',
} as const;

export const flyerProvider: PriceProvider = {
  id: 'flyer',
  parse(csvText, options) {
    return parseFeed(
      csvText,
      {
        provider: 'flyer',
        delimiter: ',',
        columns: COLUMNS,
        readRow: (cells) => {
          if (cells.sku === '') return skip('empty_sku', 'SKU is empty');
          const price = parseAmountCents(cells.unitPrice);
          if (price === null) return skip('invalid_price', `Unit Price ${quote(cells.unitPrice)} is not a positive amount`);
          const onSale = parseSaleFlag(cells.sale);
          if (onSale === null) return skip('invalid_flag', `Sale? ${quote(cells.sale)} is not a recognised flag`);
          let was: number | null = null;
          if (cells.was !== '') {
            was = parseAmountCents(cells.was);
            if (was === null) return skip('invalid_was', `Was ${quote(cells.was)} is not a positive amount`);
          }
          return priceRow(cells.sku, price, was, onSale);
        },
      },
      options,
    );
  },
};
