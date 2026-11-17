import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Runs tests/manual/sql-audit.ts (security pass, D-153): every `${...}` in the SQL text of a
 * `.query()` call in server/src must be provably fixed text or reviewed by hand. A new interpolation
 * fails this test until it is reviewed.
 */
describe('SQL audit', () => {
  it('no statement can get user input into its SQL text', () => {
    const root = path.resolve(__dirname, '../../..');
    const tsx = path.join(root, 'node_modules/.bin/tsx');
    let output = '';
    let status = 0;
    try {
      output = execFileSync(tsx, ['tests/manual/sql-audit.ts'], { cwd: root, encoding: 'utf8', env: { ...process.env, LOG_LEVEL: 'silent' } });
    } catch (error) {
      status = (error as { status: number }).status;
      output = String((error as { stdout: string }).stdout);
    }
    expect([status, output.trim().split('\n').pop()]).toEqual([0, 'OK: no user input can reach the SQL text of any statement.']);
  });
});
