/**
 * How many SQL statements does GET /api/lists send? Counted twice: in the process (every call to
 * pg's Client.query) and by Postgres itself (its statement log, between two marker statements).
 *
 *   TEST_DATABASE_URL=postgres://.../grocerysave_test npx tsx tests/manual/query-count.ts [postgres log file]
 *
 * Empties TEST_DATABASE_URL (refused unless its name contains "test"), creates users with 20 lists of
 * 10 items (and, for comparison, 1 and 100 lists of 10 items), turns on log_statement = 'all' for the
 * test database only, calls GET /api/lists over real HTTP for each, resets the setting, and prints
 * the statements. The log file defaults to ~/.local/gs-postgres.log (MANUAL_TESTING 0.5).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import { createApp } from '../../server/src/app';
import { config } from '../../server/src/config';
import { migrate } from '../../server/src/db/migrate';
import { createPool } from '../../server/src/db/pool';
import { silentLogger } from '../../server/src/logger';
import { signToken } from '../../server/src/services/tokens';

const LOG_FILE = process.argv[2] ?? path.join(os.homedir(), '.local/gs-postgres.log');
const url = config.testDatabaseUrl;
const database = url ? new URL(url).pathname.slice(1) : '';
if (!database.includes('test')) {
  console.error('TEST_DATABASE_URL must name a database containing "test" (it is emptied)');
  process.exit(2);
}
const adminUrl = (() => {
  const u = new URL(url);
  u.pathname = '/postgres';
  return u.toString();
})();

async function main() {
  const setup = createPool(url);
  await migrate(setup, { reset: true });
  const makeUser = async (lists: number, items: number) => {
    const { rows } = await setup.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id", [`user-${lists}@example.com`]);
    await setup.query(
      `WITH l AS (INSERT INTO shopping_lists (owner_id, name) SELECT $1, 'list ' || n FROM generate_series(1, $2::int) n RETURNING id)
       INSERT INTO list_items (list_id, name, position) SELECT l.id, 'item ' || p, p FROM l, generate_series(0, $3::int - 1) p`,
      [rows[0].id, lists, items],
    );
    return { id: rows[0].id, token: `Bearer ${signToken(rows[0].id, 'query-count-secret')}` };
  };
  const users = { 20: await makeUser(20, 10), 1: await makeUser(1, 10), 100: await makeUser(100, 10) };
  await setup.end();

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`ALTER DATABASE "${database}" SET log_statement = 'all'`);
  try {
    const pool = createPool(url); // new sessions: they log every statement
    const app = createApp(pool, { jwtSecret: 'query-count-secret', logger: silentLogger });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const original = Client.prototype.query;
    for (const lists of [20, 1, 100] as const) {
      const marker = `querycount_${lists}_${Date.now()}`;
      await pool.query(`SELECT '${marker}_start'`);
      const offset = fs.statSync(LOG_FILE).size;
      const seen: string[] = [];
      Client.prototype.query = function (this: Client, ...args: unknown[]) {
        const text = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text;
        seen.push(String(text).replace(/\s+/g, ' ').trim());
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      } as typeof Client.prototype.query;
      const res = await fetch(`${base}/api/lists`, { headers: { Authorization: users[lists].token } });
      const body = (await res.json()) as Array<{ items: unknown[] }>;
      Client.prototype.query = original;
      await pool.query(`SELECT '${marker}_end'`);
      await new Promise((resolve) => setTimeout(resolve, 300)); // let Postgres flush its log

      const logged = fs.readFileSync(LOG_FILE).subarray(offset).toString('utf8');
      const endAt = logged.indexOf(`${marker}_end`);
      const window = endAt === -1 ? logged : logged.slice(0, endAt);
      const executed = window.split('\n').filter((line) => / LOG: {2}(execute|statement)/.test(line)).length - (endAt === -1 ? 0 : 1);

      console.log(`\n## ${lists} list(s) of 10 items: GET /api/lists -> ${res.status}, ${body.length} lists, ${body.reduce((n, l) => n + l.items.length, 0)} items`);
      console.log(`Statements sent by the app (pg Client.query calls): ${seen.length}`);
      console.log(`Statements Postgres logged as executed for the request: ${executed}`);
      seen.forEach((sql, i) => console.log(`  ${i + 1}. ${sql.length > 150 ? `${sql.slice(0, 150)}...` : sql}`));
    }
    server.close();
    await pool.end();
  } finally {
    await admin.query(`ALTER DATABASE "${database}" RESET log_statement`);
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
