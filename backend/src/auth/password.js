/**
 * Password hashing (bcrypt, cost 12) and policy.
 */
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const ROUNDS = 12;

// Used when the email is unknown so failed logins take the same time either way
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', ROUNDS);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers');

export function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash ?? DUMMY_HASH);
}
