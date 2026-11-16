/**
 * The `standard` feed format (TECH_SPEC 4 and 4.1), used by FreshMart, ValuGrocer and GreenLeaf:
 *
 *   sku,product_name,price,regular_price,on_sale
 *   GS-006,Large Eggs dozen,4.99,5.89,true
 *
 * Comma-separated, amounts in dollars, `on_sale` a flag. A row is skipped (and counted) when the SKU
 * is empty, `price` is not a positive amount, `regular_price` is present but not a positive amount,
 * `on_sale` is not a recognised flag, or the row has too few fields. An empty `regular_price` means
 * "equal to price". `product_name` is not read (the SKU is the key) and may be absent (D-61).
 * Every skipped or adjusted row is logged with its line number and reason (D-77).
 */
import { parseAmountCents, parseFeed, parseSaleFlag, priceRow, quote, skip } from './parse';
import type { PriceProvider } from './types';

const COLUMNS = {
  sku: 'sku',
  price: 'price',
  regularPrice: 'regular_price',
  onSale: 'on_sale',
} as const;

export const standardProvider: PriceProvider = {
  id: 'standard',
  parse(csvText, options) {
    return parseFeed(
      csvText,
      {
        provider: 'standard',
        delimiter: ',',
        columns: COLUMNS,
        readRow: (cells) => {
          if (cells.sku === '') return skip('empty_sku', 'SKU is empty');
          const price = parseAmountCents(cells.price);
          if (price === null) return skip('invalid_price', `price ${quote(cells.price)} is not a positive amount`);
          let regular: number | null = null;
          if (cells.regularPrice !== '') {
            regular = parseAmountCents(cells.regularPrice);
            if (regular === null) {
              return skip('invalid_regular_price', `regular_price ${quote(cells.regularPrice)} is not a positive amount`);
            }
          }
          const onSale = parseSaleFlag(cells.onSale);
          if (onSale === null) return skip('invalid_flag', `on_sale ${quote(cells.onSale)} is not a recognised flag`);
          return priceRow(cells.sku, price, regular, onSale);
        },
      },
      options,
    );
  },
};
