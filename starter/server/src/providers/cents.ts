/**
 * The `cents` feed format (TECH_SPEC 4 and 4.1), used by Harvest Foods, City Pantry and Budget Basket:
 *
 *   item_code;description;price_cents;promo_price_cents
 *   GS-001;WHOLE MILK 1 GAL;360;
 *   GS-012;SALMON FILLET 1 LB;949;790
 *
 * Semicolon-separated, amounts in whole cents. The promo column changes what `price_cents` means:
 * - no promo (empty cell): `price_cents` is what the shopper pays; not on sale;
 * - with a promo: the promo is what the shopper pays (`price`), `price_cents` is the regular price,
 *   and the row is on sale. A promo that is not below `price_cents` is still the price paid, and
 *   `regularPrice` is raised to it (D-65, confirmed by the product owner).
 *
 * A row is skipped (and counted) when the item code is empty, `price_cents` is not a positive
 * integer (so `3.99` and `0` are skipped), `promo_price_cents` is present but not a positive
 * integer, or the row has too few fields (a row without its trailing `;` lacks the promo cell).
 * `description` is not read (the item code is the key) and may be absent (D-61).
 * Every skipped or adjusted row is logged with its line number and reason (D-77).
 */
import { parseFeed, parseIntegerCents, priceRow, quote, skip } from './parse';
import type { PriceProvider } from './types';

const COLUMNS = {
  itemCode: 'item_code',
  priceCents: 'price_cents',
  promoCents: 'promo_price_cents',
} as const;

export const centsProvider: PriceProvider = {
  id: 'cents',
  parse(csvText, options) {
    return parseFeed(
      csvText,
      {
        provider: 'cents',
        delimiter: ';',
        columns: COLUMNS,
        readRow: (cells) => {
          if (cells.itemCode === '') return skip('empty_sku', 'item code is empty');
          const shelf = parseIntegerCents(cells.priceCents);
          if (shelf === null) {
            return skip('invalid_price', `price_cents ${quote(cells.priceCents)} is not a positive whole number of cents`);
          }
          if (cells.promoCents === '') return priceRow(cells.itemCode, shelf, null, false);
          const promo = parseIntegerCents(cells.promoCents);
          if (promo === null) {
            return skip('invalid_promo', `promo_price_cents ${quote(cells.promoCents)} is not a positive whole number of cents`);
          }
          return priceRow(cells.itemCode, promo, shelf, true);
        },
      },
      options,
    );
  },
};
