import { promises as fs } from 'node:fs';
import vm from 'node:vm';
import { errorMessage } from '../errors';

describe('errorMessage (D-93): a readable message for any thrown value, never throwing', () => {
  it.each([
    ['an Error', new Error('feed exploded'), 'feed exploded'],
    ['an Error subclass', new TypeError('bad type'), 'bad type'],
    ['an Error with no message', new RangeError(''), 'RangeError'],
    ['a string', 'network down', 'network down'],
    ['an empty string', '', '(empty error message)'],
    ['undefined', undefined, 'non-Error value thrown: undefined'],
    ['null', null, 'non-Error value thrown: null'],
    ['a number', 42, 'non-Error value thrown: 42'],
    ['an object', { code: 'ECONNRESET', retry: true }, "non-Error value thrown: { code: 'ECONNRESET', retry: true }"],
    ['a symbol', Symbol('x'), 'non-Error value thrown: Symbol(x)'],
    ['an object without a prototype', Object.assign(Object.create(null), { a: 1 }), 'non-Error value thrown: [Object: null prototype] { a: 1 }'],
    ['an error-like object with a message', { message: 'connection reset', code: 'ECONNRESET' }, 'connection reset'],
    ['an object with an empty message', { message: '' }, "non-Error value thrown: { message: '' }"],
  ])('%s', (_label, thrown, expected) => {
    expect(errorMessage(thrown)).toBe(expected);
  });

  it('an Error from another realm (vm context): instanceof fails, the message is still read', () => {
    const foreign = vm.runInNewContext('new Error("made elsewhere")');
    expect(foreign instanceof Error).toBe(false);
    expect(errorMessage(foreign)).toBe('made elsewhere');
    // With an empty message only the error check (util.types.isNativeError) can give the name.
    expect(errorMessage(vm.runInNewContext('new RangeError("")'))).toBe('RangeError');
  });

  it("Node's own fs errors, as a Jest test sees them (found in round 8: they were printed as non-Errors)", async () => {
    const error = await fs.readFile('/no/such/file/gs-errors-test').catch((caught: unknown) => caught);
    expect(errorMessage(error)).toMatch(/^ENOENT: no such file or directory, open '\/no\/such\/file\/gs-errors-test'$/);
  });
});
