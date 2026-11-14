export interface CsvOptions {
  /** Field separator. When omitted, ';' is used if the header line has more ';' than ','. */
  delimiter?: string;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

/**
 * Parses CSV text into rows of fields. Handles quoted fields, escaped quotes (""),
 * separators and newlines inside quotes, CRLF line endings, a UTF-8 BOM, and skips blank lines.
 */
export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = options.delimiter ?? detectDelimiter(input);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    const blank = row.length === 1 && row[0].trim() === '';
    if (!blank) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.trim() === '' && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
      field = '';
    } else if (char === delimiter) {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      if (input[i + 1] !== '\n') endRow();
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Parses CSV text whose first row is a header into one object per data row.
 * Header names are trimmed and lower-cased; values are trimmed.
 */
export function parseCsvRecords(text: string, options: CsvOptions = {}): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text, options);
  if (!header) return [];
  const names = header.map((name) => name.trim().toLowerCase());
  return rows.map((row) => {
    const record: Record<string, string> = {};
    names.forEach((name, index) => {
      record[name] = (row[index] ?? '').trim();
    });
    return record;
  });
}
