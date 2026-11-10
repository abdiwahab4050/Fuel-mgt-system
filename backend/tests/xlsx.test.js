/**
 * XLSX/CSV writer — no database required.
 */
import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildCsv, buildXlsx, crc32, zip } from '../src/lib/xlsx.js';
import { createApp } from '../src/app.js';

// Minimal ZIP reader: walks the central directory and returns { name: Buffer }
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end of central directory present');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central header signature');
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    assert.equal(buf.readUInt32LE(local), 0x04034b50, 'local header signature');
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const data = buf.slice(start, start + size);
    assert.equal(crc32(data), crc, `CRC matches for ${name}`);
    files[name] = data;
    p += 46 + nameLen;
  }
  return files;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zip round-trips files with correct CRCs', () => {
  const files = unzip(zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.xml', data: '<x>é</x>' }]));
  assert.equal(files['a.txt'].toString(), 'hello');
  assert.equal(files['dir/b.xml'].toString(), '<x>é</x>');
});

test('xlsx contains the required parts, typed numbers and escaped text', () => {
  const buf = buildXlsx({
    sheetName: 'Sales: 2026/11', title: 'Report & <Co>', columns: [
      { key: 'name', label: 'Name', type: 'text' }, { key: 'amt', label: 'Amount', type: 'money' }, { key: 'l', label: 'Liters', type: 'liters' },
    ],
    rows: [{ name: 'A "quoted" & <tag>', amt: 1234.5, l: 10.125 }, { name: '=SUM(A1)', amt: null, l: 0 }],
    totals: { amt: 1234.5, l: 10.125 },
  });
  const files = unzip(buf);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
    assert.ok(files[part], `${part} present`);
  }
  const sheet = files['xl/worksheets/sheet1.xml'].toString();
  assert.match(sheet, /<v>1234.5<\/v>/, 'money stored as a number');
  assert.match(sheet, /A &quot;quoted&quot; &amp; &lt;tag&gt;/);
  assert.match(sheet, /t="inlineStr"[^>]*><is><t xml:space="preserve">=SUM\(A1\)<\/t>/, 'formula-like text stays text');
  assert.ok(!/<f>/.test(sheet), 'no formulas are written');
  assert.match(files['xl/workbook.xml'].toString(), /name="Sales  2026 11"/, 'sheet name sanitized');
  assert.match(sheet, /state="frozen"/, 'header row frozen');
});

test('csv: BOM, quoting, totals row, formula injection neutralised', () => {
  const csv = buildCsv({
    columns: [{ key: 'a', label: 'Name' }, { key: 'b', label: 'Amount' }],
    rows: [{ a: 'Ali, "Jr"', b: 5 }, { a: '=HYPERLINK("x")', b: -3 }, { a: '@cmd', b: null }],
    totals: { b: 2 },
  });
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[1], '"Ali, ""Jr""","5"');
  assert.equal(lines[2], '"\'=HYPERLINK(""x"")","-3"', 'formula prefixed with a quote; negative numbers untouched');
  assert.equal(lines[3], '"\'@cmd",""');
  assert.equal(lines[4], '"Total","2"');
});

test('report endpoints require sign-in', async () => {
  const app = createApp();
  assert.equal((await request(app).get('/api/reports')).status, 401);
  assert.equal((await request(app).get('/api/reports/sales?format=xlsx')).status, 401);
});
