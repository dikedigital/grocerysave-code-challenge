import fs from 'node:fs';
import path from 'node:path';
import {
  parseListCsv,
  parseListCsvDetailed,
  parseListLine,
  parseListLineDetailed,
  parseListText,
  parseListTextDetailed,
  type ParsedLine,
} from '../parseList';
import type { ParsedItem } from '../../models';

/** D-147, option A: the detailed parsers say whether a unit was written; the plain ones are unchanged. */
describe('parseListLineDetailed: unitWritten', () => {
  it.each([
    ['milk', 'each', false],
    ['2 milk', 'each', false],
    ['milk x2', 'each', false],
    ['2x milk', 'each', false],
    ['milk (2)', 'each', false],
    ['milk, 2', 'each', false],
    ['milk - 2', 'each', false],
    ['2 lb', 'each', false], // "lb" is the name (D-07)
    ['2 each milk', 'each', true],
    ['2 ea milk', 'each', true],
    ['3 pcs eggs', 'each', true],
    ['2 lb chicken', 'lb', true],
    ['500g flour', 'g', true],
    ['2 cans of tomatoes', 'can', true],
    ['milk (1.5 kg)', 'kg', true],
    ['rice, 1.5 kg', 'kg', true],
    ['rice - 2 kg', 'kg', true],
  ])('%p: unit %p, written %p', (line, unit, written) => {
    expect(parseListLineDetailed(line)).toMatchObject({ unit, unitWritten: written });
  });

  it('blank lines and comments are null, as in parseListLine', () => {
    expect(parseListLineDetailed('')).toBeNull();
    expect(parseListLineDetailed('# note')).toBeNull();
  });
});

describe('parseListTextDetailed', () => {
  it('a merged item counts as written when any of its lines wrote the unit', () => {
    expect(parseListTextDetailed('milk\nmilk x2')).toEqual([{ name: 'milk', quantity: 3, unit: 'each', unitWritten: false }]);
    expect(parseListTextDetailed('milk\n2 each milk')).toEqual([{ name: 'milk', quantity: 3, unit: 'each', unitWritten: true }]);
    expect(parseListTextDetailed('2 each milk\nmilk')).toEqual([{ name: 'milk', quantity: 3, unit: 'each', unitWritten: true }]);
  });
});

describe('parseListCsvDetailed', () => {
  it('written when the unit cell is not empty (known or not) or the quantity cell carries a unit', () => {
    const items = parseListCsvDetailed('name,quantity,unit\nmilk,2,\nrice,1,kg\ncandles,2,tub\nflour,2 lb,\nsugar,2 cups,');
    expect(items.map((i) => [i.name, i.unit, i.unitWritten])).toEqual([
      ['milk', 'each', false],
      ['rice', 'kg', true],
      ['candles', 'each', true], // unknown units become each (TECH_SPEC 5.2), but one was written
      ['flour', 'lb', true],
      ['sugar', 'each', true],
    ]);
  });
});

describe('the plain parsers are the detailed ones without unitWritten', () => {
  const samples = path.join(__dirname, '../../../tests/manual/samples');
  const files = fs.readdirSync(samples).sort();
  it.each(files)('%s', (file) => {
    const content = fs.readFileSync(path.join(samples, file), 'utf8');
    const strip = ({ unitWritten, ...item }: ParsedLine): ParsedItem => {
      void unitWritten;
      return item;
    };
    expect(parseListTextDetailed(content).map(strip)).toEqual(parseListText(content));
    expect(parseListCsvDetailed(content).map(strip)).toEqual(parseListCsv(content));
    for (const line of content.split(/\r\n|\r|\n/)) {
      const detailed = parseListLineDetailed(line);
      expect(detailed === null ? null : strip(detailed)).toEqual(parseListLine(line));
    }
  });
});
