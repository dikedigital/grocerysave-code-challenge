import { parseCsv } from '../../../../src/utils/csv';
import { splitRecords } from '../parse';
import { seededRandom } from './helpers';

const lines = (text: string, delimiter = ',') => splitRecords(text, delimiter).map((record) => [record.line, record.text]);

describe('splitRecords: records and the line each starts on (D-75)', () => {
  it('one record per line, numbered from 1; LF, CRLF and a lone CR all end a line', () => {
    expect(lines('h\na\r\nb\rc')).toEqual([[1, 'h'], [2, 'a'], [3, 'b'], [4, 'c']]);
    expect(lines('h\na\n')).toEqual([[1, 'h'], [2, 'a']]);
  });

  it('keeps blank lines as (blank) records, so the numbering follows the file', () => {
    expect(lines('h\n\n  \na\n')).toEqual([[1, 'h'], [2, ''], [3, '  '], [4, 'a']]);
  });

  it('a quoted field spanning lines is one record; the next record gets the right line', () => {
    expect(lines('h\n"a\nb\r\nc",1\nd\n')).toEqual([[1, 'h'], [2, '"a\nb\r\nc",1'], [5, 'd']]);
  });

  it('escaped quotes, separators inside quotes, and quotes that are data', () => {
    expect(lines('"x ""y"" \n z",1\nab"c\n"q"r"\ns\n')).toEqual([[1, '"x ""y"" \n z",1'], [3, 'ab"c'], [4, '"q"r"'], [5, 's']]);
  });

  it('drops a leading byte order mark', () => {
    expect(lines('\uFEFFh\na')).toEqual([[1, 'h'], [2, 'a']]);
  });

  it('an unterminated quote runs to the end of the text, as in parseCsv', () => {
    expect(lines('h\n"a\nb\nc')).toEqual([[1, 'h'], [2, '"a\nb\nc']]);
  });

  it('on random text: splitting then parsing each record gives exactly parseCsv of the whole text', () => {
    const random = seededRandom(74);
    const alphabet = ['a', 'b', ' ', '"', '""', ',', ';', '\n', '\r', '\r\n', '\t', 'x y'];
    for (let run = 0; run < 3000; run += 1) {
      const length = Math.floor(random() * 30);
      let text = random() < 0.1 ? '\uFEFF' : '';
      for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(random() * alphabet.length)];
      for (const delimiter of [',', ';']) {
        const records = splitRecords(text, delimiter);
        const viaRecords = records.flatMap((record) => parseCsv(record.text, { delimiter }));
        expect([JSON.stringify(text), viaRecords]).toEqual([JSON.stringify(text), parseCsv(text, { delimiter })]);
        // Each record starts at the beginning of the physical line it names.
        const physical = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
        for (const record of records) {
          expect(physical[record.line - 1].startsWith(record.text.split(/\r\n|\r|\n/)[0])).toBe(true);
        }
        // Line numbers never go backwards.
        expect(records.map((record) => record.line)).toEqual([...records.map((record) => record.line)].sort((a, b) => a - b));
      }
    }
  });
});
