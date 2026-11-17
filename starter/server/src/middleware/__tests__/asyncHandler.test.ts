import type { NextFunction, Request, Response } from 'express';
import { asError, asyncHandler } from '../asyncHandler';

const req = {} as Request;
const res = {} as Response;

/** Runs the wrapped handler and resolves with what `next` received (or 'not called'). */
async function nextArgs(handler: Parameters<typeof asyncHandler>[0]): Promise<unknown[] | 'not called'> {
  const next = jest.fn() as unknown as NextFunction & jest.Mock;
  asyncHandler(handler)(req, res, next);
  // Let the promise chain settle.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  return next.mock.calls.length === 0 ? 'not called' : next.mock.calls[0];
}

describe('asyncHandler', () => {
  it('a handler that resolves does not call next', async () => {
    expect(await nextArgs(async () => undefined)).toBe('not called');
  });

  it('passes the arguments through', async () => {
    const seen: unknown[] = [];
    await nextArgs(async (a, b, c) => {
      seen.push(a, b, typeof c);
    });
    expect(seen).toEqual([req, res, 'function']);
  });

  it('a rejection reaches next as the same Error', async () => {
    const error = new Error('boom');
    expect(await nextArgs(async () => Promise.reject(error))).toEqual([error]);
  });

  it('a handler that throws synchronously (not an async function) reaches next too', async () => {
    const error = new Error('sync boom');
    const args = await nextArgs(() => {
      throw error;
    });
    expect(args).toEqual([error]);
  });

  it.each([undefined, null, false, 0, ''])('a rejection with the falsy value %p still reaches next as an Error (not "carry on")', async (value) => {
    const args = await nextArgs(async () => Promise.reject(value));
    expect(args).not.toBe('not called');
    expect((args as unknown[])[0]).toBeInstanceOf(Error);
  });

  it.each(['route', 'router'])('a rejection with the string %p is an Error, not an Express routing command', async (value) => {
    const args = (await nextArgs(async () => Promise.reject(value))) as unknown[];
    expect(args[0]).toBeInstanceOf(Error);
    expect((args[0] as Error).message).toBe(value);
  });
});

describe('asError', () => {
  it('keeps errors, wraps everything else with the value as cause', () => {
    const error = new TypeError('x');
    expect(asError(error)).toBe(error);
    const wrapped = asError(undefined);
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('non-Error value thrown: undefined');
    expect(wrapped.cause).toBeUndefined();
    const object = { reason: 'x' };
    expect(asError(object).cause).toBe(object);
  });
});
