/**
 * Money helpers. Amounts are plain numbers of currency units (3.2 means $3.20); arithmetic that
 * must be exact is done in integer cents.
 *
 * Rounding is decimal, not binary: a value is first snapped to 15 significant digits (which removes
 * the representation and arithmetic noise of doubles, e.g. 1.005 is stored as 1.00499999999999989...)
 * and then shifted by a power of ten through its decimal exponent, so no multiplication can
 * reintroduce an error before Math.round sees the value.
 *
 * Every rounding helper maps non-finite input (NaN, Infinity) to 0 and never returns -0.
 */

/** Significant digits kept before rounding; a double carries 15 reliably. */
const SAFE_PRECISION = 15;

/** Normalises -0 to 0 (and leaves every other number alone). */
function noNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Multiplies a finite number by 10^exponent exactly in decimal, by editing the exponent of its
 * decimal representation ("1.005" with exponent 2 becomes "1.005e2", which parses to exactly 100.5).
 */
function shiftDecimal(value: number, exponent: number): number {
  const [mantissa, ownExponent = '0'] = value.toPrecision(SAFE_PRECISION).split('e');
  return Number(`${mantissa}e${Number(ownExponent) + exponent}`);
}

/**
 * value x 10^digits rounded to an integer, half away from zero. The result is the count of
 * 10^-digits units (cents when digits is 2). Non-finite input gives 0.
 */
function roundToUnits(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.round(shiftDecimal(Math.abs(value), digits));
  return noNegativeZero(value < 0 ? -magnitude : magnitude);
}

/**
 * Converts a currency amount to a whole number of cents (half cents round away from zero).
 * Non-finite input yields 0 so that a bad value can never poison a sum.
 */
export function toCents(amount: number): number {
  return roundToUnits(amount, 2);
}

/** Converts a whole number of cents back to currency units (1234 -> 12.34). */
export function fromCents(cents: number): number {
  // A fractional cent count is rounded first so the result is always exact cents. Dividing an
  // integer by 100 gives the double nearest to the decimal, i.e. the same value as the literal.
  return noNegativeZero(roundToUnits(cents, 0) / 100);
}

/** Rounds a currency amount to whole cents, avoiding binary float drift (1.005 -> 1.01). */
export function roundCents(amount: number): number {
  return fromCents(toCents(amount));
}

/** Rounds to `digits` decimals, half away from zero, without binary float drift (2.675 -> 2.68). */
export function roundTo(value: number, digits = 2): number {
  const units = roundToUnits(value, digits);
  return units === 0 ? 0 : shiftDecimal(units, -digits);
}

/** Sums amounts exactly by working in integer cents. */
export function sumMoney(amounts: number[]): number {
  let cents = 0;
  for (const amount of amounts) cents += toCents(amount);
  return fromCents(cents);
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string): Intl.NumberFormat {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    moneyFormatters.set(currency, formatter);
  }
  return formatter;
}

/** "$1,234.50". */
export function formatMoney(amount: number, currency = 'USD'): string {
  // Rounding first gives half-away-from-zero cents and turns -0.004, -0 and NaN into 0,
  // so the output is never "-$0.00" or "$NaN".
  return moneyFormatter(currency).format(roundCents(amount));
}

/** "19.80%" (two decimals by default). */
export function formatPct(value: number, digits = 2): string {
  // roundTo does the (drift-free) rounding; toFixed only pads an already exact value, so the
  // result has no thousands separator and never reads "-0.00%".
  return `${roundTo(value, digits).toFixed(digits)}%`;
}
