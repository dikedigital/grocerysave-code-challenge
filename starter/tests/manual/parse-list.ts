/**
 * Manual check of parseListText / parseListCsv on files: prints one markdown table per file.
 * The parser is chosen by extension: .txt -> parseListText, .csv / .tsv -> parseListCsv.
 *
 *   npx tsx tests/manual/parse-list.ts tests/manual/samples/*
 *   npx tsx tests/manual/parse-list.ts my-list.csv
 *   pbpaste | npx tsx tests/manual/parse-list.ts --text      (or --csv; reads stdin)
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { ParsedItem } from '../../src/models';
import { parseListCsv, parseListText } from '../../src/utils/parseList';

const cell = (value: string) => value.replace(/\|/g, '\\|');

function print(title: string, items: ParsedItem[]): void {
  console.log(`### ${title}: ${items.length} ${items.length === 1 ? 'item' : 'items'}\n`);
  console.log('| # | name | quantity | unit | note |');
  console.log('|---|---|---|---|---|');
  items.forEach((item, index) =>
    console.log(`| ${index + 1} | ${[item.name, String(item.quantity), item.unit, item.note ?? ''].map(cell).join(' | ')} |`)
  );
  console.log();
}

const args = process.argv.slice(2);
if (args[0] === '--text' || args[0] === '--csv') {
  const content = readFileSync(0, 'utf8');
  print(`stdin (${args[0].slice(2)})`, args[0] === '--text' ? parseListText(content) : parseListCsv(content));
} else if (args.length === 0) {
  console.error('usage: npx tsx tests/manual/parse-list.ts <file.txt|file.csv|file.tsv>...  |  --text|--csv < input');
  process.exit(2);
} else {
  for (const file of args) {
    const content = readFileSync(file, 'utf8');
    const csv = ['.csv', '.tsv'].includes(extname(file).toLowerCase());
    print(`${basename(file)} (${csv ? 'parseListCsv' : 'parseListText'})`, csv ? parseListCsv(content) : parseListText(content));
  }
}
