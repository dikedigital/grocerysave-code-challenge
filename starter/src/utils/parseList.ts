import type { ParsedItem } from '../models';
import { notImplemented } from './notImplemented';

/** Canonical unit for a spelling ("Lbs." -> "lb"), or null when it is not a known unit. */
export function normalizeUnit(text: string): string | null {
  return notImplemented(text);
}

/** Parses "2", "1.5", "1,5", "1/2" or "1 1/2". Returns null unless the result is a positive number. */
export function parseQuantity(text: string): number | null {
  return notImplemented(text);
}

/**
 * Parses one free-text line of a shopping list. Returns null for blank lines and comments (# ...).
 *
 * Accepted shapes (quantity defaults to 1, unit to 'each'):
 *   "milk"                      -> { name: 'milk', quantity: 1, unit: 'each' }
 *   "2 milk" / "2x milk" / "2 x milk"
 *   "milk x2" / "milk x 2" / "milk (2)" / "milk, 2" / "milk - 2"
 *   "2 lbs chicken breast"      -> { name: 'chicken breast', quantity: 2, unit: 'lb' }
 *   "1.5 kg rice" / "1,5 kg rice" / "500g flour" / "1/2 lb butter"
 *   "- eggs" / "* eggs" / "1. eggs" / "[ ] eggs"   (list bullets and checkboxes are stripped)
 *   "bread (whole wheat, sliced)" -> note: 'whole wheat, sliced'
 *
 * Units are normalised to: each, lb, oz, kg, g, l, ml, gal, pack, dozen, can, bottle, box, bag, bunch.
 * Names keep their original casing but are trimmed and have inner whitespace collapsed.
 */
export function parseListLine(line: string): ParsedItem | null {
  return notImplemented(line);
}

/** Parses pasted text, one item per line. Lines that parse to the same name and unit are merged (quantities added). */
export function parseListText(text: string): ParsedItem[] {
  return notImplemented(text);
}

/**
 * Parses an uploaded CSV list.
 * With a header row, columns are found by name: name|item|product, quantity|qty|amount, unit, note|notes.
 * Without a recognisable header, columns are positional: name, quantity, unit, note.
 * Rows without a name are skipped; an invalid or missing quantity becomes 1.
 *
 * A quantity cell may carry its unit ("2 lb") when the unit column is empty; unknown units become 'each'.
 */
export function parseListCsv(csv: string): ParsedItem[] {
  return notImplemented(csv);
}
