/**
 * Looks inside login tokens and makes bad ones, for trying the auth rules by hand with curl.
 * Uses JWT_SECRET (config.jwtSecret), like the server started from the same shell.
 *
 *   npx tsx tests/manual/auth-token.ts decode <token>
 *       header, payload, issue and expiry times, lifetime, and what the server's check says
 *   npx tsx tests/manual/auth-token.ts make <kind> <userId>
 *       prints one token; kinds: valid, expired, other-secret, alg-none, hs512, no-exp, bad-sub, tampered
 */
import jwt from 'jsonwebtoken';
import { config } from '../../server/src/config';
import { signToken, verifyToken } from '../../server/src/services/tokens';

const [command, arg, userId] = process.argv.slice(2);
const usage = () => {
  console.error('usage: npx tsx tests/manual/auth-token.ts decode <token>\n       npx tsx tests/manual/auth-token.ts make <valid|expired|other-secret|alg-none|hs512|no-exp|bad-sub|tampered> <userId>');
  process.exit(2);
};
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const iso = (seconds: unknown) => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : '(none)');

if (command === 'decode' && arg) {
  const decoded = jwt.decode(arg, { complete: true });
  if (!decoded) {
    console.log('not a JWT (three base64url parts)');
  } else {
    console.log('header :', JSON.stringify(decoded.header));
    console.log('payload:', JSON.stringify(decoded.payload));
    if (typeof decoded.payload === 'object') {
      const { iat, exp } = decoded.payload;
      console.log('issued :', iso(iat));
      console.log('expires:', iso(exp));
      if (typeof iat === 'number' && typeof exp === 'number') console.log('valid for:', `${(exp - iat) / 86400} days (${exp - iat} s)`);
    }
  }
  console.log('server check with JWT_SECRET:', JSON.stringify(verifyToken(arg, config.jwtSecret)));
} else if (command === 'make' && arg && userId) {
  const secret = config.jwtSecret;
  const tokens: Record<string, () => string> = {
    valid: () => signToken(userId, secret),
    expired: () => jwt.sign({ sub: userId, iat: now() - 8 * 86400, exp: now() - 86400 }, secret, { algorithm: 'HS256' }),
    'other-secret': () => signToken(userId, `${secret}-but-not-quite`),
    'alg-none': () => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: userId, iat: now(), exp: now() + 3600 })}.`,
    hs512: () => jwt.sign({}, secret, { algorithm: 'HS512', subject: userId, expiresIn: 3600 }),
    'no-exp': () => jwt.sign({ sub: userId }, secret, { algorithm: 'HS256' }),
    'bad-sub': () => jwt.sign({}, secret, { algorithm: 'HS256', subject: 'not-a-uuid', expiresIn: 3600 }),
    tampered: () => {
      const [header, , signature] = signToken(userId, secret).split('.');
      return `${header}.${b64({ sub: '00000000-0000-4000-8000-000000000000', iat: now(), exp: now() + 3600 })}.${signature}`;
    },
  };
  const make = Object.prototype.hasOwnProperty.call(tokens, arg) ? tokens[arg] : undefined;
  if (!make) usage();
  else console.log(make());
} else {
  usage();
}
