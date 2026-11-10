/**
 * Atomic document numbering: SAL-2026-000001, INV-2026-000001, PAY-2026-000001 ...
 * Uses a single INSERT ... ON CONFLICT ... RETURNING so two concurrent requests
 * can never receive the same number. Pass the transaction client (tx) when the
 * number is used inside a larger transaction so it rolls back with it.
 */
export const DOC_PREFIXES = {
  sale: 'SAL',
  invoice: 'INV',
  payment: 'PAY',
  refund: 'REF',
  purchaseOrder: 'PO',
  delivery: 'DEL',
  supplierPayment: 'SPY',
  expense: 'EXP',
  customer: 'CUS',
  supplier: 'SUP',
  employee: 'EMP',
};

export function formatDocNumber(prefix, year, value) {
  return `${prefix}-${year}-${String(value).padStart(6, '0')}`;
}

export async function nextDocNumber(db, type, date = new Date()) {
  const prefix = DOC_PREFIXES[type];
  if (!prefix) throw new Error(`Unknown document type "${type}"`);
  const year = date.getUTCFullYear();
  const key = `${prefix}:${year}`;

  const rows = await db.$queryRaw`
    INSERT INTO "DocumentCounter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
    RETURNING "value"`;
  return formatDocNumber(prefix, year, rows[0].value);
}
