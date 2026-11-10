/**
 * Shared Prisma client (one connection pool per process).
 */
import { PrismaClient, Prisma } from '@prisma/client';

// API responses carry Decimal columns (liters, money) as JSON numbers; server-side math stays in Decimal
Prisma.Decimal.prototype.toJSON = function toJSON() {
  return this.toNumber();
};

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
