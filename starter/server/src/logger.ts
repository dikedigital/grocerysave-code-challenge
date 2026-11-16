/**
 * Execution logs (decisions D-76 to D-79). No dependency: Node built-ins only.
 *
 * - Each record is one JSON object per line in `<LOG_DIR>/grocerysave-<UTC date>.log`, a new file
 *   each day, so it can be grepped or loaded by a log tool; a readable one-line copy goes to stderr,
 *   which keeps stdout free for command output.
 * - Levels: debug < info < warn < error. `LOG_LEVEL` sets the minimum (default `info`; `silent`
 *   turns logging off). `LOG_DIR` sets the folder (default `logs/app`; empty disables the file).
 *   `LOG_CONSOLE=false` turns the stderr copy off.
 * - Under Jest (NODE_ENV=test) the default logger is silent unless LOG_LEVEL is set, so tests never
 *   write log files; tests pass their own logger with a memory sink instead.
 * - Logging never throws: a failing sink is reported once on stderr and otherwise ignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { errorMessage } from './errors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogThreshold = LogLevel | 'silent';
export type LogFields = Record<string, unknown>;

export interface LogRecord {
  /** ISO 8601 timestamp. */
  time: string;
  level: LogLevel;
  /** Where the record comes from, e.g. `providers.standard`. */
  component: string;
  /** A stable, greppable event name, e.g. `row_skipped`. */
  event: string;
  /** A sentence for humans. */
  message: string;
  /** Structured context (file, line, reason...). */
  [field: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  readonly component: string;
  /** True when a record of this level would be written (to skip building expensive records). */
  isEnabled(level: LogLevel): boolean;
  debug(event: string, message: string, fields?: LogFields): void;
  info(event: string, message: string, fields?: LogFields): void;
  warn(event: string, message: string, fields?: LogFields): void;
  error(event: string, message: string, fields?: LogFields): void;
  /** A logger for a sub-component (`providers` -> `providers.flyer`) that adds `fields` to every record. */
  child(component: string, fields?: LogFields): Logger;
}

const RANK: Record<LogThreshold, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export function isLogThreshold(value: unknown): value is LogThreshold {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RANK, value);
}

export interface LoggerOptions {
  level: LogThreshold;
  sinks: LogSink[];
  component?: string;
  fields?: LogFields;
  /** Clock, for tests. */
  now?: () => Date;
}

/** Fields a caller may not overwrite: they define the record. */
const RESERVED = new Set(['time', 'level', 'component', 'event', 'message']);

export function createLogger(options: LoggerOptions): Logger {
  const { level: threshold, sinks, component = 'app', fields: base = {}, now = () => new Date() } = options;
  const enabled = (level: LogLevel) => RANK[level] >= RANK[threshold] && sinks.length > 0;

  const write = (level: LogLevel, event: string, message: string, fields: LogFields = {}) => {
    if (!enabled(level)) return;
    const record: LogRecord = { time: now().toISOString(), level, component, event, message };
    for (const source of [base, fields]) {
      for (const [key, value] of Object.entries(source)) {
        if (!RESERVED.has(key) && value !== undefined) record[key] = value;
      }
    }
    for (const sink of sinks) {
      try {
        sink(record);
      } catch {
        // A sink must never break the caller; file sinks report their own failures.
      }
    }
  };

  return {
    component,
    isEnabled: enabled,
    debug: (event, message, fields) => write('debug', event, message, fields),
    info: (event, message, fields) => write('info', event, message, fields),
    warn: (event, message, fields) => write('warn', event, message, fields),
    error: (event, message, fields) => write('error', event, message, fields),
    child: (name, fields = {}) =>
      createLogger({ level: threshold, sinks, component: `${component}.${name}`, fields: { ...base, ...fields }, now }),
  };
}

/** Collects records in memory (tests, and the manual tools that show what was logged). */
export function memorySink(): LogSink & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink = ((record: LogRecord) => {
    records.push(record);
  }) as LogSink & { records: LogRecord[] };
  sink.records = records;
  return sink;
}

/** Appends each record as one JSON line to `<dir>/<prefix>-<YYYY-MM-DD>.log` (UTC date of the record). */
export function fileSink(dir: string, prefix = 'grocerysave'): LogSink {
  let failed = false;
  return (record) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Synchronous append: the line is on disk even if the process dies right after.
      fs.appendFileSync(path.join(dir, `${prefix}-${record.time.slice(0, 10)}.log`), `${JSON.stringify(record)}\n`);
    } catch (error) {
      if (!failed) {
        failed = true;
        process.stderr.write(`[logger] cannot write log files in ${dir}: ${errorMessage(error)}; file logging disabled\n`);
      }
    }
  };
}

/** One readable line per record: `<time> WARN  providers.standard row_skipped: <message> {fields}`. */
export function formatRecord(record: LogRecord): string {
  const { time, level, component, event, message, ...fields } = record;
  const extra = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
  return `${time} ${level.toUpperCase().padEnd(5)} ${component} ${event}: ${message}${extra}`;
}

export function consoleSink(stream: { write(text: string): unknown } = process.stderr): LogSink {
  return (record) => {
    stream.write(`${formatRecord(record)}\n`);
  };
}

/** The settings of the default logger, read from the environment. */
export function loggerSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): {
  level: LogThreshold;
  dir: string | null;
  console: boolean;
} {
  const underTest = env.NODE_ENV === 'test' || env.JEST_WORKER_ID !== undefined;
  const requested = env.LOG_LEVEL?.trim().toLowerCase();
  const level: LogThreshold = isLogThreshold(requested) ? requested : underTest ? 'silent' : 'info';
  const dirSetting = env.LOG_DIR ?? 'logs/app';
  return {
    level,
    dir: dirSetting.trim() === '' ? null : path.resolve(process.cwd(), dirSetting),
    console: (env.LOG_CONSOLE ?? 'true').trim().toLowerCase() !== 'false',
  };
}

function createDefaultLogger(): Logger {
  const settings = loggerSettingsFromEnv();
  const sinks: LogSink[] = [];
  if (settings.dir !== null) sinks.push(fileSink(settings.dir));
  if (settings.console) sinks.push(consoleSink());
  return createLogger({ level: settings.level, sinks });
}

/** The process-wide logger (component `app`). Modules take a child: `logger.child('providers')`. */
export const logger: Logger = createDefaultLogger();

/** A logger that drops everything. */
export const silentLogger: Logger = createLogger({ level: 'silent', sinks: [] });
