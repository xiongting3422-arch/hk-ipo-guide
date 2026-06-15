/**
 * 新股列表 · Chart.js 雷达图 + 维度分析表
 * Chart 实例仅在首次初始化时 new Chart()，切换标的只调用 .update()
 */
(function (global) {
  'use strict';

  /** 打新质量雷达六维（API 0–5 分 ×20 映射到 0–100 渲染） */
  const IPO_LIST_RADAR_AXES = [
    { key: 'cornerstone', label: '基石背书' },
    { key: 'greenshoe', label: '绿鞋保障' },
    { key: 'sponsor', label: '保荐质量' },
    { key: 'financial', label: '财务状况' },
    { key: 'fundamental', label: '基本面' },
    { key: 'valuation', label: '估值安全度' },
  ];

  const IPO_API_DIM_ORDER = IPO_LIST_RADAR_AXES.map(a => a.key);
  let analysisFetchSeq = 0;
  /** 当前详情面板应展示的标的名称（与 stockData 键一致） */
  let currentActiveStockKey = null;

  const SPONSOR_BREAK_RATES = {
    东方证券: 0.34,
    民银资本: 0.31,
    交银国际: 0.29,
    华升资本: 0.28,
    中泰国际: 0.27,
    天风证券: 0.26,
    中银国际: 0.18,
    中国国际金融: 0.22,
    中信建投: 0.19,
    摩根士丹利: 0.15,
    高盛: 0.12,
  };

  const AI_CACHE_STORAGE_KEY = 'ipo_ai_analysis_v1';
  const AI_ANALYSIS_FETCH_TIMEOUT_MS = 90000;

  let myRadarChart = null;
  let radarChartReady = false;
  let currentAnalysisRows = [];
  let analysisDetailBound = false;
  let loadingTimer = null;

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clampScore(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function parseExplicitScore(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    if (!s || s === '—' || s === '-') return null;
    const n = parseFloat(s.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n)) return null;
    if (/星/.test(s) && n <= 5) return clampScore(n * 20);
    if (n <= 5 && !s.includes('%')) return clampScore(n * 20);
    if (n <= 10 && !s.includes('%')) return clampScore(n * 10);
    return clampScore(n);
  }

  function lookupSponsorBreakRate(sponsor) {
    const s = String(sponsor || '');
    if (!s) return null;
    const keys = Object.keys(SPONSOR_BREAK_RATES);
    for (let i = 0; i < keys.length; i++) {
      if (s.indexOf(keys[i]) >= 0) return SPONSOR_BREAK_RATES[keys[i]];
    }
    return null;
  }

  function getCell(row, aliases, getter) {
    if (typeof getter === 'function') return getter(row, aliases) || '';
    if (!row || !aliases) return '';
    for (let i = 0; i < aliases.length; i++) {
      const a = aliases[i];
      if (row[a] != null && String(row[a]).trim()) return String(row[a]).trim();
    }
    return '';
  }

  function getAxisScore(row, axis, getter, computed) {
    const raw = getCell(row, axis.scoreAliases, getter);
    const explicit = parseExplicitScore(raw);
    if (explicit != null) return explicit;
    return clampScore(computed());
  }

  function scoreCornerstoneFromRaw(raw) {
    const s = String(raw || '').trim();
    if (!s || s === '-' || s === '—') return 25;
    const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) {
      const pct = parseFloat(m[1]);
      if (pct >= 50) return 95;
      if (pct >= 30) return 82;
      if (pct >= 20) return 70;
      if (pct >= 10) return 55;
      if (pct > 0) return 40;
      return 20;
    }
    if (/有|认购/.test(s) && !/无|暂无/.test(s)) return 62;
    if (/无|暂无/.test(s)) return 22;
    return 35;
  }

  function scoreGreenShoeFromRaw(raw) {
    const t = String(raw || '').trim();
    if (t === '有') return 88;
    if (t === '无') return 22;
    if (/有/.test(t) && !/无/.test(t)) return 80;
    if (/无|暂无/.test(t)) return 25;
    return 50;
  }

  function scoreSponsorFromRaw(sponsor) {
    const rate = lookupSponsorBreakRate(sponsor);
    if (rate != null) return clampScore((1 - rate) * 100);
    if (String(sponsor || '').trim()) return 58;
    return 38;
  }

  function scoreMechanismFromRaw(mech) {
    const t = String(mech || '');
    if (/机制\s*A|甲组|回拨/i.test(t)) return 78;
    if (/机制\s*B|乙组/i.test(t)) return 58;
    return 50;
  }

  function buildRadarScoresFromRow(row, getter, rating) {
    const cornerRaw =
      getCell(row, ['基石认购占比', '基石占比', '基石投资者认购占比', '有无基石'], getter) || '';
    const greenRaw = getCell(row, ['绿鞋机制', '绿鞋', '超额配售权', '有无绿鞋'], getter) || '';
    const sponsor = getCell(row, ['保荐人', '保荐机构', '联席保荐人', '保荐'], getter) || '';
    const r = rating && rating.n ? rating.n : 3;

    const cornerstone05 = /无|^-|—/.test(String(cornerRaw).trim()) && !/\d+%/.test(cornerRaw) ? 0 : 3;
    const greenshoe05 = String(greenRaw).trim() === '无' || !String(greenRaw).trim() ? 0 : 4;
    const sponsor05 = !String(sponsor).trim() ? 0 : 3;
    const financial05 = 3;
    const fundamental05 = Math.min(5, Math.max(1, 1 + r * 0.8));
    const valuation05 = 3;

    return [cornerstone05, greenshoe05, sponsor05, financial05, fundamental05, valuation05].map(s =>
      Math.round(s * 20),
    );
  }

  function defaultBriefForAxis(axis, row, getter, score) {
    const cornerRaw = getCell(row, ['基石认购占比', '基石占比', '基石投资者认购占比'], getter);
    const greenRaw = getCell(row, ['绿鞋机制', '绿鞋', '超额配售权'], getter);
    const sponsor = getCell(row, ['保荐人', '保荐机构', '联席保荐人'], getter);
    const mech = getCell(row, ['发行机制', '发售机制'], getter);
    if (axis.key === 'cornerstone') {
      return cornerRaw ? `基石占比 ${cornerRaw}，评分 ${score}` : `基石条款偏弱，评分 ${score}`;
    }
    if (axis.key === 'greenshoe') {
      return greenRaw ? `绿鞋：${greenRaw}，评分 ${score}` : `绿鞋信息待补，评分 ${score}`;
    }
    if (axis.key === 'sponsor') {
      const rate = lookupSponsorBreakRate(sponsor);
      if (sponsor && rate != null) {
        return `${sponsor}，参考破发率约 ${Math.round(rate * 100)}%，评分 ${score}`;
      }
      return sponsor ? `${sponsor}，评分 ${score}` : `保荐人待披露，评分 ${score}`;
    }
    if (axis.key === 'financial') {
      return `财务状况待 AI 研判，暂评 ${score}`;
    }
    if (axis.key === 'valuation') {
      return mech ? `估值博弈参考 ${mech}，暂评 ${score}` : `估值安全度待 AI 研判，暂评 ${score}`;
    }
    if (axis.key === 'fundamental') {
      const hl = getCell(row, ['核心优势', '公司亮点', '投资亮点'], getter);
      if (hl) return String(hl).slice(0, 48) + (String(hl).length > 48 ? '…' : '');
      return `基本面综合评分 ${score}`;
    }
    return `基本面综合评分 ${score}`;
  }

  function calcScoreTotals(scores) {
    const list = Array.isArray(scores) ? scores : [];
    const total = list.reduce((sum, n) => sum + (Number(n) || 0), 0);
    const avg = list.length ? total / list.length : 0;
    return { total, avg: Math.round(avg * 10) / 10 };
  }

  function buildOverallSummary(row, scores, getter, rating) {
    const explicit = getCell(
      row,
      ['一句话综合概括', '综合概括', '打新综合概括', '综合点评', '综合摘要', '综合结论'],
      getter,
    );
    if (explicit) return explicit;

    const { avg } = calcScoreTotals(scores);
    const r = rating && rating.n ? rating.n : 3;
    const weak = (scores || []).filter(s => Number(s) < 45).length;
    if (avg >= 75 && r >= 4) {
      return `六维均值 ${avg} 分、打新 ${r} 星，基石/保荐等条款背书较强，可重点关注申购节奏与定价区间。`;
    }
    if (avg >= 60) {
      return `六维均值 ${avg} 分，整体质量中等，宜结合孖展热度、暗盘情绪与${weak ? '薄弱条款' : '发行机制'}再决策。`;
    }
    return `六维均值 ${avg} 分，绿鞋/基石/保荐等存在${weak > 0 ? ` ${weak} 项` : '多项'}薄弱维度，建议谨慎参与或控制仓位。`;
  }

  function resolveTotalScore(row, scores, getter) {
    const raw = getCell(row, ['评分总和', '总分', '维度评分总和', '雷达总分'], getter);
    const explicit = parseExplicitScore(raw);
    if (explicit != null && explicit > 100) return explicit;
    return calcScoreTotals(scores).total;
  }

  function buildAnalysisRowsFromSheet(row, scores, getter) {
    const rows = [];
    IPO_LIST_RADAR_AXES.forEach((axis, i) => {
      const idx = i + 1;
      const brief =
        getCell(
          row,
          [
            `${axis.label}依据`,
            `${axis.label}一句话`,
            `维度${idx}依据`,
            `维度${idx}一句话`,
            `${axis.key}依据`,
          ],
          getter,
        ) || defaultBriefForAxis(axis, row, getter, scores[i]);

      const deep =
        getCell(
          row,
          [
            `${axis.label}深度`,
            `${axis.label}深度分析`,
            `维度${idx}深度`,
            `维度${idx}深度分析`,
            `${axis.key}深度分析`,
          ],
          getter,
        ) || brief;

      rows.push({
        dimension: axis.label,
        score: scores[i],
        brief,
        deep,
      });
    });
    return rows;
  }

  function buildMetricGridHtml(start, end) {
    let html = '';
    for (let i = start; i < end; i++) {
      html +=
        '<div class="ipo-metric-cell">' +
        '<div class="ipo-metric-lbl" id="ipo-metric-lbl-' +
        i +
        '">—</div>' +
        '<div class="ipo-metric-val" id="ipo-metric-val-' +
        i +
        '">—</div>' +
        '</div>';
    }
    return html;
  }

  function buildDetailShellHtml() {
    const bullItems = [0, 1, 2]
      .map(
        i => `
    <div class="ipo-narrative-item ipo-narrative-bull">
      <span class="ipo-narrative-mark">✦</span>
      <span id="ipo-bull-${i}"></span>
    </div>`,
      )
      .join('');

    const bearItems = [0, 1, 2]
      .map(
        i => `
    <div class="ipo-narrative-item ipo-narrative-bear">
      <span class="ipo-narrative-mark">▲</span>
      <span id="ipo-bear-${i}"></span>
    </div>`,
      )
      .join('');

    return `
    <div class="ipo-detail-inner">
      <div class="ipo-detail-head">
        <div class="ipo-detail-head-main">
          <div class="ipo-detail-title" id="ipo-detail-name">—</div>
        </div>
        <div id="ipo-detail-action"></div>
      </div>
      <div class="ipo-metric-grid ipo-metric-grid-top">${buildMetricGridHtml(0, 4)}</div>
      <div class="ipo-metric-grid ipo-metric-grid-bottom">${buildMetricGridHtml(4, 8)}</div>
      <div class="ipo-detail-visual-row">
        <div class="ipo-radar-panel">
          <div class="ipo-radar-title">打新质量雷达</div>
          <div class="ipo-radar-chart-box">
            <canvas id="ipo-radar-canvas" aria-label="打新质量雷达图"></canvas>
          </div>
          <div class="ipo-radar-foot">
            <div class="ipo-radar-score-block">
              <div class="ipo-radar-foot-label">评分总和</div>
              <div class="ipo-radar-score-line">
                <span class="ipo-score-total-val" id="ipo-score-total">—</span>
                <span class="ipo-score-total-sub" id="ipo-score-avg"></span>
              </div>
            </div>
            <div class="ipo-radar-summary-block">
              <div class="ipo-radar-foot-label">一句话综合概括</div>
              <p class="ipo-score-summary-text" id="ipo-score-summary">—</p>
            </div>
          </div>
        </div>
        <div class="ipo-analysis-section">
          <div class="ipo-analysis-title">维度评分 · 依据与深度分析</div>
          <div class="ipo-analysis-body">
            <div class="ipo-analysis-table-wrap">
              <table class="ipo-analysis-table">
                <thead>
                  <tr>
                    <th>维度</th>
                    <th>评分</th>
                    <th>一句话依据</th>
                  </tr>
                </thead>
                <tbody id="ipo-analysis-tbody"></tbody>
              </table>
            </div>
            <div class="ipo-analysis-detail-panel" id="ipo-analysis-detail-panel" hidden>
              <div class="ipo-analysis-detail-head">
                <span class="ipo-analysis-detail-title" id="ipo-analysis-detail-title">深度分析</span>
                <button type="button" class="ipo-analysis-detail-close" id="ipo-analysis-detail-close" aria-label="关闭">×</button>
              </div>
              <div class="ipo-analysis-detail-body" id="ipo-analysis-detail-body"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="ipo-narrative-grid">
        <div>
          <div class="ipo-narrative-heading ipo-narrative-heading-bull">✦ 看多理由 / 亮点</div>
          ${bullItems}
        </div>
        <div>
          <div class="ipo-narrative-heading ipo-narrative-heading-bear">▲ 风险因素</div>
          ${bearItems}
        </div>
      </div>
      <div class="ipo-detail-foot">
        <span>暗盘 <b id="ipo-dark-date">--</b></span>
        <span class="ipo-detail-foot-dot">·</span>
        <span>上市 <b id="ipo-list-date">--</b></span>
      </div>
    </div>`;
  }

  function hideAnalysisDetailPanel() {
    const panel = document.getElementById('ipo-analysis-detail-panel');
    if (panel) panel.hidden = true;
    document.querySelectorAll('.ipo-analysis-detail-btn.active').forEach(btn => btn.classList.remove('active'));
  }

  function showAnalysisDetailPanel(idx) {
    const r = currentAnalysisRows[idx];
    if (!r) return;
    const panel = document.getElementById('ipo-analysis-detail-panel');
    const titleEl = document.getElementById('ipo-analysis-detail-title');
    const bodyEl = document.getElementById('ipo-analysis-detail-body');
    if (!panel || !titleEl || !bodyEl) return;

    titleEl.textContent = (r.dimension || '维度') + ' · 深度分析';
    bodyEl.textContent = r.deep && String(r.deep).trim() ? String(r.deep) : '暂无深度分析内容。';

    document.querySelectorAll('.ipo-analysis-detail-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-idx') === String(idx));
    });
    panel.hidden = false;
  }

  function bindAnalysisDetailPanel() {
    if (analysisDetailBound) return;
    const tbody = document.getElementById('ipo-analysis-tbody');
    const closeBtn = document.getElementById('ipo-analysis-detail-close');
    if (!tbody) return;

    tbody.addEventListener('click', e => {
      const btn = e.target.closest('.ipo-analysis-detail-btn');
      if (!btn) return;
      e.preventDefault();
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (!Number.isFinite(idx)) return;
      const panel = document.getElementById('ipo-analysis-detail-panel');
      if (panel && !panel.hidden && btn.classList.contains('active')) {
        hideAnalysisDetailPanel();
        return;
      }
      showAnalysisDetailPanel(idx);
    });

    if (closeBtn) closeBtn.addEventListener('click', hideAnalysisDetailPanel);
    analysisDetailBound = true;
  }

  function renderAnalysisTableRows(rows) {
    const tbody = document.getElementById('ipo-analysis-tbody');
    if (!tbody) return;
    const list = Array.isArray(rows) ? rows : [];
    currentAnalysisRows = list.slice();
    hideAnalysisDetailPanel();

    let html = '';
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const hasDeep = r.deep && String(r.deep).trim() && String(r.deep).trim() !== '—';
      html +=
        '<tr>' +
        '<td class="ipo-analysis-dim">' +
        esc(r.dimension) +
        '</td>' +
        '<td class="ipo-analysis-score"><span class="ipo-score-pill">' +
        esc(r.score) +
        '</span></td>' +
        '<td class="ipo-analysis-brief">' +
        '<div class="ipo-analysis-brief-text">' +
        esc(r.brief) +
        '</div>' +
        (hasDeep
          ? '<button type="button" class="ipo-analysis-detail-btn" data-idx="' +
            i +
            '">查看详情</button>'
          : '') +
        '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
    bindAnalysisDetailPanel();
  }

  function destroyIpoRadarChart() {
    if (myRadarChart) {
      try {
        myRadarChart.destroy();
      } catch (_) {
        /* canvas may already be detached */
      }
    }
    myRadarChart = null;
    global.myRadarChart = null;
    radarChartReady = false;
    analysisDetailBound = false;
    currentAnalysisRows = [];
    clearLoadingTimer();
  }

  function initIpoRadarChart(initialScores) {
    if (radarChartReady && myRadarChart) return myRadarChart;
    const canvas = document.getElementById('ipo-radar-canvas');
    if (!canvas || typeof global.Chart === 'undefined') return null;

    const labels = IPO_LIST_RADAR_AXES.map(a => a.label);
    const data = Array.isArray(initialScores) && initialScores.length === labels.length ? initialScores : labels.map(() => 50);

    myRadarChart = new global.Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: {
        labels,
        datasets: [
          {
            label: '打新质量',
            data: data.slice(),
            backgroundColor: 'rgba(249, 115, 22, 0.18)',
            borderColor: '#f97316',
            borderWidth: 2,
            pointBackgroundColor: '#f97316',
            pointBorderColor: '#fff',
            pointRadius: 4,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1,
        animation: { duration: 650, easing: 'easeOutQuart' },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw}` } } },
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { stepSize: 20, display: false },
            grid: { color: 'rgba(0,0,0,.08)' },
            angleLines: { color: 'rgba(0,0,0,.06)' },
            pointLabels: { font: { size: 10, family: "'Noto Sans SC',sans-serif" }, color: '#374151', padding: 6 },
          },
        },
      },
    });

    radarChartReady = true;
    global.myRadarChart = myRadarChart;
    requestAnimationFrame(() => {
      if (myRadarChart) myRadarChart.resize();
    });
    return myRadarChart;
  }

  function loadAiCacheFromStorage() {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(AI_CACHE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        global.__IPO_AI_ANALYSIS_CACHE__ = Object.assign(global.__IPO_AI_ANALYSIS_CACHE__ || {}, parsed);
      }
    } catch (_) {
      /* quota / parse */
    }
  }

  function persistAiCacheToStorage() {
    if (typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem(AI_CACHE_STORAGE_KEY, JSON.stringify(global.__IPO_AI_ANALYSIS_CACHE__ || {}));
    } catch (_) {
      /* quota */
    }
  }

  function getAiCacheKey(d) {
    return (d && (d.code || d.name)) || '';
  }

  function getCachedAiAnalysis(d) {
    if (!d) return null;
    if (d.aiAnalysis && d.aiAnalysis.dimensions) return d.aiAnalysis;
    const key = getAiCacheKey(d);
    if (!key) return null;
    global.__IPO_AI_ANALYSIS_CACHE__ = global.__IPO_AI_ANALYSIS_CACHE__ || {};
    return global.__IPO_AI_ANALYSIS_CACHE__[key] || null;
  }

  function setCachedAiAnalysis(d, json) {
    if (!d || !json) return;
    d.aiAnalysis = json;
    const key = getAiCacheKey(d);
    if (key) {
      global.__IPO_AI_ANALYSIS_CACHE__ = global.__IPO_AI_ANALYSIS_CACHE__ || {};
      global.__IPO_AI_ANALYSIS_CACHE__[key] = json;
      persistAiCacheToStorage();
    }
  }

  function clearLoadingTimer() {
    if (loadingTimer) {
      clearInterval(loadingTimer);
      loadingTimer = null;
    }
  }

  function getStockDisplayKey(d) {
    if (!d) return '';
    return String(d.name || d.code || '').trim();
  }

  function isActiveStockModel(d) {
    const key = getStockDisplayKey(d);
    return !!(key && currentActiveStockKey && key === currentActiveStockKey);
  }

  function captureSheetAnalysisFallback(d) {
    if (!d || d._sheetAnalysisFallback) return;
    d._sheetAnalysisFallback = {
      scores: Array.isArray(d.scores) ? d.scores.slice() : null,
      analysisRows: (d.analysisRows || []).map(r => Object.assign({}, r)),
      overallSummary: d.overallSummary,
      totalScore: d.totalScore,
      avgScore: d.avgScore,
      maxTotalScore: d.maxTotalScore,
    };
  }

  function restoreSheetAnalysisFallback(d) {
    const fb = d && d._sheetAnalysisFallback;
    if (!fb) return false;
    if (fb.scores) d.scores = fb.scores.slice();
    if (fb.analysisRows) d.analysisRows = fb.analysisRows.map(r => Object.assign({}, r));
    if (fb.overallSummary != null) d.overallSummary = fb.overallSummary;
    if (fb.totalScore != null) d.totalScore = fb.totalScore;
    if (fb.avgScore != null) d.avgScore = fb.avgScore;
    if (fb.maxTotalScore != null) d.maxTotalScore = fb.maxTotalScore;
    return true;
  }

  function isIpoAnalysisApiReachable(apiBase) {
    const base = String(apiBase || '').trim();
    if (!base) return false;
    try {
      const u = new URL(base);
      const pageHost = global.location && global.location.hostname;
      const localApi = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
      const localPage = !pageHost || pageHost === 'localhost' || pageHost === '127.0.0.1';
      if (localApi && !localPage) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function showAnalysisLoadingPlaceholders(d) {
    captureSheetAnalysisFallback(d);
    clearLoadingTimer();
    const stockKey = getStockDisplayKey(d);
    const start = Date.now();
    const tick = () => {
      if (stockKey !== currentActiveStockKey) {
        clearLoadingTimer();
        return;
      }
      const sec = Math.floor((Date.now() - start) / 1000);
      const msg =
        sec < 3
          ? 'AI 研判中，预计约 40–60 秒…'
          : `AI 研判中，已等待 ${sec} 秒（通常 40–60 秒内完成）`;
      d.overallSummary = msg;
      const summaryEl = document.getElementById('ipo-score-summary');
      if (summaryEl) summaryEl.innerText = msg;
    };
    d.analysisRows = IPO_LIST_RADAR_AXES.map(a => ({
      dimension: a.label,
      score: '…',
      brief: 'AI 研判中…',
      deep: '',
    }));
    d.overallSummary = 'AI 研判中，预计约 40–60 秒…';
    if (isActiveStockModel(d)) refreshAnalysisPanels(d);
    tick();
    loadingTimer = setInterval(tick, 1000);
  }

  function finishAnalysisWithFallback(d, reason) {
    clearLoadingTimer();
    if (!d) return;
    const restored = restoreSheetAnalysisFallback(d);
    if (!restored && d.sheetRow) {
      enrichModelWithRadar(d, d.sheetRow, null, { n: d.rating || 3 });
    }
    if (reason && isActiveStockModel(d)) {
      const base = String(d.overallSummary || '').trim();
      const suffix = '（在线 AI 暂不可用，已展示表格缓存分）';
      if (!base || /AI 研判中/.test(base)) {
        d.overallSummary = reason;
      } else if (!base.includes('在线 AI 暂不可用')) {
        d.overallSummary = base + suffix;
      }
    }
    if (isActiveStockModel(d)) refreshAnalysisPanels(d);
  }

  function formatDimScoreForLabel(sc) {
    if (sc == null || sc === '…' || sc === '—' || sc === '') return '';
    const n = Number(sc);
    if (Number.isFinite(n)) return String(n);
    return String(sc);
  }

  function buildRadarLabels(d) {
    return IPO_LIST_RADAR_AXES.map((a, i) => {
      let sc = null;
      if (d.analysisRows && d.analysisRows[i] && d.analysisRows[i].score != null) {
        sc = d.analysisRows[i].score;
      } else if (Array.isArray(d.scores) && d.scores[i] != null) {
        sc = Math.round((Number(d.scores[i]) / 20) * 10) / 10;
      }
      const scStr = formatDimScoreForLabel(sc);
      return scStr ? a.label + ' ' + scStr : a.label;
    });
  }

  function refreshAnalysisPanels(d) {
    if (!isActiveStockModel(d)) return;
    if (!myRadarChart) initIpoRadarChart(d.scores);
    if (myRadarChart && Array.isArray(d.scores)) {
      myRadarChart.data.labels = buildRadarLabels(d);
      myRadarChart.data.datasets[0].data = d.scores.slice();
      myRadarChart.update('none');
      requestAnimationFrame(function () {
        if (myRadarChart) myRadarChart.resize();
      });
    }
    renderAnalysisTableRows(d.analysisRows || []);

    const maxTotal = d.maxTotalScore != null ? d.maxTotalScore : IPO_LIST_RADAR_AXES.length * 5;
    const totalEl = document.getElementById('ipo-score-total');
    const avgEl = document.getElementById('ipo-score-avg');
    const summaryEl = document.getElementById('ipo-score-summary');
    if (totalEl) {
      totalEl.innerText = d.totalScore != null ? String(d.totalScore) : '—';
    }
    if (avgEl) {
      avgEl.innerText =
        d.avgScore != null ? `均值 ${d.avgScore} · 满分 ${maxTotal}` : '';
    }
    if (summaryEl) summaryEl.innerText = d.overallSummary || '—';
  }

  function applyStockAnalysisPayload(d, json, options) {
    if (!d || !json || !json.dimensions) {
      if (options && options.refreshUi !== false && isActiveStockModel(d)) {
        finishAnalysisWithFallback(d, '研判结果格式异常，已回退表格缓存分。');
      }
      return false;
    }
    const labelMap = {};
    IPO_LIST_RADAR_AXES.forEach(a => {
      labelMap[a.key] = a.label;
    });
    d.analysisRows = IPO_API_DIM_ORDER.map(key => {
      const dim = json.dimensions[key] || {};
      return {
        dimension: labelMap[key] || key,
        score: dim.score != null ? dim.score : '—',
        brief: dim.one_liner || '—',
        deep: dim.deep_analysis || '—',
      };
    });
    d.scores = Array.isArray(json.radarScores)
      ? json.radarScores.slice()
      : IPO_API_DIM_ORDER.map(key => Math.round(Number(json.dimensions[key]?.score || 0) * 20));
    d.overallSummary = json.summary || d.overallSummary;
    d.totalScore = json.totalScore;
    d.avgScore = json.avgScore;
    d.maxTotalScore = json.maxTotalScore || IPO_LIST_RADAR_AXES.length * 5;
    setCachedAiAnalysis(d, json);
    if (d.code && typeof global.updateIpoTabCardWeather === 'function') {
      global.updateIpoTabCardWeather(d.code, json.totalScore);
    }
    const refreshUi = options && options.refreshUi != null ? options.refreshUi : isActiveStockModel(d);
    if (!refreshUi) return true;
    clearLoadingTimer();
    refreshAnalysisPanels(d);
    return true;
  }

  async function fetchStockAnalysisFromApi(d, stockName, options) {
    const silent = !!(options && options.silent);
    const apiBase = String(global.__IPO_API_BASE__ || 'http://127.0.0.1:8788').replace(/\/$/, '');
    const seq = ++analysisFetchSeq;
    const requestKey = String(stockName || getStockDisplayKey(d)).trim();

    if (!isIpoAnalysisApiReachable(apiBase)) {
      if (!silent && isActiveStockModel(d)) {
        finishAnalysisWithFallback(
          d,
          '研判暂时受阻：线上环境未配置 AI 分析 API，请部署 npm run api:ipo 并设置 __IPO_API_BASE__。',
        );
      }
      return null;
    }

    if (!silent) showAnalysisLoadingPlaceholders(d);

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), AI_ANALYSIS_FETCH_TIMEOUT_MS)
      : null;

    try {
      const res = await fetch(apiBase + '/api/get-stock-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          stockName: stockName,
          code: d.code,
          row: d.sheetRow || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || '分析接口失败 HTTP ' + res.status);
      }
      if (seq !== analysisFetchSeq || requestKey !== currentActiveStockKey) {
        applyStockAnalysisPayload(d, json, { refreshUi: false });
        return null;
      }
      applyStockAnalysisPayload(d, json);
      return json;
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      const msg = aborted
        ? 'AI 研判超时（超过 ' + Math.round(AI_ANALYSIS_FETCH_TIMEOUT_MS / 1000) + ' 秒），已回退表格缓存分。'
        : String(err && err.message ? err.message : err);
      if (seq === analysisFetchSeq && requestKey === currentActiveStockKey && !silent) {
        console.warn('[switchStock] AI 分析降级为表格缓存分', err);
        finishAnalysisWithFallback(d, '研判暂时受阻：' + msg);
      }
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /** 详情页 AI 研判入口：抓取表格分 → 请求 API → 强制替换占位符 */
  async function loadIpoDetailAnalysis(d, stockName, options) {
    if (!d) return null;
    const key = String(stockName || getStockDisplayKey(d)).trim();
    const cached = getCachedAiAnalysis(d);
    const bgRefresh = !!(options && options.backgroundRefresh);

    if (cached) {
      applyStockAnalysisPayload(d, cached);
      if (bgRefresh) return fetchStockAnalysisFromApi(d, key, { silent: true });
      return cached;
    }

    if (isActiveStockModel(d)) refreshAnalysisPanels(d);
    return fetchStockAnalysisFromApi(d, key, { silent: false });
  }

  function switchStock(stockName, options) {
    const key = String(stockName || '').trim();
    const d = global.stockData && global.stockData[key];
    if (!d) return;

    currentActiveStockKey = key;
    clearLoadingTimer();
    document.querySelectorAll('.ipo-tab-card').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-stock-name') === key);
    });

    const nameEl = document.getElementById('ipo-detail-name');
    if (nameEl) nameEl.innerText = d.name || key;

    const grid = Array.isArray(d.detailGrid8) ? d.detailGrid8 : [];
    for (let i = 0; i < 8; i++) {
      const m = grid[i] || { label: '—', val: '—', valColor: null };
      const lbl = document.getElementById('ipo-metric-lbl-' + i);
      const val = document.getElementById('ipo-metric-val-' + i);
      if (lbl) lbl.innerText = m.label || '—';
      if (val) {
        val.innerText = m.val != null ? String(m.val) : '—';
        val.style.color = m.valColor || '#111';
      }
    }

    for (let i = 0; i < 3; i++) {
      const b = document.getElementById('ipo-bull-' + i);
      const r = document.getElementById('ipo-bear-' + i);
      const bullText = d.bull && d.bull[i] ? String(d.bull[i]) : '';
      const bearText = d.bear && d.bear[i] ? String(d.bear[i]) : '';
      if (b) {
        b.innerText = bullText;
        b.parentElement.style.display = bullText ? '' : 'none';
      }
      if (r) {
        r.innerText = bearText;
        r.parentElement.style.display = bearText ? '' : 'none';
      }
    }

    const darkEl = document.getElementById('ipo-dark-date');
    const listEl = document.getElementById('ipo-list-date');
    if (darkEl) darkEl.innerText = d.darkDate || '--';
    if (listEl) listEl.innerText = d.listDate || '--';

    const actionEl = document.getElementById('ipo-detail-action');
    if (actionEl) {
      const ana = global.IPO_ANALYSIS && d.code && global.IPO_ANALYSIS[d.code];
      if (ana) {
        actionEl.innerHTML =
          '<button type="button" class="ipo-detail-btn" onclick="openIpoAnalysis(\'' +
          esc(d.code) +
          '\')">查看完整分析 →</button>';
      } else {
        actionEl.innerHTML = '<span class="ipo-detail-muted">本标的暂无内置深度模态框</span>';
      }
    }

    const bgRefresh = !!(options && options.backgroundRefresh);
    loadIpoDetailAnalysis(d, key, { backgroundRefresh: bgRefresh });
  }

  function enrichModelWithRadar(model, row, getter, rating) {
    const scores = buildRadarScoresFromRow(row, getter, rating);
    const analysisRows = buildAnalysisRowsFromSheet(row, scores, getter);
    const totals = calcScoreTotals(scores);
    model.scores = scores;
    model.analysisRows = analysisRows;
    model.radarLabels = IPO_LIST_RADAR_AXES.map(a => a.label);
    const scores05 = scores.map(s => Math.round((Number(s) / 20) * 10) / 10);
    model.totalScore = Math.round(scores05.reduce((a, b) => a + b, 0) * 10) / 10;
    model.avgScore = Math.round((model.totalScore / scores05.length) * 10) / 10;
    model.maxTotalScore = IPO_LIST_RADAR_AXES.length * 5;
    model.overallSummary = buildOverallSummary(row, scores, getter, rating);
    model.sheetRow = row;
    return model;
  }

  function buildStockDataMap(modelsByCode) {
    const out = {};
    const models = modelsByCode || {};
    const cache = global.__IPO_AI_ANALYSIS_CACHE__ || {};
    Object.keys(models).forEach(code => {
      const m = models[code];
      if (!m || !m.name) return;
      if (!m.aiAnalysis && cache[code]) m.aiAnalysis = cache[code];
      if (m.aiAnalysis && m.aiAnalysis.totalScore != null) {
        m.totalScore = m.aiAnalysis.totalScore;
        if (m.aiAnalysis.avgScore != null) m.avgScore = m.aiAnalysis.avgScore;
      }
      out[m.name] = m;
    });
    global.stockData = out;
    return out;
  }

  global.IPO_LIST_RADAR_AXES = IPO_LIST_RADAR_AXES;
  global.buildIpoListRadarScores = buildRadarScoresFromRow;
  global.buildIpoListAnalysisRows = buildAnalysisRowsFromSheet;
  global.enrichIpoModelWithRadar = enrichModelWithRadar;
  global.buildIpoListDetailShellHtml = buildDetailShellHtml;
  global.destroyIpoListRadarChart = destroyIpoRadarChart;
  global.initIpoListRadarChart = initIpoRadarChart;
  global.renderIpoAnalysisTableRows = renderAnalysisTableRows;
  global.switchStock = switchStock;
  global.loadIpoDetailAnalysis = loadIpoDetailAnalysis;
  global.buildStockDataFromModels = buildStockDataMap;
  global.__ipoGetActiveTabStockName = function __ipoGetActiveTabStockName() {
    if (currentActiveStockKey) return currentActiveStockKey;
    const active = global.document && global.document.querySelector('.ipo-tab-card.active');
    return active ? active.getAttribute('data-stock-name') : null;
  };

  loadAiCacheFromStorage();
})(typeof window !== 'undefined' ? window : this);
