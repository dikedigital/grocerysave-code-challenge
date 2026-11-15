import { GOLDEN_EXPECTED, GOLDEN_PRODUCTS } from '../../../tests/fixtures/spreadsheet';
import { formatMoney, formatPct, fromCents, roundCents, roundTo, sumMoney, toCents } from '../money';

// Note: Jest's toBe uses Object.is, so `toBe(0)` also fails for -0. The negative-zero tests rely on it.

describe('half-cent rounding (half away from zero, no binary drift)', () => {
  it.each([
    // [input, cents, rounded]: each of these is stored just below the half cent as a double.
    [1.005, 101, 1.01],
    [2.675, 268, 2.68],
    [1.115, 112, 1.12],
    [0.285, 29, 0.29],
    [-1.005, -101, -1.01],
    [-2.675, -268, -2.68],
    [-0.285, -29, -0.29],
  ])('%p -> %p cents, %p', (input, cents, rounded) => {
    expect(toCents(input)).toBe(cents);
    expect(roundCents(input)).toBe(rounded);
    expect(roundTo(input)).toBe(rounded);
  });

  it('rounds every half cent from $0.005 to $99.995 up, and its negative down', () => {
    const wrong: string[] = [];
    for (let dollars = 0; dollars < 100; dollars++) {
      for (let cents = 0; cents < 100; cents++) {
        const text = `${dollars}.${String(cents).padStart(2, '0')}5`;
        const expected = dollars * 100 + cents + 1;
        if (toCents(Number(text)) !== expected) wrong.push(text);
        if (toCents(-Number(text)) !== -expected) wrong.push(`-${text}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('rounds values that reach a half cent through arithmetic', () => {
    // 2.5 + 0.175 and 1.1 * 1.05 land a hair away from the exact decimal.
    expect(roundCents(2.5 + 0.175)).toBe(2.68);
    expect(roundCents(1.1 * 1.05)).toBe(1.16);
    expect(toCents(4.35 * 3)).toBe(1305);
  });

  it('leaves values below or above the half cent on the right side', () => {
    expect(roundCents(1.0049)).toBe(1);
    expect(roundCents(1.0051)).toBe(1.01);
    expect(roundCents(-1.0049)).toBe(-1);
    expect(roundCents(12.34)).toBe(12.34);
    expect(roundCents(7)).toBe(7);
  });

  it('handles large amounts', () => {
    expect(roundCents(123456789.125)).toBe(123456789.13);
    expect(toCents(99999999.995)).toBe(10000000000);
  });
});

describe('roundTo', () => {
  it('defaults to 2 digits', () => {
    expect(roundTo(2.675)).toBe(2.68);
  });

  it.each([
    [1.0005, 3, 1.001],
    [0.3333333, 3, 0.333],
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [1.45, 1, 1.5],
    [-1.45, 1, -1.5],
    [10.004, 2, 10],
    [19.801516387043044, 2, 19.8],
    [1234, -2, 1200],
  ])('roundTo(%p, %p) = %p', (value, digits, expected) => {
    expect(roundTo(value, digits)).toBe(expected);
  });
});

describe('adding money', () => {
  it('0.1 + 0.2 is exactly 0.3', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the float problem being avoided
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });

  it('ten dimes are exactly one dollar', () => {
    expect(sumMoney(Array(10).fill(0.1))).toBe(1);
  });

  it('reproduces the golden store totals exactly', () => {
    GOLDEN_EXPECTED.storeTotals.forEach((total, store) => {
      expect(sumMoney(GOLDEN_PRODUCTS.map((product) => product.prices[store]))).toBe(total);
    });
  });

  it('rounds each amount to cents before adding', () => {
    // Half cents are settled per amount (1.01 + 1.01), not on the raw sum (2.01).
    expect(sumMoney([1.005, 1.005])).toBe(2.02);
  });

  it('sums negatives and an empty list', () => {
    expect(sumMoney([5, -1.25, -3.75])).toBe(0);
    expect(sumMoney([-0.1, -0.2])).toBe(-0.3);
    expect(sumMoney([])).toBe(0);
  });
});

describe('cents conversion', () => {
  it('converts to and from cents', () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.07)).toBe(7);
    expect(toCents(19.99)).toBe(1999);
    expect(fromCents(1234)).toBe(12.34);
    expect(fromCents(7)).toBe(0.07);
    expect(fromCents(-250)).toBe(-2.5);
  });

  it('round-trips every cent amount up to $100', () => {
    for (let cents = 0; cents <= 10000; cents++) {
      if (toCents(fromCents(cents)) !== cents) throw new Error(`round trip failed for ${cents}`);
      if (fromCents(cents) !== Number((cents / 100).toFixed(2))) throw new Error(`not exact: ${cents}`);
    }
  });

  it('rounds a fractional cent count to a whole cent', () => {
    expect(fromCents(1234.5)).toBe(12.35);
    expect(fromCents(-1234.5)).toBe(-12.35);
  });
});

describe('NaN and Infinity', () => {
  it.each([NaN, Infinity, -Infinity])('%p becomes 0 in every rounding helper', (bad) => {
    expect(toCents(bad)).toBe(0);
    expect(fromCents(bad)).toBe(0);
    expect(roundCents(bad)).toBe(0);
    expect(roundTo(bad)).toBe(0);
    expect(roundTo(bad, 0)).toBe(0);
  });

  it('cannot poison a sum', () => {
    expect(sumMoney([1.5, NaN, 2.25, Infinity, -Infinity])).toBe(3.75);
  });

  it('formats as zero', () => {
    expect(formatMoney(NaN)).toBe('$0.00');
    expect(formatMoney(Infinity)).toBe('$0.00');
    expect(formatPct(NaN)).toBe('0.00%');
    expect(formatPct(-Infinity)).toBe('0.00%');
  });
});

describe('negative zero', () => {
  it('is never returned', () => {
    expect(toCents(-0)).toBe(0);
    expect(toCents(-0.004)).toBe(0);
    expect(fromCents(-0)).toBe(0);
    expect(roundCents(-0)).toBe(0);
    expect(roundCents(-0.004)).toBe(0);
    expect(roundTo(-0.0004, 3)).toBe(0);
    expect(roundTo(-0.4, 0)).toBe(0);
    expect(sumMoney([-0])).toBe(0);
    expect(sumMoney([0.1, -0.1])).toBe(0);
  });

  it('never formats with a minus sign', () => {
    expect(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(-0)).toBe('-$0.00'); // why it matters
    expect(formatMoney(-0)).toBe('$0.00');
    expect(formatMoney(-0.004)).toBe('$0.00');
    expect(formatPct(-0)).toBe('0.00%');
    expect(formatPct(-0.004)).toBe('0.00%');
    expect(formatPct(-0.4, 0)).toBe('0%');
  });
});

describe('formatMoney', () => {
  it.each([
    [0, '$0.00'],
    [3.2, '$3.20'],
    [12.345, '$12.35'],
    [1234.5, '$1,234.50'],
    [1234567.891, '$1,234,567.89'],
    [-1, '-$1.00'],
    [-1234.5, '-$1,234.50'],
    [1.005, '$1.01'],
    [-1.005, '-$1.01'],
    [2.675, '$2.68'],
    [0.005, '$0.01'],
    [-0.005, '-$0.01'],
  ])('formatMoney(%p) = %p', (amount, expected) => {
    expect(formatMoney(amount)).toBe(expected);
  });

  it('accepts another currency', () => {
    expect(formatMoney(1234.5, 'EUR')).toBe('€1,234.50');
  });
});

describe('formatPct', () => {
  it.each([
    [19.801516387043044, '19.80%'],
    [0, '0.00%'],
    [3.5, '3.50%'],
    [-2, '-2.00%'],
    [2.675, '2.68%'],
    [-2.675, '-2.68%'],
    [10.004, '10.00%'],
    [1234.5, '1234.50%'], // no thousands separator
    [100, '100.00%'],
  ])('formatPct(%p) = %p', (value, expected) => {
    expect(formatPct(value)).toBe(expected);
  });

  it('honours the digits argument', () => {
    expect(formatPct(33.33333, 1)).toBe('33.3%');
    expect(formatPct(2.5, 0)).toBe('3%');
    expect(formatPct(1.0005, 3)).toBe('1.001%');
  });
});
