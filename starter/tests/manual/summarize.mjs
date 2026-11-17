#!/usr/bin/env node
/**
 * One readable line per API answer, for the manual checks. Reads a curl answer from stdin, with the
 * status appended by `-w ' %{http_code}'`, and prints:
 *   an item   -> `<name> | <quantity> <unit> | <category> | product yes/none | note ... | completed ...  <status>`
 *   a list    -> `<name> | <n> items: <item names> | shared: yes/no | updatedAt ...  <status>`
 *   lists     -> one list line each (most recently changed first, as the API sends them)
 *   an error  -> `{"error":"..."}  <status>`; an empty answer (204) -> `(no body)  204`
 *
 *   curl -s -w ' %{http_code}' ... | node tests/manual/summarize.mjs
 */
import { readFileSync } from 'node:fs';

const text = readFileSync(0, 'utf8').trim();
const match = /\s?(\d{3})$/.exec(text);
const status = match ? match[1] : '';
const body = match ? text.slice(0, match.index).trim() : text;

const item = (i) => `${i.name} | ${i.quantity} ${i.unit} | ${i.category} | product ${i.productId ? 'yes' : 'none'} | note ${JSON.stringify(i.note)} | completed ${i.completed}`;
const list = (l) => `${l.name} | ${l.items.length} items${l.items.length ? `: ${l.items.map((i) => i.name).join(', ')}` : ''} | shared: ${l.householdId ? 'yes' : 'no'} | updatedAt ${l.updatedAt}`;

let data;
try {
  data = body === '' ? undefined : JSON.parse(body);
} catch {
  console.log(`${text}`);
  process.exit(0);
}
const line = (s) => console.log(status ? `${s}  ${status}` : s);
if (data === undefined) line('(no body)');
else if (Array.isArray(data)) {
  if (data.length === 0) line('[]');
  data.forEach((l, index) => (index === data.length - 1 ? line(list(l)) : console.log(list(l))));
} else if (data.error !== undefined) line(JSON.stringify(data));
else if (Array.isArray(data.items)) line(list(data));
else if ('listId' in data) line(item(data));
else line(JSON.stringify(data));
