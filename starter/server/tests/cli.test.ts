import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { count, resetDatabase, testDatabaseUrl, testPool } from './helpers/db';

jest.setTimeout(120000);

const ROOT = path.resolve(__dirname, '../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

/** Runs the CLI like `npm run db:*` does, against the test database; returns exit code and output. */
function cli(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(TSX, ['server/src/db/cli.ts', ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl(), LOG_LEVEL: 'silent', ...env },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
const oneLine = (text: string) => {
  expect(text.endsWith('\n')).toBe(true);
  expect(text.trimEnd().split('\n')).toHaveLength(1);
  return text.trimEnd();
};
const FULL = '8 chains, 8 stores, 40 products, 1136 price rows';
const DEMO = '2 users, 1 household(s), 2 lists (22 items)';

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
});

describe('cli.ts <migrate|seed|reset|sync> (TECH_SPEC 4.3)', () => {
  it('migrate: applies the migrations, then reports up to date; one line, exit 0', () => {
    const first = cli(['migrate']);
    expect([first.code, oneLine(first.stdout)]).toEqual([0, 'migrate: applied 001_init.sql']);
    const second = cli(['migrate']);
    expect([second.code, oneLine(second.stdout)]).toEqual([0, 'migrate: already up to date']);
  });

  it('reset: recreates the schema and seeds everything', async () => {
    await resetDatabase(pool);
    await pool.query("INSERT INTO users (email, password_hash) VALUES ('left-over@example.test', 'x')");
    const result = cli(['reset']);
    expect(result.code).toBe(0);
    expect(oneLine(result.stdout)).toBe(`reset: schema recreated (001_init.sql) and seeded: ${FULL}, 8 sync runs, ${DEMO}`);
    expect(await count(pool, 'users', "WHERE email = 'left-over@example.test'")).toBe(0);
  });

  it('seed: migrates then seeds; a second seed changes nothing but adds a sync run per chain', () => {
    const first = cli(['seed']);
    expect([first.code, oneLine(first.stdout)]).toEqual([0, `seed: applied 001_init.sql, seeded: ${FULL}, 8 sync runs, ${DEMO}`]);
    const second = cli(['seed']);
    expect([second.code, oneLine(second.stdout)]).toEqual([0, `seed: seeded: ${FULL}, 16 sync runs, ${DEMO}`]);
  });

  it('sync: runs syncPrices and reports it; exit 0', async () => {
    cli(['seed']);
    const result = cli(['sync']);
    expect([result.code, oneLine(result.stdout)]).toEqual([0, 'sync: 8 chains ok, 0 failed, 1136 price rows written']);
    expect(await count(pool, 'sync_runs')).toBe(16);
  });

  it('sync with a failing chain: the summary names it, exit 1', async () => {
    cli(['seed']);
    await pool.query("INSERT INTO chains (id, name, provider) VALUES ('mystery', 'Mystery Mart', 'toString')");
    const result = cli(['sync']);
    expect(result.code).toBe(1);
    expect(oneLine(result.stdout)).toBe('sync: 8 chains ok, 1 failed (mystery: Unknown price provider "toString" (known: standard, cents, flyer)), 1136 price rows written');
  });

  it.each([[[]], [['seedz']], [['seed', 'sync']], [['--help']]])('a wrong command line %p: usage on stderr, nothing on stdout, exit 2', (args) => {
    const result = cli(args as string[]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('usage: tsx server/src/db/cli.ts <migrate|seed|reset|sync>\n');
  });

  it('a database that cannot be reached: one error line on stderr, exit 1, and the process ends (pool closed)', () => {
    const url = new URL(testDatabaseUrl());
    url.pathname = '/gs_no_such_database_test';
    const started = Date.now();
    const result = cli(['migrate'], { DATABASE_URL: url.toString() });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('migrate failed: database "gs_no_such_database_test" does not exist\n');
    expect(Date.now() - started).toBeLessThan(30000);
  });

  it('writes execution logs: cli_started and cli_finished (info), cli_failed (error)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-cli-logs-'));
    try {
      cli(['migrate'], { LOG_LEVEL: 'info', LOG_DIR: dir, LOG_CONSOLE: 'false' });
      cli(['sync'], { LOG_LEVEL: 'info', LOG_DIR: dir, LOG_CONSOLE: 'false', DATABASE_URL: testDatabaseUrl().replace(/\/[^/]*$/, '/gs_no_such_database_test') });
      const records = fs.readdirSync(dir).flatMap((file) => fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').map((line) => JSON.parse(line)));
      const cliRecords = records.filter((record) => record.component === 'app.cli').map((record) => [record.level, record.event, record.command]);
      expect(cliRecords).toEqual([
        ['info', 'cli_started', 'migrate'],
        ['info', 'cli_finished', 'migrate'],
        ['info', 'cli_started', 'sync'],
        ['error', 'cli_failed', 'sync'],
      ]);
      expect(records.every((record) => !JSON.stringify(record).includes('postgres:postgres@'))).toBe(true); // no credentials in logs
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
