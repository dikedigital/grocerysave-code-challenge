import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  consoleSink,
  createLogger,
  fileSink,
  formatRecord,
  loggerSettingsFromEnv,
  memorySink,
  type LogRecord,
} from '../logger';

const fixedClock = (iso: string) => () => new Date(iso);

describe('createLogger: levels and records', () => {
  it('writes records at or above the threshold, and nothing below', () => {
    const sink = memorySink();
    const log = createLogger({ level: 'warn', sinks: [sink] });
    log.debug('a', 'debug');
    log.info('b', 'info');
    log.warn('c', 'warn');
    log.error('d', 'error');
    expect(sink.records.map((record) => record.event)).toEqual(['c', 'd']);
    expect([log.isEnabled('info'), log.isEnabled('warn')]).toEqual([false, true]);
  });

  it('silent writes nothing; a logger with no sinks is never enabled', () => {
    const sink = memorySink();
    const log = createLogger({ level: 'silent', sinks: [sink] });
    log.error('e', 'even errors');
    expect(sink.records).toEqual([]);
    expect(createLogger({ level: 'debug', sinks: [] }).isEnabled('error')).toBe(false);
  });

  it('a record has time, level, component, event, message, then the fields', () => {
    const sink = memorySink();
    const log = createLogger({ level: 'debug', sinks: [sink], now: fixedClock('2026-11-09T10:00:00.000Z') });
    log.warn('row_skipped', 'line 38 skipped', { line: 38, reason: 'empty_sku', absent: undefined });
    expect(sink.records).toEqual([
      { time: '2026-11-09T10:00:00.000Z', level: 'warn', component: 'app', event: 'row_skipped', message: 'line 38 skipped', line: 38, reason: 'empty_sku' },
    ]);
    expect(Object.keys(sink.records[0])).toEqual(['time', 'level', 'component', 'event', 'message', 'line', 'reason']);
  });

  it('fields cannot overwrite the reserved keys', () => {
    const sink = memorySink();
    createLogger({ level: 'debug', sinks: [sink] }).info('real', 'real message', { level: 'error', event: 'fake', message: 'x', component: 'y', time: 'z' });
    expect(sink.records[0]).toMatchObject({ level: 'info', event: 'real', message: 'real message', component: 'app' });
    expect(sink.records[0].time).not.toBe('z');
  });

  it('child loggers extend the component and add their fields to every record', () => {
    const sink = memorySink();
    const providers = createLogger({ level: 'debug', sinks: [sink], fields: { run: 7 } }).child('providers');
    const flyer = providers.child('flyer', { provider: 'flyer', source: 'a.csv' });
    flyer.info('feed_parsed', 'done', { rows: 3, source: 'b.csv' });
    expect(flyer.component).toBe('app.providers.flyer');
    expect(sink.records[0]).toMatchObject({ component: 'app.providers.flyer', run: 7, provider: 'flyer', source: 'b.csv', rows: 3 });
  });

  it('a sink that throws never reaches the caller, and the other sinks still get the record', () => {
    const after = memorySink();
    const log = createLogger({ level: 'info', sinks: [() => { throw new Error('disk full'); }, after] });
    expect(() => log.error('x', 'still fine')).not.toThrow();
    expect(after.records).toHaveLength(1);
  });
});

describe('fileSink: JSON lines in a daily file', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-logs-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('creates the folder and appends one JSON object per line to grocerysave-<UTC date>.log', () => {
    const target = path.join(dir, 'nested', 'app');
    let now = '2026-11-09T23:59:59.000Z';
    const log = createLogger({ level: 'info', sinks: [fileSink(target)], now: () => new Date(now) });
    log.warn('row_skipped', 'first', { line: 38 });
    log.info('feed_parsed', 'second');
    now = '2026-11-10T00:00:01.000Z';
    log.info('feed_parsed', 'next day');

    expect(fs.readdirSync(target).sort()).toEqual(['grocerysave-2026-11-09.log', 'grocerysave-2026-11-10.log']);
    const lines = fs.readFileSync(path.join(target, 'grocerysave-2026-11-09.log'), 'utf8').split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'warn', event: 'row_skipped', message: 'first', line: 38 });
    expect(JSON.parse(lines[1])).toMatchObject({ level: 'info', message: 'second' });
  });

  it('keeps text with quotes, newlines and unicode intact', () => {
    const log = createLogger({ level: 'info', sinks: [fileSink(dir)], now: fixedClock('2026-11-09T00:00:00.000Z') });
    const raw = 'GS-1,"Milk, ""whole""",3.20\nnext line ✓';
    log.warn('row_skipped', 'x', { raw });
    const [line] = fs.readFileSync(path.join(dir, 'grocerysave-2026-11-09.log'), 'utf8').split('\n');
    expect(JSON.parse(line).raw).toBe(raw);
  });

  it('a folder that cannot be written is reported once on stderr, never thrown', () => {
    const blocker = path.join(dir, 'a-file');
    fs.writeFileSync(blocker, 'not a folder');
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const log = createLogger({ level: 'info', sinks: [fileSink(path.join(blocker, 'logs'))] });
      expect(() => {
        log.error('a', 'one');
        log.error('b', 'two');
      }).not.toThrow();
      const reports = stderr.mock.calls.map(([text]) => String(text)).filter((text) => text.startsWith('[logger]'));
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('file logging disabled');
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('console output', () => {
  it('formats one readable line: time, LEVEL, component, event: message {fields}', () => {
    const record: LogRecord = {
      time: '2026-11-09T10:00:00.000Z', level: 'warn', component: 'app.providers.standard', event: 'row_skipped',
      message: 'a.csv line 38 skipped: SKU is empty', line: 38,
    };
    expect(formatRecord(record)).toBe(
      '2026-11-09T10:00:00.000Z WARN  app.providers.standard row_skipped: a.csv line 38 skipped: SKU is empty {"line":38}',
    );
    expect(formatRecord({ ...record, level: 'info', line: undefined })).toContain('INFO  app');
  });

  it('consoleSink writes the formatted line to the stream it is given', () => {
    const written: string[] = [];
    createLogger({ level: 'info', sinks: [consoleSink({ write: (text: string) => written.push(text) })], now: fixedClock('2026-11-09T00:00:00.000Z') })
      .error('unknown_provider', 'Unknown price provider "x"');
    expect(written).toEqual(['2026-11-09T00:00:00.000Z ERROR app unknown_provider: Unknown price provider "x"\n']);
  });
});

describe('loggerSettingsFromEnv', () => {
  it('outside tests: info, logs/app under the working directory, console on', () => {
    expect(loggerSettingsFromEnv({})).toEqual({ level: 'info', dir: path.resolve(process.cwd(), 'logs/app'), console: true });
  });

  it('under Jest the default is silent (tests never write log files) unless LOG_LEVEL is set', () => {
    expect(loggerSettingsFromEnv({ NODE_ENV: 'test' }).level).toBe('silent');
    expect(loggerSettingsFromEnv({ JEST_WORKER_ID: '1' }).level).toBe('silent');
    expect(loggerSettingsFromEnv({ NODE_ENV: 'test', LOG_LEVEL: 'debug' }).level).toBe('debug');
    // The real Jest environment (without a LOG_LEVEL the caller may have set):
    expect(loggerSettingsFromEnv({ ...process.env, LOG_LEVEL: undefined }).level).toBe('silent');
  });

  it('reads LOG_LEVEL (any case), LOG_DIR (empty disables the file) and LOG_CONSOLE', () => {
    expect(loggerSettingsFromEnv({ LOG_LEVEL: ' WARN ', LOG_DIR: '/var/log/gs', LOG_CONSOLE: 'false' })).toEqual({
      level: 'warn', dir: path.resolve('/var/log/gs'), console: false,
    });
    expect(loggerSettingsFromEnv({ LOG_DIR: '  ' }).dir).toBeNull();
    expect(loggerSettingsFromEnv({ LOG_LEVEL: 'verbose' }).level).toBe('info');
    expect(loggerSettingsFromEnv({ LOG_LEVEL: 'toString' }).level).toBe('info');
    expect(loggerSettingsFromEnv({ LOG_LEVEL: 'silent' }).level).toBe('silent');
  });
});
