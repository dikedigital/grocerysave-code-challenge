import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvRecords } from '../../../../src/utils/csv';
import { centsProvider } from '../cents';
import { flyerProvider } from '../flyer';
import { getProvider } from '../index';
import { standardProvider } from '../standard';

/** Calls getProvider and returns what it threw (fails the test if it did not throw). */
function thrownBy(id: unknown): unknown {
  try {
    getProvider(id as string);
  } catch (error) {
    return error;
  }
  throw new Error(`getProvider(${String(id)}) did not throw`);
}

describe('getProvider: known ids', () => {
  it.each([
    ['standard', standardProvider],
    ['cents', centsProvider],
    ['flyer', flyerProvider],
  ])('%p returns that adapter (the same object every time)', (id, adapter) => {
    expect(getProvider(id)).toBe(adapter);
    expect(getProvider(id)).toBe(getProvider(id));
    expect(getProvider(id).id).toBe(id);
  });

  it('every provider named in data/stores.csv resolves', () => {
    const stores = parseCsvRecords(readFileSync(join(__dirname, '../../../../data/stores.csv'), 'utf8'));
    const ids = [...new Set(stores.map((store) => store.provider))].sort();
    expect(ids).toEqual(['cents', 'flyer', 'standard']);
    for (const id of ids) expect(getProvider(id).id).toBe(id);
  });

  it('the adapter it returns parses its own format', () => {
    expect(getProvider('flyer').parse('SKU,Name,Unit Price,Sale?,Was\nGS-001,Milk,$3.46,N,\n').rows).toEqual([
      { sku: 'GS-001', price: 3.46, regularPrice: 3.46, onSale: false },
    ]);
  });
});

describe('getProvider: unknown ids throw "Unknown price provider ..."', () => {
  it.each([
    // plain unknown ids and near misses (ids are exact and case-sensitive, D-68)
    'unknown', '', 'Standard', 'STANDARD', ' standard', 'standard ', 'cent', 'flyers', 'standard,cents',
    // keys inherited from Object.prototype: a plain-object registry would return a function for these
    'toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf',
    'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__lookupGetter__', 'prototype',
    // members of Map itself (the registry is a Map; these must not leak either)
    'get', 'has', 'size', 'set', 'keys',
  ])('%p', (id) => {
    const error = thrownBy(id);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Unknown price provider/);
    expect((error as Error).message).toContain(JSON.stringify(id));
  });

  it('the message names the id and lists the known providers', () => {
    expect(() => getProvider('toString')).toThrow(
      new Error('Unknown price provider "toString" (known: standard, cents, flyer)'),
    );
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an array holding a known id (a plain object would coerce it to "standard")', ['standard']],
    ['an object whose toString gives a known id', { toString: () => 'cents' }],
    ['a symbol', Symbol('standard')],
    ['an object with no prototype', Object.create(null)],
  ])('a non-string id: %s', (_label, id) => {
    const error = thrownBy(id);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/^Unknown price provider/);
  });

  it('throws when called, so a caller can catch it per chain (TECH_SPEC 4.2)', () => {
    const outcomes = ['standard', 'toString', 'flyer'].map((id) => {
      try {
        return getProvider(id).id;
      } catch (error) {
        return (error as Error).message.slice(0, 22);
      }
    });
    expect(outcomes).toEqual(['standard', 'Unknown price provider', 'flyer']);
  });
});
