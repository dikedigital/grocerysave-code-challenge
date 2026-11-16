/**
 * Checks the database against the golden spreadsheet (tests/fixtures/spreadsheet.ts, TECH_SPEC 9):
 * reads `current_prices` for GS-001..GS-016 at the 8 chains and compares every cell of the 16 x 8
 * matrix, plus the store totals (GOLDEN_EXPECTED.storeTotals). Prints the matrix with a mark per
 * cell; exits 1 on any difference.
 *
 *   npx tsx tests/manual/golden-db.ts            DATABASE_URL (what `npm run db:reset` filled)
 *   npx tsx tests/manual/golden-db.ts --test     TEST_DATABASE_URL
 */
import { config } from '../../server/src/config';
import { createPool } from '../../server/src/db/pool';
import { GOLDEN_CHAINS, GOLDEN_EXPECTED, GOLDEN_PRODUCTS } from '../fixtures/spreadsheet';

const useTest = process.argv.includes('--test');
const url = useTest ? config.testDatabaseUrl : config.databaseUrl;

async function main(): Promise<number> {
  const pool = createPool(url);
  try {
    const { rows } = await pool.query<{ chain_id: string; sku: string; price: number; effective_date: string; on_sale: boolean }>(`
      SELECT s.chain_id, p.sku, cp.price, cp.effective_date, cp.on_sale
      FROM current_prices cp JOIN stores s ON s.id = cp.store_id JOIN products p ON p.id = cp.product_id
      WHERE p.sku = ANY($1::text[])`, [GOLDEN_PRODUCTS.map((product) => product.sku)]);
    const cell = new Map(rows.map((row) => [`${row.chain_id}/${row.sku}`, row]));
    const stores = Number((await pool.query("SELECT count(*) AS n FROM stores")).rows[0].n);

    console.log(`database: ${new URL(url).pathname.slice(1)}; current_prices rows for the 16 golden SKUs: ${rows.length} (${stores} stores)\n`);
    console.log(`| SKU | ${GOLDEN_CHAINS.map((chain) => chain.id).join(' | ')} |`);
    console.log(`|---|${GOLDEN_CHAINS.map(() => '---').join('|')}|`);
    let mismatches = 0;
    const dates = new Set<string>();
    for (const product of GOLDEN_PRODUCTS) {
      const cells = GOLDEN_CHAINS.map((chain, column) => {
        const found = cell.get(`${chain.id}/${product.sku}`);
        const expected = product.prices[column];
        if (!found) {
          mismatches += 1;
          return `✗ missing (want ${expected.toFixed(2)})`;
        }
        dates.add(found.effective_date);
        if (found.price !== expected) {
          mismatches += 1;
          return `✗ ${found.price.toFixed(2)} (want ${expected.toFixed(2)})`;
        }
        return `${found.price.toFixed(2)}${found.on_sale ? '*' : ''} ✓`;
      });
      console.log(`| ${product.sku} | ${cells.join(' | ')} |`);
    }
    const totals = GOLDEN_CHAINS.map((chain) =>
      Math.round(GOLDEN_PRODUCTS.reduce((sum, product) => sum + Math.round((cell.get(`${chain.id}/${product.sku}`)?.price ?? 0) * 100), 0)) / 100,
    );
    const totalsOk = totals.every((total, index) => total === GOLDEN_EXPECTED.storeTotals[index]);
    console.log(`| **total** | ${totals.map((total, index) => `${total.toFixed(2)} ${total === GOLDEN_EXPECTED.storeTotals[index] ? '✓' : `✗ (want ${GOLDEN_EXPECTED.storeTotals[index]})`}`).join(' | ')} |`);
    console.log(`\n(* = on sale in the feed.) Effective date(s) of these current prices: ${[...dates].sort().join(', ')}`);
    console.log(`\n${128 - mismatches} of 128 cells match; store totals ${totalsOk ? 'match' : 'DO NOT match'} GOLDEN_EXPECTED.storeTotals`);
    return mismatches === 0 && totalsOk ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().then((code) => process.exit(code), (error) => {
  console.error(`golden-db failed: ${(error as Error).message}`);
  process.exit(1);
});
