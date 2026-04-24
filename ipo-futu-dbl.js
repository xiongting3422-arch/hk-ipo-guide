/**
 * 双击打开详情抽屉；优先通过可配置的富途 OpenD 桥接拉取行情/资讯，失败回退到页面内 openDrawer 的数据（STOCKS + 表）。
 * 标准 Futu OpenD 为 WebSocket/二进制协议，浏览器内需自建 HTTP 桥或设置 window.__IPO_FUTU_FETCH__。
 */
(function (global) {
  'use strict';

  global.__IPO_FUTU_CONFIG__ = global.__IPO_FUTU_CONFIG__ || {
    host: '127.0.0.1',
    port: 11111,
    /**
     * 与仓库内 `npm run futu-bridge` 对应，默认连本机 HTTP 桥（将 OpenD WebSocket 转为 JSON）；
     * 未启动桥时请求会失败并自动回退到页内数据。
     */
    httpBridgeBase: 'http://127.0.0.1:19999',
    timeoutMs: 5000,
  };

  function _norm5(code) {
    return String(code || '')
      .replace(/\D/g, '')
      .padStart(5, '0');
  }

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _mapNewsList(raw) {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .slice(0, 8)
      .map(n => {
        if (!n) return null;
        if (typeof n === 'string') return { title: n, source: 'Futu', date: '—' };
        return {
          title: String(n.title || n.headline || n.n || '—'),
          source: String(n.source || n.src || '富途'),
          date: String(n.time || n.date || n.dt || '—'),
        };
      })
      .filter(Boolean);
  }

  function _num(j, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = j[keys[i]];
      if (v != null && v !== '' && Number.isFinite(+v)) return +v;
    }
    return null;
  }

  function _normalizeRemoteQuote(j, code5) {
    if (!j || typeof j !== 'object') return null;
    const cur = _num(j, ['cur', 'last', 'last_price', 'price', 'lastPrice', 'nominal']);
    return {
      ok: true,
      fromOpenD: true,
      name: j.name || j.stock_name,
      currentPrice: cur,
      changePct: _num(j, ['pct', 'pct_change', 'chg', 'change_pct']),
      high: _num(j, ['high', 'high_price', 'day_high']),
      low: _num(j, ['low', 'low_price', 'day_low']),
      news: _mapNewsList(j.news || j.announcement || j.warrantsNews),
    };
  }

  /**
   * @returns {Promise<null|object>} ok: true 表示可用深度包
   */
  global.__ipoTryFutuOpenD = async function __ipoTryFutuOpenD(code5) {
    const c0 = _norm5(code5);
    if (!c0) return null;
    const C = global.__IPO_FUTU_CONFIG__ || {};
    const t = C.timeoutMs != null ? C.timeoutMs : 5000;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), t);
    const done = () => {
      clearTimeout(tid);
    };

    try {
      if (typeof global.__IPO_FUTU_FETCH__ === 'function') {
        const r = await global.__IPO_FUTU_FETCH__(c0, { signal: ctrl.signal });
        done();
        if (r && (r.ok === true || r.currentPrice != null || (r.news && r.news.length)))
          return _normalizeRemoteQuote({ ...r, ok: true }, c0);
      }
    } catch (e) {
      done();
    }

    const base = (C.httpBridgeBase || C.httpBase || '').replace(/\/$/, '');
    if (base) {
      for (const path of [
        '/quote?code=HK.' + c0,
        '/v1/quote?market=hk&code=' + c0,
        '/qot/quote?security=HK.' + c0,
      ]) {
        try {
          const u = base + path;
          const res = await fetch(u, { mode: 'cors', cache: 'no-store', signal: ctrl.signal });
          if (res.ok) {
            const j = await res.json();
            const n = _normalizeRemoteQuote(j, c0);
            if (n && n.currentPrice != null) {
              done();
              return n;
            }
          }
        } catch (e) {
          /* 下一候选 */
        }
      }
    }

    const host = C.host || '127.0.0.1';
    const port = C.port != null ? C.port : 11111;
    for (const path of [
      '/api/quote?code=HK.' + c0,
      '/v1/quote?code=HK.' + c0,
    ]) {
      try {
        const u = 'http://' + host + ':' + port + path;
        const res = await fetch(u, { mode: 'cors', cache: 'no-store', signal: ctrl.signal });
        if (res.ok) {
          const j = await res.json();
          const n = _normalizeRemoteQuote(j, c0);
          if (n && (n.currentPrice != null || n.ok)) {
            done();
            return n;
          }
        }
      } catch (e) {
        /* 连接拒绝 / CORS */
      }
    }
    done();
    return null;
  };

  /**
   * @param {object|undefined} base  STOCKS[code]
   * @param {string} code5
   * @param {object} futu  __ipoTryFutuOpenD 返回值
   */
  global.__ipoMergeFutuIntoStock = function __ipoMergeFutuIntoStock(base, code5, futu) {
    const f = futu || {};
    const o = base
      ? { ...base }
      : {
          name: f.name || '—',
          code: code5,
          sector: '—',
          sectorClass: 'mfg',
          ipoPrice: null,
          firstDay: null,
          listDate: '—',
          currentPrice: null,
          cumul: null,
          lotSize: null,
          entryFee: null,
          marketCap: '—',
          sponsor: '—',
          greenshoe: '—',
          raiseAmount: '—',
          status: 'listed',
          details: { sector: '—', board: '主板' },
        };
    o.code = code5;
    o._futuFromOpenD = true;
    if (f.name && (!base || !o.name)) o.name = f.name;
    if (f.currentPrice != null && Number.isFinite(f.currentPrice)) o.currentPrice = f.currentPrice;
    if (o.currentPrice == null && f.last_price != null && Number.isFinite(+f.last_price)) o.currentPrice = +f.last_price;
    if (f.changePct != null && Number.isFinite(f.changePct)) o._futuDayChgPct = f.changePct;
    if (f.amplitude != null && Number.isFinite(+f.amplitude)) o._futuAmplitude = +f.amplitude;
    if (f.volume != null && f.volume !== '') o._futuVolume = f.volume;
    if (f.high != null || f.low != null) o._futuRange = { high: f.high, low: f.low };
    if (f.news && f.news.length) {
      const head = f.news.map(n => ({
        title: n.title,
        source: n.source,
        date: n.date,
      }));
      o.news = head.concat((base && base.news) || []);
    }
    if (!o.sectorClass) o.sectorClass = 'mfg';
    return o;
  };

  function _showFutuLoadingDrawer(code5) {
    const d = document.getElementById('drawer');
    const ov = document.getElementById('overlay');
    const body = document.getElementById('drawer-body');
    const elCode = document.getElementById('d-code');
    const elName = document.getElementById('d-name');
    const chip = document.getElementById('d-sector-chip');
    const s = (typeof global.STOCKS === 'object' && global.STOCKS[code5]) || null;
    if (elCode) elCode.textContent = code5 + '.HK';
    if (elName) elName.textContent = s && s.name ? s.name : '—';
    if (chip) chip.innerHTML = s && s.sector ? `<span class="sc-sector ${s.sectorClass || ''}">${_esc(s.sector)}</span>` : '';
    if (body) {
      body.innerHTML =
        '<div class="dprice-banner" style="padding:8px 0 16px;">' +
        '<div style="font-size:13px;color:var(--t2);line-height:1.65;">正在通过富途 OpenD 获取深度数据…</div>' +
        '<div style="font-size:11px;color:var(--t3);margin-top:8px;">未检测到本地桥时，将自动使用页面内建数据。</div></div>';
    }
    if (d) d.classList.add('open');
    if (ov) ov.classList.add('open');
    if (global.document && global.document.body) global.document.body.style.overflow = 'hidden';
  }

  async function _openDrawerDblInternal(stockCode) {
    const code5 = _norm5(stockCode);
    if (!code5) return;
    _showFutuLoadingDrawer(code5);
    let pack = null;
    try {
      if (global.__ipoTryFutuOpenD) pack = await global.__ipoTryFutuOpenD(code5);
    } catch (e) {
      console.warn('[IPO Futu] OpenD', e);
    }
    if (pack && (pack.currentPrice != null || (pack.news && pack.news.length))) {
      if (typeof global.openDrawer === 'function') global.openDrawer(code5, { futu: pack });
    } else if (typeof global.openDrawer === 'function') {
      global.openDrawer(code5, {});
    }
  }

  global.__ipoDblOpenDrawer = function __ipoDblOpenDrawer(stockCode) {
    return _openDrawerDblInternal(stockCode);
  };
  global.openModal = function openModal(stockCode) {
    return _openDrawerDblInternal(stockCode);
  };

  function _extractIpoCodeFromEvent(ev) {
    const t = ev.target;
    if (t && t.closest && t.closest('button, a, label[for], input, textarea, select, [data-no-ipo-dbl]')) {
      if (!t.closest('.drawer, #drawer')) return null;
    }
    if (t.closest && t.closest('#drawer')) return null;

    let el = t.closest(
      '[data-ipo-code].ipo-dbl-open, .ipo-dbl-open[data-ipo-code], .lb-tr[data-ipo-code], tr[data-ipo-code], [data-ipo-code]',
    );
    if (el && el.dataset && el.dataset.ipoCode) return _norm5(el.dataset.ipoCode);
    el = t.closest('.ipo-tab-card');
    if (el && el.id && /^ipo-tab-/.test(el.id)) {
      return _norm5(el.id.replace(/^ipo-tab-/, ''));
    }
    el = t.closest('.sm-open-row, .sm-name, .sm-code');
    if (el) {
      const row = t.closest('.sm-open-row') || (el.classList && el.classList.contains('sm-open-row') ? el : el.closest && el.closest('.sm-open-row'));
      if (row && row.dataset && row.dataset.ipoCode) return _norm5(row.dataset.ipoCode);
      const sc = t.closest('.sm-code') || (el.classList && el.classList.contains('sm-code') ? el : null);
      if (sc) {
        const m = (sc.textContent || '').match(/([0-9]{4,5})/);
        if (m) return _norm5(m[1]);
      }
    }
    el = t.closest('.lb-tr');
    if (el && el.dataset && el.dataset.ipoCode) return _norm5(el.dataset.ipoCode);
    if (t.closest && t.closest('.stock-name, .stock-code, .ipo-tab-name')) {
      const tr = t.closest('tr[data-ipo-code], [data-ipo-code]');
      if (tr && tr.dataset.ipoCode) return _norm5(tr.dataset.ipoCode);
    }
    return null;
  }

  document.addEventListener(
    'dblclick',
    function (ev) {
      const c = _extractIpoCodeFromEvent(ev);
      if (!c) return;
      if (ev.target.closest && ev.target.closest('#stat-modal') && global.closeStatModal) {
        try {
          global.closeStatModal();
        } catch (e) { /* */ }
      }
      _openDrawerDblInternal(c);
    },
    true,
  );
})(typeof window !== 'undefined' ? window : this);
