import type { Pool } from 'pg';
import type { Logger } from './logger';

/**
 * What every router factory receives from `createApp` (D-104). Routers pass `pool` (or a
 * transaction client) to the services; nothing reads a process-wide pool, so the tests can
 * build an app on the test database.
 */
export interface AppDeps {
  pool: Pool;
  logger: Logger;
  /** Signs and verifies login tokens (HS256); `config.jwtSecret` unless createApp was given one. */
  jwtSecret: string;
}
