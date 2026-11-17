/**
 * Static audit of every SQL statement the server sends (security pass): finds each `.query(...)`
 * call in server/src (tests excluded) with the TypeScript compiler, and prints what its SQL text is
 * made of. A plain string is fixed text. In a template, each `${...}` is classified:
 *   - const:   a constant (a string literal, or a const whose value is fixed text, in this file or
 *              imported from a server module);
 *   - literal: only string literals (for example `cond ? 'FOR UPDATE' : ''`);
 *   - helper:  a call to a known SQL-fragment helper with literal arguments only;
 *   - REVIEW:  anything else, to be checked by hand (listed at the end).
 * Values always travel in the second argument (bind parameters), which this audit does not need to read.
 *
 *   npx tsx tests/manual/sql-audit.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve('server/src');

/**
 * Interpolations reviewed by hand (security pass, D-153), by file and expression text. Anything
 * REVIEW that is not here makes the audit fail, so a new one must be looked at and added.
 */
const REVIEWED: Record<string, string> = {
  "server/src/services/lists.ts: sets.join(', ')":
    'updateList: each piece is the literal `name = $n` or `household_id = $n` written in code; the values go into the parameter array',
  "server/src/services/items.ts: sets.join(', ')":
    'updateItem: column names come from the fixed COLUMN map (an unknown key throws), `$n` numbers are counted in code; values are parameters',
  'server/src/db/migrate.ts: sql': 'the content of server/migrations/*.sql, files of the repository, run by the CLI and at start-up; no request data',
  'server/src/db/seed.ts: sql': 'upsert(): its three callers pass fixed SQL text (chains, stores, products); the CSV data goes in the parameter arrays',
};
const HELPERS = new Set(['visibleListCondition', 'accessExpression']);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : files(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const program = ts.createProgram(files(ROOT), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: false });
const checker = program.getTypeChecker();

/** True when the expression is fixed text: string literals, templates of fixed text, consts bound to those. */
function isFixed(node: ts.Node, seen = new Set<ts.Node>()): boolean {
  if (seen.has(node)) return false;
  seen.add(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isParenthesizedExpression(node)) return isFixed(node.expression, seen);
  if (ts.isConditionalExpression(node)) return isFixed(node.whenTrue, seen) && isFixed(node.whenFalse, seen);
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => isFixed(span.expression, seen));
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return isFixed(node.left, seen) && isFixed(node.right, seen);
  if (ts.isIdentifier(node)) {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) {
      return isFixed(declaration.initializer, seen);
    }
  }
  return false;
}

function classify(expression: ts.Expression): string {
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && HELPERS.has(expression.expression.text)) {
    return expression.arguments.every((arg) => isFixed(arg)) ? 'helper' : 'REVIEW';
  }
  if (ts.isStringLiteral(expression) || ts.isConditionalExpression(expression)) return isFixed(expression) ? 'literal' : 'REVIEW';
  return isFixed(expression) ? 'const' : 'REVIEW';
}

interface Row { where: string; form: string; parts: Array<{ text: string; kind: string }> }
const rows: Row[] = [];
for (const source of program.getSourceFiles()) {
  if (!source.fileName.startsWith(ROOT)) continue;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'query' && node.arguments.length > 0) {
      const sql = node.arguments[0];
      const where = `${path.relative(process.cwd(), source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      if (ts.isStringLiteral(sql) || ts.isNoSubstitutionTemplateLiteral(sql)) rows.push({ where, form: 'fixed text', parts: [] });
      else if (ts.isTemplateExpression(sql)) rows.push({ where, form: 'template', parts: sql.templateSpans.map((span) => ({ text: span.expression.getText(source), kind: classify(span.expression) })) });
      else rows.push({ where, form: `expression \`${sql.getText(source).slice(0, 60)}\``, parts: [{ text: sql.getText(source).slice(0, 60), kind: isFixed(sql) ? 'const' : 'REVIEW' }] });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

console.log(`SQL statements sent with .query(...) in server/src (tests excluded): ${rows.length}\n`);
console.log('| Where | SQL argument | Interpolated into the SQL text |\n|---|---|---|');
for (const row of rows) {
  const parts = row.parts.length === 0 ? '(none)' : row.parts.map((p) => `\`${p.text.replace(/\|/g, '\\|')}\` ${p.kind}`).join('; ');
  console.log(`| ${row.where} | ${row.form} | ${parts} |`);
}
const review = rows.flatMap((row) => row.parts.filter((p) => p.kind === 'REVIEW').map((p) => ({ where: row.where, key: `${row.where.replace(/:\d+$/, '')}: ${p.text}` })));
console.log(`\nStatements whose SQL text is provably fixed: ${rows.filter((r) => r.parts.every((p) => p.kind !== 'REVIEW')).length} of ${rows.length}`);
console.log(`Interpolations the audit cannot prove fixed: ${review.length}`);
let unreviewed = 0;
for (const item of review) {
  const reason = REVIEWED[item.key];
  if (!reason) unreviewed += 1;
  console.log(`  - ${item.where}: \`${item.key.split(': ').slice(1).join(': ')}\` ${reason ? `reviewed: ${reason}` : '**NOT REVIEWED**'}`);
}
console.log(unreviewed === 0 ? '\nOK: no user input can reach the SQL text of any statement.' : `\nFAILED: ${unreviewed} interpolation(s) not reviewed`);
process.exit(unreviewed === 0 ? 0 : 1);
