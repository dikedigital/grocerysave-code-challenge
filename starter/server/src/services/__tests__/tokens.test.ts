import jwt from 'jsonwebtoken';
import { TOKEN_TTL_SECONDS, signToken, verifyToken } from '../tokens';

const SECRET = 'unit-test-secret';
const USER = '3f0c6a9e-2b1d-4c8e-9a7f-1e2d3c4b5a69';
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

describe('signToken (D-122)', () => {
  it('HS256, subject = user id, valid 7 days, nothing else in the payload', () => {
    const token = signToken(USER, SECRET);
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded.payload === 'string') throw new Error('not a JWT');
    expect(decoded.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(Object.keys(decoded.payload).sort()).toEqual(['exp', 'iat', 'sub']);
    expect(decoded.payload.sub).toBe(USER);
    expect(TOKEN_TTL_SECONDS).toBe(604800);
    expect(decoded.payload.exp! - decoded.payload.iat!).toBe(604800);
    expect(Math.abs(decoded.payload.iat! - now())).toBeLessThanOrEqual(2);
  });
});

describe('verifyToken', () => {
  it('accepts its own tokens', () => {
    expect(verifyToken(signToken(USER, SECRET), SECRET)).toEqual({ ok: true, userId: USER });
  });

  it('is valid until 7 days have passed, then expired', () => {
    const realNow = Date.now();
    const issuedAt = (msAgo: number) => {
      const spy = jest.spyOn(Date, 'now').mockReturnValue(realNow - msAgo);
      try {
        return signToken(USER, SECRET);
      } finally {
        spy.mockRestore();
      }
    };
    expect(verifyToken(issuedAt(7 * 86400e3 - 60e3), SECRET)).toEqual({ ok: true, userId: USER });
    expect(verifyToken(issuedAt(7 * 86400e3 + 1e3), SECRET)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it.each([
    ['another secret', () => signToken(USER, 'other-secret')],
    ['alg none', () => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: USER, exp: now() + 60 })}.`],
    ['HS512 with the right secret', () => jwt.sign({}, SECRET, { algorithm: 'HS512', subject: USER, expiresIn: 60 })],
    ['no expiry', () => jwt.sign({ sub: USER }, SECRET, { algorithm: 'HS256' })],
    ['no subject', () => jwt.sign({}, SECRET, { algorithm: 'HS256', expiresIn: 60 })],
    ['a subject that is not a uuid', () => jwt.sign({}, SECRET, { algorithm: 'HS256', expiresIn: 60, subject: "1' OR '1'='1" })],
    ['a payload that is a string', () => jwt.sign('just text', SECRET, { algorithm: 'HS256' })],
    ['a not-yet-valid token', () => jwt.sign({}, SECRET, { algorithm: 'HS256', expiresIn: 600, notBefore: 300, subject: USER })],
    ['a tampered payload', () => {
      const [header, , signature] = signToken(USER, SECRET).split('.');
      return `${header}.${b64({ sub: '00000000-0000-4000-8000-000000000000', iat: now(), exp: now() + 60 })}.${signature}`;
    }],
    ['garbage', () => 'garbage'],
    ['three empty parts', () => '..'],
    ['empty', () => ''],
  ])('refuses %s as invalid', (_label, make) => {
    expect(verifyToken(make(), SECRET)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('an expired token is reported as expired', () => {
    expect(verifyToken(jwt.sign({ sub: USER, exp: now() - 1 }, SECRET, { algorithm: 'HS256' }), SECRET)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('an upper-case uuid subject is lower-cased', () => {
    expect(verifyToken(signToken(USER.toUpperCase(), SECRET), SECRET)).toEqual({ ok: true, userId: USER });
  });
});
