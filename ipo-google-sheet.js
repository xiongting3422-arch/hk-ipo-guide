/**
 * Google 表格 CSV — 严格中文表头映射（与 PERF_ALL / CAL_STOCKS / STOCKS 协同）
 * 依赖：PapaParse、window.PERF_ALL / window.CAL_STOCKS / window.STOCKS
 */
(function () {
  'use strict';

  window.IPO_GOOGLE_SHEET_CSV_URL =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5R7a29N0wHqOVKXO7Dx016Z_DV0IQ5n16IaTMSPWF2QOqwqud1ViC1Llp0MFwZep8qMUGW_-9SCBU/pubhtml3';

  function normalizeGoogleSheetCsvUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return s;
    if (/\/pubhtml(?:\d*)?(?:\?.*)?$/i.test(s)) {
      const base = s.replace(/\/pubhtml(?:\d*)?(?:\?.*)?$/i, '/pub');
      return `${base}?output=csv`;
    }
    return s;
  }

  /** CSV 加载后与 ipo-live-data 一致：默认「今日」为北京时间 YYYY-MM-DD（可被 URL previewDate 覆盖） */
  window.__IPO_DEFAULT_PREVIEW_YMD__ =
    typeof window.__ipoBeijingYmd === 'function' ? window.__ipoBeijingYmd() : new Date().toISOString().slice(0, 10);

  function normHeader(h) {
    return String(h || '')
      .replace(/^\uFEFF/, '')
      .replace(/\t/g, '')
      .trim();
  }

  function parseStockCode(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/(\d{4,5})/);
    return m ? m[1].padStart(5, '0') : null;
  }

  function isPlaceholderCell(s) {
    return /抓取|数据源|待更新|无效|N\/A|富途数据源/i.test(String(s || ''));
  }

  function isPendingListing(s) {
    const t = String(s || '').trim();
    return !t || t === '—' || t === '-' || /^待上市$/i.test(t);
  }

  function parseOversub(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim().replace(/,/g, '');
    if (!s || s === '—' || s === '-') return null;
    const m = s.match(/([\d.]+)\s*×/i);
    if (m) return Math.round(parseFloat(m[1]) * 10) / 10;
    const n = parseFloat(s.replace(/[^\d.]/g, ''));
    return Number.isNaN(n) ? null : Math.round(n * 10) / 10;
  }

  function parseMoneyHkd(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    if (!s || s === '—' || s === '-') return null;
    if (isPlaceholderCell(s)) return null;
    const m = s.match(/[\d,]+(?:\.\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0].replace(/,/g, ''));
    return Number.isNaN(n) ? null : Math.round(n * 100) / 100;
  }

  function parsePercentSmart(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim().replace(/,/g, '');
    if (!s || s === '—' || s === '-') return null;
    if (isPlaceholderCell(s) || isPendingListing(s)) return null;
    if (/±0%|^0%$/i.test(s)) return 0;
    const pct = s.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
    if (pct) return Math.round(parseFloat(pct[1]) * 10) / 10;
    const n = parseFloat(s.replace(/[^\d.\-+]/g, ''));
    if (Number.isNaN(n)) return null;
    if (Math.abs(n) < 10 && /^\s*[+-]?\d+\.\d+\s*$/.test(s)) {
      return Math.round(n * 1000) / 10;
    }
    return Math.round(n * 10) / 10;
  }

  function parseDarkGainCell(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    if (!s || s === '—' || s === '-') return null;
    if (isPlaceholderCell(s) || isPendingListing(s) || /^待上市$/i.test(s)) return null;
    const pct = s.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
    if (pct) return Math.round(parseFloat(pct[1]) * 10) / 10;
    const n = parseFloat(s.replace(/[^\d.\-+]/g, ''));
    if (Number.isNaN(n)) return null;
    return Math.round(n * 10) / 10;
  }

  /**
   * 严格优先：先按「完全相等 normHeader」匹配列名，再按别名子串匹配
   */
  function getCell(row, fieldMap, exactNames, fuzzyAliases) {
    const keys = Object.keys(row);
    const nk = k => normHeader(k);
    for (const want of exactNames || []) {
      const wn = normHeader(want);
      const hit = keys.find(k => nk(k) === wn);
      if (hit != null) return row[hit];
    }
    for (const a of fuzzyAliases || []) {
      const hit = keys.find(k => nk(k) === normHeader(a) || nk(k).includes(a));
      if (hit != null) return row[hit];
    }
    if (fieldMap) {
      for (const a of fuzzyAliases || []) {
        if (fieldMap[a]) return row[fieldMap[a]];
      }
    }
    return '';
  }

  function parseIsoDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    const m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const m2 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m2) return new Date(+m2[3], +m2[1] - 1, +m2[2]);
    const m3 = s.match(/(\d{1,2})月(\d{1,2})日/);
    if (m3) return new Date(new Date().getFullYear(), +m3[1] - 1, +m3[2]);
    return null;
  }

  function remapStrictSheetRow(item) {
    const row = item || {};
    row.name = row['股票名称'] || row['名称'] || row['IPO名称'] || row.name;
    row.code = row['股票代码'] || row['代号'] || row.code;
    row.sector = row['板块'] || row['行业板块'] || row.sector;
    row.ipoPrice =
      row['招股价(HKD)'] || row['招股价 (HKD)'] || row['招股价'] || row.ipoPrice;
    row.darkGain = row['暗盘涨幅'] || row.darkGain;
    row.listingGain = row['上市涨幅'] || row.listingGain;
    row.profitPerLot = row['一手赚(HKD)'] || row.profitPerLot;
    row.darkDate = row['暗盘时间'] || row['暗盘日期'] || row.darkDate;
    return row;
  }

  /** 表头规范（股票名称→name …） */
  const strictMap = window.IPO_SHEET_STRICT_FIELD_MAP || {};
  const strictHeaders = Object.keys(strictMap);
  const HDR = {
    name: { exact: [strictHeaders.find(h => strictMap[h] === 'name') || '股票名称'], fuzzy: ['名称', '股票名', 'IPO名称'] },
    code: { exact: [strictHeaders.find(h => strictMap[h] === 'code') || '股票代码'], fuzzy: ['代号', '代码'] },
    sector: { exact: [strictHeaders.find(h => strictMap[h] === 'sector') || '板块'], fuzzy: ['行业', '行业板块', 'sector'] },
    ipoPrice: {
      exact: [strictHeaders.find(h => strictMap[h] === 'ipoPrice') || '招股价(HKD)'],
      fuzzy: ['招股价', '招股價', '招股价 (HKD)', '招股价(HKD)'],
    },
    darkGain: { exact: [strictHeaders.find(h => strictMap[h] === 'darkGain') || '暗盘涨幅'], fuzzy: ['暗盘涨跌', '暗盤漲幅'] },
    listingGain: { exact: [strictHeaders.find(h => strictMap[h] === 'listingGain') || '上市涨幅'], fuzzy: ['首日表现', '首日涨幅', '累计表现'] },
    profitPerLot: { exact: [strictHeaders.find(h => strictMap[h] === 'profitPerLot') || '一手赚(HKD)'], fuzzy: ['一手赚', '每手盈利'] },
    darkDate: { exact: [strictHeaders.find(h => strictMap[h] === 'darkDate') || '暗盘时间'], fuzzy: ['暗盘日期', '暗盤日期', '暗盘日'] },
    list: { exact: ['上市日期'], fuzzy: ['挂牌日', '上市日'] },
    subStart: { exact: [], fuzzy: ['招股开始', '认购开始'] },
    subEnd: { exact: [], fuzzy: ['招股结束', '招股截止'] },
    pricing: { exact: [], fuzzy: ['定价日'] },
    results: { exact: [], fuzzy: ['结果公布'] },
    over: { exact: [], fuzzy: ['超额倍数', '孖展倍数'] },
    cur: { exact: [], fuzzy: ['现价', '最新价'] },
    lot: { exact: [], fuzzy: ['每手股数', '每手手数'] },
    news: { exact: [], fuzzy: ['资讯总结', '资讯摘要', '摘要', '备注'] },
    cum: { exact: [], fuzzy: ['累计表现', '累計表現', '累计涨幅'] },
  };

  window.applyIpoGoogleSheetParsed = function applyIpoGoogleSheetParsed(parsed) {
    const PERF_ALL = window.PERF_ALL;
    const STOCKS = window.STOCKS;
    const CAL_STOCKS = window.CAL_STOCKS;
    if (!parsed || !Array.isArray(parsed.data) || !PERF_ALL || !STOCKS || !CAL_STOCKS) return false;

    const rows = parsed.data
      .map(remapStrictSheetRow)
      .filter(r => r && Object.keys(r).some(k => String(r[k] || '').trim()));
    if (!rows.length) return false;

    const fieldMap = {};
    (parsed.meta.fields || []).forEach(f => {
      const n = normHeader(f);
      if (n && !fieldMap[n]) fieldMap[n] = f;
    });
    const required = [
      HDR.name.exact[0],
      HDR.code.exact[0],
      HDR.sector.exact[0],
      HDR.ipoPrice.exact[0],
      HDR.darkGain.exact[0],
      HDR.listingGain.exact[0],
      HDR.profitPerLot.exact[0],
      HDR.darkDate.exact[0],
    ];
    const missing = required.filter(h => !Object.prototype.hasOwnProperty.call(fieldMap, normHeader(h)));
    if (missing.length && typeof window !== 'undefined' && window.__IPO_DEBUG_SHEET__) {
      console.debug('[IPO Sheet] 列名提示（不影响渲染）:', missing.join(', '));
    }

    const oldPerfByCode = Object.fromEntries(PERF_ALL.map(p => [p.code, { ...p }]));
    const newPerf = [];
    const sheetDarkBackfill = [];
    const sheetFdBackfill = [];

    const rowsByDarkDateDesc = rows.slice().sort((a, b) => {
      const ta = (parseIsoDate(a.darkDate || a['暗盘时间']) || parseIsoDate(a.darkDate))?.getTime() || 0;
      const tb = (parseIsoDate(b.darkDate || b['暗盘时间']) || parseIsoDate(b.darkDate))?.getTime() || 0;
      return tb - ta;
    });

    rowsByDarkDateDesc.forEach((row, idx) => {
      const g = field => getCell(row, fieldMap, HDR[field].exact, HDR[field].fuzzy);

      const code = parseStockCode(g('code'));
      if (!code) return;

      const name = String(g('name') || '').trim() || (oldPerfByCode[code] && oldPerfByCode[code].name) || code;
      const sector = String(g('sector') || '').trim() || (oldPerfByCode[code] && oldPerfByCode[code].sector) || '—';
      const o = oldPerfByCode[code] || {};

      const ipoRaw = g('ipoPrice');
      let ipoP = parseMoneyHkd(ipoRaw);
      if (ipoP == null && ipoRaw && String(ipoRaw).includes('$')) {
        const m = String(ipoRaw).match(/([\d,.]+)/);
        if (m) ipoP = parseFloat(m[1].replace(/,/g, ''));
      }

      const lotStr = (function pickLot(r) {
        for (const k of Object.keys(r)) {
          if (normHeader(k).includes('每手')) {
            const v = r[k];
            const t = v == null ? '' : String(v).trim();
            if (t && t !== '—') return t;
          }
        }
        return g('lot');
      })(row);
      const lot = parseInt(String(lotStr).replace(/\D/g, ''), 10) || (oldPerfByCode[code] && oldPerfByCode[code].lot) || null;
      const over = parseOversub(g('over'));

      const darkGainRaw = g('darkGain');
      let darkP = parseDarkGainCell(darkGainRaw);
      const darkNeedCrawl =
        !darkGainRaw || String(darkGainRaw).trim() === '' || isPendingListing(darkGainRaw) || darkP == null;
      if (darkNeedCrawl && darkP == null) {
        darkP = oldPerfByCode[code] && oldPerfByCode[code].darkP != null ? oldPerfByCode[code].darkP : null;
        if (darkP == null) sheetDarkBackfill.push(code);
      }

      const listingRaw = g('listingGain');
      let fd = parsePercentSmart(listingRaw);
      const listingNeedCrawl =
        !listingRaw || String(listingRaw).trim() === '' || isPendingListing(listingRaw) || fd == null;
      if (listingNeedCrawl && fd == null) {
        fd = oldPerfByCode[code] && oldPerfByCode[code].fd != null ? oldPerfByCode[code].fd : null;
        if (fd == null) sheetFdBackfill.push(code);
      }

      let cur = parseMoneyHkd(g('cur'));
      const cumParsed = parsePercentSmart(g('cum'));
      const cum = cumParsed != null ? cumParsed : o.cumPerfPct;

      const profitPerLot = parseMoneyHkd(g('profitPerLot'));

      const dDarkSheet = parseIsoDate(g('darkDate'));
      const dList = parseIsoDate(g('list'));
      const upcomingBySheet = darkNeedCrawl || listingNeedCrawl;

      newPerf.push({
        rank: idx + 1,
        code,
        name,
        sector,
        sc: o.sc || 'mfg',
        ipoP: ipoP != null ? ipoP : o.ipoP,
        lot: lot != null ? lot : o.lot,
        over: over != null ? over : o.over,
        darkP,
        fd: fd != null ? fd : o.fd,
        cur: cur != null ? cur : o.cur,
        cumPerfPct: cum != null ? cum : o.cumPerfPct,
        profitPerLot: profitPerLot != null ? profitPerLot : o.profitPerLot,
        sheetDarkDateMs: dDarkSheet ? dDarkSheet.getTime() : (o.sheetDarkDateMs || null),
        mth: o.mth,
        st: o.st || 'listed',
        ah: o.ah,
        listDate: o.listDate,
        sheetDarkEmpty: darkNeedCrawl && darkP == null,
        sheetListingEmpty: listingNeedCrawl && fd == null,
      });

      if (STOCKS[code]) {
        const st = STOCKS[code];
        if (ipoP != null) st.ipoPrice = ipoP;
        if (lot) st.lotSize = lot;
        if (over != null) st.oversubscribed = over;
        if (fd != null) st.firstDay = fd;
        if (cum != null) st.cumul = cum;
        if (cur != null) st.currentPrice = cur;
        if (profitPerLot != null) st.profitPerLot = profitPerLot;
        if (sector && sector !== '—') st.sector = sector;
        if (upcomingBySheet) st.status = 'upcoming';
        if (dList) {
          st.listDate = `${dList.getFullYear()}-${String(dList.getMonth() + 1).padStart(2, '0')}-${String(dList.getDate()).padStart(2, '0')}`;
        }
        st.sheetNewsSummary = g('news');
      }

      let cs = CAL_STOCKS.find(c => c.code === code);
      if (!cs) {
        cs = {
          code,
          name,
          sector: sector || '—',
          ipoPrice: ipoP != null ? String(ipoP) : '—',
          status: 'open',
          statusLabel: '',
          batch: 'sheet',
          sub: null,
          pricing: null,
          results: null,
          dark: null,
          list: null,
        };
        CAL_STOCKS.push(cs);
      }
      if (name) cs.name = name;
      if (sector && sector !== '—') cs.sector = sector;
      if (upcomingBySheet) {
        cs.status = 'open';
        cs.statusLabel = '即将上市';
      }

      const dSubS = parseIsoDate(g('subStart'));
      const dSubE = parseIsoDate(g('subEnd'));
      const dPr = parseIsoDate(g('pricing'));
      const dRes = parseIsoDate(g('results'));

      const c0 = d => (d && !isNaN(d) ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null);
      const dDark = dDarkSheet || parseIsoDate(g('darkDate'));
      if (dList) {
        cs.listDateObj = c0(dList);
        cs.list = dList.getDate();
      }
      if (dDark) {
        cs.darkDateObj = c0(dDark);
        cs.dark = dDark.getDate();
      }
      if (dSubS && dSubE) {
        cs.subStartDate = c0(dSubS);
        cs.subEndDate = c0(dSubE);
        cs.sub = [
          `${dSubS.getFullYear()}-${String(dSubS.getMonth() + 1).padStart(2, '0')}-${String(dSubS.getDate()).padStart(2, '0')}`,
          `${dSubE.getFullYear()}-${String(dSubE.getMonth() + 1).padStart(2, '0')}-${String(dSubE.getDate()).padStart(2, '0')}`,
        ];
      }
      if (dPr) {
        cs.pricingDate = c0(dPr);
        cs.pricing = dPr.getDate();
      }
      if (dRes) {
        cs.resultsDate = c0(dRes);
        cs.results = dRes.getDate();
      }
    });

    PERF_ALL.splice(0, PERF_ALL.length, ...newPerf);
    window.__IPO_SHEET_APPLIED__ = true;
    window.__IPO_SHEET_ROWS__ = rows.length;
    window._sheetDarkBackfillCodes = sheetDarkBackfill;
    window._sheetFdBackfillCodes = sheetFdBackfill;
    window.__IPO_SHEET_FETCHED_AT__ = Date.now();
    return true;
  };

  window.fetchAndApplyIpoGoogleSheetCsv = async function fetchAndApplyIpoGoogleSheetCsv() {
    if (typeof Papa === 'undefined') {
      console.warn('[IPO Sheet] PapaParse 未加载');
      return false;
    }
    const url = normalizeGoogleSheetCsvUrl(window.IPO_GOOGLE_SHEET_CSV_URL);
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${sep}t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
    const text = await res.text();
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => normHeader(h),
    });
    if (parsed.errors && parsed.errors.length) {
      console.warn('[IPO Sheet] parse warnings', parsed.errors.slice(0, 3));
    }
    return window.applyIpoGoogleSheetParsed(parsed);
  };
})();

/**
 * 「上市新股」：招股结束时间窗筛选、全字段保留、图1 样式卡片 + Loading
 * 需在 Google 表格中「发布到网络」，并将 window.__IPO_SHEET_CONFIG__.publishBase 设为 …/pub 地址。
 * 文档与 gid：上市新股 = gid 63719317（可在 __IPO_SHEET_CONFIG__.gids.listed 覆盖）
 */
(function (global) {
  'use strict';

  const SUB_END_ALIASES = ['招股结束', '招股截止', '认购截止', '截止申购'];
  const HIGHLIGHT_ALIASES = ['公司亮点', '投资亮点', '核心亮点', '行业地位', '投资要点'];
  const RISK_ALIASES = ['风险因素', '主要风险', '风险提示', '风险'];

  function _normH(h) {
    return String(h || '')
      .replace(/^\uFEFF/, '')
      .replace(/\t/g, '')
      .trim();
  }

  function _getCellByAliases(row, aliases) {
    if (!row) return '';
    const keys = Object.keys(row);
    for (const a of aliases) {
      const an = _normH(a);
      const hit = keys.find(k => _normH(k) === an);
      if (hit != null && row[hit] != null) {
        const t = String(row[hit]).trim();
        if (t) return t;
      }
    }
    for (const a of aliases) {
      const hit2 = keys.find(k => _normH(k).includes(a));
      if (hit2 && row[hit2] != null) {
        const t = String(row[hit2]).trim();
        if (t) return t;
      }
    }
    return '';
  }

  function _parseDateFlexible(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s === '—' || s === '-') return null;
    const m = s.match(/(\d{4})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const m2 = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m2) return new Date(+m2[3], +m2[1] - 1, +m2[2]);
    const m3 = s.match(/(\d{1,2})月(\d{1,2})日/);
    if (m3) {
      const y = global.__IPO_SHEET_SYNC_REF_YMD__
        ? parseInt(String(global.__IPO_SHEET_SYNC_REF_YMD__).slice(0, 4), 10)
        : new Date().getFullYear();
      return new Date(y, +m3[1] - 1, +m3[2]);
    }
    return null;
  }

  function _startOfDay(d) {
    if (!d || isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function _addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return _startOfDay(x);
  }

  function _todayStart() {
    if (typeof global.ipoToday === 'function') return global.ipoToday();
    return _startOfDay(new Date());
  }

  function getSubEndDateFromRow(row) {
    for (const a of SUB_END_ALIASES) {
      for (const k of Object.keys(row || {})) {
        if (
          _normH(k) === a ||
          (_normH(k).includes('招股') && /结束|截止|截止日/.test(_normH(k)))
        ) {
          const p = _parseDateFlexible(row[k]);
          if (p) return _startOfDay(p);
        }
      }
    }
    return _parseDateFlexible(_getCellByAliases(row, SUB_END_ALIASES));
  }

  const IPO_SHEET_TOP_N = 6;

  function _dedupeIpoRowsByCode(rows) {
    const seen = new Set();
    return (rows || []).filter(r => {
      const c = _extractCodeFromRow(r);
      if (!c) return false;
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });
  }

  function _sortRowsBySubEndDesc(list) {
    return (list || []).slice().sort((a, b) => {
      const da = getSubEndDateFromRow(a);
      const db = getSubEndDateFromRow(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db.getTime() - da.getTime();
    });
  }

  function _sortRowsBySubEndAsc(list) {
    return (list || []).slice().sort((a, b) => {
      const da = getSubEndDateFromRow(a);
      const db = getSubEndDateFromRow(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });
  }

  /**
   * 上市新股 列表+汇总表：固定最多 6 只（不足则全展示）
   * 首选：招股结束日 ≥ 今日 0 点，按结束日由近到远升序
   * 次选：其余已结束，按结束日由近到远逆序 递补
   */
  function buildIpoTopSixStocks(rows) {
    const t0 = _todayStart();
    if (!t0) return [];
    const t0m = t0.getTime();
    const withDate = _dedupeIpoRowsByCode(
      (rows || []).filter(
        r => r && getSubEndDateFromRow(r) && _extractCodeFromRow(r) && Object.keys(r).some(k => String(r[k] || '').trim()),
      ),
    );
    if (!withDate.length) return [];
    const active = withDate.filter(r => getSubEndDateFromRow(r).getTime() >= t0m);
    const past = withDate.filter(r => getSubEndDateFromRow(r).getTime() < t0m);
    const actSorted = _sortRowsBySubEndAsc(active);
    const pastSorted = _sortRowsBySubEndDesc(past);
    const out = [];
    actSorted.forEach(r => {
      if (out.length < IPO_SHEET_TOP_N) out.push(r);
    });
    pastSorted.forEach(r => {
      if (out.length < IPO_SHEET_TOP_N) out.push(r);
    });
    return out.slice(0, IPO_SHEET_TOP_N);
  }

  /** 新股列表：仅「招股结束」≥ 今天（进行中的招股 / 将招） */
  function filterCurrentIpoForList(rows) {
    const t0 = _todayStart();
    if (!t0) return [];
    const out = (rows || []).filter(r => {
      if (!r || !Object.keys(r).some(k => String(r[k] || '').trim())) return false;
      const endD = getSubEndDateFromRow(r);
      if (!endD) return false;
      return endD.getTime() >= t0.getTime();
    });
    return _sortRowsBySubEndDesc(out);
  }

  /**
   * 数据汇总表：A 招股中（结束日≥今）∪ B 近7日已结束招股（今−7 天 ≤ 结束日 < 今），
   * 按「招股结束」由新到旧
   */
  function buildExtendedIpoForTable(rows) {
    const t0 = _todayStart();
    if (!t0) return [];
    const t7 = _addDays(t0, -7);
    if (!t7) return _sortRowsBySubEndDesc(filterCurrentIpoForList(rows));
    const t0Ms = t0.getTime();
    const t7Ms = t7.getTime();
    const out = (rows || []).filter(r => {
      if (!r || !Object.keys(r).some(k => String(r[k] || '').trim())) return false;
      const endD = getSubEndDateFromRow(r);
      if (!endD) return false;
      const ed = endD.getTime();
      if (ed >= t0Ms) return true; /* 正在招股 */
      if (ed < t0Ms && ed >= t7Ms) return true; /* 7 天内已结束 */
      return false;
    });
    return _sortRowsBySubEndDesc(out);
  }

  /** 兼容：与前端列表/汇总表一致，取固定 6 只逻辑 */
  function filterIpoListedSheetRows(rows) {
    return buildIpoTopSixStocks(rows);
  }

  /**
   * 打新资金分配用「今天」0 点：用本地时区，避免与 UTC 日界线错位。
   */
  function _ipoCalcStartOfTodayLocal() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }

  /**
   * 打新资金分配计算器用：「招股结束」解析为本地日 0 点，与「今天」比较——结束日晚于今天或等于今天（即 ≥ 今日 0:00，含今天）。
   * 「今天」为 new Date() 后 setHours(0,0,0,0)，与表格列解析的日期语义一致（均为本地日）。
   */
  function filterIpoRowsSubEndGteToday(rows) {
    const t0m = _ipoCalcStartOfTodayLocal().getTime();
    const withCodeDate = (rows || []).filter(r => {
      if (!r || !Object.keys(r).some(k => String(r[k] || '').trim())) return false;
      const c = _extractCodeFromRow(r);
      if (!c) return false;
      const endD = getSubEndDateFromRow(r);
      if (!endD) return false;
      return endD.getTime() >= t0m;
    });
    return _sortRowsBySubEndAsc(_dedupeIpoRowsByCode(withCodeDate));
  }

  function ipoCalcMetaFromListedRow(row) {
    const code = _extractCodeFromRow(row);
    if (!code) return null;
    const name = _extractNameFromRow(row) || '—';
    const lotStr = _getCellByAliases(row, ['每手股数', '每手手数', '每手']);
    const lot = parseInt(String(lotStr).replace(/[^\d]/g, ''), 10) || 0;
    const ipoRaw = _getCellByAliases(row, [
      '招股价 (HKD)',
      '招股价(HKD)',
      '招股价',
      '招股價',
      '招股價范围',
    ]);
    const ms = String(ipoRaw || '').match(/(\d+(?:\.\d+)?)/g);
    const firstNum = ms && ms[0] ? parseFloat(ms[0]) : NaN;
    const hasLot = lot > 0;
    const hasPrice = Number.isFinite(firstNum) && firstNum > 0;
    return {
      code,
      name,
      lotSize: hasLot ? lot : null,
      ipoPrice: hasPrice ? firstNum : null,
    };
  }

  /**
   * 汇总表表头状态键（V7/V8）：
   * - active 认购中：结束日晚于今天 0 点
   * - closed 待上市（前称已截止认购）：结束日=今天 或=昨天
   * - listed 已上市：结束日 ≤ 前天
   * - unknown：无有效结束日
   */
  function getCompareTableStatusKey(row) {
    const t0 = _todayStart();
    const tSub = getSubEndDateFromRow(row);
    if (!t0) return 'unknown';
    if (!tSub) return 'unknown';
    const sub = tSub.getTime();
    const t0m = t0.getTime();
    /* 招股结束日 ≥ 今日 0 点 = 仍在认购期（与 Top6 优先「认购中」一致） */
    if (sub >= t0m) return 'active';
    const tY = _addDays(t0, -1);
    if (tY && sub === tY.getTime()) return 'closed' /* 待上市 */;
    const t2 = _addDays(t0, -2);
    if (t2 && sub <= t2.getTime()) return 'listed' /* 已上市 */;
    return 'unknown';
  }

  function _extractCodeFromRow(row) {
    const s = _getCellByAliases(row, ['股票代码', '代码', '代号', '上市代号']);
    const m = String(s || '').match(/(\d{4,5})/);
    return m ? m[1].padStart(5, '0') : '';
  }

  function _extractNameFromRow(row) {
    return _getCellByAliases(row, ['股票名称', '名称', 'IPO名称', '股票名']) || '—';
  }

  function _fmtYmd(d) {
    if (!d) return '待定';
    if (!(d instanceof Date) || isNaN(d.getTime())) return '待定';
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  function _splitBullets(s) {
    if (!s) return [];
    return String(s)
      .split(/[；;。\n]/)
      .map(t => t.trim())
      .filter(t => t.length > 0)
      .slice(0, 4);
  }

  // V11: Detailed card UI refactor & Dual-source data logic. — 详情卡：四格指标 + 核心优势/主要压力 + AI 降级
  function _v11HasMeaningfulText(s) {
    return s != null && String(s).replace(/\s|—|-/g, '').length > 0;
  }

  function _v11ShowCornerstoneRatio(s) {
    const raw = String(s == null ? '' : s).trim();
    if (!raw || raw === '—' || raw === '-' || raw === '0' || raw === '0%') return false;
    if (/暂无|无基石|未设|N\/A/i.test(raw) && !/\d/.test(raw)) return false;
    const m = raw.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return parseFloat(m[1]) > 0;
    const n = parseFloat(String(raw).replace(/[^\d.]/g, ''), 10);
    return Number.isFinite(n) && n > 0;
  }

  function _v11FmtDash(s) {
    const t = String(s == null ? '' : s).trim();
    if (!t || t === '—' || t === '-') return '-';
    return t;
  }

  function _v11AhValColor(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (t === '否') return '#F03A55';
    return null;
  }

  function _v11CornerstoneCell(raw) {
    const s0 = String(raw == null ? '' : raw).trim();
    if (!s0 || s0 === '—' || s0 === '-') return { display: '-', valColor: null };
    if (_v11ShowCornerstoneRatio(s0)) return { display: s0, valColor: null };
    if (/暂无|无基石/i.test(s0) && !/\d+\.?\d*\s*%/.test(s0)) return { display: '-', valColor: null };
    if (!_v11HasMeaningfulText(s0)) return { display: '-', valColor: null };
    return { display: s0, valColor: null };
  }

  /** 有无绿鞋：缺失为「-」；显式「无」为红 #F03A55；「有」为默认 */
  function _v11ParseGreenShoeForDetail(raw) {
    const t0 = String(raw == null ? '' : raw).trim();
    if (!t0 || t0 === '—' || t0 === '-' || t0 === '0') {
      return { display: '-', valColor: null };
    }
    if (t0 === '无') {
      return { display: '无', valColor: '#F03A55' };
    }
    if (t0 === '有') {
      return { display: '有', valColor: null };
    }
    return { display: t0, valColor: null };
  }

  function _v11SplitNarrativeToItems(raw, kind) {
    if (!raw) return [];
    const s = String(raw).trim();
    if (kind === 'bull' && /✦/.test(s)) {
      const parts = s
        .split(/(?=✦)/u)
        .map(p => p.replace(/^\s*✦\s*/u, '').replace(/\s+/g, ' ').trim())
        .filter(t => t.length > 1);
      if (parts.length) return parts.slice(0, 3);
    }
    if (kind === 'bear' && /▲/.test(s)) {
      const parts = s
        .split(/(?=▲)/u)
        .map(p => p.replace(/^\s*▲\s*/u, '').replace(/\s+/g, ' ').trim())
        .filter(t => t.length > 1);
      if (parts.length) return parts.slice(0, 3);
    }
    const lines = s
      .split(/\n+/)
      .map(l => l.replace(/^[✦▲\s·•]+/u, '').trim())
      .filter(t => t.length > 1);
    if (lines.length >= 2) return lines.slice(0, 3);
    const bul = _splitBullets(s);
    return (bul.length ? bul : s ? [s] : []).slice(0, 3);
  }

  function _v11ReadDetailCache(code) {
    if (typeof sessionStorage === 'undefined' || !code) return null;
    try {
      const raw = sessionStorage.getItem(`v11-ipo-dual-${code}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function _v11WriteDetailCache(code, data) {
    if (typeof sessionStorage === 'undefined' || !code) return;
    try {
      sessionStorage.setItem(`v11-ipo-dual-${code}`, JSON.stringify(data));
    } catch (e) { /* quota */ }
  }

  async function v11CallAiBullBearDual(name, code) {
    // V11: Name + stock code; OpenAI-compatible JSON; 无独立爬虫，由模型按公开信息风格归纳
    const cfg = global.__IPO_AI_CONFIG__ || {};
    const key = cfg.apiKey || cfg.openaiKey || cfg.token;
    if (!key) return null;
    const model = cfg.model || 'gpt-4o-mini';
    const base =
      cfg.baseUrl && String(cfg.baseUrl).trim() ? String(cfg.baseUrl).replace(/\/$/, '') : 'https://api.openai.com/v1';
    const path = cfg.chatPath || '/chat/completions';
    const codeLine = String(code).replace(/\D/g, '').length >= 4 ? `${String(code).replace(/\D/g, '').padStart(5, '0')}.HK` : String(code);
    const body = {
      model,
      temperature: 0.35,
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content:
            '你是港股新股研究助理。只输出一个 JSON 对象，不要 Markdown。用简体中文。不得编造具体未公开的财务数字。信息风格可参考捷利交易宝、阿思达克 AASTOCKS、港交所披露易等公开来源的表述方式（由你据常识归纳，勿声称已实时爬网）。',
        },
        {
          role: 'user',
          content: `标的：${name}（${codeLine}）。请各写 3 条，每条 60 字以内：\n1) “bull” 数组：看多理由/亮点；\n2) “bear” 数组：风险与压力。\n仅输出：{"bull":["x","x","x"],"bear":["x","x","x"]}`,
        },
      ],
    };
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!text) return null;
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const o = JSON.parse(m[0]);
      const bull = Array.isArray(o.bull) ? o.bull.map(String) : [];
      const bear = Array.isArray(o.bear) ? o.bear.map(String) : [];
      if (bull.length < 1 && bear.length < 1) return null;
      return {
        bull: bull.slice(0, 3),
        bear: bear.slice(0, 3),
      };
    } catch (e) {
      return null;
    }
  }

  async function v11EnrichBullBearFromAI(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    // V11: Detailed card UI refactor & Dual-source data logic. — 表格优先，空则读 session 缓存，再调 AI（Name+Code）
    const tasks = rows.map(async row => {
      const name = _extractNameFromRow(row);
      const code = _extractCodeFromRow(row);
      if (!code) return;
      const hasSheetPros = _v11HasMeaningfulText(
        _getCellByAliases(row, ['核心优势', '公司亮点', '投资亮点', '核心赛道']) || (row && row['核心优势']),
      );
      const hasSheetCons = _v11HasMeaningfulText(
        _getCellByAliases(row, ['主要压力', '重要压力', '主要风险', '风险因素']) || (row && row['主要压力']),
      );
      if (hasSheetPros && hasSheetCons) return;
      const cached = _v11ReadDetailCache(code);
      if (cached) {
        if (!hasSheetPros && Array.isArray(cached.bull) && cached.bull.length) {
          row['核心优势'] = cached.bull.join('\n');
        }
        if (!hasSheetCons && Array.isArray(cached.bear) && cached.bear.length) {
          row['主要压力'] = cached.bear.join('\n');
        }
      }
      const hasPros = _v11HasMeaningfulText(row['核心优势']);
      const hasCons = _v11HasMeaningfulText(row['主要压力']);
      if (hasPros && hasCons) return;
      const next = await v11CallAiBullBearDual(name, code);
      if (next) {
        if (!hasPros && next.bull && next.bull.length) {
          row['核心优势'] = next.bull.join('\n');
        }
        if (!hasCons && next.bear && next.bear.length) {
          row['主要压力'] = next.bear.join('\n');
        }
        _v11WriteDetailCache(code, next);
      }
    });
    await Promise.all(tasks);
  }

  function _ratingFromRow(row) {
    const raw =
      _getCellByAliases(row, ['打新星级', '星级', '打新评分']) || _getCellByAliases(row, ['打新评级', '综合评级', '评级']);
    const n = parseInt(String(raw).replace(/\D/g, ''), 10);
    if (n >= 1 && n <= 5) {
      return { n, cls: n >= 5 ? 'r5' : n >= 4 ? 'r4' : n >= 3 ? 'r3' : 'r2', label: n >= 5 ? '强烈推荐' : n >= 4 ? '重点关注' : n >= 3 ? '适量参与' : '谨慎参与' };
    }
    return { n: 3, cls: 'r3', label: '关注' };
  }

  function rowToIpoDisplayModel(row) {
    const code = _extractCodeFromRow(row);
    const name = _extractNameFromRow(row);
    const sector = _getCellByAliases(row, ['行业板块', '板块', '行业', '行业·细分']) || '';
    const ipoP = _getCellByAliases(row, ['招股价 (HKD)', '招股价(HKD)', '招股价', '招股價范围']) || '';
    const handFee = _getCellByAliases(row, ['一手入场费', '每手金额', '入场费', '每手中签费']) || '';
    const lot = _getCellByAliases(row, ['每手股数', '每手手数', '每手']) || '—';
    const ahRaw = _getCellByAliases(row, ['A+H 股', 'A+H', 'A+H股', '是否A+H']) || '';
    const aStart = _parseDateFlexible(_getCellByAliases(row, ['招股开始', '认购开始', '起购日期']));
    const subEnd = getSubEndDateFromRow(row);
    // 上市新股表：2×4 阵列；data 映射在 ipo-live-data 拉取后仍由本函数渲染（@ipo-google-sheet.js）
    const d0 =
      aStart && subEnd
        ? `${_fmtYmd(aStart)} - ${_fmtYmd(subEnd)}`
        : aStart
          ? `${_fmtYmd(aStart)} - 待定`
          : subEnd
            ? `待定 - ${_fmtYmd(subEnd)}`
            : '-';
    const mech = _getCellByAliases(row, ['发行机制', '发售机制']) || '';
    const green = _getCellByAliases(row, ['绿鞋机制', '绿鞋', '超额配售权']) || '';
    const cornerPct = _getCellByAliases(row, ['基石认购占比', '基石占比', '基石投资者认购占比']) || '';
    const dDark = _parseDateFlexible(_getCellByAliases(row, ['暗盘时间', '暗盘日期', '暗盘']));
    const dList = _parseDateFlexible(_getCellByAliases(row, ['上市日期', '上市日', '预计上市']));
    const hl =
      _getCellByAliases(row, ['核心优势', '公司亮点', '投资亮点']) ||
      _getCellByAliases(row, HIGHLIGHT_ALIASES) ||
      _getCellByAliases(row, ['投资要点', '核心赛道']);
    const rsk =
      _getCellByAliases(row, ['主要压力', '重要压力']) ||
      _getCellByAliases(row, RISK_ALIASES);
    const { n, cls, label } = _ratingFromRow(row);
    const starColor = cls === 'r5' ? '#16a34a' : cls === 'r4' ? '#f97316' : cls === 'r3' ? '#d97706' : '#dc2626';
    const gs = _v11ParseGreenShoeForDetail(green);
    const cs = _v11CornerstoneCell(cornerPct);
    const ahVal = _v11FmtDash(ahRaw);
    const detailGrid8 = [
      { label: '行业板块', val: _v11FmtDash(sector) },
      { label: '招股价', val: _v11FmtDash(ipoP) },
      { label: '一手入场费', val: _v11FmtDash(handFee) },
      { label: '是否为 A+H', val: ahVal, valColor: _v11AhValColor(ahRaw) },
      { label: '招股期', val: d0 },
      { label: '发行机制', val: _v11FmtDash(mech) },
      { label: '有无绿鞋', val: gs.display, valColor: gs.valColor },
      { label: '有无基石', val: cs.display, valColor: cs.valColor },
    ];
    const bullItems = _v11SplitNarrativeToItems(hl, 'bull');
    const bearItems = _v11SplitNarrativeToItems(rsk, 'bear');
    const bearOut =
      bearItems.length > 0
        ? bearItems
        : ['监管与市况、定价与估值、行业竞争等详见招股书及路演材料。'];
    return {
      code,
      name,
      sectorLabel: _v11FmtDash(sector) === '-' ? '' : sector,
      ipoPrice: ipoP,
      lot,
      entryFee: handFee,
      rating: n,
      ratingClass: cls,
      ratingLabel: label,
      starColor,
      detailGrid8,
      bull: bullItems.length ? bullItems : [hl && String(hl).trim() ? String(hl).trim() : '—'],
      bear: bearOut.slice(0, 3),
      subDeadline: _fmtYmd(subEnd),
      darkDate: dDark ? _fmtYmd(dDark) : '待定',
      listDate: dList ? _fmtYmd(dList) : '待定',
    };
  }

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildIpoAccordionFromListedSheet() {
    const wrapper = document.getElementById('ipo-acc-wrapper');
    if (!wrapper) return;
    const rows = global.__IPO_CURRENT_IPO__ || global.currentIPO || [];
    if (!rows.length) {
      wrapper.innerHTML = `<div style="padding:20px;color:var(--t3);font-size:13px;line-height:1.6;">暂无进行中的招股项目（「招股结束」日≥今天）。可下滑查看汇总表中「近7日已结束招股」标的。请检查表格「招股结束」列是否为有效日期，并确认 <code>publishBase</code> 已发布同一文档。</div>`;
      return;
    }

    const models = {};
    rows.forEach(r => {
      const m = rowToIpoDisplayModel(r);
      if (m.code) models[m.code] = m;
    });
    global.__IPO_SHEET_UI_MODELS__ = models;

    let firstCode = null;
    let tabsHtml = '<div class="ipo-tabs-scroll">';
    rows.forEach((r, idx) => {
      const m = rowToIpoDisplayModel(r);
      if (!m.code) return;
      if (!firstCode) firstCode = m.code;
      const sc = m.starColor;
      const starsOn = '★'.repeat(m.rating);
      const starsOff = '★'.repeat(5 - m.rating);
      tabsHtml += `
        <div class="ipo-tab-card${idx === 0 ? ' active' : ''}" id="ipo-tab-${_esc(m.code)}" onclick="switchIpoTab('${_esc(m.code)}')">
          <div class="ipo-tab-stars" style="color:${_esc(sc)};">${starsOn}<span class="ipo-tab-stars-dim">${starsOff}</span></div>
          <div class="ipo-tab-name">${_esc(m.name)}</div>
        </div>`;
    });
    tabsHtml += '</div>';
    wrapper.innerHTML = `${tabsHtml}<div class="ipo-tab-content-wrap" id="ipo-tab-content" style="margin-top:12px;"></div>`;
    if (firstCode) switchIpoTabFromSheetModel(firstCode);
  }

  function switchIpoTabFromSheetModel(code) {
    // V11: Detailed card UI refactor & Dual-source data logic
    document.querySelectorAll('.ipo-tab-card').forEach(el => el.classList.remove('active'));
    const tab = document.getElementById('ipo-tab-' + code);
    if (tab) tab.classList.add('active');
    const d = global.__IPO_SHEET_UI_MODELS__ && global.__IPO_SHEET_UI_MODELS__[code];
    const contentEl = document.getElementById('ipo-tab-content');
    if (!d || !contentEl) return;

    const _ipoDetailMetricCell = m => {
      const valCol = m.valColor ? _esc(m.valColor) : '#111';
      return `
    <div style="background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:10px;padding:12px 10px;min-width:0;">
      <div style="font-size:10px;color:#6b7280;margin-bottom:5px;letter-spacing:.04em;">${_esc(m.label)}</div>
      <div style="font-size:14px;font-weight:700;color:${valCol};line-height:1.35;word-break:break-word;">${_esc(m.val)}</div>
    </div>`;
    };
    const g8 = Array.isArray(d.detailGrid8) && d.detailGrid8.length === 8 ? d.detailGrid8 : [];
    const gridHtml = g8.length
      ? `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px;">${g8
          .slice(0, 4)
          .map(_ipoDetailMetricCell)
          .join('')}</div>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px;">${g8
          .slice(4, 8)
          .map(_ipoDetailMetricCell)
          .join('')}</div>`
      : '';

    const bHtml = d.bull
      .slice(0, 3)
      .map(
        t => `
    <div style="display:flex;gap:8px;margin-bottom:8px;font-size:12px;line-height:1.65;color:#374151;">
      <span style="color:#059669;flex-shrink:0;margin-top:2px;">✦</span><span>${_esc(t)}</span>
    </div>`,
      )
      .join('');

    const rHtml = d.bear
      .slice(0, 3)
      .map(
        t => `
    <div style="display:flex;gap:8px;margin-bottom:8px;font-size:12px;line-height:1.65;color:#374151;">
      <span style="color:#dc2626;flex-shrink:0;margin-top:2px;">▲</span><span>${_esc(t)}</span>
    </div>`,
      )
      .join('');

    const ana = global.IPO_ANALYSIS && global.IPO_ANALYSIS[code];
    const openFn = ana ? `openIpoAnalysis('${_esc(code)}')` : `void(0)`;
    const btn = ana
      ? `<button onclick="${openFn}" style="background:#f97316;border:none;border-radius:9px;padding:9px 20px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;font-family:inherit;flex-shrink:0;white-space:nowrap;" onmouseover="this.style.background='#ea580c'" onmouseout="this.style.background='#f97316'">查看完整分析 →</button>`
      : `<span style="font-size:12px;color:var(--t3);">本标的暂无内置深度模态框</span>`;

    contentEl.innerHTML = `
    <div style="padding:20px 22px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding-bottom:16px;border-bottom:1px solid rgba(0,0,0,.08);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:18px;font-weight:800;color:#111;">${_esc(d.name)}</div>
        </div>
        ${btn}
      </div>
      ${gridHtml}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:16px;">
        <div>
          <div style="font-size:11px;color:#059669;font-weight:700;margin-bottom:10px;letter-spacing:.05em;text-transform:uppercase;">✦ 看多理由 / 亮点</div>
          ${bHtml}
        </div>
        <div>
          <div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:10px;letter-spacing:.05em;text-transform:uppercase;">▲ 风险因素</div>
          ${rHtml}
        </div>
      </div>
      <div style="font-size:12px;color:#6b7280;padding-top:14px;border-top:1px solid rgba(0,0,0,.08);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span>截止 <b style="color:#111;">${_esc(d.subDeadline)}</b></span>
        <span style="opacity:.35;">·</span>
        <span>暗盘 <b style="color:#d97706;">${_esc(d.darkDate)}</b></span>
        <span style="opacity:.35;">·</span>
        <span>上市 <b style="color:#111;">${_esc(d.listDate)}</b></span>
      </div>
    </div>`;
  }

  function _wrapIpoAccHooks() {
    if (global.__IPO_LISTED_SHEET_HOOKS__) return;
    global.__IPO_LISTED_SHEET_HOOKS__ = true;
    const origBuild = global.buildIpoAccordion;
    if (typeof origBuild === 'function') {
      global._buildIpoAccordionStatic = origBuild;
      global.buildIpoAccordion = function buildIpoAccordion() {
        if (global.__IPO_LISTED_SHEET_HYDRATED__) {
          return buildIpoAccordionFromListedSheet();
        }
        return origBuild.apply(this, arguments);
      };
    }
    const origSwitch = global.switchIpoTab;
    if (typeof origSwitch === 'function') {
      global._switchIpoTabStatic = origSwitch;
      global.switchIpoTab = function switchIpoTab(code) {
        if (global.__IPO_SHEET_UI_MODELS__ && global.__IPO_SHEET_UI_MODELS__[code]) {
          return switchIpoTabFromSheetModel(code);
        }
        return origSwitch.apply(this, arguments);
      };
    }
  }

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.addEventListener('DOMContentLoaded', _wrapIpoAccHooks, { once: true });
    } else {
      setTimeout(_wrapIpoAccHooks, 0);
    }
  }

  global.__ipoProcessListedSheetRows = async function __ipoProcessListedSheetRows(listedResult) {
    if (!listedResult || !listedResult.ok) {
      global.currentIPO = [];
      global.extendedIPO = [];
      global.__IPO_CURRENT_IPO__ = [];
      global.__IPO_EXTENDED_IPO__ = [];
      global.__IPO_LISTED_SHEET_ACTIVE_ROWS__ = [];
      global.__IPO_TARGET_STOCKS__ = [];
      global.__IPO_LISTED_SHEET_ACTIVE_CODES__ = [];
      global.__IPO_LISTED_SHEET_HYDRATED__ = false;
      return;
    }
    const all = Array.isArray(listedResult.rows) ? listedResult.rows.map(r => ({ ...r })) : [];
    try {
      if (typeof global.showIpoListedLoading === 'function') {
        global.showIpoListedLoading('正在筛选「上市新股」行…');
      }
      const top6 = buildIpoTopSixStocks(all);
      // V11: 详情卡双源：表格 → 本地缓存 → AI（见 v11EnrichBullBearFromAI）
      await v11EnrichBullBearFromAI(top6);
      /* 全表行供 merge；展示统一用最多 6 只 */
      listedResult.rows = all;
      global.currentIPO = top6;
      global.extendedIPO = top6;
      global.__IPO_CURRENT_IPO__ = top6;
      global.__IPO_EXTENDED_IPO__ = top6;
      global.__IPO_LISTED_SHEET_ACTIVE_ROWS__ = top6;
      global.__IPO_TARGET_STOCKS__ = top6;
      global.__IPO_LISTED_SHEET_ACTIVE_CODES__ = top6.map(r => _extractCodeFromRow(r)).filter(Boolean);
      global.__IPO_LISTED_SHEET_HYDRATED__ = true;
    } catch (e) {
      console.warn('[IPO Sheet] 上市新股处理失败，退回无表格补全', e);
      const allFallback = Array.isArray(listedResult.rows) ? listedResult.rows.map(r => ({ ...r })) : [];
      const top6 = buildIpoTopSixStocks(allFallback);
      await v11EnrichBullBearFromAI(top6).catch(() => {});
      listedResult.rows = allFallback;
      global.currentIPO = top6;
      global.extendedIPO = top6;
      global.__IPO_CURRENT_IPO__ = top6;
      global.__IPO_EXTENDED_IPO__ = top6;
      global.__IPO_LISTED_SHEET_ACTIVE_ROWS__ = top6;
      global.__IPO_TARGET_STOCKS__ = top6;
      global.__IPO_LISTED_SHEET_ACTIVE_CODES__ = top6.map(r => _extractCodeFromRow(r)).filter(Boolean);
      global.__IPO_LISTED_SHEET_HYDRATED__ = true;
    }
    if (typeof global.buildIpoAccordion === 'function') {
      try {
        global.buildIpoAccordion();
      } catch (e2) {
        console.warn('[IPO Sheet] buildIpoAccordion', e2);
      }
    }
    if (typeof global.buildCompareTable === 'function') {
      try {
        global.buildCompareTable();
      } catch (e2) {
        console.warn('[IPO Sheet] buildCompareTable', e2);
      }
    }
  };

  global.filterIpoListedSheetRows = filterIpoListedSheetRows;
  global.filterIpoRowsSubEndGteToday = filterIpoRowsSubEndGteToday;
  global.ipoCalcFilterSubEndAfterTodayRows = filterIpoRowsSubEndGteToday;
  /* 旧名保留：现含义为「结束日 ≥ 本地今日 0:00（含今天）」 */
  global.filterIpoRowsSubEndStrictlyAfterToday = filterIpoRowsSubEndGteToday;
  global.ipoCalcMetaFromListedRow = ipoCalcMetaFromListedRow;
  global.filterCurrentIpoForList = filterCurrentIpoForList;
  global.buildIpoTopSixStocks = buildIpoTopSixStocks;
  global.buildExtendedIpoForTable = buildExtendedIpoForTable;
  global.getCompareTableStatusKey = getCompareTableStatusKey;
  global.__ipoGetCompareTableStatus = getCompareTableStatusKey;
  global.v11EnrichBullBearFromAI = v11EnrichBullBearFromAI;
  global.showIpoListedLoading = function showIpoListedLoading(msg) {
    const m = String(msg || '正在加载…');
    const el = document.getElementById('listed-stocks');
    if (!el) return;
    if (!el.hasAttribute('data-ipo-prev-html')) {
      el.setAttribute('data-ipo-prev-html', el.innerHTML);
    }
    el.innerHTML = `<div id="loading-status" class="ipo-listed-loading-msg" style="display:block;padding:16px 18px;border:1px dashed rgba(249,115,22,.4);border-radius:12px;background:rgba(249,115,22,.04);color:var(--t1);font-size:13px;font-weight:600;letter-spacing:.04em;">${m.replace(/</g, '&lt;')}</div>`;
  };
  global.hideIpoListedLoading = function hideIpoListedLoading() {
    const el = document.getElementById('listed-stocks');
    if (!el) return;
    const prev = el.getAttribute('data-ipo-prev-html');
    if (prev != null) {
      el.innerHTML = prev;
      el.removeAttribute('data-ipo-prev-html');
    } else {
      const lo = document.getElementById('loading-status') || document.getElementById('ipo-listed-loading');
      if (lo) lo.remove();
    }
  };
})(typeof window !== 'undefined' ? window : this);
