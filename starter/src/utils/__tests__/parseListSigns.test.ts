import { parseListLine, parseListText } from '../parseList';

/** D-156: "-" or "+" directly before a number is a sign, not a bullet. */
describe('a sign before a number is not a bullet', () => {
  it.each([
    ['-2 milk', { name: '-2 milk', quantity: 1, unit: 'each' }],
    ['+2 milk', { name: '+2 milk', quantity: 1, unit: 'each' }],
    ['-2 kg rice', { name: '-2 kg rice', quantity: 1, unit: 'each' }],
    ['-.5 milk', { name: '-.5 milk', quantity: 1, unit: 'each' }],
    ['--2 milk', { name: '-2 milk', quantity: 1, unit: 'each' }], // the first "-" is a bullet
  ])('%p is %j (like "0 milk": not a positive quantity, so part of the name)', (line, item) => {
    expect(parseListLine(line)).toEqual(item);
  });

  it.each([
    ['- 2 milk', { name: 'milk', quantity: 2, unit: 'each' }],
    ['-eggs', { name: 'eggs', quantity: 1, unit: 'each' }],
    ['+ eggs', { name: 'eggs', quantity: 1, unit: 'each' }],
    ['– 2 lbs chicken', { name: 'chicken', quantity: 2, unit: 'lb' }],
    ['–2 milk', { name: 'milk', quantity: 2, unit: 'each' }], // en dash: still a bullet (not a minus sign)
  ])('%p is still a bullet: %j', (line, item) => {
    expect(parseListLine(line)).toEqual(item);
  });

  it('a bare "-" or "+" is an empty bullet (no item)', () => {
    expect(parseListText('-\n+\n- ')).toEqual([]);
  });
});
