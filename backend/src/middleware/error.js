/**
 * Central error handler — maps AppError, Zod and Prisma errors to safe JSON
 * responses. Internal details are logged, never sent to the client.
 */
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';

export function notFoundApi(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with this value already exists', details: err.meta?.target } });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
    }
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error('[database unavailable]', err.message);
    return res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'The database is unavailable. Please try again shortly or contact your administrator.' } });
  }

  // database integrity backstops (CHECK constraints, append-only triggers) — should never fire; log loudly
  if (/violates check constraint|append-only and cannot be modified/.test(err?.message ?? '')) {
    console.error(`[integrity] ${req.method} ${req.path} request ${req.id ?? '-'}:`, err.message.split('\n').find((l) => /constraint|append-only/.test(l)));
    return res.status(409).json({ error: { code: 'INTEGRITY', message: 'This change would break a data integrity rule and was blocked.', requestId: req.id } });
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request is too large' } });
  }

  console.error(`[${req.method} ${req.path}] request ${req.id ?? '-'}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId: req.id } });
}
