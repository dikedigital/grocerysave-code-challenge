import { CSV_TEMPLATE, ITEM_UNITS } from '../../config/constants';
import type { ParsedItem } from '../../models';
import { normalizeUnit, parseListCsv, parseListLine, parseListText, parseQuantity } from '../parseList';

/** Shorthand for the expected item; `note` is only present when given (checked with toStrictEqual). */
function item(name: string, quantity = 1, unit = 'each', note?: string): ParsedItem {
  return note === undefined ? { name, quantity, unit } : { name, quantity, unit, note };
}

describe('normalizeUnit', () => {
  it('maps every canonical unit offered by the client to itself', () => {
    for (const unit of ITEM_UNITS) expect(normalizeUnit(unit)).toBe(unit);
  });

  it.each([
    ['Lbs.', 'lb'],
    ['LB', 'lb'],
    ['pounds', 'lb'],
    ['ounces', 'oz'],
    ['Kg', 'kg'],
    ['kilos', 'kg'],
    ['grams', 'g'],
    ['gr', 'g'],
    ['litre', 'l'],
    ['Liters', 'l'],
    ['ML', 'ml'],
    ['gallons', 'gal'],
    ['pk', 'pack'],
    ['packets', 'pack'],
    ['doz', 'dozen'],
    ['cans', 'can'],
    ['tins', 'can'],
    ['bottles', 'bottle'],
    ['boxes', 'box'],
    ['bags', 'bag'],
    ['bunches', 'bunch'],
    ['ea', 'each'],
    ['pcs', 'each'],
    ['  kg  ', 'kg'],
  ])('%p -> %p', (text, unit) => {
    expect(normalizeUnit(text)).toBe(unit);
  });

  it.each(['', '   ', 'cup', 'tbsp', 'loaf', 'rolls', 'milk', 'x', 'k g', '.'])('%p is not a unit', (text) => {
    expect(normalizeUnit(text)).toBeNull();
  });
});

describe('parseQuantity', () => {
  it.each([
    ['2', 2],
    [' 2 ', 2],
    ['12', 12],
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['.5', 0.5],
    ['0.25', 0.25],
    ['1/2', 0.5],
    ['3/4', 0.75],
    ['1/3', 0.333],
    ['2/3', 0.667],
    ['1 1/2', 1.5],
    ['2  1/4', 2.25],
    ['1.23456', 1.235],
    ['007', 7],
  ])('%p -> %p', (text, expected) => {
    expect(parseQuantity(text)).toBe(expected);
  });

  it.each(['', ' ', 'abc', '0', '0.0', '0/5', '-1', '-0.5', '1/0', '0.0001', '2x', 'x2', '1e3', '1.2.3', '1/2/3', 'Infinity', 'NaN', '½'])(
    '%p -> null',
    (text) => {
      expect(parseQuantity(text)).toBeNull();
    }
  );

  it.each([
    ['1,000', 1000],
    ['12,345', 12345],
    ['999,999', 999999],
    ['1,000,000', 1000000],
    ['1,500.5', 1500.5],
    ['1,000.125', 1000.125],
  ])('reads a comma followed by exactly 3 digits as thousands: %p -> %p (decision D-15)', (text, expected) => {
    expect(parseQuantity(text)).toBe(expected);
  });

  it.each([
    ['1,5', 1.5],
    ['1,50', 1.5],
    ['1,5000', 1.5],
    ['0,500', 0.5], // nobody writes thousands with a leading 0: half
    ['0,250', 0.25],
    ['1234,567', 1234.567], // a 4-digit first group is not thousands grouping
    ['12,3456', 12.346],
  ])('keeps every other comma a decimal comma: %p -> %p', (text, expected) => {
    expect(parseQuantity(text)).toBe(expected);
  });

  it.each(['1,000,5', '1,00,000', '1.000,5', '1,000.', ',000', '1,,000'])('rejects the malformed number %p', (text) => {
    expect(parseQuantity(text)).toBeNull();
  });
});

describe('parseListLine: the shapes of the doc comment', () => {
  it.each([
    ['milk', item('milk')],
    ['2 milk', item('milk', 2)],
    ['2x milk', item('milk', 2)],
    ['2 x milk', item('milk', 2)],
    ['milk x2', item('milk', 2)],
    ['milk x 2', item('milk', 2)],
    ['milk (2)', item('milk', 2)],
    ['milk, 2', item('milk', 2)],
    ['milk - 2', item('milk', 2)],
    ['2 lbs chicken breast', item('chicken breast', 2, 'lb')],
    ['1.5 kg rice', item('rice', 1.5, 'kg')],
    ['1,5 kg rice', item('rice', 1.5, 'kg')],
    ['500g flour', item('flour', 500, 'g')],
    ['1/2 lb butter', item('butter', 0.5, 'lb')],
    ['- eggs', item('eggs')],
    ['* eggs', item('eggs')],
    ['1. eggs', item('eggs')],
    ['[ ] eggs', item('eggs')],
    ['bread (whole wheat, sliced)', item('bread', 1, 'each', 'whole wheat, sliced')],
  ])('%p', (line, expected) => {
    expect(parseListLine(line)).toStrictEqual(expected);
  });
});

describe('parseListLine: blank lines and comments', () => {
  it.each(['', '   ', '\t', '\r', '# comment', '  # indented comment', '#'])('%p -> null', (line) => {
    expect(parseListLine(line)).toBeNull();
  });

  it.each(['-', '* ', '[ ]', '- [x]', '1. '])('a bullet with nothing after it (%p) -> null', (line) => {
    expect(parseListLine(line)).toBeNull();
  });

  it('only treats # at the start as a comment', () => {
    expect(parseListLine('size #2 nails')).toStrictEqual(item('size #2 nails'));
  });
});

describe('parseListLine: names', () => {
  it('keeps the casing, trims and collapses inner whitespace (tabs, no-break spaces)', () => {
    expect(parseListLine('  Greek \t  Yogurt  ')).toStrictEqual(item('Greek Yogurt'));
    expect(parseListLine('Peanut\u00a0Butter')).toStrictEqual(item('Peanut Butter'));
    expect(parseListLine('2   LBS    Chicken   Breast\r')).toStrictEqual(item('Chicken Breast', 2, 'lb'));
  });

  it('omits the note key when there is no note', () => {
    expect(parseListLine('milk')).not.toHaveProperty('note');
    expect(parseListLine('milk ()')).toStrictEqual(item('milk'));
    expect(parseListLine('milk (   )')).toStrictEqual(item('milk'));
  });
});

describe('parseListLine: leading quantities and units', () => {
  it.each([
    ['2 Lbs. Chicken Breast', item('Chicken Breast', 2, 'lb')],
    ['2 X milk', item('milk', 2)],
    ['2 × milk', item('milk', 2)],
    ['12 eggs', item('eggs', 12)],
    ['2 dozen eggs', item('eggs', 2, 'dozen')],
    ['1 1/2 lb butter', item('butter', 1.5, 'lb')],
    ['1/3 kg cheese', item('cheese', 0.333, 'kg')],
    ['1,5kg rice', item('rice', 1.5, 'kg')],
    ['2pk soda', item('soda', 2, 'pack')],
    ['.5 gal milk', item('milk', 0.5, 'gal')],
    ['3 bunches bananas', item('bananas', 3, 'bunch')],
    ['2 cans of tomatoes', item('tomatoes', 2, 'can')],
    ['2 bottles Of water', item('water', 2, 'bottle')],
    ['2 of milk', item('of milk', 2)], // "of" is only dropped after a unit
    ['2 cups flour', item('cups flour', 2)], // cup is not a unit of the product
  ])('%p', (line, expected) => {
    expect(parseListLine(line)).toStrictEqual(expected);
  });

  it('reads "2 lb" alone as 2 x "lb" (a unit needs a name after it)', () => {
    expect(parseListLine('2 lb')).toStrictEqual(item('lb', 2));
    expect(parseListLine('3 kg')).toStrictEqual(item('kg', 3));
  });

  it('keeps numbers that are not quantities in the name', () => {
    expect(parseListLine('7up')).toStrictEqual(item('7up'));
    expect(parseListLine('3m tape')).toStrictEqual(item('3m tape'));
    expect(parseListLine('0 milk')).toStrictEqual(item('0 milk'));
    expect(parseListLine('500g')).toStrictEqual(item('500g'));
    expect(parseListLine('2')).toStrictEqual(item('2'));
    expect(parseListLine('T-2 batteries')).toStrictEqual(item('T-2 batteries'));
  });

  it('does not read an x-word as a multiplier', () => {
    expect(parseListLine('2 xl eggs')).toStrictEqual(item('xl eggs', 2));
    expect(parseListLine('2 X-Large eggs')).toStrictEqual(item('X-Large eggs', 2));
  });
});

describe('parseListLine: trailing quantities', () => {
  it.each([
    ['milk X2', item('milk', 2)],
    ['milk ×3', item('milk', 3)],
    ['milk x 1.5', item('milk', 1.5)],
    ['milk,2', item('milk', 2)],
    ['rice, 1,5 kg', item('rice', 1.5, 'kg')],
    ['rice, 1,5', item('rice', 1.5)],
    ['rice - 2 kg', item('rice', 2, 'kg')],
    ['rice – 500g', item('rice', 500, 'g')],
    ['salt, pepper, 2', item('salt, pepper', 2)],
    ['milk (1.5 l)', item('milk', 1.5, 'l')],
    ['milk (1/2)', item('milk', 0.5)],
  ])('%p', (line, expected) => {
    expect(parseListLine(line)).toStrictEqual(expected);
  });

  it('keeps text that only looks like a trailing quantity', () => {
    expect(parseListLine('tomatoes, ripe')).toStrictEqual(item('tomatoes, ripe'));
    expect(parseListLine('milk - semi skimmed')).toStrictEqual(item('milk - semi skimmed'));
    expect(parseListLine('milk, 2 cups')).toStrictEqual(item('milk, 2 cups'));
    expect(parseListLine('box x')).toStrictEqual(item('box x'));
    expect(parseListLine('milk x0')).toStrictEqual(item('milk x0'));
  });

  it('lets a leading quantity win; the trailing text stays', () => {
    expect(parseListLine('2 milk x3')).toStrictEqual(item('milk x3', 2));
    expect(parseListLine('2 milk (2)')).toStrictEqual(item('milk', 2, 'each', '2'));
  });
});

describe('parseListLine: notes', () => {
  it.each([
    ['2 lbs chicken breast (boneless)', item('chicken breast', 2, 'lb', 'boneless')],
    ['milk (organic) x2', item('milk', 2, 'each', 'organic')],
    ['milk x2 (organic)', item('milk', 2, 'each', 'organic')],
    ['milk, 2 (semi-skimmed)', item('milk', 2, 'each', 'semi-skimmed')],
    ['bread (  whole   wheat  )', item('bread', 1, 'each', 'whole wheat')],
    ['bread (whole wheat (sliced))', item('bread', 1, 'each', 'whole wheat (sliced)')],
    ['milk (2 cups)', item('milk', 1, 'each', '2 cups')],
  ])('%p', (line, expected) => {
    expect(parseListLine(line)).toStrictEqual(expected);
  });

  it('keeps brackets that are not a trailing group in the name', () => {
    expect(parseListLine('(2)')).toStrictEqual(item('(2)'));
    expect(parseListLine('milk (2')).toStrictEqual(item('milk (2'));
    expect(parseListLine('milk (2))')).toStrictEqual(item('milk (2))'));
    expect(parseListLine('M&M (peanut) bag')).toStrictEqual(item('M&M (peanut) bag'));
  });
});

describe('parseListLine: bullets and checkboxes', () => {
  it.each([
    ['+ eggs', 'eggs'],
    ['• eggs', 'eggs'],
    ['-eggs', 'eggs'],
    ['2) eggs', 'eggs'],
    ['10. eggs', 'eggs'],
    ['[] eggs', 'eggs'],
    ['[x] eggs', 'eggs'],
    ['[X] eggs', 'eggs'],
    ['[ x ] eggs', 'eggs'],
    ['☐ eggs', 'eggs'],
    ['- [ ] eggs', 'eggs'],
    ['1. [x] eggs', 'eggs'],
  ])('%p', (line, name) => {
    expect(parseListLine(line)).toStrictEqual(item(name));
  });

  it('parses the quantity after the bullet', () => {
    expect(parseListLine('- [ ] 12 eggs')).toStrictEqual(item('eggs', 12));
    expect(parseListLine('1. 2 lbs chicken')).toStrictEqual(item('chicken', 2, 'lb'));
    expect(parseListLine('* milk x2')).toStrictEqual(item('milk', 2));
  });

  it('does not mistake a decimal for a numbered bullet', () => {
    expect(parseListLine('1.5 kg rice')).toStrictEqual(item('rice', 1.5, 'kg'));
    expect(parseListLine('1.eggs')).toStrictEqual(item('1.eggs'));
  });
});

describe('parseListLine: thousands separators (decision D-15)', () => {
  it.each([
    ['1,000 g sugar', item('sugar', 1000, 'g')],
    ['1,000g sugar', item('sugar', 1000, 'g')],
    ['2,500 ml water', item('water', 2500, 'ml')],
    ['sugar, 1,000 g', item('sugar', 1000, 'g')],
    ['sugar - 1,000 g', item('sugar', 1000, 'g')],
    ['sugar x 1,000', item('sugar', 1000)],
    ['sugar (1,000 g)', item('sugar', 1000, 'g')],
    ['1,000,000 g sugar', item('sugar', 1000000, 'g')], // several groups
    ['1,500.5 g sugar', item('sugar', 1500.5, 'g')], // groups and decimals
    ['sugar, 1,000,000 g', item('sugar', 1000000, 'g')],
    ['sugar (1,500.25)', item('sugar', 1500.25)],
    ['1,5000 g sugar', item('sugar', 1.5, 'g')], // not thousands: the engine falls back to 1,5...
    ['0,500 kg flour', item('flour', 0.5, 'kg')],
    ['rice, 1,5 kg', item('rice', 1.5, 'kg')],
    ['eggs,120', item('eggs', 120)],
  ])('%p', (line, expected) => {
    expect(parseListLine(line)).toStrictEqual(expected);
  });
});

describe('parseListLine: regressions found while parsing whole lists', () => {
  it.each([
    ['– Butter', 'Butter'], // Word / Apple Notes autocorrect "- " to an en dash
    ['— Butter', 'Butter'],
    ['● Bananas', 'Bananas'],
    ['○ Bananas', 'Bananas'],
    ['■ Rice', 'Rice'],
    ['➤ Rice', 'Rice'],
    ['✓ Rice', 'Rice'],
    ['✔ Rice', 'Rice'],
    ['☑ Rice', 'Rice'],
  ])('strips the editor bullet in %p', (line, name) => {
    expect(parseListLine(line)).toStrictEqual(item(name));
  });

  it('keeps the quantity after an editor bullet', () => {
    expect(parseListLine('— Apples x3')).toStrictEqual(item('Apples', 3));
    expect(parseListLine('– 2 lbs chicken')).toStrictEqual(item('chicken', 2, 'lb'));
  });

  it('removes invisible characters copied from web pages', () => {
    expect(parseListLine('Milk\u200b')).toStrictEqual(item('Milk'));
    expect(parseListLine('\u200bMilk')).toStrictEqual(item('Milk'));
    expect(parseListLine('Pea\u00adnut butter')).toStrictEqual(item('Peanut butter'));
    expect(parseListLine('\ufeffMilk')).toStrictEqual(item('Milk'));
    expect(parseListLine('\u200b')).toBeNull();
  });
});

describe('parseListText', () => {
  it('merges "Milk", "milk" and "2 milk (organic)"', () => {
    expect(parseListText('Milk\nmilk\n2 milk (organic)')).toStrictEqual([item('Milk', 4, 'each', 'organic')]);
  });

  it('parses one item per line and skips blank lines and comments', () => {
    expect(parseListText('# groceries\n2 lbs chicken breast\n\n   \nmilk x2\n- eggs\n')).toStrictEqual([
      item('chicken breast', 2, 'lb'),
      item('milk', 2),
      item('eggs'),
    ]);
  });

  it('accepts \\n, \\r\\n and \\r line endings', () => {
    expect(parseListText('milk\r\neggs\rbread\n')).toStrictEqual([item('milk'), item('eggs'), item('bread')]);
  });

  it('returns [] for empty, blank or comment-only text', () => {
    expect(parseListText('')).toEqual([]);
    expect(parseListText('\n \n\t\n')).toEqual([]);
    expect(parseListText('# one\n# two')).toEqual([]);
  });

  it('ignores case, keeps the first spelling and the position of the first line', () => {
    expect(parseListText('eggs\nMILK\nEggs\nmilk\nBread')).toStrictEqual([item('eggs', 2), item('MILK', 2), item('Bread')]);
  });

  it('merges only when the unit matches as well', () => {
    expect(parseListText('1 kg rice\n500 g rice\nRice, 2 kg\nrice')).toStrictEqual([
      item('rice', 3, 'kg'),
      item('rice', 500, 'g'),
      item('rice'),
    ]);
  });

  it('merges lines written in different shapes', () => {
    expect(parseListText('2 milk\nmilk x3\n- Milk\n[ ] milk (2)\nmilk, 1.5')).toStrictEqual([item('milk', 9.5)]); // 2 + 3 + 1 + 2 + 1.5
  });

  it('merges names that differ only by whitespace or invisible characters', () => {
    expect(parseListText('peanut   butter\n  Peanut Butter \nPeanut\u200b butter')).toStrictEqual([item('peanut butter', 3)]);
  });

  it('keeps merged quantities to 3 decimals', () => {
    expect(parseListText('0.1 kg salt\n0.2 kg salt')).toStrictEqual([item('salt', 0.3, 'kg')]); // not 0.30000000000000004
    // Each line is rounded first (1/3 -> 0.333), so three thirds make 0.999.
    expect(parseListText('1/3 kg flour\n1/3 kg flour\n1/3 kg flour')).toStrictEqual([item('flour', 0.999, 'kg')]);
  });

  it('joins differing notes with "; " in order, without repeating a note', () => {
    expect(parseListText('milk (organic)\nmilk\nmilk (2%)\nmilk (organic)\nmilk (Organic)')).toStrictEqual([
      item('milk', 5, 'each', 'organic; 2%'),
    ]);
  });

  it('takes the note of a later line when the first had none', () => {
    expect(parseListText('milk\nmilk (cold)')).toStrictEqual([item('milk', 2, 'each', 'cold')]);
  });

  it('does not mutate the items it returns when merging later lines', () => {
    const [first] = parseListText('milk (a)');
    const merged = parseListText('milk (a)\nmilk (b)');
    expect(first).toStrictEqual(item('milk', 1, 'each', 'a'));
    expect(merged).toStrictEqual([item('milk', 2, 'each', 'a; b')]);
  });

  it('reads a list pasted from a notes app', () => {
    expect(parseListText('☐ Milk\n☑ eggs\n• Bread\n– Butter\n— Apples x3\n1.\tRice\n2) 500g flour')).toStrictEqual([
      item('Milk'),
      item('eggs'),
      item('Bread'),
      item('Butter'),
      item('Apples', 3),
      item('Rice'),
      item('flour', 500, 'g'),
    ]);
  });
});

describe('parseListCsv: header rows', () => {
  it('reads the template offered by the client', () => {
    expect(parseListCsv(CSV_TEMPLATE)).toStrictEqual([
      item('Milk', 2, 'l', 'semi-skimmed'),
      item('Bananas', 6),
      item('Chicken breast', 1.5, 'lb', 'boneless'),
      item('Rice', 1, 'kg'),
    ]);
  });

  it.each([
    ['name,quantity,unit,note'],
    ['item,qty,unit,notes'],
    ['product,amount,unit,note'],
    ['Item,Qty,Unit,Notes'],
    ['PRODUCT,AMOUNT,UNIT,NOTES'],
    [' Name , Quantity , Unit , Note '],
    ['Item:,Qty.,Unit,Notes'],
  ])('finds the columns of header %p', (header) => {
    expect(parseListCsv(`${header}\nMilk,2,l,cold\nEggs,12,,`)).toStrictEqual([item('Milk', 2, 'l', 'cold'), item('Eggs', 12)]);
  });

  it('finds columns in any order and ignores unknown columns', () => {
    const csv = 'Aisle,Qty,Product,Price,Notes\nDairy,2,Milk,3.20,"cold, please"\nBakery,,Bread,2.50,';
    expect(parseListCsv(csv)).toStrictEqual([item('Milk', 2, 'each', 'cold, please'), item('Bread')]);
  });

  it('works with only some of the columns', () => {
    expect(parseListCsv('item\nMilk\nEggs')).toStrictEqual([item('Milk'), item('Eggs')]);
    expect(parseListCsv('qty,name\n3,Milk')).toStrictEqual([item('Milk', 3)]);
  });

  it('uses the left-most column when a field appears twice', () => {
    expect(parseListCsv('name,product,qty\nMilk,Dairy milk,2')).toStrictEqual([item('Milk', 2)]);
  });

  it('uses the first unknown column as the name when the header has no name column', () => {
    expect(parseListCsv('Description,Qty\nMilk,2')).toStrictEqual([item('Milk', 2)]);
  });

  it('returns [] for a header without rows', () => {
    expect(parseListCsv('name,quantity,unit,note\n')).toEqual([]);
  });
});

describe('parseListCsv: files without a header', () => {
  it('reads columns by position: name, quantity, unit, note', () => {
    expect(parseListCsv('Milk,2,l,semi-skimmed\nBananas,6\nBread')).toStrictEqual([
      item('Milk', 2, 'l', 'semi-skimmed'),
      item('Bananas', 6),
      item('Bread'),
    ]);
  });

  it('does not take the first data row for a header', () => {
    expect(parseListCsv('Milk,2\nEggs,12')).toHaveLength(2);
  });

  it('returns [] for empty input', () => {
    expect(parseListCsv('')).toEqual([]);
    expect(parseListCsv('\n\n')).toEqual([]);
    expect(parseListCsv(',,,\n,,')).toEqual([]);
    expect(parseListCsv(';;;\n;;')).toEqual([]);
    expect(parseListCsv('\t\t\n\t')).toEqual([]);
  });
});

describe('parseListCsv: separators', () => {
  it('reads semicolon-separated files, with decimal commas', () => {
    expect(parseListCsv('Product;Amount;Unit\nRice;1,5;kg\nFlour;500g;')).toStrictEqual([
      item('Rice', 1.5, 'kg'),
      item('Flour', 500, 'g'),
    ]);
  });

  it('detects semicolons from a headerless first line with a decimal comma', () => {
    // A plain ";" vs "," count ties here and would split "1,5" in two.
    expect(parseListCsv('Milk;1,5;l\nEggs;12')).toStrictEqual([item('Milk', 1.5, 'l'), item('Eggs', 12)]);
    expect(parseListCsv('Milk;1,5')).toStrictEqual([item('Milk', 1.5)]);
  });

  it('does not count decimal commas when detecting the separator', () => {
    // Excel only quotes fields that contain the separator, so a semicolon file leaves "Rice, basmati"
    // unquoted: one ";" against two ",", one of which is the decimal comma of 1,5.
    expect(parseListCsv('Rice, basmati;1,5\nEggs;12')).toStrictEqual([item('Rice, basmati', 1.5), item('Eggs', 12)]);
  });

  it('does not count commas inside quotes when detecting the separator', () => {
    expect(parseListCsv('"Bread, sliced, whole";2\nEggs;12')).toStrictEqual([item('Bread, sliced, whole', 2), item('Eggs', 12)]);
  });

  it('keeps commas as the separator when semicolons only appear in a value', () => {
    expect(parseListCsv('name,note\nMilk,cold; skimmed')).toStrictEqual([item('Milk', 1, 'each', 'cold; skimmed')]);
  });

  it('reads tab-separated rows copied from a spreadsheet', () => {
    expect(parseListCsv('Item\tQty\tUnit\nMilk\t2\tl\nRice\t1,5\tkg')).toStrictEqual([item('Milk', 2, 'l'), item('Rice', 1.5, 'kg')]);
  });

  it('detects the separator from the first line with content', () => {
    expect(parseListCsv('\n\nname;qty\nMilk;1,5')).toStrictEqual([item('Milk', 1.5)]);
    expect(parseListCsv('\r\n  \r\nMilk;2;l')).toStrictEqual([item('Milk', 2, 'l')]);
    expect(parseListCsv('\t\n  \nname;qty\nMilk;2')).toStrictEqual([item('Milk', 2)]); // a blank line of tabs is not a TSV
  });

  it('does not end the first line at a newline inside quotes', () => {
    expect(parseListCsv('"Bread,\nsliced";2\nEggs;12')).toStrictEqual([item('Bread, sliced', 2), item('Eggs', 12)]);
  });

  it("honours Excel's sep= line", () => {
    expect(parseListCsv('sep=;\nName;Qty\nMilk;2')).toStrictEqual([item('Milk', 2)]);
    expect(parseListCsv('\ufeffsep=,\r\nMilk,2\r\n')).toStrictEqual([item('Milk', 2)]);
  });
});

describe('parseListCsv: cells', () => {
  it('reads quoted fields with separators, escaped quotes and newlines', () => {
    const csv = 'name,quantity,unit,note\n"Cheese, cheddar",1,lb,"aged ""extra"" sharp"\n"Bread","1",,"line one\nline two"';
    expect(parseListCsv(csv)).toStrictEqual([
      item('Cheese, cheddar', 1, 'lb', 'aged "extra" sharp'),
      item('Bread', 1, 'each', 'line one line two'),
    ]);
  });

  it('collapses newlines and runs of spaces in a note to one space', () => {
    expect(parseListCsv('name,note\nMilk,"a\r\n\r\n  b\tc"')).toStrictEqual([item('Milk', 1, 'each', 'a b c')]);
  });

  it('tidies the name and omits a blank note', () => {
    expect(parseListCsv('name,note\n"  Greek \n yogurt ","   "')).toStrictEqual([item('Greek yogurt')]);
  });

  it('reads the unit from the quantity cell when the unit column is empty', () => {
    expect(parseListCsv('name,qty,unit\nChicken,2 lb,\nFlour,500g,\nMilk,1.5 Litres,')).toStrictEqual([
      item('Chicken', 2, 'lb'),
      item('Flour', 500, 'g'),
      item('Milk', 1.5, 'l'),
    ]);
    expect(parseListCsv('Chicken,2 lbs')).toStrictEqual([item('Chicken', 2, 'lb')]); // positional too
  });

  it('prefers the unit column over a unit in the quantity cell', () => {
    expect(parseListCsv('name,qty,unit\nMilk,2 lb,l')).toStrictEqual([item('Milk', 2, 'l')]);
  });

  it('turns unknown units into each', () => {
    expect(parseListCsv('name,qty,unit\nBread,1,loaf\nSugar,2 cups,\nRice,1,xyz')).toStrictEqual([
      item('Bread'),
      item('Sugar', 2),
      item('Rice'),
    ]);
  });

  it('normalises unit spellings', () => {
    expect(parseListCsv('name,qty,unit\nMilk,2,Litres\nChicken,1,LBS.')).toStrictEqual([item('Milk', 2, 'l'), item('Chicken', 1, 'lb')]);
  });

  it.each(['', 'abc', '0', '-1', '1/0', 'two'])('turns the invalid quantity %p into 1', (quantity) => {
    expect(parseListCsv(`name,qty\nMilk,${quantity}`)).toStrictEqual([item('Milk')]);
  });

  it('reads thousands separators in the quantity cell (decision D-15)', () => {
    expect(parseListCsv('name;qty\nFlour;1,500\nRice;1,5')).toStrictEqual([item('Flour', 1500), item('Rice', 1.5)]);
    expect(parseListCsv('name,qty\nFlour,"2,500 g"')).toStrictEqual([item('Flour', 2500, 'g')]);
  });

  it('accepts fractions and decimal commas in the quantity cell', () => {
    expect(parseListCsv('name;qty\nButter;1/2\nRice;1,5\nFlour;1 1/2')).toStrictEqual([
      item('Butter', 0.5),
      item('Rice', 1.5),
      item('Flour', 1.5),
    ]);
  });

  it('skips rows without a name and rows that are entirely empty', () => {
    expect(parseListCsv('name,qty\n,3\n  ,2\n,,\nMilk,1\n\n')).toStrictEqual([item('Milk')]);
  });

  it('handles rows shorter or longer than the header', () => {
    expect(parseListCsv('name,qty,unit,note\nMilk\nEggs,12,,,extra,cells')).toStrictEqual([item('Milk'), item('Eggs', 12)]);
  });

  it('finds the header after leading empty rows', () => {
    expect(parseListCsv(',,\nname,qty\nMilk,2')).toStrictEqual([item('Milk', 2)]);
    expect(parseListCsv('  ,  \nname,qty\nMilk,2')).toStrictEqual([item('Milk', 2)]);
  });

  it('reads a BOM, CRLF line endings and trailing blank lines', () => {
    expect(parseListCsv('\ufeffName,Qty\r\nMilk,2\r\n\r\n')).toStrictEqual([item('Milk', 2)]);
  });

  it('does not merge repeated rows', () => {
    expect(parseListCsv('Milk,1\nmilk,2')).toStrictEqual([item('Milk'), item('milk', 2)]);
  });

  it('keeps the name cell literally (no line parsing inside CSV cells)', () => {
    expect(parseListCsv('name,qty\n2 lbs chicken,1\n- eggs,3')).toStrictEqual([item('2 lbs chicken'), item('- eggs', 3)]);
  });
});
