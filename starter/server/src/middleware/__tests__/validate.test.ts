import { isBlank, trimmedName } from '../validate';

describe('isBlank (D-155)', () => {
  it.each(['', ' ', '\t\n', '\u00a0', '\u3000', '\u2003', '\ufeff', '\u200b', '\u200c', '\u200d', '\u2060', '\u00ad', ' \u200b\u200d '])('%j shows nothing', (value) => {
    expect(isBlank(value)).toBe(true);
  });
  it.each(['a', '.', '0', '👨‍👩‍👧', '\u200ba', 'ä', '中'])('%j shows something', (value) => {
    expect(isBlank(value)).toBe(false);
  });
  it('trimmedName refuses an invisible name and keeps invisible characters inside a real one', () => {
    expect(trimmedName(10).safeParse('\u200b\u200b').error?.issues[0].message).toBe('is required');
    expect(trimmedName(10).parse(' a\u200db ')).toBe('a\u200db');
  });
});
