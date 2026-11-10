/**
 * Minimal, dependency-free XLSX writer (Office Open XML spreadsheet).
 *
 * One worksheet, bold header row, frozen header, typed cells:
 *   text    → inline string
 *   number  → number, 0.### format
 *   money   → number, #,##0.00 format
 *   liters  → number, #,##0.000 format
 *   percent → number shown with a % suffix (value is already a percentage)
 *   date    → text YYYY-MM-DD (unambiguous in every locale)
 *
 * The workbook is packaged as a ZIP with STORED (uncompressed) entries, which
 * every spreadsheet application accepts and which needs only a CRC-32.
 */

// SECTION: CRC-32 (IEEE 802.3) for ZIP entries
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// SECTION: ZIP container with stored entries
export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// SECTION: XML helpers
const esc = (s) => String(s)
  // characters XML 1.0 forbids would corrupt the file
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// style ids in styles.xml below
const STYLE = { header: 1, number: 2, money: 3, liters: 4, percent: 5, bold: 6, boldMoney: 7 };

function cell(ref, value, type, bold) {
  if (value === null || value === undefined || value === '') return '';
  const numeric = ['number', 'money', 'liters', 'percent'].includes(type);
  if (numeric && Number.isFinite(Number(value))) {
    const s = bold ? STYLE.boldMoney : STYLE[type];
    return `<c r="${ref}" s="${s}"><v>${Number(value)}</v></c>`;
  }
  const text = type === 'date' && value instanceof Date ? value.toISOString().slice(0, 10) : value;
  return `<c r="${ref}" t="inlineStr"${bold ? ` s="${STYLE.bold}"` : ''}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

/**
 * buildXlsx({ sheetName, title, subtitle, columns:[{key,label,type,width}], rows:[{...}], totals:{...} })
 * → Buffer
 */
export function buildXlsx({ sheetName = 'Report', title, subtitle, columns, rows, totals }) {
  const out = [];
  let r = 1;
  if (title) out.push(`<row r="${r}">${cell(`A${r++}`, title, 'text', true)}</row>`);
  if (subtitle) out.push(`<row r="${r}">${cell(`A${r++}`, subtitle, 'text', false)}</row>`);
  if (title || subtitle) r++; // blank spacer row
  const headerRow = r;
  out.push(`<row r="${r}">${columns.map((c, i) => `<c r="${colName(i)}${r}" t="inlineStr" s="${STYLE.header}"><is><t>${esc(c.label)}</t></is></c>`).join('')}</row>`);
  r++;
  for (const row of rows) {
    out.push(`<row r="${r}">${columns.map((c, i) => cell(`${colName(i)}${r}`, row[c.key], c.type)).join('')}</row>`);
    r++;
  }
  if (totals) {
    out.push(`<row r="${r}">${columns.map((c, i) => cell(`${colName(i)}${r}`, i === 0 && totals[c.key] === undefined ? 'Total' : totals[c.key], c.type, true)).join('')}</row>`);
  }
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? Math.min(48, Math.max(10, c.label.length + 4))}" customWidth="1"/>`).join('');
  const freeze = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<cols>${cols}</cols><sheetData>${out.join('')}</sheetData></worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.000"/><numFmt numFmtId="166" formatCode="0.00&quot;%&quot;"/><numFmt numFmtId="167" formatCode="#,##0.###"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE9FF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const safeSheet = esc(String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

// SECTION: CSV with a UTF-8 BOM so Excel shows non-ASCII names correctly; formula-looking cells are neutralised
export function buildCsv({ columns, rows, totals }) {
  const q = (v) => {
    let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`; // CSV/formula injection guard
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [columns.map((c) => q(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => q(r[c.key])).join(','));
  if (totals) lines.push(columns.map((c, i) => q(i === 0 && totals[c.key] === undefined ? 'Total' : totals[c.key])).join(','));
  return '﻿' + lines.join('\r\n');
}
