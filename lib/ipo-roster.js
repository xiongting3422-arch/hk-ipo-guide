/**
 * 与网页 ipo-google-sheet.js · buildIpoTopSixStocks 一致的 Node 侧名册逻辑
 */
'use strict';

const SUB_END_ALIASES = ['招股结束', '招股截止', '认购截止', '截止申购'];
const IPO_SHEET_TOP_N = 6;

function normH(h) {
  return String(h || '')
    .replace(/^\uFEFF/, '')
    .replace(/\t/g, '')
    .trim();
}

function getCellByAliases(row, aliases) {
  if (!row) return '';
  const keys = Object.keys(row);
  for (const a of aliases) {
    const an = normH(a);
    const hit = keys.find(k => normH(k) === an);
    if (hit != null && row[hit] != null) {
      const t = String(row[hit]).trim();
      if (t) return t;
    }
  }
  for (const a of aliases) {
    const hit2 = keys.find(k => normH(k).includes(a));
    if (hit2 && row[hit2] != null) {
      const t = String(row[hit2]).trim();
      if (t) return t;
    }
  }
  return '';
}

function parseDateFlexible(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '—' || s === '-') return null;
  const m = s.match(/(\d{4})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const m2 = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m2) return new Date(+m2[3], +m2[1] - 1, +m2[2]);
  const m3 = s.match(/(\d{1,2})月(\d{1,2})日/);
  if (m3) return new Date(new Date().getFullYear(), +m3[1] - 1, +m3[2]);
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

function startOfDay(d) {
  if (!d || isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function extractCodeFromRow(row) {
  const s = getCellByAliases(row, ['股票代码', '代码', '代号', '上市代号']);
  const m = String(s || '').match(/(\d{4,5})/);
  return m ? m[1].padStart(5, '0') : '';
}

function extractNameFromRow(row) {
  return getCellByAliases(row, ['股票名称', '名称', 'IPO名称', '股票名']) || '';
}

function getSubEndDateFromRow(row) {
  for (const a of SUB_END_ALIASES) {
    for (const k of Object.keys(row || {})) {
      if (
        normH(k) === a ||
        (normH(k).includes('招股') && /结束|截止|截止日/.test(normH(k)))
      ) {
        const p = parseDateFlexible(row[k]);
        if (p) return startOfDay(p);
      }
    }
  }
  return startOfDay(parseDateFlexible(getCellByAliases(row, SUB_END_ALIASES)));
}

function dedupeIpoRowsByCode(rows) {
  const seen = new Set();
  return (rows || []).filter(r => {
    const c = extractCodeFromRow(r);
    if (!c) return false;
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });
}

function sortRowsBySubEndDesc(list) {
  return (list || []).slice().sort((a, b) => {
    const da = getSubEndDateFromRow(a);
    const db = getSubEndDateFromRow(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.getTime() - da.getTime();
  });
}

/** 与网页新股横滑卡片一致：最多 6 只 */
function buildIpoTopSixStocks(rows) {
  const withDate = dedupeIpoRowsByCode(
    (rows || []).filter(
      r =>
        r &&
        getSubEndDateFromRow(r) &&
        extractCodeFromRow(r) &&
        Object.keys(r).some(k => String(r[k] || '').trim()),
    ),
  );
  if (!withDate.length) return [];
  return sortRowsBySubEndDesc(withDate).slice(0, IPO_SHEET_TOP_N);
}

function normStockCode(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length <= 5 ? d.padStart(5, '0') : d.slice(-5).padStart(5, '0');
}

function rowToRosterEntry(row) {
  const code = extractCodeFromRow(row);
  const name = extractNameFromRow(row);
  const subEnd = getSubEndDateFromRow(row);
  return {
    code,
    name,
    subEnd: subEnd ? subEnd.toISOString().slice(0, 10) : null,
  };
}

function buildRosterPayload(rows) {
  const top = buildIpoTopSixStocks(rows);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    source: 'buildIpoTopSixStocks',
    count: top.length,
    stocks: top.map(rowToRosterEntry).filter(s => s.code && s.name),
  };
}

module.exports = {
  buildIpoTopSixStocks,
  buildRosterPayload,
  extractCodeFromRow,
  extractNameFromRow,
  normStockCode,
  getSubEndDateFromRow,
};
