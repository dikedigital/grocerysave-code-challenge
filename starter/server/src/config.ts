import path from 'node:path';

/**
 * Server configuration, read from the environment.
 * Paths resolve from the process working directory: run every command from the repo root.
 */
export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/grocerysave',
  testDatabaseUrl: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR ?? 'data'),
  migrationsDir: path.resolve(process.cwd(), 'server/migrations'),
  staticDir: path.resolve(process.cwd(), 'dist'),
  priceSyncIntervalMinutes: Number(process.env.PRICE_SYNC_INTERVAL_MINUTES ?? 15),
};
