import { z } from 'zod';
import { HttpError, badRequest, conflict, forbidden, notFound, unauthorized } from '../../httpError';
import {
  BODY_TOO_LARGE_MESSAGE,
  INTERNAL_ERROR_MESSAGE,
  MALFORMED_JSON_MESSAGE,
  classifyError,
  classifySqlState,
  formatZodError,
  isPostgresError,
} from '../errorHandler';

/** An error shaped like the ones pg rejects with (a DatabaseError: code + severity). */
const pgError = (code: string, message = 'postgres says no') => Object.assign(new Error(message), { code, severity: 'ERROR' });

/** An error shaped like body-parser's (http-errors): type, status, expose. */
const bodyError = (type: string, status: number, message: string) =>
  Object.assign(new Error(message), { type, status, statusCode: status, expose: status < 500 });

describe('HttpError', () => {
  it('keeps status and message; helpers give the TECH_SPEC 6.1 statuses', () => {
    const error = new HttpError(404, 'List not found');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HttpError');
    expect([error.status, error.message]).toEqual([404, 'List not found']);
    expect([badRequest(), unauthorized(), forbidden(), notFound(), conflict()].map((e) => [e.status, e.message])).toEqual([
      [400, 'Bad request'],
      [401, 'Authentication required'],
      [403, 'Forbidden'],
      [404, 'Not found'],
      [409, 'Conflict'],
    ]);
    expect(badRequest('Name is required').message).toBe('Name is required');
  });

  it.each([200, 302, 399, 600, 404.5, Number.NaN])('rejects the non-error status %p (programming error)', (status) => {
    expect(() => new HttpError(status, 'x')).toThrow(RangeError);
  });
});

describe('classifyError', () => {
  it.each([400, 401, 403, 404, 409, 422])('an HttpError %p keeps its status and message', (status) => {
    expect(classifyError(new HttpError(status, `message ${status}`))).toEqual({ status, message: `message ${status}`, kind: 'http' });
  });

  it('an HttpError of 500 or more is a plain 500 whose message is not sent', () => {
    expect(classifyError(new HttpError(500, 'secret detail'))).toEqual({ status: 500, message: INTERNAL_ERROR_MESSAGE, kind: 'internal' });
    expect(classifyError(new HttpError(503, 'secret detail')).status).toBe(500);
  });

  it('a ZodError is a 400 naming each field', () => {
    const schema = z.object({ email: z.string().email('must be an email'), password: z.string().min(8, 'too short') });
    const result = schema.safeParse({ email: 'nope', password: 'short' });
    if (result.success) throw new Error('expected a failure');
    expect(classifyError(result.error)).toEqual({ status: 400, message: 'email: must be an email; password: too short', kind: 'validation' });
  });

  it('body-parser errors: malformed JSON 400, too large 413, fixed messages', () => {
    // The parse error's own message quotes the body (V8: `Unexpected token ... "{'password'..."`), so it is not sent.
    expect(classifyError(bodyError('entity.parse.failed', 400, `Unexpected token ''', "{'password': 'hunter2'}" is not valid JSON`))).toEqual({
      status: 400,
      message: MALFORMED_JSON_MESSAGE,
      kind: 'body',
    });
    expect(classifyError(bodyError('entity.too.large', 413, 'request entity too large'))).toEqual({
      status: 413,
      message: BODY_TOO_LARGE_MESSAGE,
      kind: 'body',
    });
  });

  it('other exposed 4xx errors (body-parser charset / encoding) keep their status and message', () => {
    expect(classifyError(bodyError('charset.unsupported', 415, 'unsupported charset "LATIN1"'))).toEqual({
      status: 415,
      message: 'unsupported charset "LATIN1"',
      kind: 'body',
    });
    expect(classifyError(Object.assign(new Error(''), { status: 400, expose: true })).message).toBe('Bad request');
  });

  it('a status on an error that is not marked exposed is not trusted: 500', () => {
    expect(classifyError(Object.assign(new Error('x'), { status: 404 })).status).toBe(500);
    expect(classifyError(Object.assign(new Error('x'), { status: 503, expose: true })).status).toBe(500);
    expect(classifyError(Object.assign(new Error('x'), { status: '400', expose: true })).status).toBe(500);
  });

  it.each([
    ['22P02', 400, 'Invalid input'], // invalid_text_representation (bad uuid)
    ['22003', 400, 'Invalid input'], // numeric_value_out_of_range
    ['22008', 400, 'Invalid input'], // datetime_field_overflow
    ['22021', 400, 'Invalid input'], // character_not_in_repertoire (NUL byte)
    ['23502', 400, 'Invalid input'], // not_null_violation
    ['23514', 400, 'Invalid input'], // check_violation
    ['23505', 409, 'Already exists'], // unique_violation
    ['23503', 404, 'Referenced resource not found'], // foreign_key_violation
  ])('Postgres %s is %p %p', (code, status, message) => {
    expect(classifyError(pgError(code))).toEqual({ status, message, kind: 'database', code });
  });

  it.each(['42P01', '42703', '08006', '57P01', '53300', '40001', '40P01', 'XX000'])(
    'Postgres %s (a server-side failure) is a 500',
    (code) => {
      expect(classifyError(pgError(code))).toEqual({ status: 500, message: INTERNAL_ERROR_MESSAGE, kind: 'internal', code });
    },
  );

  it('Node error codes and code-only objects are not taken for Postgres errors', () => {
    expect(classifyError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' })).status).toBe(500);
    expect(classifyError(Object.assign(new Error('x'), { code: '22P02' })).status).toBe(500); // no severity
    expect(isPostgresError(pgError('22P02'))).toBe(true);
    expect(isPostgresError({ code: 'ERR_X', severity: 'ERROR' })).toBe(false);
  });

  it.each([undefined, null, 'route', 'router', 42, {}, [], Symbol('x')])('the non-Error value %p is a 500', (value) => {
    expect(classifyError(value)).toEqual({ status: 500, message: INTERNAL_ERROR_MESSAGE, kind: 'internal' });
  });

  it('a plain Error is a 500 and its message is not sent', () => {
    expect(classifyError(new Error('Cannot use a pool after calling end on the pool'))).toEqual({
      status: 500,
      message: INTERNAL_ERROR_MESSAGE,
      kind: 'internal',
    });
  });
});

describe('classifySqlState', () => {
  it('maps the whole data-exception class 22 to 400, and nothing outside 22/23 to a client error', () => {
    expect(classifySqlState('22000')?.status).toBe(400);
    expect(classifySqlState('22P05')?.status).toBe(400);
    expect(classifySqlState('23P01')).toBeNull(); // exclusion_violation: no such constraint in the schema
    expect(classifySqlState('42601')).toBeNull();
  });
});

describe('formatZodError', () => {
  it('nested and array paths are dot-joined; an issue at the root has no path prefix', () => {
    const nested = z.object({ items: z.array(z.object({ quantity: z.number().positive('must be > 0') })) });
    const r1 = nested.safeParse({ items: [{ quantity: 1 }, { quantity: 0 }] });
    if (r1.success) throw new Error('expected a failure');
    expect(formatZodError(r1.error)).toBe('items.1.quantity: must be > 0');

    const root = z.string({ invalid_type_error: 'must be text' }).safeParse(1);
    if (root.success) throw new Error('expected a failure');
    expect(formatZodError(root.error)).toBe('must be text');
  });

  it('lists at most 5 issues and counts the rest', () => {
    const result = z.array(z.number({ invalid_type_error: 'must be a number' })).safeParse(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    if (result.success) throw new Error('expected a failure');
    expect(formatZodError(result.error)).toBe(
      '0: must be a number; 1: must be a number; 2: must be a number; 3: must be a number; 4: must be a number; and 2 more',
    );
  });

  it('a ZodError with no issues still gives a message', () => {
    expect(formatZodError(new z.ZodError([]))).toBe('Invalid request');
  });
});
