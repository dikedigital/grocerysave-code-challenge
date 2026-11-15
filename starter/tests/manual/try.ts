/**
 * Manual check of any pure helper in src/utils: evaluates each argument as an expression with every
 * export of src/utils in scope and prints the result as JSON (so -0, NaN and strings are visible).
 *
 *   npx tsx tests/manual/try.ts "roundCents(1.005)" "formatMoney(-0.004)" "parseQuantity('1 1/2')"
 *
 * Functions that are not implemented yet print "not implemented (...)".
 */
import * as utils from '../../src/utils';

function show(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (Object.is(value, -0)) return '-0';
  return JSON.stringify(value) ?? String(value);
}

const names = Object.keys(utils);
const scope = Object.values(utils);
const expressions = process.argv.slice(2);
if (expressions.length === 0) {
  console.error('usage: npx tsx tests/manual/try.ts "<expression>" ...');
  console.error(`in scope: ${names.join(', ')}`);
  process.exit(2);
}
let failed = false;
for (const expression of expressions) {
  try {
    const evaluate = new Function(...names, `"use strict"; return (${expression});`) as (...args: unknown[]) => unknown;
    console.log(`${expression}  ->  ${show(evaluate(...scope))}`);
  } catch (error) {
    failed = true;
    console.log(`${expression}  !!  ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exit(failed ? 1 : 0);
