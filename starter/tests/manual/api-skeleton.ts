/**
 * Serves createApp(pool) on localhost so the API can be tried with curl, before the real process
 * entry point (server/src/index.ts, a later stage) exists. It does not migrate, seed or start the
 * scheduler: health needs only a database that answers SELECT 1; auth needs the schema
 * (`npm run db:reset` gives the demo users). Tokens are signed with JWT_SECRET (config.jwtSecret).
 * At start it prints every route and whether it needs a token.
 *
 *   DATABASE_URL=postgres://... npx tsx tests/manual/api-skeleton.ts              port 3001 (PORT)
 *   npx tsx tests/manual/api-skeleton.ts --port 3999
 *   npx tsx tests/manual/api-skeleton.ts --db-down        a pool on a port where nothing listens
 *
 * Logs at debug (one `request_completed` line per request) on stderr and in logs/app/, unless
 * LOG_LEVEL says otherwise; LOG_CONSOLE=false silences stderr, LOG_DIR= (empty) the file. Ctrl+C stops it.
 */
import { createApp, listApiRoutes } from '../../server/src/app';
import { config } from '../../server/src/config';
import { createPool } from '../../server/src/db/pool';
import { consoleSink, createLogger, fileSink, isLogThreshold, type LogSink } from '../../server/src/logger';

const args = process.argv.slice(2);
let port = config.port;
let dbDown = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--port') port = Number(args[++i]);
  else if (args[i] === '--db-down') dbDown = true;
  else {
    console.error('usage: npx tsx tests/manual/api-skeleton.ts [--port <n>] [--db-down]');
    process.exit(2);
  }
}

let databaseUrl = config.databaseUrl;
if (dbDown) {
  const url = new URL(databaseUrl);
  url.hostname = '127.0.0.1';
  url.port = '1';
  databaseUrl = url.toString();
}

const requested = process.env.LOG_LEVEL?.trim().toLowerCase();
const sinks: LogSink[] = (process.env.LOG_CONSOLE ?? 'true').trim().toLowerCase() === 'false' ? [] : [consoleSink()];
const logDir = process.env.LOG_DIR ?? 'logs/app';
if (logDir.trim() !== '') sinks.push(fileSink(logDir));
const logger = createLogger({ level: isLogThreshold(requested) ? requested : 'debug', sinks, component: 'app.http' });

const pool = createPool(databaseUrl);
const app = createApp(pool, { logger });
const server = app.listen(port, '127.0.0.1', () => {
  const database = new URL(databaseUrl);
  for (const route of listApiRoutes(app)) console.log(`  ${route.method.padEnd(6)} ${route.path.padEnd(28)} ${route.access}`);
  console.log(`API skeleton on http://127.0.0.1:${port}/api (database ${database.pathname.slice(1)} on ${database.host}${dbDown ? ', unreachable on purpose' : ''}); Ctrl+C stops it`);
});
server.on('error', (error) => {
  console.error(`cannot listen on port ${port}: ${error.message}`);
  process.exit(1);
});

const stop = () => {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
