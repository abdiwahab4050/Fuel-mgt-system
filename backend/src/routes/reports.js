/**
 * /api/reports — list available reports and run one as JSON, Excel (.xlsx) or CSV.
 *
 *   GET /api/reports                       reports this user may run
 *   GET /api/reports/:key?from&to&groupBy&search&stationId&format=json|xlsx|csv
 *
 * Exports (xlsx/csv) need reports.export and are written to the audit log.
 * PDF output is the browser's print → "Save as PDF" of the on-screen report.
 */
import express from 'express';
import { prisma } from '../db.js';
import { can, requireAuth, stationScope } from '../middleware/auth.js';
import { REPORTS } from '../services/reports.js';
import { resolveRange } from '../lib/dates.js';
import { buildCsv, buildXlsx } from '../lib/xlsx.js';
import { audit } from '../lib/audit.js';
import { forbidden, notFound } from '../lib/errors.js';
import { getSettings } from './settings.js';

const router = express.Router();

router.get('/reports', requireAuth, (req, res) => {
  const reports = Object.entries(REPORTS)
    .filter(([, r]) => can(req.user, ...r.permissions))
    .map(([key, r]) => ({ key, title: r.title, category: r.category, params: r.params }));
  res.json({ reports, canExport: can(req.user, 'reports.export') });
});

router.get('/reports/:key', requireAuth, async (req, res) => {
  const def = REPORTS[req.params.key];
  if (!def) throw notFound('Unknown report');
  if (!can(req.user, ...def.permissions)) throw forbidden();
  const format = String(req.query.format || 'json');
  if (!['json', 'xlsx', 'csv'].includes(format)) throw notFound('Unknown format (use json, xlsx or csv; PDF is printed from the screen)');
  if (format !== 'json' && !can(req.user, 'reports.export')) throw forbidden('You are not allowed to export reports');

  const range = resolveRange(req.query, { maxDays: 1100 });
  const stationId = stationScope(req);
  const result = await def.run({
    start: range.start, end: range.end, stationId,
    groupBy: req.query.groupBy ? String(req.query.groupBy) : undefined,
    search: req.query.search ? String(req.query.search).slice(0, 100) : undefined,
  });
  const station = stationId ? await prisma.station.findUnique({ where: { id: stationId }, select: { name: true } }) : null;
  const meta = {
    key: req.params.key,
    from: def.params.includes('range') ? range.from : null,
    to: def.params.includes('range') ? range.to : null,
    station: station?.name ?? 'All stations',
    generatedAt: new Date().toISOString(),
    generatedBy: req.user.name,
  };

  if (format === 'json') return res.json({ ...result, meta });

  const settings = await getSettings();
  const period = meta.from ? `${meta.from} to ${meta.to}` : `as of ${meta.generatedAt.slice(0, 10)}`;
  const filename = `${req.params.key}-${meta.from ?? meta.generatedAt.slice(0, 10)}${meta.to && meta.to !== meta.from ? `-to-${meta.to}` : ''}`;
  await audit(prisma, req, { action: 'report.export', entityType: 'Report', entityId: req.params.key, details: `Exported ${result.title} (${period}, ${meta.station}) as ${format.toUpperCase()}` });

  if (format === 'xlsx') {
    const buf = buildXlsx({
      sheetName: result.title, title: `${settings['company.name']} — ${result.title}`,
      subtitle: `${period} · ${meta.station} · generated ${meta.generatedAt.slice(0, 16).replace('T', ' ')} by ${meta.generatedBy}`,
      columns: result.columns, rows: result.rows, totals: result.totals,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return res.send(buf);
  }
  // csv
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  return res.send(buildCsv(result));
});

export default router;
