import { inspect, types } from 'node:util';

/**
 * A readable message for any thrown value (D-93): an error's message (its name when the message is
 * empty), a string as is, anything else (`undefined`, `null`, objects) described. Never throws,
 * unlike `(error as Error).message`, which throws for `undefined` and `null`.
 *
 * Errors are recognised with `util.types.isNativeError`, not only `instanceof Error`: an error made
 * in another realm (Node's own `fs` errors seen from a Jest test context, `vm`, worker threads) is
 * not an `instanceof` this realm's `Error`. Objects with a string `message` (error-like values from
 * libraries) count as errors too.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error || types.isNativeError(error)) {
    const { message, name } = error as Error;
    return message || name || 'Error';
  }
  if (typeof error === 'string') return error || '(empty error message)';
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string' && (error as { message: string }).message !== '') {
    return (error as { message: string }).message;
  }
  return `non-Error value thrown: ${inspect(error, { depth: 2, breakLength: Infinity })}`;
}
