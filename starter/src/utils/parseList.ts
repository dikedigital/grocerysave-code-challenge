import type { ParsedItem } from '../models';
import { parseCsv } from './csv';
import { roundTo } from './money';

// ---------- Units ----------

/** Every accepted spelling (lower case, without a trailing dot) of each canonical unit. */
const UNIT_SPELLINGS: Record<string, string[]> = {
  each: ['each', 'ea', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  oz: ['oz', 'ozs', 'ounce', 'ounces'],
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes'],
  g: ['g', 'gr', 'grs', 'gram', 'grams', 'gramme', 'grammes'],
  l: ['l', 'lt', 'ltr', 'ltrs', 'liter', 'liters', 'litre', 'litres'],
  ml: ['ml', 'mls', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
  gal: ['gal', 'gals', 'gallon', 'gallons'],
  pack: ['pack', 'packs', 'pk', 'pkt', 'pkts', 'pkg', 'pkgs', 'packet', 'packets', 'package', 'packages'],
  dozen: ['dozen', 'dozens', 'doz', 'dz'],
  can: ['can', 'cans', 'tin', 'tins'],
  bottle: ['bottle', 'bottles', 'btl', 'btls'],
  box: ['box', 'boxes'],
  bag: ['bag', 'bags'],
  bunch: ['bunch', 'bunches'],
};

const UNIT_BY_SPELLING = new Map<string, string>(
  Object.entries(UNIT_SPELLINGS).flatMap(([unit, spellings]) =>
    spellings.map((spelling): [string, string] => [spelling, unit])
  )
);

/** Canonical unit for a spelling ("Lbs." -> "lb"), or null when it is not a known unit. */
export function normalizeUnit(text: string): string | null {
  const key = text.trim().toLowerCase().replace(/\.+$/, '');
  return UNIT_BY_SPELLING.get(key) ?? null;
}

// ---------- Quantities ----------

/**
 * A number with thousands separators: a first group of 1-3 digits not starting with 0, then one or
 * more ",ddd" groups, then optional decimals with a point ("1,000", "12,345", "1,000,000", "1,500.5").
 * Decision D-15: a comma followed by exactly 3 digits separates thousands, except where no one
 * writes thousands that way ("0,500" is half, "1234,567" has a 4-digit first group): those, and
 * every other single comma ("1,5", "1,50"), stay decimal commas.
 */
const THOUSANDS_NUMBER = String.raw`[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?`;

/**
 * A quantity as written: a mixed number ("1 1/2"), a fraction ("1/2"), a number with thousands
 * separators ("1,000", "1,000,000") or a decimal with a point or a comma ("1.5", "1,5", ".5").
 * Every pattern using it is anchored, so the regex engine backtracks through the alternatives until
 * the rest of the line fits ("1,5000 g" falls back to the decimal form); the thousands form is what
 * lets a line hold multi-group numbers ("1,000,000 g", "1,500.5 g"). parseQuantity then decides
 * what the matched text means.
 */
const QUANTITY = String.raw`\d+\s+\d+/\d+|\d+/\d+|${THOUSANDS_NUMBER}|\d+(?:[.,]\d+)?|[.,]\d+`;

const MIXED = /^(\d+)\s+(\d+)\/(\d+)$/;
const FRACTION = /^(\d+)\/(\d+)$/;
const THOUSANDS = new RegExp(`^${THOUSANDS_NUMBER}$`);
const DECIMAL = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;

/**
 * Parses "2", "1.5", "1,5", "1,000", "1/2" or "1 1/2". Returns null unless the result is a positive number.
 * "1,000" is a thousand and "1,5" one and a half (decision D-15, see THOUSANDS_NUMBER).
 */
export function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  let value: number;
  let match: RegExpExecArray | null;
  if ((match = MIXED.exec(trimmed))) {
    value = Number(match[1]) + Number(match[2]) / Number(match[3]);
  } else if ((match = FRACTION.exec(trimmed))) {
    value = Number(match[1]) / Number(match[2]);
  } else if (THOUSANDS.test(trimmed)) {
    value = Number(trimmed.replace(/,/g, ''));
  } else if (DECIMAL.test(trimmed)) {
    value = Number(trimmed.replace(',', '.')); // a decimal comma: "1,5" is 1.5
  } else {
    return null;
  }
  // Fractions are kept to 3 decimals (1/3 -> 0.333); a value that rounds to 0 is not positive.
  const rounded = roundTo(value, 3);
  return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
}

// ---------- One line ----------

/**
 * A list bullet or checkbox at the start of a line: "- ", "* ", "+ ", "• ", "1. ", "2) ", "[ ]", "[x]",
 * and the symbols editors substitute for them ("– " and "— " from autocorrected dashes, "●", "■",
 * "➤", ticks "✓"/"✔" and ballot boxes "☐"/"☑").
 */
const BULLET = /^(?:[-*+•◦▪‣·–—●○■□▸►➤→✓✔✗✘]\s*|\d+[.)](?:\s+|$)|\[\s*[xX✓✔]?\s*\]\s*|[☐☑☒]\s*)/;

/** "2x milk", "2 x milk", "2 × milk". */
const LEADING_TIMES = new RegExp(String.raw`^(${QUANTITY})\s*[xX×]\s+(.+)$`);
/** "500g flour", "1,5kg rice", "2pk soda": the unit written against the number. */
const LEADING_GLUED_UNIT = new RegExp(String.raw`^(${QUANTITY})([a-zA-Z]+\.?)\s+(.+)$`);
/** "2 milk", "2 lbs chicken breast": the first word of the rest may be a unit. */
const LEADING_SPACED = new RegExp(String.raw`^(${QUANTITY})\s+(.+)$`);

/** "milk x2", "milk x 2". */
const TRAILING_TIMES = new RegExp(String.raw`^(.+?)\s+[xX×]\s*(${QUANTITY})$`);
/** A quantity with an optional unit word, as it may end a line ("2", "1,5 kg", "500g"). */
const AMOUNT = String.raw`(?:${QUANTITY})\s*(?:[a-zA-Z]+\.?)?`;
/**
 * "milk, 2", "rice, 1,5 kg", "salt, pepper, 2". The amount is anchored at the end, so the name grows
 * past earlier commas until the rest is an amount (and "1,5" is never split at its comma).
 */
const TRAILING_COMMA = new RegExp(String.raw`^(.+?)\s*,\s*(${AMOUNT})$`);
/** "milk - 2", "rice – 1.5 kg" (spaces around the dash, so "T-2" is a name). */
const TRAILING_DASH = new RegExp(String.raw`^(.+?)\s+[-–—]\s+(${AMOUNT})$`);

/** "2", "1.5 kg", "500g" or "2 lbs." on its own: the quantity of a trailing or bracketed group. */
const QUANTITY_WITH_UNIT = new RegExp(String.raw`^(${QUANTITY})\s*([a-zA-Z]+\.?)?$`);

interface Amount {
  quantity: number;
  unit: string;
}

/** Reads "2", "1.5 kg" or "500g" (a quantity with an optional known unit), else null. */
function parseAmount(text: string): Amount | null {
  const match = QUANTITY_WITH_UNIT.exec(text.trim());
  if (!match) return null;
  const quantity = parseQuantity(match[1]);
  if (quantity === null) return null;
  if (match[2] === undefined) return { quantity, unit: 'each' };
  const unit = normalizeUnit(match[2]);
  return unit === null ? null : { quantity, unit };
}

/** Invisible characters that web pages and chat apps leave in copied text. */
const INVISIBLE = /[\u200B\u2060\u00AD]/g; // zero-width space, word joiner, soft hyphen

/**
 * Removes invisible characters, collapses runs of whitespace (including tabs, newlines, no-break
 * spaces and a BOM) to one space, and trims. "Milk\u200B" and "Milk" are then the same name.
 */
function tidy(text: string): string {
  return text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** Removes any number of leading bullets and checkboxes ("- [ ] eggs" -> "eggs"). */
function stripBullets(text: string): string {
  let rest = text;
  for (let previous = ''; previous !== rest; ) {
    previous = rest;
    rest = rest.replace(BULLET, '');
  }
  return rest;
}

/** Splits "bread (whole wheat, sliced)" into the body and the last bracketed group (nesting allowed). */
function splitTrailingGroup(text: string): { body: string; group: string | null } {
  if (!text.endsWith(')')) return { body: text, group: null };
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === ')') depth++;
    else if (text[i] === '(' && --depth === 0) {
      const body = text.slice(0, i).trim();
      // "(2)" alone has no name to attach to: keep it as the name.
      return body === '' ? { body: text, group: null } : { body, group: text.slice(i + 1, -1).trim() };
    }
  }
  return { body: text, group: null }; // unbalanced: "milk (2))"
}

/** Reads a quantity at the start of the text ("2 lbs chicken", "500g flour", "2x milk"). */
function leadingAmount(text: string): (Amount & { name: string }) | null {
  let match = LEADING_TIMES.exec(text);
  if (match) {
    const quantity = parseQuantity(match[1]);
    return quantity === null ? null : { quantity, unit: 'each', name: match[2] };
  }

  match = LEADING_GLUED_UNIT.exec(text);
  if (match) {
    const quantity = parseQuantity(match[1]);
    const unit = normalizeUnit(match[2]);
    // "7up cans" or "3m tape": the letters are not a unit, so the number belongs to the name.
    if (quantity === null || unit === null) return null;
    return { quantity, unit, name: dropLeadingOf(match[3]) };
  }

  match = LEADING_SPACED.exec(text);
  if (match) {
    const quantity = parseQuantity(match[1]);
    if (quantity === null) return null; // "0 milk": keep the number in the name
    const rest = match[2];
    const space = rest.indexOf(' ');
    // The first word is the unit only when a name remains after it ("2 lb" is 2 x "lb").
    if (space > 0) {
      const unit = normalizeUnit(rest.slice(0, space));
      if (unit !== null) return { quantity, unit, name: dropLeadingOf(rest.slice(space + 1)) };
    }
    return { quantity, unit: 'each', name: rest };
  }
  return null;
}

/** "2 cans of tomatoes" names "tomatoes": drop an "of" that follows a unit, when a name remains. */
function dropLeadingOf(name: string): string {
  const match = /^of\s+(\S.*)$/i.exec(name);
  return match ? match[1] : name;
}

/** Reads a quantity at the end of the text ("milk x2", "milk, 2", "milk - 2"). */
function trailingAmount(text: string): (Amount & { name: string }) | null {
  const times = TRAILING_TIMES.exec(text);
  if (times) {
    const quantity = parseQuantity(times[2]);
    if (quantity !== null) return { quantity, unit: 'each', name: times[1] };
  }
  for (const pattern of [TRAILING_COMMA, TRAILING_DASH]) {
    const match = pattern.exec(text);
    const amount = match ? parseAmount(match[2]) : null;
    if (match && amount) return { ...amount, name: match[1] };
  }
  return null;
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
 *
 * Precedence, where the shapes overlap:
 * - A leading quantity wins over a trailing one; the other text then stays in the name or note
 *   ("2 milk (2)" is 2 x "milk" with the note "2").
 * - The last bracketed group is a quantity ("milk (2)", "milk (1.5 kg)") only when the line has no
 *   leading quantity and the group is nothing but a quantity; otherwise it is the note.
 * - Trailing ", 2" and " - 2" may carry a unit ("rice, 1.5 kg"); "x2" may not.
 * - Leading "of" after a unit is dropped ("2 cans of tomatoes" -> "tomatoes").
 * - A number that is not a positive quantity ("0 milk"), or that is glued to letters that are not
 *   a unit ("7up"), is part of the name.
 */
export function parseListLine(line: string): ParsedItem | null {
  const text = tidy(line);
  if (text === '' || text.startsWith('#')) return null;

  const unbulleted = stripBullets(text);
  if (unbulleted === '') return null; // a bare bullet or an empty checkbox

  const { body, group } = splitTrailingGroup(unbulleted);
  let note = group;
  let parsed = leadingAmount(body);

  if (!parsed && group !== null) {
    const amount = parseAmount(group);
    if (amount) {
      parsed = { ...amount, name: body };
      note = null;
    }
  }
  if (!parsed) {
    parsed = trailingAmount(body);
    // "milk (organic) x2": the note sat before the trailing quantity.
    if (parsed && note === null) {
      const inner = splitTrailingGroup(parsed.name);
      parsed.name = inner.body;
      note = inner.group;
    }
  }
  parsed ??= { quantity: 1, unit: 'each', name: body };

  const item: ParsedItem = { name: tidy(parsed.name), quantity: parsed.quantity, unit: parsed.unit };
  if (note) item.note = tidy(note);
  return item;
}

// ---------- Pasted text ----------

/**
 * Parses pasted text, one item per line. Lines that parse to the same name and unit are merged (quantities added).
 *
 * Merging ignores the case of the name and keeps the first spelling and the position of the first
 * line; quantities are added (and kept to 3 decimals); differing notes are joined with "; " in order
 * of appearance, a note that repeats one already kept (ignoring case) is not added again.
 * Lines ending in \n, \r\n or \r are accepted.
 */
export function parseListText(text: string): ParsedItem[] {
  const merged = new Map<string, { item: ParsedItem; notes: string[] }>();
  for (const line of text.split(/\r\n|\r|\n/)) {
    const item = parseListLine(line);
    if (!item) continue;
    const key = `${item.name.toLowerCase()}\u0000${item.unit}`;
    const entry = merged.get(key);
    if (!entry) {
      merged.set(key, { item: { ...item }, notes: item.note ? [item.note] : [] });
      continue;
    }
    entry.item.quantity = roundTo(entry.item.quantity + item.quantity, 3);
    if (item.note && !entry.notes.some((note) => note.toLowerCase() === item.note?.toLowerCase())) {
      entry.notes.push(item.note);
      entry.item.note = entry.notes.join('; ');
    }
  }
  return [...merged.values()].map(({ item }) => item);
}

// ---------- CSV ----------

type CsvField = 'name' | 'quantity' | 'unit' | 'note';

/** Header names of each column, compared after lower-casing and trimming (a trailing ":" or "." is ignored). */
const CSV_HEADERS: Record<CsvField, string[]> = {
  name: ['name', 'item', 'product'],
  quantity: ['quantity', 'qty', 'amount'],
  unit: ['unit'],
  note: ['note', 'notes'],
};

/** Column index of each field; -1 when the file has no such column. */
type CsvColumns = Record<CsvField, number>;

const POSITIONAL_COLUMNS: CsvColumns = { name: 0, quantity: 1, unit: 2, note: 3 };

/** "Qty." and " QUANTITY: " both read as "qty" / "quantity". */
function headerKey(cell: string): string {
  return tidy(cell).toLowerCase().replace(/[.:]+$/, '');
}

function fieldOfHeader(cell: string): CsvField | null {
  const key = headerKey(cell);
  for (const field of Object.keys(CSV_HEADERS) as CsvField[]) {
    if (CSV_HEADERS[field].includes(key)) return field;
  }
  return null;
}

/**
 * Reads the header row when it has at least one known column name; otherwise null (the file is
 * positional). The left-most column wins when a field appears twice. A header without a name
 * column ("Description,Qty") uses its first unrecognised column as the name.
 */
function headerColumns(row: string[]): CsvColumns | null {
  const columns: CsvColumns = { name: -1, quantity: -1, unit: -1, note: -1 };
  let recognised = false;
  row.forEach((cell, index) => {
    const field = fieldOfHeader(cell);
    if (field === null) return;
    recognised = true;
    if (columns[field] === -1) columns[field] = index;
  });
  if (!recognised) return null;
  if (columns.name === -1) columns.name = row.findIndex((cell) => fieldOfHeader(cell) === null);
  return columns;
}

/** The first line that is not blank, read up to its first line break outside quotes. */
function firstContentLine(text: string): string {
  let line = '';
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (line.trim() !== '') return line;
      line = '';
    } else {
      line += char;
    }
  }
  return line;
}

/**
 * Picks the field separator from the first line with content: a tab, ';' or ','.
 * Unlike the generic CSV reader it skips leading blank lines, does not count separators inside
 * quotes or commas between two digits (a decimal comma, as in "Milk;1,5"), and it honours Excel's
 * "sep=;" first line. Ties go to the tab, then ';'.
 */
function detectListDelimiter(text: string): { delimiter: string; body: string } {
  const sep = /^\uFEFF?sep=(.)\s*(?:\r\n|\r|\n|$)/i.exec(text);
  if (sep) return { delimiter: sep[1], body: text.slice(sep[0].length) };

  const line = firstContentLine(text);
  let tabs = 0;
  let semicolons = 0;
  let commas = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (inQuotes) continue;
    else if (char === '\t') tabs++;
    else if (char === ';') semicolons++;
    else if (char === ',' && !(/\d/.test(line[i - 1] ?? '') && /\d/.test(line[i + 1] ?? ''))) commas++;
  }
  if (tabs > 0 && tabs >= semicolons && tabs >= commas) return { delimiter: '\t', body: text };
  if (semicolons > 0 && semicolons >= commas) return { delimiter: ';', body: text };
  return { delimiter: ',', body: text };
}

/** "2", "2 lb", "500g", "2 cups" in a quantity cell. The unit is null when absent or unknown. */
function parseQuantityCell(cell: string): { quantity: number | null; unit: string | null } {
  const match = new RegExp(String.raw`^(${QUANTITY})\s*([a-zA-Z]+\.?)?$`).exec(tidy(cell));
  if (!match) return { quantity: null, unit: null };
  return { quantity: parseQuantity(match[1]), unit: match[2] === undefined ? null : normalizeUnit(match[2]) };
}

/**
 * Parses an uploaded CSV list.
 * With a header row, columns are found by name: name|item|product, quantity|qty|amount, unit, note|notes.
 * Without a recognisable header, columns are positional: name, quantity, unit, note.
 * Rows without a name are skipped; an invalid or missing quantity becomes 1.
 *
 * A quantity cell may carry its unit ("2 lb") when the unit column is empty; unknown units become 'each'.
 *
 * Also: the separator may be ',', ';' or a tab (see detectListDelimiter); header names ignore case
 * and surrounding spaces; whitespace and newlines inside a cell collapse to one space; rows that are
 * entirely empty (",,,") are skipped; rows are not merged.
 */
export function parseListCsv(csv: string): ParsedItem[] {
  const { delimiter, body } = detectListDelimiter(csv);
  const rows = parseCsv(body, { delimiter }).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (rows.length === 0) return [];

  const header = headerColumns(rows[0]);
  const columns = header ?? POSITIONAL_COLUMNS;
  const cellOf = (row: string[], field: CsvField) => (columns[field] < 0 ? '' : tidy(row[columns[field]] ?? ''));

  const items: ParsedItem[] = [];
  for (const row of header ? rows.slice(1) : rows) {
    const name = cellOf(row, 'name');
    if (name === '') continue;
    const fromQuantity = parseQuantityCell(cellOf(row, 'quantity'));
    const unitCell = cellOf(row, 'unit');
    const unit = unitCell !== '' ? normalizeUnit(unitCell) : fromQuantity.unit;
    const item: ParsedItem = { name, quantity: fromQuantity.quantity ?? 1, unit: unit ?? 'each' };
    const note = cellOf(row, 'note');
    if (note !== '') item.note = note;
    items.push(item);
  }
  return items;
}
