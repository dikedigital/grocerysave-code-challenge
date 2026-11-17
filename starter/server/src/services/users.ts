/**
 * Accounts (TECH_SPEC 6.1, 6.3). Emails are stored trimmed and lower-cased (D-118), so an exact
 * `email = $1` on the normalised input is a case-insensitive match that uses the unique index.
 */
import type { User } from '../../../src/models';
import type { Queryable as Db } from '../db/pool';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

export function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

/** Trimmed and lower-cased: the form stored and compared. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Inserts the user; null when the email is taken (one statement, so two racing sign-ups cannot both win). */
export async function createUser(db: Db, input: { email: string; passwordHash: string; displayName: string }): Promise<User | null> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, display_name`,
    [input.email, input.passwordHash, input.displayName],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findUserById(db: Db, id: string): Promise<User | null> {
  const { rows } = await db.query<UserRow>('SELECT id, email, display_name FROM users WHERE id = $1', [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** The user and their password hash, for login; `email` must already be normalised. */
export async function findCredentials(db: Db, email: string): Promise<{ user: User; passwordHash: string } | null> {
  const { rows } = await db.query<UserRow & { password_hash: string }>(
    'SELECT id, email, display_name, password_hash FROM users WHERE email = $1',
    [email],
  );
  return rows[0] ? { user: toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
}
