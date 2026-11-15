/**
 * Manual check of parseListLine: prints a markdown table of what each input line parses to.
 *
 *   npx tsx tests/manual/parse-line.ts "2 lbs chicken breast" "milk x2"
 *   printf '2 milk\n- eggs\n' | npx tsx tests/manual/parse-line.ts
 *   npx tsx tests/manual/parse-line.ts --json "500g flour"      (raw JSON, one object per line)
 *
 * Input is shown JSON-quoted so leading/trailing spaces and tabs are visible.
 */
import { readFileSync } from 'node:fs';
import { parseListLine } from '../../src/utils/parseList';

const args = process.argv.slice(2);
const json = args[0] === '--json';
const lines = json ? args.slice(1) : args;
const input = lines.length > 0 ? lines : readFileSync(0, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);

const cell = (value: string) => value.replace(/\|/g, '\\|');

if (json) {
  for (const line of input) console.log(JSON.stringify(line), '->', JSON.stringify(parseListLine(line)));
} else {
  console.log('| # | Input | name | quantity | unit | note |');
  console.log('|---|---|---|---|---|---|');
  input.forEach((line, index) => {
    const item = parseListLine(line);
    const columns = item
      ? [item.name, String(item.quantity), item.unit, item.note ?? '']
      : ['*null*', '', '', ''];
    console.log(`| ${index + 1} | \`${cell(JSON.stringify(line))}\` | ${columns.map(cell).join(' | ')} |`);
  });
}
