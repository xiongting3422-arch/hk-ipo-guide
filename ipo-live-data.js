/**
 * IPO Live Data — 腾讯财经行情 & 涨幅自动计算版
 *
 * Google Sheets CSV：Fetch + IPO主页 → 涨幅榜（innerHTML 注入 #ipo-table-container）
 *
 * 现价批量来源：腾讯财经 https://qt.gtimg.cn/q=r_hk00700,r_hk09988,...（单批最多 60 只，避免 URL 过长）
 * 缓存：localStorage 键 __IPO_GTIMG_LIVE_CACHE_V1__，时间戳 ts；距上次成功更新不足 3 小时则只读缓存不发请求
 * 入口：window.loadLiveData(codes5) → { map: { '00700': 现价 } }
 * 刷新榜单元格：window.loadStockQuotes() — 按现价重算「累计表现」（走 loadLiveData，尊重 3 小时缓存）
 *
 * 「今日」同步：window.__IPO_SHEET_SYNC_REF_YMD__ 为只读 getter，始终返回北京时间 YYYY-MM-DD（勿再赋值覆盖）
 */
window.IPO_LIVE_DATA = window.IPO_LIVE_DATA || {};
window.MASTER_IPO_LIST = window.MASTER_IPO_LIST || {};

window.__IPO_DISABLE_LIVE_SCRAPERS__ = true;
/** 当前 UTC 日历 YYYY-MM-DD（与 toISOString().slice(0,10) 一致；跨日边界与北京时间可能差一日） */
window.__ipoUtcYmdIso = function __ipoUtcYmdIso() {
  return new Date().toISOString().slice(0, 10);
};
/** 当前「北京时间」日历 YYYY-MM-DD（用于港股日程、与表格当日对齐） */
window.__ipoBeijingYmd = function __ipoBeijingYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
};
Object.defineProperty(window, '__IPO_SHEET_SYNC_REF_YMD__', {
  get() {
    return window.__ipoBeijingYmd();
  },
  configurable: true,
});
window.__IPO_MERGED_UNIFIED_CSV_KEY__ = '__IPO_MERGED_UNIFIED_CSV__';
window.IPO_SHEET_STRICT_FIELD_MAP = window.IPO_SHEET_STRICT_FIELD_MAP || {};

window.__IPO_LB_DYNAMIC_ACTIVE__ = false;

function _publishIpoHomeLbMapped(mapped) {
  const m = Array.isArray(mapped) ? mapped : [];
  window.__IPO_HOME_LB_MAPPED__ = m;
  window.allData = m;
}

/** 与「2026新股涨幅榜」同源：上市日期落在 2026 自然年（本地日历日边界） */
function _ipoListingMsIn2026(listMs) {
  if (listMs == null || !Number.isFinite(listMs)) return false;
  const start = new Date(2026, 0, 1).getTime();
  const end = new Date(2026, 11, 31, 23, 59, 59, 999).getTime();
  return listMs >= start && listMs <= end;
}

/**
 * 首页顶部「2026年已上市 / 首日上涨率 / 最高首日涨幅」三卡：仅更新 innerText，数据与 window.allData（涨幅榜）一致。
 */
function updateIpoHomeLeaderboardStatCards() {
  const rows = Array.isArray(window.__IPO_HOME_LB_MAPPED__) && window.__IPO_HOME_LB_MAPPED__.length
    ? window.__IPO_HOME_LB_MAPPED__
    : Array.isArray(window.allData)
      ? window.allData
      : [];
  const y2026 = rows.filter(r => r && _ipoListingMsIn2026(r.listMs));
  const total = y2026.length;
  let up = 0;
  for (let i = 0; i < y2026.length; i++) {
    const fd = y2026[i].fd;
    if (fd != null && Number.isFinite(fd) && fd > 0) up++;
  }
  const ratioPct = total > 0 ? (up / total) * 100 : 0;

  let maxRow = null;
  let maxFd = -Infinity;
  for (let i = 0; i < y2026.length; i++) {
    const fd = y2026[i].fd;
    if (fd == null || !Number.isFinite(fd)) continue;
    if (fd > maxFd) {
      maxFd = fd;
      maxRow = y2026[i];
    }
  }

  const elListed = document.getElementById('sc-listed');
  const elListedSub = document.getElementById('sc-listed-sub');
  const elRatio = document.getElementById('sc-ratio');
  const elRatioSub = document.getElementById('sc-ratio-sub');
  const elMax = document.getElementById('sc-maxgain');
  const elMaxSub = document.getElementById('sc-maxgain-sub');

  if (elListed) elListed.textContent = String(total);
  if (elListedSub) elListedSub.textContent = '截至今日';

  if (elRatio) elRatio.textContent = `${ratioPct.toFixed(1)}%`;
  if (elRatioSub) elRatioSub.textContent = total > 0 ? `${up}/${total} 首日上涨` : `0/0 首日上涨`;

  if (elMax) {
    if (maxRow && Number.isFinite(maxFd)) {
      const v = maxFd % 1 === 0 ? String(Math.round(maxFd)) : maxFd.toFixed(1);
      elMax.textContent = `${v}%`;
    } else {
      elMax.textContent = '—';
    }
  }
  if (elMaxSub) {
    if (maxRow && Number.isFinite(maxFd)) {
      const name = String(maxRow.stockName || '—').trim() || '—';
      const code = String(maxRow.code || '')
        .replace(/\D/g, '')
        .padStart(5, '0');
      elMaxSub.textContent = code ? `${name} ${code}` : name;
    } else {
      elMaxSub.textContent = '—';
    }
  }
  renderIpoLbBreakGuide();
}
window.updateIpoHomeLeaderboardStatCards = updateIpoHomeLeaderboardStatCards;
window.allData = window.allData || [];

/** 默认：仓库示例表。换成你的表：在 index.html 里先于本脚本设置 window.__IPO_SHEET_CONFIG__ */
const _IPO_PUB_DEFAULT =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5R7a29N0wHqOVKXO7Dx016Z_DV0IQ5n16IaTMSPWF2QOqwqud1ViC1Llp0MFwZep8qMUGW_-9SCBU/pub';

const _GID_DEFAULT = {
  ipoHome: 1914717842,
  listed: 63719317,
  dark: 976801045,
  schedule: 0,
};

function _getPublishBase() {
  const cfg = window.__IPO_SHEET_CONFIG__ || {};
  const raw = cfg.publishBase || cfg.publishUrl || cfg.url || '';
  if (typeof raw === 'string' && raw.trim()) {
    let u = raw.trim().replace(/\/+$/, '');
    if (/spreadsheets\/d\/e\//i.test(u) && !/\/pub$/i.test(u)) u += '/pub';
    return u;
  }
  return _IPO_PUB_DEFAULT;
}

function _getGids() {
  const g = (window.__IPO_SHEET_CONFIG__ && window.__IPO_SHEET_CONFIG__.gids) || {};
  return {
    ipoHome: g.ipoHome != null ? g.ipoHome : _GID_DEFAULT.ipoHome,
    listed: g.listed != null ? g.listed : _GID_DEFAULT.listed,
    dark: g.dark != null ? g.dark : _GID_DEFAULT.dark,
    schedule: g.schedule != null ? g.schedule : _GID_DEFAULT.schedule,
  };
}

const _TAB_LABEL = {
  ipoHome: 'IPO主页',
  listed: '上市新股',
  dark: '新股暗盘',
  schedule: '打新时间表',
};

const _LB_HEADERS = [
  '股票名称',
  '股票代码',
  '行业板块',
  '上市日期',
  '每手手数',
  '招股价(HKD)',
  '每手金额',
  '上市价',
  '超额倍数',
  '现价',
  '暗盘表现',
  '暗盘一手赚',
  '首日表现',
  '上市一手赚',
  '累计表现',
];

/** 暗盘表现、暗盘一手赚、首日表现、上市一手赚 — 列下标 10–13（nth-child 11–14） */
const _LB_METRIC_BREAK_COLS = [10, 11, 12, 13];

function _ipoParseSignedMetric(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s === '—' || s === '-' || s === '－') return null;
  s = s.replace(/\u2212/g, '-').replace(/,/g, '').replace(/，/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function _ipoLbRowHasBreakMetric(rawCells) {
  if (!Array.isArray(rawCells)) return false;
  for (let j = 0; j < _LB_METRIC_BREAK_COLS.length; j++) {
    const idx = _LB_METRIC_BREAK_COLS[j];
    const v = _ipoParseSignedMetric(rawCells[idx]);
    if (v != null && v < 0) return true;
  }
  return false;
}

/** 暗盘表现(10)、首日表现(12) 任一为负 → 名称后 [破发]（与 DataTable 排序无关，仅展示） */
const _LB_PERF_BREAK_IDX = [10, 12];

function _ipoLbRowHasBreakPerformance(rawCells) {
  if (!Array.isArray(rawCells)) return false;
  for (let j = 0; j < _LB_PERF_BREAK_IDX.length; j++) {
    const idx = _LB_PERF_BREAK_IDX[j];
    const v = _ipoParseSignedMetric(rawCells[idx]);
    if (v != null && v < 0) return true;
  }
  return false;
}

window.__ipoParseSignedMetric = _ipoParseSignedMetric;
window.__ipoLbRowHasBreakMetric = _ipoLbRowHasBreakMetric;
window.__ipoLbRowHasBreakPerformance = _ipoLbRowHasBreakPerformance;
window.__IPO_LB_METRIC_BREAK_COLS = _LB_METRIC_BREAK_COLS.slice();
window.__IPO_LB_PERF_BREAK_IDX = _LB_PERF_BREAK_IDX.slice();
/** 行业板块列：tbody td 为每行第 3 个单元格（nth-child(3)），含 data-order="{原始大类}" 供 DataTables 等按大类排序 */
window.__IPO_LB_SECTOR_COL_INDEX = 2;

window.safeParseDate = function safeParseDate(d) {
  if (d == null || d === '' || d === 'TBD') return null;
  const dt = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  return dt instanceof Date && !isNaN(dt.getTime()) ? dt : null;
};

function _normKey(k) {
  return String(k || '')
    .replace(/^\uFEFF/, '')
    .trim();
}

function _normColKeyForMatch(k) {
  return _normKey(k).replace(/\s/g, '');
}

function findColumnKey(row, keywords, options) {
  const opts = options || {};
  const exclude = opts.exclude;
  const kwList = (Array.isArray(keywords) ? keywords : [keywords])
    .map(k => String(k).replace(/\s/g, ''))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const keys = Object.keys(row || {});
  for (const kwn of kwList) {
    for (const k of keys) {
      const nk = _normColKeyForMatch(k);
      if (!nk.includes(kwn)) continue;
      if (exclude && (typeof exclude === 'function' ? exclude(nk) : exclude.test(nk))) continue;
      return k;
    }
  }
  return null;
}

function _cleanCellValue(val) {
  if (val == null) return '';
  const s = String(val).trim();
  if (s === '' || s === '—') return '';
  if (/^自动抓取$/i.test(s) || /^自動抓取$/i.test(s)) return '';
  return s;
}

function getColumnValue(row, keywords, options) {
  const key = findColumnKey(row, keywords, options);
  if (key == null) return '';
  return _cleanCellValue(row[key]);
}

window.findColumnKey = findColumnKey;
window.getColumnValue = getColumnValue;

function cleanNum(raw, opts) {
  const o = typeof opts === 'string' ? { kind: opts } : opts || {};
  try {
    if (raw == null) return o.emptyAsZero ? 0 : null;
    const s0 = String(raw).trim();
    if (/^自动抓取$/i.test(s0) || /^自動抓取$/i.test(s0)) return o.emptyAsZero ? 0 : null;
    if (s0 === '' || s0 === '—' || s0 === '-') return o.emptyAsZero ? 0 : null;

    const hadPct = /%/.test(s0);
    let s = s0
      .replace(/[$\s\u00A0]/g, '')
      .replace(/,/g, '')
      .replace(/，/g, '');

    const kind = o.kind || 'money';
    if (kind === 'oversub' || kind === 'multiple') {
      s = s.replace(/[×xX倍]/gi, '');
      const m = s.match(/[+-]?[\d.]+/);
      if (!m) return o.emptyAsZero ? 0 : null;
      const n = parseFloat(m[0]);
      return Number.isFinite(n) ? n : o.emptyAsZero ? 0 : null;
    }

    s = s.replace(/%/g, '');
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return o.emptyAsZero ? 0 : null;
    if (kind === 'percent' && hadPct && o.percentAsDecimal !== false) {
      return n / 100;
    }
    return n;
  } catch (e) {
    const ez = typeof opts === 'object' && opts && opts.emptyAsZero;
    return ez ? 0 : null;
  }
}
window.cleanNum = cleanNum;

function _rowHasContent(row) {
  if (!row || typeof row !== 'object') return false;
  return Object.keys(row).some(k => String(row[k] || '').trim() !== '');
}

const _CSV_HEADER_CELL_MARKERS = new Set([
  '股票代码',
  '代码',
  '股票名称',
  '名称',
  'IPO名称',
  '股票名',
  '上市日期',
  '挂牌日',
  '上市日',
  '挂牌',
  '招股价',
  '招股价(HKD)',
  '招股价（港元）',
  '板块',
  '行业板块',
  '超额倍数',
  '超购',
  '现价',
  '最新价',
  '暗盘表现',
  '首日表现',
  '累计表现',
  '每手金额',
  '每手手数',
  '每手股数',
  '上市价',
  '定价',
  '发行价',
  '孖展倍数',
  '认购倍数',
  '暗盘一手赚',
  '上市一手赚',
  '自动抓取',
]);

function _rowLooksLikeCsvHeaderDuplicate(row) {
  if (!row || typeof row !== 'object') return false;
  const nameGuess = getColumnValue(row, ['股票名称', '名称', 'IPO名称', '股票名']);
  if (nameGuess && _CSV_HEADER_CELL_MARKERS.has(nameGuess)) return true;
  const codeGuess = getColumnValue(row, ['股票代码', '代码', '证券代码']);
  if (codeGuess === '股票代码' || codeGuess === '代码') return true;

  const vals = Object.values(row)
    .map(v => String(v ?? '').trim())
    .filter(Boolean);
  if (!vals.length) return false;
  let hits = 0;
  for (const v of vals) {
    if (_CSV_HEADER_CELL_MARKERS.has(v)) hits++;
  }
  if (hits >= 2) return true;
  if (vals[0] === '股票代码' && vals.length >= 2 && _CSV_HEADER_CELL_MARKERS.has(vals[1])) return true;
  return false;
}

function _normStockCode(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/(\d{4,5})/);
  return m ? m[1].padStart(5, '0') : '';
}

function _extractStockCodeFromZh(row) {
  if (!row) return '';
  const fromGc = getColumnValue(row, ['股票代码', '代码']);
  if (fromGc) {
    const c = _normStockCode(fromGc);
    if (c) return c;
  }
  for (const k of ['股票代码', '股票代号', '代号']) {
    if (row[k] != null) {
      const c = _normStockCode(_cleanCellValue(row[k]));
      if (c) return c;
    }
  }
  for (const k of Object.keys(row)) {
    const c = _normStockCode(_cleanCellValue(row[k]));
    if (c) return c;
  }
  return '';
}

function _extractNameFromZh(row) {
  if (!row) return '';
  for (const k of ['股票名称', '名称', 'IPO名称']) {
    if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
}

function _firstRowStockNameZh(row) {
  if (!row) return '(无)';
  const byKey = getColumnValue(row, ['股票名称', '名称', 'IPO名称', '股票名']);
  if (byKey && !_CSV_HEADER_CELL_MARKERS.has(byKey)) return byKey;
  for (const k of ['股票名称', '名称', 'IPO名称', '股票名']) {
    if (row[k] != null && String(row[k]).trim() !== '') {
      const s = String(row[k]).trim();
      if (!_CSV_HEADER_CELL_MARKERS.has(s)) return s;
    }
  }
  const vals = Object.values(row).filter(v => v != null && String(v).trim() !== '');
  for (const v of vals) {
    const s = String(v).trim();
    if (_CSV_HEADER_CELL_MARKERS.has(s)) continue;
    if (/^0?\d{4,5}(?:\s|$)/.test(s) || /^\d{4,5}\.HK$/i.test(s)) continue;
    return s;
  }
  return '(无)';
}

function _dash(v) {
  if (v == null) return '-';
  const s = String(v).trim();
  return s === '' || s === '—' ? '-' : s;
}

/** 禁止 data:image / 超长纯 base64 进单元格，避免 ERR_INVALID_URL */
function _sanitizeNoImg(val) {
  if (val == null) return '';
  let s = String(val);
  if (/data:\s*image/i.test(s)) return '';
  if (/;base64/i.test(s)) return '';
  if (s.length > 400 && /^[A-Za-z0-9+/=\s]+$/.test(s)) return '';
  return s;
}

function _lbEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HTML 属性用转义，供 data-order 等 */
function _lbEscAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
}

function _parseMoneyNum(raw) {
  const v = cleanNum(_cleanCellValue(raw) || raw, { kind: 'money' });
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

function _parsePercentNum(raw) {
  const s0 = _cleanCellValue(raw) || raw;
  if (s0 === '' || s0 == null) return null;
  const hadPct = /%/.test(String(s0));
  if (hadPct) {
    const dec = cleanNum(s0, { kind: 'percent', percentAsDecimal: true });
    if (dec == null || !Number.isFinite(dec)) return null;
    return dec * 100;
  }
  const v = cleanNum(s0, { kind: 'money' });
  return v != null && Number.isFinite(v) ? v : null;
}

function _parseOversub(raw) {
  const v = cleanNum(_cleanCellValue(raw) || raw, { kind: 'oversub' });
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/** 一手中签率等，返回百分比数值（如 12.5 表示 12.5%） */
function _ipoParseHitRatePct(raw) {
  if (raw == null) return null;
  const s = String(_cleanCellValue(raw) || raw).trim();
  if (!s) return null;
  const m = s.match(/([\d.]+)\s*%/);
  if (m) {
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  const m2 = s.match(/([\d.]+)/);
  if (m2) {
    const n = parseFloat(m2[1]);
    return Number.isFinite(n) && n <= 100 ? n : null;
  }
  return null;
}

function _listDateToMs(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 40000 && raw < 60000) {
      const epoch = new Date(1899, 11, 30);
      const ms = epoch.getTime() + Math.round(raw) * 86400000;
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d.getTime() : null;
    }
  }
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]).getTime();
  m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})$/);
  if (m) {
    const ref =
      typeof window.__ipoBeijingYmd === 'function'
        ? window.__ipoBeijingYmd()
        : String(window.__IPO_DEFAULT_PREVIEW_YMD__ || window.__ipoUtcYmdIso?.() || '').trim();
    const y = parseInt(String(ref).slice(0, 4), 10) || new Date().getFullYear();
    return new Date(y, +m[1] - 1, +m[2]).getTime();
  }
  m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  return null;
}

function _getListingDateRaw(row) {
  let v = getColumnValue(row, ['上市日期', '挂牌日', '上市日', '挂牌', 'ListingDate', '上市时间']);
  if (v) return v;
  const keys = Object.keys(row || {});
  for (const k of keys) {
    const nk = _normColKeyForMatch(k);
    if ((/上市|挂牌|listing/i.test(nk) && /日|期|date|time/i.test(nk)) || /^listdate$/i.test(nk)) {
      const cell = _cleanCellValue(row[k]);
      if (cell) return cell;
    }
  }
  return '';
}

function _fmtCumPct(n) {
  if (n == null || !Number.isFinite(n) || n === -Infinity) return '-';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function _inferSectorClass(sector) {
  const t = String(sector || '');
  if (/AI|人工智能|视觉|物联网/.test(t)) return 'ai';
  if (/半导体|芯片|PCB|线路板|SiC/.test(t)) return 'semi';
  if (/消费|零食|户外|连锁/.test(t)) return 'consumer';
  if (/医疗|健康|生物|药/.test(t)) return 'health';
  if (/农业|牧原|生猪/.test(t)) return 'agri';
  if (/锂电|新能源/.test(t)) return 'energy';
  if (/出行|共享/.test(t)) return 'travel';
  if (/汽车|泽景|HUD/.test(t)) return 'auto';
  if (/机器人|埃斯顿|精密|制造|物流|冷链|工艺/.test(t)) return 'mfg';
  if (/新材料|沃尔|核材|特种/.test(t)) return 'mat';
  return 'mfg';
}

/** 单列「行业板块」内拆分：大类 · 细分 */
function _ipoSplitSectorCombined(singleCell) {
  const t = String(singleCell || '').trim();
  if (!t) return { broad: '—', niche: '' };
  const seps = [' · ', '·', ' | ', '|', ' / ', '/', '／', '、'];
  for (let si = 0; si < seps.length; si++) {
    const sep = seps[si];
    if (t.indexOf(sep) >= 0) {
      const parts = t.split(sep).map(x => x.trim()).filter(Boolean);
      if (parts.length >= 2) return { broad: parts[0], niche: parts.slice(1).join(' · ') };
    }
  }
  return { broad: t, niche: '' };
}

/**
 * 原始大类用于 data-order / 分组排序；细分来自独立列或同一单元格拆分
 */
function _ipoResolveSectorBroadAndNiche(row, sectorMainRaw) {
  let broad = String(sectorMainRaw || '').trim();
  let niche = getColumnValue(row, ['细分行业', '网络细分', '细分板块', '子行业', '网络细分行业']);
  niche = String(niche || '').trim();
  if (!niche && broad) {
    const sp = _ipoSplitSectorCombined(broad);
    broad = sp.broad;
    niche = sp.niche;
  }
  if (!broad) broad = '—';
  const sectorOrder = broad;
  return { broad, niche, sectorOrder };
}

/** 表格单元格是否需要拉取腾讯财经现价（占位/空视为需要） */
function _needsAutoFetchedPrice(val) {
  const s = String(val ?? '').trim();
  if (!s) return true;
  if (/自动抓取|自動抓取|API|实时|實時/i.test(s)) return true;
  return false;
}

const _IPO_GTIMG_CACHE_KEY = '__IPO_GTIMG_LIVE_CACHE_V1__';
const _IPO_GTIMG_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const _IPO_GTIMG_CHUNK = 60;

function _readGtimgLocalCache() {
  try {
    const raw = localStorage.getItem(_IPO_GTIMG_CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || typeof o.ts !== 'number' || !o.data || typeof o.data !== 'object') return null;
    return o;
  } catch (e) {
    return null;
  }
}

function _writeGtimgLocalCache(ts, data) {
  try {
    localStorage.setItem(_IPO_GTIMG_CACHE_KEY, JSON.stringify({ ts, data }));
  } catch (e) {}
}

/** 解析腾讯 qt.gtimg.cn 返回：v_r_hk00700="a~b~c~现价~..."，下标 3 为现价，32 为涨跌幅 */
function _parseGtimgQtBody(text) {
  const out = {};
  if (text == null || String(text).trim() === '') return out;
  const re = /v_r_hk(\d{5})="([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const code5 = m[1];
    const parts = String(m[2]).split('~');
    const priceRaw = parts[3];
    const chgRaw = parts[32];
    const price = parseFloat(String(priceRaw ?? '').replace(/,/g, ''));
    let changePct = null;
    if (chgRaw != null && String(chgRaw).trim() !== '') {
      const c = parseFloat(String(chgRaw).replace(/,/g, ''));
      if (Number.isFinite(c)) changePct = c;
    }
    if (Number.isFinite(price)) {
      out[code5] = {
        price: Math.round(price * 1000) / 1000,
        changePct,
      };
    }
  }
  return out;
}

function _priceMapFromGtimgData(data, codes5) {
  const map = {};
  const src = data && typeof data === 'object' ? data : {};
  (codes5 || []).forEach(c => {
    const c5 = String(c).padStart(5, '0');
    const row = src[c5];
    if (row && row.price != null && Number.isFinite(+row.price)) map[c5] = +row.price;
  });
  return map;
}

/**
 * 批量拉取港股现价（腾讯财经公开接口），带 3 小时 localStorage 缓存。
 * @returns {Promise<{ map: Object.<string, number> }>} map：5 位代码 -> 现价
 */
async function loadLiveData(codes5) {
  const uniq = [...new Set((codes5 || []).filter(Boolean).map(c => String(c).padStart(5, '0')))];
  if (!uniq.length) return { map: {} };

  const cached = _readGtimgLocalCache();
  const now = Date.now();

  if (cached && now - cached.ts < _IPO_GTIMG_CACHE_TTL_MS) {
    return { map: _priceMapFromGtimgData(cached.data, uniq) };
  }

  const merged = {};
  try {
    for (let i = 0; i < uniq.length; i += _IPO_GTIMG_CHUNK) {
      const chunk = uniq.slice(i, i + _IPO_GTIMG_CHUNK);
      const q = chunk.map(c => `r_hk${c}`).join(',');
      const url = `https://qt.gtimg.cn/q=${q}&_=${Date.now()}`;
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      Object.assign(merged, _parseGtimgQtBody(text));
    }

    const prev = cached && cached.data && typeof cached.data === 'object' ? cached.data : {};
    const nextData = { ...prev };
    Object.keys(merged).forEach(k => {
      nextData[k] = merged[k];
    });
    _writeGtimgLocalCache(now, nextData);

    return { map: _priceMapFromGtimgData(nextData, uniq) };
  } catch (e) {
    console.log('线上接口暂不可用，使用缓存数据');
    if (cached && cached.data) {
      return { map: _priceMapFromGtimgData(cached.data, uniq) };
    }
    return { map: {} };
  }
}

window.loadLiveData = loadLiveData;

/**
 * 根据腾讯现价更新 window.allData（涨幅榜行）中的现价与累计表现，并触发 renderLeaderboardNow。
 * 数据结构为 _buildIpoHomeLeaderboardMapped 产出的行：cells[5] 招股价、cells[9] 现价、cells[14] 累计表现。
 */
async function loadStockQuotes() {
  console.log('[IPO Live] 同步物理日期:', window.__IPO_SHEET_SYNC_REF_YMD__);

  const stocks = window.allData;
  if (!Array.isArray(stocks) || !stocks.length) return;

  const codes = [
    ...new Set(
      stocks
        .map(s => {
          const digits = String(s && s.code != null ? s.code : '').replace(/\D/g, '');
          return digits ? digits.padStart(5, '0') : '';
        })
        .filter(Boolean),
    ),
  ];
  if (!codes.length) return;

  let map;
  try {
    const res = await loadLiveData(codes);
    map = res && res.map ? res.map : {};
  } catch (e) {
    console.warn('[IPO Live] loadStockQuotes 拉取行情失败', e);
    return;
  }

  stocks.forEach(row => {
    const c5 = String(row.code != null ? row.code : '')
      .replace(/\D/g, '')
      .padStart(5, '0');
    const px = map[c5];
    if (px == null || !Number.isFinite(px)) return;

    const cells = Array.isArray(row.cells) ? row.cells.slice() : [];
    while (cells.length < 15) cells.push('-');

    cells[9] = _dash(String(px));
    const ipo = _parseMoneyNum(cells[5]);
    if (ipo != null && ipo > 0) {
      const pct = ((px - ipo) / ipo) * 100;
      row.cum = pct;
      cells[14] = _fmtCumPct(pct);
    }
    row.cells = cells;
  });

  _publishIpoHomeLbMapped(stocks);

  if (typeof window.renderLeaderboardNow === 'function') {
    console.log('[IPO Live] 抓取成功，正在刷新涨幅榜…');
    window.renderLeaderboardNow();
  }
}

window.loadStockQuotes = loadStockQuotes;

function _ensureLbCss() {
  if (document.getElementById('ipo-lb-force-css')) return;
  const st = document.createElement('style');
  st.id = 'ipo-lb-force-css';
  st.textContent = `
#ipo-table-container { overflow-x: auto !important; }
#ipo-table-container table, #ipo-table-container #ipo-table-2026, #lb-table { min-width: 1500px !important; border-collapse: separate !important; border-spacing: 0 !important; }
#ipo-table-container .lb-tr { cursor: pointer; transition: background .12s; }
#ipo-table-container .lb-tr:hover { background: var(--s2) !important; }
#ipo-table-container .lb-tr.lb-tr-neg { background: rgba(220,38,38,.02); }
#ipo-table-container .lb-tr.lb-tr-neg:hover { background: rgba(220,38,38,.05) !important; }
#ipo-table-container th.lb-th-sector { text-align: right !important; justify-content: flex-end !important; }
#ipo-table-container td.lb-td-sector { text-align: right !important; justify-content: flex-end !important; }
#ipo-table-container td.lb-td-sector .lb-sector-stack { display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-start; }
#ipo-table-container .lb-group-hdr-2026 td { background: #f3f4f6 !important; }
`;
  document.head.appendChild(st);
}

/** 上市日期分组的月份标题（如 2026年4月） */
function _ipoYmLabelFromMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '日期未解析';
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}
function _ipoYmKey(ms) {
  if (ms == null || !Number.isFinite(ms)) return '__none__';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _lbCells15(r) {
  const cells = Array.isArray(r.cells) ? r.cells.slice() : [];
  while (cells.length < 15) cells.push('-');
  return cells;
}

function _lbGetSortKey(r, mode) {
  const cells = _lbCells15(r);
  const nfin = x => (x != null && Number.isFinite(x) ? x : -Infinity);
  switch (mode) {
    case 'default':
    case 'fd':
      return nfin(r.fd);
    case 'month':
      return nfin(r.listMs);
    case 'over':
      return nfin(r.over);
    case 'dark':
      return nfin(_ipoParseSignedMetric(cells[10]));
    case 'darkLot':
      return nfin(_parseMoneyNum(cells[11]));
    case 'listProfit':
      return nfin(_parseMoneyNum(cells[13]));
    case 'cum':
      if (r.cum != null && Number.isFinite(r.cum)) return r.cum;
      return nfin(_parsePercentNum(cells[14]));
    default:
      return nfin(r.fd);
  }
}

function _lbCmpRows(a, b, mode) {
  const vb = _lbGetSortKey(b, mode);
  const va = _lbGetSortKey(a, mode);
  if (vb !== va) return vb - va;
  return (a.lbRank || 0) - (b.lbRank || 0);
}

function _lbGroupHdrRow2026(label, countText) {
  const extra = countText
    ? `<span class="lb-group-hdr-count" style="margin-left:8px;">${_lbEsc(countText)}</span>`
    : '';
  return `<tr class="lb-group-hdr lb-group-hdr-2026"><td colspan="15" style="padding:8px 14px;background:#f3f4f6;border-top:1px solid var(--s3);border-bottom:1px solid var(--s3);"><span class="lb-group-hdr-label" style="font-weight:700;">${_lbEsc(
    label,
  )}</span>${extra}</td></tr>`;
}

function __ipoRenderLeaderboardInnerHTML(mapped, mode) {
  _ensureLbCss();
  const wrap = document.getElementById('ipo-table-container');
  if (!wrap) {
    console.warn('[IPO LB] 未找到 #ipo-table-container');
    return;
  }
  if (!mapped || !mapped.length) {
    wrap.innerHTML =
      '<table id="ipo-table-2026" class="lb-table" style="width:max-content;min-width:1500px !important;border-collapse:separate;border-spacing:0;white-space:nowrap;"><thead><tr>' +
      _LB_HEADERS.map((h, i) => {
        const cls = i === 0 ? 'lb-sth lb-sth-col-name' : i === 2 ? 'lb-th-r lb-th-sector' : 'lb-th-r';
        return `<th class="${cls}">${_lbEsc(h)}</th>`;
      }).join('') +
      '</tr></thead><tbody id="lb-tbody"></tbody></table>';
    console.log(
      '%c🔥 渲染流程已走完，当前 tbody 实际行数: ' + document.querySelectorAll('tbody tr').length,
      'font-size:18px;font-weight:bold;color:#dc2626;',
    );
    return;
  }

  const m = mode || window.__IPO_LB_SORT_MODE__ || 'default';
  window.__IPO_LB_SORT_MODE__ = m;

  function rowHtml(r) {
    const cells = Array.isArray(r.cells) ? r.cells.slice() : [];
    while (cells.length < 15) cells.push('-');
    const rawMetric = cells.slice(0, 15);
    const isPerfBreak = _ipoLbRowHasBreakPerformance(rawMetric);
    const slice = cells.slice(0, 15).map(c => _sanitizeNoImg(_dash(c)));
    const neg = r.fd != null && r.fd < 0;
    const code = String(r.code || '').replace(/[^0-9]/g, '');
    const tds = slice
      .map((disp, i) => {
        const sticky = i === 0 ? ' lb-td-sticky lb-td-col-name' : '';
        const align = i === 0 ? 'left' : 'right';
        const sectorCls = i === 2 ? ' lb-td-sector' : '';
        const fw =
          i === 0
            ? 'font-weight:700;color:var(--t1);'
            : i === 2
              ? ''
              : "font-family:'DM Mono',monospace;font-size:12px;color:var(--t2);";
        let inner = _lbEsc(disp);
        let dataOrderAttr = '';
        const ws = i === 2 ? 'normal' : 'nowrap';
        const va = i === 2 ? 'top' : 'middle';
        if (_LB_METRIC_BREAK_COLS.indexOf(i) >= 0) {
          const v = _ipoParseSignedMetric(rawMetric[i]);
          if (v != null && v < 0) {
            inner = `<span style="font-weight:700;color:#FF6900;font-family:'DM Mono',monospace;font-size:12px;">${_lbEsc(disp)}</span>`;
          }
        } else if (i === 0 && isPerfBreak) {
          inner = `<span style="display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;">${_lbEsc(
            disp,
          )}<span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:4px;font-weight:700;font-size:12px;line-height:1.3;color:#FF6900;background:rgba(255,105,0,.1);border:1px solid rgba(255,105,0,.2);">[破发]</span></span>`;
        } else if (i === 2) {
          let broad =
            r.sectorBroad != null && String(r.sectorBroad).trim() !== '' ? String(r.sectorBroad).trim() : '';
          let niche = r.sectorNiche != null ? String(r.sectorNiche).trim() : '';
          if (!broad && disp && disp !== '-') {
            const sp = _ipoSplitSectorCombined(disp);
            broad = sp.broad || disp;
            niche = sp.niche || '';
          }
          if (!broad) broad = disp && disp !== '-' ? disp : '—';
          const orderKey =
            r.sectorOrderKey != null && String(r.sectorOrderKey).trim() !== ''
              ? String(r.sectorOrderKey).trim()
              : broad;
          dataOrderAttr = ` data-order="${_lbEscAttr(orderKey)}"`;
          // 方案一升级：优先显示系统细分；无细分则显示原始大类；二者不一致则双标签
          if (niche) {
            if (broad && broad !== niche) {
              inner = `<div class="lb-sector-stack"><div style="font-weight:700;color:var(--t1);line-height:1.35;">${_lbEsc(
                niche,
              )}</div><div style="font-size:11px;color:#6b7280;line-height:1.35;margin-top:2px;">${_lbEsc(
                broad,
              )}</div></div>`;
            } else {
              inner = `<div class="lb-sector-stack"><div style="font-weight:700;color:var(--t1);line-height:1.35;">${_lbEsc(
                niche,
              )}</div></div>`;
            }
          } else {
            inner = `<div class="lb-sector-stack"><div style="font-weight:700;color:var(--t1);line-height:1.35;">${_lbEsc(
              broad,
            )}</div></div>`;
          }
        }
        return `<td class="${`${sticky}${sectorCls}`.trim()}"${dataOrderAttr} style="padding:10px 10px;border-bottom:1px solid var(--s3);font-size:12px;white-space:${ws};vertical-align:${va};text-align:${align};${fw}">${inner}</td>`;
      })
      .join('');
    const cls = 'lb-tr' + (neg ? ' lb-tr-neg' : '');
    const oc = code
      ? ` onclick="try{typeof openDrawer==='function'&&openDrawer('${code}')}catch(e){}"`
      : '';
    const breakAttr = isPerfBreak ? ' data-ipobreak="1"' : '';
    const secKey =
      r.sectorOrderKey != null && String(r.sectorOrderKey).trim() !== ''
        ? String(r.sectorOrderKey).trim()
        : r.sectorLabel != null
          ? String(r.sectorLabel)
          : '';
    return `<tr class="${cls}" data-rank="${r.lbRank}" data-fd="${r.fd != null ? r.fd : ''}" data-sk="${_lbEsc(
      r.sc,
    )}" data-sector-key="${_lbEsc(secKey)}" data-month="${r.mth != null ? r.mth : ''}" data-over="${
      r.over != null ? r.over : ''
    }" data-cum="${r.cum != null && Number.isFinite(r.cum) ? String(r.cum) : ''}" data-list-ms="${
      r.listMs != null && Number.isFinite(r.listMs) ? String(r.listMs) : ''
    }"${breakAttr}${oc}>${tds}</tr>`;
  }

  const modesNumericNoDivider = {
    default: true,
    fd: true,
    over: true,
    dark: true,
    darkLot: true,
    listProfit: true,
    cum: true,
  };

  let bodyInner = '';
  if (m === 'sector') {
    const by = {};
    mapped.forEach(r => {
      const k =
        r.sectorOrderKey != null && String(r.sectorOrderKey).trim() !== ''
          ? String(r.sectorOrderKey).trim()
          : r.sectorLabel != null
            ? String(r.sectorLabel)
            : '—';
      if (!by[k]) by[k] = [];
      by[k].push(r);
    });
    const keys = Object.keys(by).sort((a, b) => by[b].length - by[a].length);
    let rank = 1;
    keys.forEach(k => {
      by[k].sort((p, q) => _lbCmpRows(p, q, 'default'));
      bodyInner += _lbGroupHdrRow2026(k, `${by[k].length}只`);
      by[k].forEach(row => {
        bodyInner += rowHtml({ ...row, lbRank: rank++ });
      });
    });
  } else if (m === 'month') {
    const sorted = mapped.slice().sort((a, b) => _lbCmpRows(a, b, 'month'));
    let rank = 1;
    let lastYmKey = null;
    sorted.forEach(r => {
      const yk = _ipoYmKey(r.listMs);
      const label = _ipoYmLabelFromMs(r.listMs);
      if (yk !== lastYmKey) {
        bodyInner += _lbGroupHdrRow2026(label, null);
        lastYmKey = yk;
      }
      bodyInner += rowHtml({ ...r, lbRank: rank++ });
    });
  } else if (modesNumericNoDivider[m]) {
    const sorted = mapped.slice().sort((a, b) => _lbCmpRows(a, b, m));
    bodyInner = sorted.map((r, idx) => rowHtml({ ...r, lbRank: idx + 1 })).join('');
  } else {
    const sorted = mapped.slice().sort((a, b) => _lbCmpRows(a, b, 'default'));
    bodyInner = sorted.map((r, idx) => rowHtml({ ...r, lbRank: idx + 1 })).join('');
  }

  const thead =
    '<thead><tr>' +
    _LB_HEADERS.map((h, i) => {
      const cls =
        i === 0 ? 'lb-sth lb-sth-col-name' : i === 2 ? 'lb-th-r lb-th-sector' : 'lb-th-r';
      return `<th class="${cls}">${_lbEsc(h)}</th>`;
    }).join('') +
    '</tr></thead>';

  wrap.innerHTML = `<table id="ipo-table-2026" class="lb-table" style="width:max-content;min-width:1500px !important;border-collapse:separate;border-spacing:0;white-space:nowrap;">${thead}<tbody id="lb-tbody">${bodyInner}</tbody></table>`;

  console.log(
    '%c🔥 渲染流程已走完，当前 tbody 实际行数: ' + document.querySelectorAll('tbody tr').length,
    'font-size:18px;font-weight:bold;color:#dc2626;',
  );

  if (typeof window.renderIpoLbBreakGuide === 'function') {
    try {
      window.renderIpoLbBreakGuide();
    } catch (e) {
      console.warn('[IPO LB] renderIpoLbBreakGuide', e);
    }
  }
}

function _patchLeaderboardRenderer() {
  ensureIpo2026LbRiskTagStyles();
  if (typeof window.renderLbRowsFromIpoHomeMapped !== 'function') return;
  if (window.__IPO_LB_INNERHTML_PATCHED__) return;
  window.__IPO_LB_INNERHTML_PATCHED__ = true;
  window.renderLbRowsFromIpoHomeMapped = function renderLbRowsFromIpoHomeMapped(mapped, mode) {
    __ipoRenderLeaderboardInnerHTML(mapped, mode);
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(_patchLeaderboardRenderer, 0);
  });
} else {
  setTimeout(_patchLeaderboardRenderer, 0);
}
window.addEventListener('load', _patchLeaderboardRenderer);

function _waitDomReady() {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    document.addEventListener('DOMContentLoaded', resolve, { once: true });
  });
}

async function fetchSingleTabCsv(tabKey, gid) {
  const ov = window.__IPO_SHEET_CSV_OVERRIDE__ || {};
  let url;
  if (typeof ov[tabKey] === 'string' && ov[tabKey].trim()) {
    url = ov[tabKey].trim();
    url += (url.indexOf('?') >= 0 ? '&' : '?') + `t=${Date.now()}`;
  } else {
    const base = _getPublishBase();
    const t = Date.now();
    url = `${base}?gid=${gid}&single=true&output=csv&t=${t}&tab=${encodeURIComponent(tabKey)}&_=${Math.random()
      .toString(36)
      .slice(2, 9)}`;
  }
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    mode: 'cors',
    credentials: 'omit',
    redirect: 'follow',
    headers: { Pragma: 'no-cache', 'Cache-Control': 'no-cache' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} · ${String(text).slice(0, 160)}`);
  }
  const head = String(text).trim().slice(0, 512);
  if (head.startsWith('<') || /<!DOCTYPE/i.test(head)) {
    throw new Error(
      '返回了网页而不是 CSV：请打开 Google 表格 → 文件 → 共享 → 发布到网络 → 发布，并把 window.__IPO_SHEET_CONFIG__.publishBase 设为链接里的 …/pub 地址。',
    );
  }
  return text;
}

async function _parseCsv(text) {
  if (typeof Papa === 'undefined') throw new Error('PapaParse 未加载');
  if (text == null || text === '') throw new Error('CSV 为空');
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => _normKey(h),
      complete: result => resolve(result),
      error: err => reject(err),
    });
  });
}

/**
 * 「上市新股」表可能是宽表转置：第1列=字段名，第2列起每列为一只标的（见发布 CSV gid=63719317）。
 * 与常规「一行一标的」自动区分。
 */
function _isIpoListTransposedMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2) return false;
  const a = _normKey(matrix[0] && matrix[0][0]);
  const b = _normKey(matrix[1] && matrix[1][0]);
  return a === '股票名称' && b === '股票代码';
}

function _pivotIpoListTransposedToRows(matrix) {
  const fieldLabels = [];
  for (let i = 0; i < (matrix || []).length; i++) {
    const r = matrix[i];
    if (!r) continue;
    const k = r[0] != null ? _normKey(String(r[0])) : '';
    if (k) fieldLabels.push(k);
  }
  const nRows = matrix.length;
  const nCols = Math.max(0, ...matrix.map(r => (Array.isArray(r) ? r.length : 0)));
  const out = [];
  for (let j = 1; j < nCols; j++) {
    const row = {};
    for (let i = 0; i < nRows; i++) {
      const r = matrix[i];
      if (!r) continue;
      const keyRaw = r[0] != null ? _normKey(String(r[0])) : '';
      if (!keyRaw) continue;
      const val = r[j] != null ? String(r[j]).trim() : '';
      row[keyRaw] = val;
    }
    if (Object.keys(row).some(k => String(row[k] || '').trim())) {
      out.push(row);
    }
  }
  return { rows: out, fieldLabels };
}

async function _parseIpoListCsvMaybeTransposed(text) {
  if (typeof Papa === 'undefined') throw new Error('PapaParse 未加载');
  if (text == null || text === '') throw new Error('CSV 为空');
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: false,
      skipEmptyLines: true,
      complete: result => {
        try {
          const matrix = result.data || [];
          if (_isIpoListTransposedMatrix(matrix)) {
            const { rows: data, fieldLabels } = _pivotIpoListTransposedToRows(matrix);
            if (typeof window !== 'undefined') {
              window.__IPO_LISTED_FIELD_LABELS__ = fieldLabels;
            }
            const fields = data[0] ? Object.keys(data[0]) : [];
            resolve({ data, meta: { fields }, errors: result.errors || [] });
          } else {
            _parseCsv(text)
              .then(parsed => {
                if (typeof window !== 'undefined' && parsed && parsed.meta && Array.isArray(parsed.meta.fields)) {
                  window.__IPO_LISTED_FIELD_LABELS__ = parsed.meta.fields;
                }
                return resolve(parsed);
              })
              .catch(reject);
          }
        } catch (e) {
          reject(e);
        }
      },
      error: err => reject(err),
    });
  });
}

function _mergeThreeSheetsByCodeForPerf(listedRows, darkRows, schedRows) {
  const darkMap = new Map();
  (darkRows || []).forEach(raw => {
    if (!_rowHasContent(raw)) return;
    const code = _extractStockCodeFromZh(raw);
    if (!code) return;
    darkMap.set(code, { ...(darkMap.get(code) || {}), ...raw });
  });
  const listedMap = new Map();
  (listedRows || []).forEach(raw => {
    if (!_rowHasContent(raw)) return;
    const code = _extractStockCodeFromZh(raw);
    if (!code) return;
    listedMap.set(code, { ...(listedMap.get(code) || {}), ...raw });
  });
  const nameToCode = new Map();
  darkMap.forEach((row, code) => {
    const n = _extractNameFromZh(row);
    if (n) nameToCode.set(n, code);
  });
  listedMap.forEach((row, code) => {
    const n = _extractNameFromZh(row);
    if (n) nameToCode.set(n, code);
  });
  const schedMap = new Map();
  (schedRows || []).forEach(raw => {
    if (!_rowHasContent(raw)) return;
    let code = _extractStockCodeFromZh(raw);
    if (!code) {
      const n = _extractNameFromZh(raw);
      if (n) code = nameToCode.get(n) || '';
    }
    if (!code) return;
    schedMap.set(code, { ...(schedMap.get(code) || {}), ...raw });
  });
  const allCodes = new Set([...darkMap.keys(), ...listedMap.keys(), ...schedMap.keys()]);
  const merged = [];
  allCodes.forEach(code => {
    merged.push({
      ...(schedMap.get(code) || {}),
      ...(listedMap.get(code) || {}),
      ...(darkMap.get(code) || {}),
    });
  });
  return merged;
}

function _rebuildPapaMetaFields(parsed) {
  const rows = parsed && parsed.data;
  if (!rows || !rows.length) return;
  parsed.meta = parsed.meta || {};
  parsed.meta.fields = Object.keys(rows[0]);
}

function _mapCsvRowFromZh(raw) {
  const row = { ...raw };
  row.name = raw['股票名称'] || raw['名称'] || '';
  row.code = _extractStockCodeFromZh(raw);
  row.sector = raw['板块'] || raw['行业板块'] || '';
  row.darkGain = raw['暗盘涨幅'] || '';
  row.ipoPrice =
    raw['招股价 (HKD)'] || raw['招股价(HKD)'] || raw['招股价'] || '';
  row.listingGain = raw['上市涨幅'] || raw['首日表现'] || '';
  row.profitPerLot = raw['一手赚 (HKD)'] || raw['一手赚(HKD)'] || raw['一手赚'] || '';
  row.darkDate = raw['暗盘时间'] || raw['暗盘日期'] || '';
  return row;
}

function _buildMasterFromRows(rows) {
  const mapped = (rows || []).map(_mapCsvRowFromZh).filter(r => String(r.code || '').trim());
  return mapped.map((r, idx) => {
    const c = String(r.code || '').match(/(\d{4,5})/);
    const code = c ? c[1].padStart(5, '0') : String(r.code).trim();
    const dark = r.darkDate || '';
    return {
      code,
      name: r.name || code,
      sector: r.sector || '—',
      status: /待上市/.test(String(r.darkGain || '')) || !String(r.darkGain || '').trim() ? 'grey_market' : 'listed',
      statusLabel:
        /待上市/.test(String(r.darkGain || '')) || !String(r.darkGain || '').trim() ? '即将上市' : '已更新',
      dates: { grey_market: dark || null, listing: null },
      performance: {
        ipoPrice: Number(String(r.ipoPrice || '').replace(/[^\d.]/g, '')) || null,
        darkPoolPct: (() => {
          const mm = String(r.darkGain || '').match(/([+-]?\d+(?:\.\d+)?)/);
          return mm ? Number(mm[1]) : null;
        })(),
        firstDayPct: (() => {
          const mm = String(r.listingGain || '').match(/([+-]?\d+(?:\.\d+)?)/);
          return mm ? Number(mm[1]) : null;
        })(),
        profitPerLot: Number(String(r.profitPerLot || '').replace(/[^\d.]/g, '')) || null,
      },
      _rowIndex: idx,
    };
  });
}

function _applyTierDataFromZhDarkRows(darkRows) {
  const data = (darkRows || []).map(_mapCsvRowFromZh).filter(r => String(r.code || '').trim());
  window.__IPO_DARK_PARSED_ROWS__ = data;
  if (typeof window.applyDarkTierFromRows === 'function') {
    window.applyDarkTierFromRows(data);
  }
}

function renderZhCsvTable() {}

function _destroySheetLoadingTips() {
  ['csv-loading-tip', 'cmp-loading'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

/**
 * IPO主页：不做日期筛选、不做表头行剔除，有内容的行全部映射；单行 try/catch 跳过。
 */
async function _buildIpoHomeLeaderboardMapped() {
  const home = window.__IPO_HOME_SHEET__;
  const rows = (home && home.rows) || [];

  if (!rows.length) {
    _publishIpoHomeLbMapped([]);
    return;
  }

  const list = rows.filter(_rowHasContent);

  let priceKey = null;
  let ipoKey = null;
  let cumKey = null;
  try {
    const sample = list[0] || {};
    priceKey = findColumnKey(sample, ['现价', '最新价', '現價']);
    ipoKey = findColumnKey(sample, ['招股价'], { exclude: /市值/ });
    cumKey = findColumnKey(sample, ['累计表现', '累计涨幅', '至今涨幅']);
  } catch (e) {
    console.warn('[IPO LB] 列探测失败', e);
  }

  const needCodes = [];
  try {
    list.forEach(row => {
      try {
        const code = _extractStockCodeFromZh(row);
        if (!code || !priceKey) return;
        if (_needsAutoFetchedPrice(row[priceKey])) needCodes.push(code);
      } catch (e) {}
    });
  } catch (e) {}

  const { map: livePriceMap } = await loadLiveData(needCodes);

  list.forEach(row => {
    try {
      const code = _extractStockCodeFromZh(row);
      if (!code || !priceKey) return;
      const c5 = code.padStart(5, '0');
      const before = row[priceKey];
      const beforeStr = before != null ? String(before).trim() : '';
      if (_needsAutoFetchedPrice(before)) {
        if (livePriceMap[c5] != null) row[priceKey] = String(livePriceMap[c5]);
        else row[priceKey] = beforeStr && !_needsAutoFetchedPrice(beforeStr) ? beforeStr : '';
      }
      if (cumKey && ipoKey) {
        const ipo = _parseMoneyNum(row[ipoKey]);
        const cur = _parseMoneyNum(row[priceKey]);
        if (ipo != null && ipo > 0 && cur != null && Number.isFinite(cur)) {
          const pct = ((cur - ipo) / ipo) * 100;
          row[cumKey] = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
        }
      }
    } catch (e) {}
  });

  const mapped = [];
  list.forEach((row, idx) => {
    try {
      const code = _extractStockCodeFromZh(row);
      const code5 = code ? code.padStart(5, '0') : '';

      const name = getColumnValue(row, ['股票名称', '名称', 'IPO名称']);
      const sectorMain = getColumnValue(row, ['行业板块', '板块', '行业']);
      const sr = _ipoResolveSectorBroadAndNiche(row, sectorMain);
      const sc = _inferSectorClass(`${sr.broad}${sr.niche ? ' ' + sr.niche : ''}`);
      const listDateRaw = _getListingDateRaw(row);
      const listMs = _listDateToMs(listDateRaw);
      const listMsSafe = listMs != null && Number.isFinite(listMs) ? listMs : null;

      const lot = getColumnValue(row, ['每手手数', '每手股数', '手数', '每手']);
      const ipo = getColumnValue(row, ['招股价'], { exclude: /市值/ });
      const entry = getColumnValue(row, ['每手金额', '入场费', '一手金额', '每手认购额']);
      const listPrice = getColumnValue(row, ['上市价', '定价', '发行价']);
      const over = getColumnValue(row, ['超额倍数', '超购', '孖展倍数', '认购倍数']);
      const cur = priceKey ? _cleanCellValue(row[priceKey]) || '' : getColumnValue(row, ['现价', '最新价', '現價']);
      const darkP = getColumnValue(row, ['暗盘表现', '暗盘涨幅', '暗盘涨跌幅']);
      const darkLot = getColumnValue(row, ['暗盘一手赚', '暗盘一手赚(HKD)', '暗盘一手赚 (HKD)', '暗盘每手赚']);
      const listProfit = getColumnValue(row, ['上市一手赚', '首日一手赚', '上市每手赚']);
      const fdRaw = getColumnValue(row, ['首日表现', '上市涨幅', '首日涨幅']);
      const hitRateRaw = getColumnValue(row, [
        '一手中签率',
        '中签率',
        '甲组中签率',
        '公开招股中签率',
        '认购中签率',
      ]);

      let cumVal = null;
      if (cumKey && row[cumKey] != null && String(row[cumKey]).trim() !== '') {
        cumVal = _parsePercentNum(row[cumKey]);
      }
      if ((cumVal == null || !Number.isFinite(cumVal)) && ipoKey && priceKey) {
        const ip = _parseMoneyNum(row[ipoKey]);
        const cu = _parseMoneyNum(row[priceKey]);
        if (ip != null && cu != null && ip > 0) cumVal = ((cu - ip) / ip) * 100;
      }

      const overNum = _parseOversub(over);
      const fdVal = _parsePercentNum(fdRaw);
      const hitRatePct = _ipoParseHitRatePct(hitRateRaw);
      const darkLotHkd = _parseMoneyNum(darkLot);
      const listProfitHkd = _parseMoneyNum(listProfit);

      const sectorCellPlain = sr.niche ? `${sr.broad} · ${sr.niche}` : sr.broad;

      mapped.push({
        lbRank: mapped.length + 1,
        code: code5,
        sc,
        stockName: name || '',
        sectorLabel: sectorCellPlain || '—',
        sectorBroad: sr.broad,
        sectorNiche: sr.niche || '',
        sectorOrderKey: sr.sectorOrder,
        listMs: listMsSafe,
        cum: cumVal != null && Number.isFinite(cumVal) ? cumVal : null,
        over: overNum != null && Number.isFinite(overNum) ? overNum : null,
        fd: fdVal != null && Number.isFinite(fdVal) ? fdVal : null,
        hitRatePct: hitRatePct != null && Number.isFinite(hitRatePct) ? hitRatePct : null,
        darkLotHkd,
        listProfitHkd,
        mth: listMsSafe ? new Date(listMsSafe).getMonth() + 1 : '',
        cells: [
          _dash(_sanitizeNoImg(name)),
          _dash(_sanitizeNoImg(code5 ? `${code5}.HK` : '')),
          _dash(_sanitizeNoImg(sectorCellPlain)),
          _dash(_sanitizeNoImg(listDateRaw)),
          _dash(_sanitizeNoImg(lot)),
          _dash(_sanitizeNoImg(ipo)),
          _dash(_sanitizeNoImg(entry)),
          _dash(_sanitizeNoImg(listPrice)),
          _dash(_sanitizeNoImg(over)),
          _dash(_sanitizeNoImg(cur)),
          _dash(_sanitizeNoImg(darkP)),
          _dash(_sanitizeNoImg(darkLot)),
          _dash(_sanitizeNoImg(fdRaw)),
          _dash(_sanitizeNoImg(listProfit)),
          _fmtCumPct(cumVal),
        ],
      });
    } catch (err) {
      console.warn('[IPO LB] 跳过一行映射', idx, err);
    }
  });

  mapped.forEach((r, i) => {
    r.lbRank = i + 1;
  });

  _publishIpoHomeLbMapped(mapped);
  console.log('[IPO LB] IPO主页行→映射', mapped.length, '（无日期过滤）');
  updateIpoHomeLeaderboardStatCards();
}

window.renderLeaderboardNow = function renderLeaderboardNow() {
  _patchLeaderboardRenderer();
  if (typeof window.renderLbRows !== 'function') {
    console.warn('[IPO LB] renderLbRows 未定义');
    return;
  }
  const perf =
    typeof window.PERF_ALL !== 'undefined' && window.PERF_ALL && typeof window.PERF_ALL.slice === 'function'
      ? window.PERF_ALL.slice()
      : [];
  try {
    window.renderLbRows(perf);
  } catch (e) {
    console.warn('[IPO LB] renderLeaderboardNow', e);
  }
  updateIpoHomeLeaderboardStatCards();
  try {
    const lbSel = document.getElementById('ipo-lb-sort-2026');
    const cur = window.__IPO_LB_SORT_MODE__ || 'default';
    if (lbSel) lbSel.value = cur;
  } catch (e) { /* noop */ }
};

window.fetchMasterDataFromSheet = async function fetchMasterDataFromSheet() {
  await _waitDomReady();
  _patchLeaderboardRenderer();
  window.__IPO_LB_DYNAMIC_ACTIVE__ = false;

  let _ipoSheetFetchSucceeded = true;

  try {
    if (typeof Papa === 'undefined') throw new Error('PapaParse 未加载');

    if (location.protocol === 'file:') {
      console.error(
        '[IPO Sheet] 当前为 file:// 打开页面，部分浏览器会拦截对 Google 表格的请求。请用本地服务器打开（例如：python3 -m http.server 或 npx serve），再刷新。',
      );
    }

    window.__IPO_DEFAULT_PREVIEW_YMD__ = typeof window.__ipoBeijingYmd === 'function' ? window.__ipoBeijingYmd() : window.__ipoUtcYmdIso();

    const G = _getGids();
    window.__IPO_SHEET_ACTIVE_PUBLISH_BASE__ = _getPublishBase();
    window.__IPO_SHEET_ACTIVE_GIDS__ = { ...G };
    console.log('[IPO Sheet] 使用发布基址:', window.__IPO_SHEET_ACTIVE_PUBLISH_BASE__, 'IPO主页 gid:', G.ipoHome);

    const tabs = [
      { key: 'ipoHome', gid: G.ipoHome, label: _TAB_LABEL.ipoHome },
      { key: 'listed', gid: G.listed, label: _TAB_LABEL.listed },
      { key: 'dark', gid: G.dark, label: _TAB_LABEL.dark },
      { key: 'schedule', gid: G.schedule, label: _TAB_LABEL.schedule },
    ];

    if (typeof window.showIpoListedLoading === 'function') {
      try {
        /* 提示节点 id=loading-status 由 showIpoListedLoading 注入 #listed-stocks，见 index 旁注；V9 在 finally 中隐藏或改失败文案 */
        window.showIpoListedLoading('正在从 Google 表格拉取数据…');
      } catch (e) {
        /* noop */
      }
    }

    const results = await Promise.all(
      tabs.map(async def => {
        try {
          const text = await fetchSingleTabCsv(def.key, def.gid);
          const parsed =
            def.key === 'listed' ? await _parseIpoListCsvMaybeTransposed(text) : await _parseCsv(text);
          const rawRows = parsed.data || [];
          const rows =
            def.key === 'ipoHome'
              ? rawRows.filter(_rowHasContent)
              : rawRows.filter(_rowHasContent).filter(r => !_rowLooksLikeCsvHeaderDuplicate(r));
          const fields = (parsed.meta && parsed.meta.fields) || (rows[0] ? Object.keys(rows[0]) : []);
          const n = rows.length;
          const first = rows[0] || null;
          const nameStr = _firstRowStockNameZh(first);
          console.log(`页签 [${def.label}] 已成功加载 ${n} 行数据，第一行股票名为：${nameStr}`);
          return { key: def.key, label: def.label, rows, fields, parsed, ok: true };
        } catch (e) {
          console.error(`[IPO Sheet] 页签「${def.label}」CSV 拉取/解析失败`, e);
          return { key: def.key, label: def.label, rows: [], fields: [], parsed: { data: [], meta: { fields: [] } }, ok: false, err: e };
        }
      }),
    );

    const byKey = Object.fromEntries(results.map(r => [r.key, r]));
    const home = byKey.ipoHome;
    const listed = byKey.listed;

    // V11: 上市新股详情卡 UI 与双源数据在 ipo-google-sheet.js（rowToIpoDisplayModel、v11EnrichBullBearFromAI），表格：63719317
    // 「有无绿鞋」展示/着色：ipo-google-sheet.js _v11ParseGreenShoeForDetail + switchIpoTabFromSheetModel（本文件无 display:none 隐藏该格）
    // 详情 2×4 阵列：行业/招股价/一手入场费/A+H、招股期/发行机制/绿鞋/基石 — 由 ipo-google-sheet rowToIpoDisplayModel 映射「上市新股」表列；index.html 静态回退为 _buildStaticIpoDetailGrid8
    if (typeof window.__ipoProcessListedSheetRows === 'function' && listed && listed.ok) {
      try {
        await window.__ipoProcessListedSheetRows(listed);
      } catch (e) {
        console.warn('[IPO Sheet] 上市新股行处理', e);
      }
    }
    const dark = byKey.dark;
    const sched = byKey.schedule;

    window.__IPO_HOME_SHEET__ = {
      headers: home.fields || [],
      rows: home.rows || [],
    };
    window.__IPO_LISTED_SHEET_ROWS__ = listed.rows || [];
    if (typeof window.ipoCalcRefreshStockList === 'function') {
      try {
        window.ipoCalcRefreshStockList();
      } catch (e) {
        console.warn('[IPO Calc] 刷新打新资金分配器标的', e);
      }
    }
    window.__IPO_DARK_SHEET_ROWS__ = dark.rows || [];
    window.__IPO_SCHEDULE_SHEET_ROWS__ = sched.rows || [];

    const pub = _getPublishBase();
    window.__IPO_SHEET_CSV_URLS = {
      ipoHome: `${pub}?gid=${G.ipoHome}&single=true&output=csv&t=${Date.now()}`,
      listed: `${pub}?gid=${G.listed}&single=true&output=csv&t=${Date.now()}`,
      dark: `${pub}?gid=${G.dark}&single=true&output=csv&t=${Date.now()}`,
      schedule: `${pub}?gid=${G.schedule}&single=true&output=csv&t=${Date.now()}`,
    };

    window.__IPO_GREY_RECENT_CSV_HEADERS__ = (dark.fields && dark.fields.length ? dark.fields : dark.rows[0] ? Object.keys(dark.rows[0]) : []).map(_normKey);
    window.__IPO_GREY_RECENT_SOURCE_ROWS__ = (dark.rows || []).map(r => ({ ...r }));

    const unifiedForPerf = _mergeThreeSheetsByCodeForPerf(listed.rows, dark.rows, sched.rows);
    const parsed = {
      data: unifiedForPerf,
      meta: { fields: unifiedForPerf.length ? Object.keys(unifiedForPerf[0]) : [] },
      errors: [],
    };
    _rebuildPapaMetaFields(parsed);

    window.__IPO_SHEET_MERGE_STATS__ = {
      ipoHome: (home.rows || []).length,
      listed: (listed.rows || []).length,
      dark: (dark.rows || []).length,
      schedule: (sched.rows || []).length,
      mergedPerf: unifiedForPerf.length,
    };
    window.__IPO_LAST_SHEET_SYNC_AT__ = Date.now();

    await _buildIpoHomeLeaderboardMapped();
    if (!(home.rows && home.rows.length)) {
      console.error(
        '[IPO Sheet] IPO主页 无数据行。若你使用自己的表格，请在 index.html 里设置 window.__IPO_SHEET_CONFIG__ = { publishBase: "你的发布链接…/pub", gids: { ipoHome: 工作表gid } }；并确认已「发布到网络」。',
      );
    }
    _destroySheetLoadingTips();
    if (typeof window.renderLeaderboardNow === 'function') window.renderLeaderboardNow();

    if (typeof window.applyIpoGoogleSheetParsed === 'function') {
      let ok = !!window.applyIpoGoogleSheetParsed(parsed);
      if (!ok) {
        const fb = _buildMasterFromRows(unifiedForPerf);
        if (fb.length) {
          window.MASTER_IPO_LIST = fb;
          ok = true;
        }
      }
      if (ok) {
        _applyTierDataFromZhDarkRows(dark.rows);
      }
    }

    if (typeof window.renderLeaderboardNow === 'function') {
      window.renderLeaderboardNow();
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => window.renderLeaderboardNow());
      }
    }

    return true;
  } catch (e) {
    _ipoSheetFetchSucceeded = false;
    console.warn('[IPO Sheet] fetchMasterDataFromSheet', e);
    _destroySheetLoadingTips();
    return false;
  } finally {
    const loadingStatus = document.getElementById('loading-status');
    if (loadingStatus) {
      if (_ipoSheetFetchSucceeded) {
        loadingStatus.style.display = 'none';
        // V9: Auto-hide loading status
      } else {
        loadingStatus.textContent = '加载失败，请重试';
        loadingStatus.style.display = 'block';
        loadingStatus.style.color = '#b91c1c';
        loadingStatus.style.borderColor = 'rgba(220,38,38,.5)';
        loadingStatus.style.background = 'rgba(220,38,38,.06)';
        // V9: Auto-hide loading status
      }
    }
  }
};

window.refreshIpoHomeLeaderboard = async function refreshIpoHomeLeaderboard() {
  await _buildIpoHomeLeaderboardMapped();
  _destroySheetLoadingTips();
  if (typeof window.renderLeaderboardNow === 'function') window.renderLeaderboardNow();
};

window.buildIpoSheetCsvUrls = function buildIpoSheetCsvUrls() {
  const t = Date.now();
  const pub = _getPublishBase();
  const g = _getGids();
  window.IPO_SHEET_CSV_URLS = {
    ipoHome: `${pub}?gid=${g.ipoHome}&single=true&output=csv&t=${t}`,
    listed: `${pub}?gid=${g.listed}&single=true&output=csv&t=${t}`,
    dark: `${pub}?gid=${g.dark}&single=true&output=csv&t=${t}`,
    schedule: `${pub}?gid=${g.schedule}&single=true&output=csv&t=${t}`,
  };
  return window.IPO_SHEET_CSV_URLS;
};
buildIpoSheetCsvUrls();

window.setMasterIpoList = function setMasterIpoList(rows) {
  if (!Array.isArray(rows)) return;
  window.MASTER_IPO_LIST = rows;
  if (typeof window.applyMasterListToCalendar === 'function') {
    window.applyMasterListToCalendar();
  }
};

window.applyExternalLiveData = function applyExternalLiveData() {
  if (typeof window.mergeExternalLiveIntoMasterAndPerf === 'function') {
    window.mergeExternalLiveIntoMasterAndPerf();
  }
  if (typeof window.refreshIpoViewsFromMaster === 'function') {
    window.refreshIpoViewsFromMaster();
  }
};

window.refreshIpoViewsFromMaster = function refreshIpoViewsFromMaster() {
  if (typeof window.rerenderAllIpoViews === 'function') {
    window.rerenderAllIpoViews();
  }
};

(function _ipoScheduleLoadStockQuotes() {
  setTimeout(() => {
    if (typeof window.loadStockQuotes !== 'function') return;
    window.loadStockQuotes().catch(e => console.warn('[IPO Live] loadStockQuotes', e));
  }, 1000);
})();

/** 与涨幅榜 tbody 一致的 15 列，供破发判定复用 */
function _ipoLbRowCells15(r) {
  const cells = Array.isArray(r && r.cells) ? r.cells.slice() : [];
  while (cells.length < 15) cells.push('-');
  return cells;
}

function _ipoStockDisplayName(name) {
  let s = String(name || '').trim();
  if (!s) return '—';
  s = s.replace(/股份有限公司|有限公司|集团控股|控股有限公司/g, '');
  return s.trim() || String(name).trim();
}

function _ipoLbStrHash(s) {
  const t = String(s || '');
  let h = 0;
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 模拟「全网投研语料库」：非真实 API，由列表字段确定性映射专业表述，用于避坑指南扩写。
 * 术语覆盖：簿记/回拨、基石、流动性溢价、AH 分流、社媒情绪、保荐声誉、估值锚等。
 */
const IPO_LB_WEB_INSIGHT_BANK = {
  sponsorOverheat:
    '招股窗口对保荐团队历史新股表现的争议抬升，卖方亦提示情绪簿记抬高发行市盈率、稀释估值锚，簿记上沿定价更易脱离可验证盈利。',
  socialSkewHot:
    '申购端呈现讨论热度与获配均匀度背离：散户侧参与度高但筹码结构失衡，首日更易叠加被动兑现与恐慌抛售。',
  socialSkewCold:
    '「易中签」与认购清淡并存，反映配置型需求不足；上市后流动性溢价快速收敛，与一级隐含假设剪刀差扩大。',
  peerAshareDrain: peer =>
    `行业比较窗口内，「${peer}」等在A股融资与定价环节交易拥挤，港股增量资金被阶段性分流，本股相对配置权重承压。`,
  cornerstoneThin:
    '配售条款显示基石占比与锁定期偏保守，削弱对簿记上沿的价格背书，首日定价向二级市场均衡回归的弹性偏大。',
  macroLiquidity:
    '港元流动性预期边际收紧，IPO 风险溢价中枢上移，高估值发行面临系统性逆风。',
  genericRisk:
    '市场对孖息成本与回拨条款敏感度上行，与首日定价修正路径形成闭环，簿记质量需用暗盘深度与首日 VWAP 反向校验。',
  pricingTrap:
    '典型「簿记上沿+高回拨」定价陷阱：二级市场承接曲线在首日即承压，戴维斯双杀式修正概率抬升。',
  liquiditySqueeze:
    '暗盘与首日成交量呈流动性挤压形态，与情绪驱动申购、理性资金观望的二元结构一致。',
};

const IPO_LB_PEER_POOL = [
  '科创板可比龙头',
  'A 股同业指数权重股',
  '细分赛道 Pre-IPO 龙头',
  '产业链核心零部件标的',
  '南向重仓 AH 可比公司',
  '行业龙头 H 股',
  '同赛道未盈利科技标杆',
];

function _ipoLbPickPeerLabel(row) {
  const seed = `${row.sectorBroad || ''}${row.sectorNiche || ''}${row.code || ''}`;
  return IPO_LB_PEER_POOL[_ipoLbStrHash(seed) % IPO_LB_PEER_POOL.length];
}

function _ipoLbSectorSuggestsPeerDrain(row) {
  const t = `${row.sectorBroad || ''}${row.sectorNiche || ''}${row.sectorLabel || ''}`;
  return /半导体|芯片|AI|人工智能|医疗|医药|新能源|锂电|汽车|消费电子|软件|云计算/i.test(t);
}

/** 单行破发原因摘要（与首行「简称 · 破发原因」中的正文对应） */
function generateWebScaleCoreLine(row, ctx) {
  const cells = _ipoLbRowCells15(row);
  const over = row.over;
  const fd = row.fd;
  const cum = row.cum;
  const hit = row.hitRatePct;
  const darkLot = row.darkLotHkd != null ? row.darkLotHkd : _parseMoneyNum(cells[11]);
  const listP = row.listProfitHkd != null ? row.listProfitHkd : _parseMoneyNum(cells[13]);
  const lotVals = [darkLot, listP].filter(v => v != null && Number.isFinite(v));
  const minLot = lotVals.length ? Math.min(...lotVals) : null;
  const overBreak = over != null && Number.isFinite(over) && over > 100 && fd != null && fd < 0;
  const hitHot =
    over != null &&
    Number.isFinite(over) &&
    over >= 400 &&
    fd != null &&
    fd < 0 &&
    (hit == null || (Number.isFinite(hit) && hit < 12));
  const hitCold =
    (hit != null && Number.isFinite(hit) && hit >= 15) ||
    (hit == null && over != null && Number.isFinite(over) && over < 15 && fd != null && fd < 0);
  const lotExtreme = minLot != null && minLot < -600;
  const cumWeak = cum != null && Number.isFinite(cum) && cum < -8;

  if (overBreak && lotExtreme) return '高回拨+乙组抛压+定价透支，一级未给二级留水位。';
  if (overBreak) return '超高认购触发回拨与筹码分散，首日承接意愿不足。';
  if (hitHot) return '申购热度与获配结构错配，首日易演化为兑现踩踏。';
  if (hitCold) return '高中签暴露真实需求偏弱，上市后流动性溢价迅速蒸发。';
  if (lotExtreme) return '每手深度亏损揭示发行价相对均衡价过高。';
  if (cumWeak) return '累计走弱确立阴跌路径，基本面叙事难支撑定价。';
  return '暗盘或首日定价与风险溢价错配，抛压释放快于承接修复。';
}

/**
 * 深度段落：【代码+简称】+ 成因链条 + 列表数据核对 + 避坑结论（不含首行「简称 · 破发原因」）。
 * @param {object} row
 * @param {{ breakRows: object[] }} ctx
 */
function generateWebScaleAnalysis(row, ctx) {
  const cells = _ipoLbRowCells15(row);
  const code5 = String(row.code || '')
    .replace(/\D/g, '')
    .padStart(5, '0');
  const displayName = _ipoStockDisplayName(row.stockName);
  const over = row.over;
  const fd = row.fd;
  const cum = row.cum;
  const hit = row.hitRatePct;
  const darkLot = row.darkLotHkd != null ? row.darkLotHkd : _parseMoneyNum(cells[11]);
  const listP = row.listProfitHkd != null ? row.listProfitHkd : _parseMoneyNum(cells[13]);
  const darkPct = _ipoParseSignedMetric(cells[10]);
  const lotVals = [darkLot, listP].filter(v => v != null && Number.isFinite(v));
  const minLot = lotVals.length ? Math.min(...lotVals) : null;

  const overBreak = over != null && Number.isFinite(over) && over > 100 && fd != null && fd < 0;
  const hitHot =
    over != null &&
    Number.isFinite(over) &&
    over >= 400 &&
    fd != null &&
    fd < 0 &&
    (hit == null || (Number.isFinite(hit) && hit < 12));
  const hitCold =
    (hit != null && Number.isFinite(hit) && hit >= 15) ||
    (hit == null && over != null && Number.isFinite(over) && over < 15 && fd != null && fd < 0);
  const lotExtreme = minLot != null && minLot < -600;
  const cumWeak = cum != null && Number.isFinite(cum) && cum < -8;

  const ext = [];
  if (overBreak) ext.push(IPO_LB_WEB_INSIGHT_BANK.sponsorOverheat);
  if (_ipoLbSectorSuggestsPeerDrain(row)) {
    ext.push(IPO_LB_WEB_INSIGHT_BANK.peerAshareDrain(_ipoLbPickPeerLabel(row)));
  }
  if (hitHot) ext.push(IPO_LB_WEB_INSIGHT_BANK.socialSkewHot);
  else if (hitCold) ext.push(IPO_LB_WEB_INSIGHT_BANK.socialSkewCold);
  if (overBreak && (lotExtreme || (cum != null && cum < -5))) ext.push(IPO_LB_WEB_INSIGHT_BANK.cornerstoneThin);
  if (overBreak && lotExtreme) ext.push(IPO_LB_WEB_INSIGHT_BANK.pricingTrap);
  if (darkPct != null && darkPct < 0) ext.push(IPO_LB_WEB_INSIGHT_BANK.liquiditySqueeze);
  if (ext.length < 2) ext.push(IPO_LB_WEB_INSIGHT_BANK.genericRisk);
  if (ctx && Array.isArray(ctx.breakRows) && ctx.breakRows.length >= 4) ext.push(IPO_LB_WEB_INSIGHT_BANK.macroLiquidity);

  const extText = [...new Set(ext)].slice(0, 2).join('');

  const overTxt = over != null && Number.isFinite(over) ? `超额认购约${Math.round(over)}倍` : '超购数据待核对';
  const fdTxt = fd != null && Number.isFinite(fd) ? `首日表现约${fd.toFixed(1)}%` : '首日表现偏弱';
  const cumTxt =
    cum != null && Number.isFinite(cum) ? `累计表现约${cum.toFixed(1)}%` : '累计表现待结合现价重估';
  const lotTxt =
    minLot != null && Number.isFinite(minLot)
      ? `暗盘/上市每手盈亏约${Math.round(minLot)}港元`
      : '每手盈亏需对照暗盘与上市列';
  const hitTxt =
    hit != null && Number.isFinite(hit) ? `一手中签率约${hit.toFixed(1)}%` : '中签率未在表中披露';
  const internal = `与列表字段交叉核对：${overTxt}；${fdTxt}；${cumTxt}；${hitTxt}；${lotTxt}。上述指标与逻辑链条相互对照，避免单一指标误判。`;

  let conclusion =
    '避坑结论：保荐声誉、基石锁定期、回拨敏感度与同业估值带四轴交叉验证；情绪型超购标的默认下调仓位并拉长观察窗。';
  if (overBreak && lotExtreme) {
    conclusion =
      '避坑结论：典型「高回拨+薄水位」组合，同类标的应回避簿记上沿定价，并要求基石与绿鞋对二级留出安全边际。';
  }
  if (hitCold && !overBreak) {
    conclusion =
      '避坑结论：冷档发行须以流动性折价补偿为前提；无明确估值折扣与长线锁仓时，不宜仅凭「易中签」参与博弈。';
  }

  let body = `成因与链条：${extText}${internal}${conclusion}`;
  let full = `【${code5} ${displayName}】${body}`;
  if (full.length < 100) {
    full +=
      ' 建议将孖展截飞前资金费率、暗盘撮合深度与绿鞋行使空间纳入同一复盘框架，与自由流通市值比一并检视。';
  }
  if (full.length > 280) full = full.slice(0, 277) + '…';
  return full;
}

/** @deprecated 语义保留：与 generateWebScaleAnalysis 等价 */
function generateDeepAnalysis(row, ctx) {
  return generateWebScaleAnalysis(row, ctx);
}

function _buildIpoLbBreakCommonSummary(breakRows) {
  const sectorKeyOf = r =>
    (r.sectorOrderKey != null && String(r.sectorOrderKey).trim()) ||
    (r.sectorBroad != null && String(r.sectorBroad).trim()) ||
    '—';
  const bySector = {};
  breakRows.forEach(r => {
    const k = sectorKeyOf(r);
    bySector[k] = (bySector[k] || 0) + 1;
  });
  const heavyPlate = Object.keys(bySector)
    .filter(k => k && k !== '—' && bySector[k] >= 3)
    .sort((a, b) => bySector[b] - bySector[a])[0];
  const lines = [];
  if (heavyPlate) {
    lines.push(
      `• 当前有 ${bySector[heavyPlate]} 只及以上破发同属「${heavyPlate}」板块，近期该板块估值逻辑崩坏，一级定价假设与业绩兑现错配概率上升，宜压缩该板块新股市盈容忍度。`,
    );
  }
  const highOver = breakRows.filter(
    r => r.over != null && Number.isFinite(r.over) && r.over > 50,
  ).length;
  if (highOver >= 3) {
    lines.push(
      `• 其中 ${highOver} 只超购倍数仍显著高于 50 倍却破发，说明高倍数申购已成为破发风向标，应重点核查回拨、锁定期与基石占比，而非单纯追逐认购倍数。`,
    );
  }
  return lines;
}

/**
 * 从破发集合抽象「全网共性」关键词与金句（确定性规则，非真实爬网）。
 */
function _buildWebGlobalCommonReplay(breakRows) {
  const n = breakRows.length;
  if (!n) return [];
  const lines = [];
  const kw = [];

  const sectorKeyOf = r =>
    (r.sectorOrderKey != null && String(r.sectorOrderKey).trim()) ||
    (r.sectorBroad != null && String(r.sectorBroad).trim()) ||
    '—';
  const by = {};
  breakRows.forEach(r => {
    const k = sectorKeyOf(r);
    by[k] = (by[k] || 0) + 1;
  });
  const top = Object.keys(by).sort((a, b) => by[b] - by[a])[0];
  if (top && top !== '—' && by[top] >= 2) {
    kw.push('赛道拥挤', '板块估值逻辑');
    lines.push(
      `【关键词：${kw.slice(-2).join('·')}】${by[top]} 只破发在「${top}」赛道同向共振，指向一级市场对赛道β的过度贴现；避坑金句：同板块密集破发期，应下调赛道映射估值并拉长定价观察窗。`,
    );
  }

  const highOver = breakRows.filter(r => r.over != null && Number.isFinite(r.over) && r.over > 50).length;
  if (highOver >= 3 || (n >= 3 && highOver / n >= 0.5)) {
    kw.push('IPO定价陷阱', '高倍数申购');
    lines.push(
      `【关键词：IPO定价陷阱·高倍数申购】${highOver}/${n} 只标的呈现「超购仍破发」同构，反映簿记情绪与估值锚系统性偏离；避坑金句：高倍数申购已成为破发风向标，须以回拨/基石/锁定期三维穿透后再决策。`,
    );
  }

  const hitColdN = breakRows.filter(r => {
    const h = r.hitRatePct;
    return h != null && Number.isFinite(h) && h >= 15;
  }).length;
  if (hitColdN >= 2) {
    kw.push('基石投资者背景', '流动性枯竭');
    lines.push(
      `【关键词：基石投资者背景·流动性枯竭】多标的呈现高中签+破发组合，指向国际配售与零售端预期差；避坑金句：缺乏长线锁仓与基石背书时，勿将「易中签」误读为安全边际。`,
    );
  }

  const cumWeakN = breakRows.filter(r => r.cum != null && Number.isFinite(r.cum) && r.cum < -6).length;
  if (cumWeakN >= 2) {
    kw.push('宏观流动性紧缩', '阴跌路径');
    lines.push(
      `【关键词：宏观流动性紧缩·阴跌路径】累计表现走弱在样本中重复出现，与风险溢价抬升叙事一致；避坑金句：上市即巅峰的图谱下，优先回避缺乏盈利可见度的纯情绪发行。`,
    );
  }

  if (!lines.length) {
    lines.push(
      `【关键词：簿记质量·定价与承接】本批 ${n} 只破发共性集中于定价与承接错配；避坑金句：以暗盘深度、孖展费率与首日 VWAP 三件套，反向校验簿记区间合理性。`,
    );
  }

  return lines;
}

const IPO_LB_BREAK_GUIDE_ROOT_STYLE =
  'text-align:left!important;align-items:stretch!important;width:100%;display:flex;flex-direction:column;gap:14px;';

const IPO_LB_2026_RISK_TAG_STYLE_ID = 'ipo-lb-2026-risk-tags-css';

/** 仅 #ipo-2026-leaderboard-block：打新破发风险信号标签（半透明红底 + 警示色字 + 细边框） */
function ensureIpo2026LbRiskTagStyles() {
  if (document.getElementById(IPO_LB_2026_RISK_TAG_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = IPO_LB_2026_RISK_TAG_STYLE_ID;
  st.textContent = [
    '#tab-home #ipo-2026-leaderboard-block .ipo-lb-break-panel--risk .ipo-lb-risk-tags{',
    'display:flex!important;flex-wrap:wrap!important;gap:0!important;',
    'justify-content:flex-start!important;align-items:flex-start!important;',
    'text-align:left!important;margin:0!important;padding:0!important;',
    '}',
    '#tab-home #ipo-2026-leaderboard-block .ipo-lb-break-panel--risk .ipo-lb-risk-tag{',
    'box-sizing:border-box!important;display:inline-block!important;',
    'font-size:11px!important;font-weight:600!important;line-height:1.45!important;',
    'padding:4px 10px!important;border-radius:4px!important;text-align:left!important;',
    'color:#FF6900!important;background:rgba(255,105,0,.1)!important;',
    'border:1px solid rgba(255,105,0,.2)!important;',
    'margin:0 8px 8px 0!important;',
    '}',
  ].join('');
  document.head.appendChild(st);
}

/**
 * 破发原因总结区块：仅 #ipo-lb-break-guide-section；与 2026 涨幅榜同源数据；排序/重绘后由 __ipoRenderLeaderboardInnerHTML 与 updateIpoHomeLeaderboardStatCards 触发。
 */
function renderIpoLbBreakGuide() {
  ensureIpo2026LbRiskTagStyles();
  const wrap = document.getElementById('ipo-lb-break-guide-list');
  if (!wrap) return;

  const esc = s =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const rows = Array.isArray(window.__IPO_HOME_LB_MAPPED__) && window.__IPO_HOME_LB_MAPPED__.length
    ? window.__IPO_HOME_LB_MAPPED__
    : Array.isArray(window.allData)
      ? window.allData
      : [];

  const breakRows = rows.filter(r => r && _ipoLbRowHasBreakPerformance(_ipoLbRowCells15(r)));
  const ctx = { breakRows };

  if (!breakRows.length) {
    wrap.innerHTML = `<div style="font-size:11px;color:var(--t3);line-height:1.85;text-align:left!important;">当前 2026 新股涨幅榜中暂无被系统标记为破发（暗盘或首日表现为负）的标的。</div>`;
    return;
  }

  const itemsHtml = breakRows
    .map((r, idx) => {
      const coreLine = generateWebScaleCoreLine(r, ctx);
      const detail = generateWebScaleAnalysis(r, ctx);
      const stockLabel = _ipoStockDisplayName(r.stockName);
      const ord = `${idx + 1}.`;
      return `<div class="ipo-lb-break-item">
<span class="ipo-lb-break-idx">${esc(ord)}</span>
<div class="ipo-lb-break-reason-lead">【${esc(stockLabel)} · 破发原因】：${esc(coreLine)}</div>
<div class="ipo-lb-break-detail">${esc(detail)}</div>
</div>`;
    })
    .join('');

  const sumLines = _buildIpoLbBreakCommonSummary(breakRows);
  const summaryHtml =
    sumLines.length > 0
      ? `<div class="ipo-lb-break-subblock" style="text-align:left!important;">
<div class="ipo-lb-break-data-lead" style="font-size:0.95rem;font-weight:700;color:var(--t1);margin:0 0 10px;text-align:left!important;letter-spacing:.02em;">数据侧摘要</div>
${sumLines.map(l => `<div style="font-size:11px;color:var(--t2);line-height:1.85;margin-bottom:10px;text-align:left!important;">${esc(l)}</div>`).join('')}
</div>`
      : '';

  const webLines = _buildWebGlobalCommonReplay(breakRows);
  const webHtml = `<div class="ipo-lb-break-webreplay" style="text-align:left!important;">
<h3 class="ipo-lb-2026-sec-title ipo-lb-main-title">破发共性</h3>
${webLines.map(l => `<div style="font-size:11px;color:var(--t2);line-height:1.85;margin-bottom:10px;text-align:left!important;">${esc(l)}</div>`).join('')}
</div>`;

  wrap.innerHTML = `<div class="ipo-lb-break-guide-root" style="${IPO_LB_BREAK_GUIDE_ROOT_STYLE}">${itemsHtml}${summaryHtml}${webHtml}</div>`;
}

window.generateWebScaleAnalysis = generateWebScaleAnalysis;
window.generateWebScaleCoreLine = generateWebScaleCoreLine;
window.generateDeepAnalysis = generateDeepAnalysis;
window.renderIpoLbBreakGuide = renderIpoLbBreakGuide;
