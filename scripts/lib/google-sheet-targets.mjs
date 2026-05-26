/**
 * Google Sheet「港股IPO打新指南信息收集」· 上市新股 tab CSV 解析
 */
const DEFAULT_PUBLISH_BASE =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5R7a29N0wHqOVKXO7Dx016Z_DV0IQ5n16IaTMSPWF2QOqwqud1ViC1Llp0MFwZep8qMUGW_-9SCBU/pub';
const DEFAULT_LISTED_GID = 63719317;

const FIELD_ALIASES = {
  name: ['股票名称', '名称', 'name'],
  code: ['股票代码', '代码', 'code'],
  subStart: ['招股开始', '认购开始', '起购日期', '招股日期'],
  subEnd: ['招股结束', '认购结束', '截止认购'],
  listingDate: ['上市日期', '挂牌日', '上市日'],
  sector: ['行业板块', '板块', '行业', '行业·细分'],
};

function normKey(s) {
  return String(s || '').replace(/\s+/g, '').trim();
}

function normCode(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length <= 5 ? d.padStart(5, '0') : d.slice(-5).padStart(5, '0');
}

function cell(row, keys) {
  const map = Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [normKey(k), v]));
  for (const k of keys) {
    const v = map[normKey(k)];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => String(c).trim())) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => String(c).trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] != null ? String(cols[idx]).trim() : '';
    });
    return obj;
  });
}

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s || ['—', '-', '待定', 'TBD', 'N/A'].includes(s)) return null;
  const norm = s.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/\//g, '-');
  let m = norm.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.replace(/\D/g, '').match(/(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function rowToSheetIpo(raw) {
  const code = normCode(cell(raw, FIELD_ALIASES.code));
  if (!code || code === '00000') return null;
  const name = cell(raw, FIELD_ALIASES.name) || code;
  const subStart = cell(raw, FIELD_ALIASES.subStart);
  const subEnd = cell(raw, FIELD_ALIASES.subEnd);
  const listingDate = cell(raw, FIELD_ALIASES.listingDate);
  return {
    code,
    name,
    subStart,
    subEnd,
    listingDate,
    sector: cell(raw, FIELD_ALIASES.sector) || '其他',
    subStartDate: parseDate(subStart),
    subEndDate: parseDate(subEnd),
    listingDateParsed: parseDate(listingDate),
  };
}

export async function fetchListedSheetRows(options = {}) {
  const base = (options.publishBase || process.env.NNQ_HEAT_SHEET_PUBLISH_BASE || DEFAULT_PUBLISH_BASE).replace(/\/$/, '');
  const gid = options.listedGid || process.env.NNQ_HEAT_SHEET_LISTED_GID || DEFAULT_LISTED_GID;
  const url = `${base}?gid=${gid}&single=true&output=csv&_t=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/csv,application/csv,text/plain,*/*',
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) throw new Error(`Sheet CSV HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith('<')) throw new Error('Sheet 返回 HTML 而非 CSV');
  return parseCsv(text);
}

function passesSheetTimeFilter(subStart, subEnd, listing, today = new Date()) {
  const pastDays = 30;
  const futureDays = 7;
  const dayMs = 24 * 60 * 60 * 1000;
  const toDate = (iso) => (iso ? new Date(`${iso}T00:00:00+08:00`) : null);
  const ss = toDate(subStart);
  const se = toDate(subEnd);
  const ld = toDate(listing);
  const t = new Date(`${today.toISOString().slice(0, 10)}T00:00:00+08:00`);
  const pastCutoff = new Date(t.getTime() - pastDays * dayMs);
  const futureCutoff = new Date(t.getTime() + futureDays * dayMs);

  if (ld && ld < pastCutoff) {
    if (!(ss && t < ss && ss <= futureCutoff)) return false;
  }
  if (ss && t < ss && ss <= futureCutoff) return true;
  if (ss && ss >= pastCutoff) return true;
  if (ld && ld >= pastCutoff) return true;
  if (ss && se && ss <= t && t <= se) return true;
  if (se && se >= pastCutoff && se <= t) {
    if (!ld || ld >= pastCutoff) return true;
  }
  return false;
}

export function selectScrapeTargets(rows, options = {}) {
  const limit = Number(options.limit || process.env.NNQ_STOCK_TARGET_LIMIT || 20);
  const today = new Date();

  const parsed = [];
  for (const raw of rows) {
    const row = rowToSheetIpo(raw);
    if (!row) continue;
    if (!passesSheetTimeFilter(row.subStartDate, row.subEndDate, row.listingDateParsed, today)) {
      continue;
    }
    const dates = [row.listingDateParsed, row.subEndDate, row.subStartDate]
      .filter(Boolean)
      .map((d) => new Date(`${d}T00:00:00+08:00`));
    if (!dates.length) continue;
    const anchor = new Date(Math.max(...dates.map((d) => d.getTime())));
    parsed.push({
      code: row.code,
      name: row.name,
      subStart: row.subStart,
      subEnd: row.subEnd,
      listingDate: row.listingDate,
      sector: row.sector,
      sortDate: anchor.toISOString().slice(0, 10),
    });
  }
  parsed.sort((a, b) => (a.sortDate < b.sortDate ? 1 : a.sortDate > b.sortDate ? -1 : 0));
  return parsed.slice(0, Math.max(1, limit));
}
