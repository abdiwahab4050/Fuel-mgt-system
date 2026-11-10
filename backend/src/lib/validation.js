/**
 * Shared Zod helpers. Quantities and money are parsed straight into
 * Prisma.Decimal so arithmetic never goes through floating point.
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const NUMERIC = /^-?\d+(\.\d+)?$/;

// SECTION: decimal(dp, opts) — accepts number or numeric string, max `dp` decimal places
export function decimal(dp, { min, max, positive = false, allowNegative = false } = {}) {
  return z
    .union([z.number(), z.string().trim()])
    .transform((v, ctx) => {
      const s = typeof v === 'number' ? String(v) : v;
      if (!NUMERIC.test(s)) {
        ctx.addIssue({ code: 'custom', message: 'Must be a number' });
        return z.NEVER;
      }
      const d = new Prisma.Decimal(s);
      if (d.decimalPlaces() > dp) {
        ctx.addIssue({ code: 'custom', message: `At most ${dp} decimal places` });
        return z.NEVER;
      }
      if (!allowNegative && d.isNegative()) {
        ctx.addIssue({ code: 'custom', message: 'Cannot be negative' });
        return z.NEVER;
      }
      if (positive && d.lte(0)) {
        ctx.addIssue({ code: 'custom', message: 'Must be greater than zero' });
        return z.NEVER;
      }
      if (min !== undefined && d.lt(min)) {
        ctx.addIssue({ code: 'custom', message: `Must be at least ${min}` });
        return z.NEVER;
      }
      if (max !== undefined && d.gt(max)) {
        ctx.addIssue({ code: 'custom', message: `Must be at most ${max}` });
        return z.NEVER;
      }
      return d;
    });
}

export const liters = (opts) => decimal(3, opts);
export const money = (opts) => decimal(2, opts);
export const unitPrice = (opts) => decimal(4, opts);

export const id = z.string().trim().min(1).max(40);
export const code = z.string().trim().min(1).max(20).transform((v) => v.toUpperCase());
export const optionalText = (max = 255) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
export const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// SECTION: pagination from query (?page&pageSize), capped
export function paging(query, { max = 100, def = 25 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(max, Math.max(1, parseInt(query.pageSize, 10) || def));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
