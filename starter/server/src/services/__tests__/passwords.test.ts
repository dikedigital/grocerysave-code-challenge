import bcrypt from 'bcryptjs';
import {
  BCRYPT_COST,
  MAX_PASSWORD_BYTES,
  hashPassword,
  passwordBytes,
  passwordLength,
  passwordProblem,
  verifyPassword,
} from '../passwords';

jest.setTimeout(30000);

const NFD = 'cafe\u0301-cre\u0300me'; // "café-crème" with combining accents
const NFC = NFD.normalize('NFC');

describe('password rules (D-120)', () => {
  it('counts characters as code points of the NFC form', () => {
    expect(passwordLength('12345678')).toBe(8);
    expect(passwordLength('🙂'.repeat(4))).toBe(4); // 8 UTF-16 units
    expect(passwordLength(NFD)).toBe(10); // combining accents merge
    expect(passwordBytes('é')).toBe(2);
    expect(passwordBytes('🙂')).toBe(4);
  });

  it.each([
    ['', 'must be at least 8 characters'],
    ['1234567', 'must be at least 8 characters'],
    ['🙂'.repeat(7), 'must be at least 8 characters'],
    ['12345678', null],
    ['        ', null], // spaces are characters; no strength rules beyond the spec
    ['🙂'.repeat(8), null],
    ['a'.repeat(72), null],
    ['a'.repeat(73), expect.stringMatching(/^must be at most 72 bytes/)],
    ['é'.repeat(36), null], // 72 bytes
    ['é'.repeat(37), expect.stringMatching(/^must be at most 72 bytes/)], // 37 characters, 74 bytes
  ])('%j: %p', (password, problem) => {
    expect(passwordProblem(password)).toEqual(problem);
  });
});

describe('hashPassword / verifyPassword', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await hashPassword('correct horse');
  });

  it('hashes with bcrypt at cost 10, never storing the password', () => {
    expect(BCRYPT_COST).toBe(10);
    expect(hash).toMatch(/^\$2[aby]\$10\$.{53}$/);
    expect(hash).not.toContain('correct horse');
  });

  it('verifies the right password only (case and spaces matter)', async () => {
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('Correct horse', hash)).toBe(false);
    expect(await verifyPassword(' correct horse', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('NFC and NFD spellings of the same password match each other', async () => {
    const fromNfd = await hashPassword(NFD);
    expect(await verifyPassword(NFC, fromNfd)).toBe(true);
    expect(await verifyPassword(NFD, await hashPassword(NFC))).toBe(true);
  });

  it('a login attempt over 72 bytes fails even when its first 72 bytes are the password (bcrypt truncation)', async () => {
    const exactly72 = 'p'.repeat(MAX_PASSWORD_BYTES);
    const stored = await hashPassword(exactly72);
    expect(await verifyPassword(exactly72, stored)).toBe(true);
    expect(bcrypt.compareSync(`${exactly72}anything`, stored)).toBe(true); // what plain bcrypt would accept
    expect(await verifyPassword(`${exactly72}anything`, stored)).toBe(false);
  });

  it('no user (hash null): false, after a real bcrypt comparison against a dummy hash', async () => {
    const compare = jest.spyOn(bcrypt, 'compare');
    try {
      expect(await verifyPassword('whatever1', null)).toBe(false);
      expect(compare).toHaveBeenCalledTimes(1);
      expect(String(compare.mock.calls[0][1])).toMatch(/^\$2[aby]\$10\$/);
    } finally {
      compare.mockRestore();
    }
  });

  it('a stored value that is not a bcrypt hash never matches', async () => {
    expect(await verifyPassword('whatever1', 'not-a-hash')).toBe(false);
  });
});
