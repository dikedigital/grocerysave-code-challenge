/**
 * Reads the Postgres server log (from a byte offset) and sorts every log entry that contains a
 * marker: is the marker in a bind-parameter value (`DETAIL:  parameters: $1 = '...'`), which is
 * data, or anywhere else (the SQL text of a statement, an error quoting it), which would mean user
 * input reached SQL as text? Used by tests/manual/sql-injection-evidence.sh (security pass).
 *
 *   npx tsx tests/manual/sql-log-check.ts <postgres log> <byte offset> <marker>
 *
 * Expects log_line_prefix '%m [%p] ' (the default) and log_statement = 'all'. Exits 1 when the
 * marker appears outside parameter values, or when it appears nowhere (nothing was logged).
 */
import fs from 'node:fs';

const [file, offsetText, marker] = process.argv.slice(2);
if (!file || !offsetText || !marker) {
  console.error('usage: npx tsx tests/manual/sql-log-check.ts <postgres log> <byte offset> <marker>');
  process.exit(2);
}
const text = fs.readFileSync(file).subarray(Number(offsetText)).toString('utf8');
const START = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \S+) \[(\d+)\] ([A-Z]+): {2}([\s\S]*)$/;

interface Entry { pid: string; kind: string; body: string }
const entries: Entry[] = [];
for (const line of text.split('\n')) {
  const match = START.exec(line);
  if (match) entries.push({ pid: match[2], kind: match[3], body: match[4] });
  else if (entries.length > 0) entries[entries.length - 1].body += `\n${line}`;
}

const statements = entries.filter((e) => e.kind === 'LOG' && /^(execute|statement)/.test(e.body));
const withMarker = entries.filter((e) => e.body.includes(marker));
const asParameter = withMarker.filter((e) => e.kind === 'DETAIL' && e.body.startsWith('parameters:'));
const elsewhere = withMarker.filter((e) => !asParameter.includes(e));

console.log(`Postgres log entries written during the run: ${entries.length}; statements executed: ${statements.length}.`);
console.log(`Entries containing the marker "${marker}": ${withMarker.length}`);
console.log(`  - as a bind-parameter value (DETAIL: parameters: ...):   ${asParameter.length}`);
console.log(`  - anywhere else (SQL text, an error, a statement echo): ${elsewhere.length}`);

// Show a few statements next to the parameters they received, one per distinct SQL text.
const shown = new Set<string>();
console.log('\nExamples: the statement text Postgres executed, and the values bound to it');
for (let i = 1; i < entries.length && shown.size < 6; i += 1) {
  const detail = entries[i];
  if (!(detail.kind === 'DETAIL' && detail.body.includes(marker))) continue;
  const statement = [...entries.slice(0, i)].reverse().find((e) => e.pid === detail.pid && e.kind === 'LOG');
  if (!statement) continue;
  const sql = statement.body.replace(/\s+/g, ' ').replace(/^execute [^:]*: /, '');
  const key = sql.slice(0, 60);
  if (shown.has(key)) continue;
  shown.add(key);
  console.log(`\n  SQL:    ${sql.length > 160 ? `${sql.slice(0, 160)}...` : sql}`);
  const values = detail.body.replace(/^parameters: /, '').replace(/\s+/g, ' ');
  console.log(`  values: ${values.length > 220 ? `${values.slice(0, 220)}...` : values}`);
}

if (elsewhere.length > 0) {
  console.log('\nThe marker outside a parameter value (user input in SQL text or an error):');
  for (const entry of elsewhere.slice(0, 10)) console.log(`  [${entry.kind}] ${entry.body.replace(/\s+/g, ' ').slice(0, 200)}`);
}
const ok = elsewhere.length === 0 && asParameter.length > 0;
console.log(`\n${ok ? 'OK: every value carrying the marker reached Postgres as a bind parameter, never as SQL text.' : 'FAILED'}`);
process.exit(ok ? 0 : 1);
