/**
 * Integration tests against the configured DATABASE_URL (migrated + seeded).
 */
import { needsDb, prisma } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { nextDocNumber, formatDocNumber } from '../src/lib/numbering.js';
import { ROLES } from '../src/auth/permissions.js';

after(() => prisma.$disconnect());

test('GET /api/health reports database up', needsDb, async () => {
  const res = await request(createApp()).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.database, 'up');
});

test('unknown API routes return JSON 404', needsDb, async () => {
  const res = await request(createApp()).get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('frontend login page is served from /', needsDb, async () => {
  const res = await request(createApp()).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /<html/i);
  assert.ok(res.headers['content-security-policy']);
});

test('document numbers are unique under concurrency', needsDb, async () => {
  const year = new Date().getUTCFullYear();
  await prisma.documentCounter.deleteMany({ where: { key: `EXP:${year}` } });
  const numbers = await Promise.all(Array.from({ length: 25 }, () => nextDocNumber(prisma, 'expense')));
  assert.equal(new Set(numbers).size, 25);
  assert.ok(numbers.includes(formatDocNumber('EXP', year, 1)));
  assert.ok(numbers.includes(formatDocNumber('EXP', year, 25)));
  await prisma.documentCounter.deleteMany({ where: { key: `EXP:${year}` } });
});

test('a number taken inside a rolled-back transaction is released', needsDb, async () => {
  const year = new Date().getUTCFullYear();
  await prisma.documentCounter.deleteMany({ where: { key: `REF:${year}` } });
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await nextDocNumber(tx, 'refund');
      throw new Error('boom');
    })
  );
  assert.equal(await nextDocNumber(prisma, 'refund'), formatDocNumber('REF', year, 1));
  await prisma.documentCounter.deleteMany({ where: { key: `REF:${year}` } });
});

test('seed stored every role with its exact permission set', needsDb, async () => {
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } } } });
  for (const [key, def] of Object.entries(ROLES)) {
    const role = roles.find((r) => r.key === key);
    assert.ok(role, `role ${key} missing`);
    assert.deepEqual(role.permissions.map((rp) => rp.permission.key).sort(), [...def.permissions].sort(), key);
  }
});

test('seeded passwords are hashed, never plain text', needsDb, async () => {
  const users = await prisma.user.findMany({ select: { email: true, passwordHash: true } });
  assert.ok(users.length > 0);
  for (const u of users) assert.match(u.passwordHash, /^\$2[aby]\$12\$/, u.email);
});

test('seeded tank levels equal the sum of their stock ledger', needsDb, async () => {
  const tanks = await prisma.tank.findMany({ include: { movements: true } });
  for (const t of tanks) {
    const ledger = t.movements.reduce((sum, m) => sum.plus(m.quantity), new (t.currentLiters.constructor)(0));
    assert.equal(ledger.toString(), t.currentLiters.toString(), t.code);
  }
});

test('database rejects duplicate business keys', needsDb, async () => {
  const station = await prisma.station.findFirstOrThrow();
  const tank = await prisma.tank.findFirstOrThrow({ where: { stationId: station.id } });
  await assert.rejects(
    prisma.tank.create({ data: { code: tank.code, stationId: station.id, productId: tank.productId, capacityLiters: 1 } }),
    (e) => e.code === 'P2002'
  );
});
