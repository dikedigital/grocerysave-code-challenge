/**
 * Input helpers shared by the routers (D-104, D-111).
 *
 * - Path ids are uuids; a malformed one must be answered 404 **before** any query (TECH_SPEC 6.1):
 *   Postgres would reject it with 22P02, and "malformed" must look the same as "not yours".
 * - Schema pieces give the messages D-111 prints as `field: message`.
 */
import { z } from 'zod';
import { notFound } from '../httpError';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a uuid in its canonical 8-4-4-4-12 hex form (any case). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** The path id, lower-cased, or a 404 with `message` when it is not a uuid. */
export function pathId(value: string | undefined, message: string): string {
  if (!isUuid(value)) throw notFound(message);
  return value.toLowerCase();
}

export const BODY_MESSAGE = 'The request body must be a JSON object';
/** Options for `z.object(shape, OBJECT_BODY)`: a body that is not an object gets one clear message. */
export const OBJECT_BODY = { required_error: BODY_MESSAGE, invalid_type_error: BODY_MESSAGE };

/** A required text field: `is required` when absent, `must be text` when not a string. */
export const text = () => z.string({ required_error: 'is required', invalid_type_error: 'must be text' });

/** Length in characters (code points), not UTF-16 units. */
export const characters = (value: string): number => [...value].length;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** True when the text holds a control character (newline, tab, NUL...): not allowed in one-line fields. */
export const hasControlCharacters = (value: string): boolean => CONTROL_CHARACTERS.test(value);

/**
 * True when the text shows nothing: only white space and invisible format characters (Unicode
 * category Cf: zero-width space, zero-width joiner, word joiner, soft hyphen, byte order mark...).
 * Such a name would look blank in every list (D-155).
 */
export const isBlank = (value: string): boolean => value.replace(/[\s\p{Cf}]/gu, '') === '';

/** A trimmed, non-blank, one-line name of at most `max` characters. */
export const trimmedName = (max: number) =>
  text().transform((value, ctx) => {
    const trimmed = value.trim();
    if (isBlank(trimmed)) {
      ctx.addIssue({ code: 'custom', message: 'is required' });
      return z.NEVER;
    }
    if (characters(trimmed) > max) {
      ctx.addIssue({ code: 'custom', message: `must be at most ${max} characters` });
      return z.NEVER;
    }
    if (hasControlCharacters(trimmed)) {
      ctx.addIssue({ code: 'custom', message: 'must not contain control characters' });
      return z.NEVER;
    }
    return trimmed;
  });
