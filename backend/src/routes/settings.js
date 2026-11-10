/**
 * /api/settings — company branding, currency, invoice and alert settings.
 *
 * GET is available to every signed-in user (the UI needs the currency and
 * branding for receipts). PUT requires settings.manage and only accepts the
 * known keys below, each with its own validation.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const router = express.Router();

const text = (max) => z.string().trim().max(max);
// SECTION: editable settings and their validators; add new keys here (and a default in prisma/seed.js)
export const SETTING_SCHEMAS = {
  'company.name': text(120).min(1),
  'company.address': text(250),
  'company.phone': text(40),
  'company.email': z.union([z.literal(''), z.string().trim().email()]),
  'company.taxId': text(60),
  'company.logoUrl': z.union([
    z.literal(''),
    z.string().regex(/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/, 'Logo must be an uploaded image').max(400_000, 'Logo must be under ~300KB'),
    z.string().url().startsWith('https://', 'Logo URL must use https'),
  ]),
  'currency.code': z.string().trim().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
  'currency.symbol': text(5).min(1),
  'invoice.taxRate': z.coerce.number().min(0).max(100),
  'invoice.taxLabel': text(20),
  'invoice.creditTermsDays': z.coerce.number().int().min(0).max(365),
  'invoice.footer': text(300),
  'inventory.lowStockAlerts': z.boolean(),
  'sales.maxDiscountPercentWithoutApproval': z.coerce.number().min(0).max(100),
  'dashboard.targetRevenue': z.coerce.number().min(0),
};

// SECTION: typed read with defaults — used by billing so a missing row never breaks a sale
const DEFAULTS = {
  'company.name': 'Fuel Station', 'currency.code': 'USD', 'currency.symbol': '$',
  'invoice.taxRate': 0, 'invoice.taxLabel': 'VAT', 'invoice.creditTermsDays': 30, 'invoice.footer': '',
  'sales.maxDiscountPercentWithoutApproval': 0,
};

export async function getSettings(db = prisma) {
  const rows = await db.setting.findMany({ where: { key: { in: Object.keys(SETTING_SCHEMAS) } } });
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

router.get('/settings', requireAuth, async (req, res) => {
  res.json({ settings: await getSettings() });
});

router.put('/settings', requirePermission('settings.manage'), async (req, res) => {
  const shape = Object.fromEntries(Object.entries(SETTING_SCHEMAS).map(([k, v]) => [k, v.optional()]));
  const body = z.object(shape).strict().parse(req.body);
  const before = await getSettings();

  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      await tx.setting.upsert({ where: { key }, update: { value, updatedById: req.user.id }, create: { key, value, updatedById: req.user.id } });
    }
    const changed = Object.keys(body).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(body[k]));
    if (changed.length) {
      const strip = (o) => Object.fromEntries(changed.map((k) => [k, k === 'company.logoUrl' ? (o[k] ? '[image]' : '') : o[k]]));
      await audit(tx, req, { action: 'settings.update', entityType: 'Setting', details: `Changed ${changed.join(', ')}`, before: strip(before), after: strip(body) });
    }
  });
  res.json({ settings: await getSettings() });
});

export default router;
