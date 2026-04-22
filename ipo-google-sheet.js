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
