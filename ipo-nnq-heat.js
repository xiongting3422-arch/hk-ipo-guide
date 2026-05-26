/**
 * 牛牛圈 IPO 舆情看板
 * 布局路径：市场总览 → 个股分析 → 话题拆解 → 内容聚合
 */
(function (global) {
  'use strict';

  const JSON_FILE = './nnq-heat.json';
  const BUILD_ID = '20260525h';

  let postGenStyle = 'brief';
  let postGenText = '';
  let postGenSource = '';
  let topicModalAnalysis = null;

  /** 打新预期雷达五维（0–100） */
  const IPO_RADAR_AXES = [
    { key: 'bullishSentiment', label: '社区看多', color: '#16a34a' },
    { key: 'breakConcern', label: '破发担忧', color: '#dc2626' },
    { key: 'greyMarketExpect', label: '暗盘预期', color: '#7c3aed' },
    { key: 'lotRateHeat', label: '中签率热度', color: '#2563eb' },
    { key: 'sectorHeat', label: '赛道热度', color: '#f97316' },
  ];

  const SPONSOR_BREAK_RATES = {
    '东方证券': 0.34,
    '民银资本': 0.31,
    '交银国际': 0.29,
    '华升资本': 0.28,
    '中泰国际': 0.27,
    '天风证券': 0.26,
    '中银国际': 0.18,
    '中国国际金融': 0.22,
    '中信建投': 0.19,
  };

  const DOMINANT_LABELS = {
    bullish: { text: '看多', cls: 'bullish' },
    bearish: { text: '看空', cls: 'bearish' },
    watch: { text: '观望', cls: 'watch' },
    neutral: { text: '中性', cls: 'neutral' },
  };

  const SENT_ROW_LABELS = {
    bullish: '看多',
    bearish: '看空',
    watch: '观望',
    neutral: '中性',
  };

  const SENT_ROW_COLORS = {
    bullish: '#16a34a',
    bearish: '#dc2626',
    watch: '#d97706',
    neutral: '#a1a1aa',
  };

  const PIE_COLORS = {
    bullish: '#16a34a',
    bearish: '#dc2626',
    watch: '#d97706',
  };

  const KW_CATEGORIES = {
    trade: {
      title: '交易行为词',
      icon: '📊',
      words: ['打新', '申购', '中签', '暗盘', '孖展', '绿鞋', '超额认购', '回拨', '稳价人', '一手中签率'],
    },
    fundamental: {
      title: '基本面词',
      icon: '📋',
      words: ['招股', '基石', '招股书', '市盈率', '保荐', '入场费', '发行', '聆讯', '招股期', '新股'],
    },
    risk: {
      title: '风险词',
      icon: '⚠️',
      words: ['破发', '劝退', '避雷', '坑', '弃购', '估值过高', '割韭菜', '冷场', '超额冷门'],
    },
    bullish: {
      title: '利好词',
      icon: '📈',
      words: ['必打', '大肉', '稳中签', '看好', '梭哈', '值得打', '参与', '冲', '上车'],
    },
  };

  const BOARD_TABS = [
    { id: 'heat', label: '热度榜' },
    { id: 'bullish', label: '看多榜' },
    { id: 'risk', label: '风险预警榜' },
    { id: 'sector', label: '赛道聚合榜' },
  ];

  let nnqHeatLoaded = false;
  let nnqHeatLoading = false;
  let nnqHeatData = null;
  let activeBoardTab = 'heat';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtPct(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toFixed(1) + '%' : '—';
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
      return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Hong_Kong' });
    } catch (_) {
      return iso;
    }
  }

  function sentimentLabel(s) {
    if (s === 'positive') return { text: '正面', color: '#16a34a', bg: 'rgba(22,163,74,.1)' };
    if (s === 'negative') return { text: '负面', color: '#dc2626', bg: 'rgba(220,38,38,.1)' };
    return { text: '中性', color: '#52525b', bg: 'rgba(82,82,91,.08)' };
  }

  function hasV2Data(data) {
    if (!data) return false;
    if (Number(data.schemaVersion) >= 2) return true;
    return !!(
      (data.stockInsights && data.stockInsights.length) ||
      data.marketInsights ||
      (data.dailyTrend && data.dailyTrend.length)
    );
  }

  function getStockList(data) {
    if (data.stockInsights && data.stockInsights.length) return data.stockInsights;
    return (data.topStocks || []).map(function (r) {
      return {
        code: r.code,
        name: r.name,
        mentions: r.mentions,
        heatIndex: r.heatIndex != null ? r.heatIndex : r.engagement,
        disagreementIndex: r.disagreementIndex,
        sentimentBreakdown: {
          bullish: { pct: 0 },
          bearish: { pct: 0 },
          watch: { pct: 0 },
          neutral: { pct: 100 },
          dominant: 'neutral',
        },
        weightedHeat: { weightedScore: r.weightedScore || r.engagement },
        basicTags: {},
        relatedKeywords: [],
      };
    });
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

  function kwAffinity(stock, word) {
    const list = stock.relatedKeywords || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].word === word) return list[i].affinity || 0;
    }
    return 0;
  }

  function clampScore(v) {
    return Math.max(0, Math.min(100, v));
  }

  /** 模块1 · 个股打新预期雷达（优先读 JSON ipoRadar，否则前端推算） */
  function computeIpoRadar(stock, data) {
    if (stock.ipoRadar && stock.ipoRadar.scores) return stock.ipoRadar;

    const sb = stock.sentimentBreakdown || {};
    const tiers = (stock.weightedHeat && stock.weightedHeat.tiers) || {};
    const tags = stock.basicTags || {};
    const sectorHeat = ((data.marketInsights && data.marketInsights.sectorHeat) || []);
    let maxSector = 1;
    const sectorMap = {};
    sectorHeat.forEach(function (r) {
      sectorMap[r.sectorGroup || '其他'] = r.heatScore || 0;
      maxSector = Math.max(maxSector, r.heatScore || 0);
    });

    const bullish = (sb.bullish && sb.bullish.pct) || 0;
    const bearish = (sb.bearish && sb.bearish.pct) || 0;
    const breakConcern = clampScore(bearish + kwAffinity(stock, '破发') * 100);
    const greyMarket = clampScore(
      Math.max(kwAffinity(stock, '暗盘'), kwAffinity(stock, '暗盘套利')) * 100 +
        ((tiers.lotteryShare && tiers.lotteryShare.posts) || 0) * 20
    );
    const lotRate = clampScore(
      Math.max(kwAffinity(stock, '中签'), kwAffinity(stock, '一手中签率')) * 100 +
        ((tiers.lotteryShare && tiers.lotteryShare.posts) || 0) * 25 +
        (tags.lotRateExpect ? 15 : 0)
    );
    const group = tags.sectorGroup || '其他';
    const sectorNorm = clampScore(((sectorMap[group] || 0) / maxSector) * 100);

    return {
      labels: {},
      order: IPO_RADAR_AXES.map(function (a) { return a.key; }),
      scores: {
        bullishSentiment: Math.round(bullish * 10) / 10,
        breakConcern: Math.round(breakConcern * 10) / 10,
        greyMarketExpect: Math.round(greyMarket * 10) / 10,
        lotRateHeat: Math.round(lotRate * 10) / 10,
        sectorHeat: Math.round(sectorNorm * 10) / 10,
      },
    };
  }

  function renderRadarSvg(radar, size) {
    const scores = radar.scores || {};
    const n = IPO_RADAR_AXES.length;
    const cx = size / 2;
    const cy = size / 2;
    const maxR = size * 0.36;
    const rings = [0.25, 0.5, 0.75, 1].map(function (p) {
      const r = maxR * p;
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--b1)" stroke-width="0.6"/>';
    }).join('');

    const axes = IPO_RADAR_AXES.map(function (axis, i) {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = cx + maxR * Math.cos(ang);
      const y = cy + maxR * Math.sin(ang);
      const lx = cx + (maxR + 14) * Math.cos(ang);
      const ly = cy + (maxR + 14) * Math.sin(ang);
      const anchor = Math.abs(Math.cos(ang)) < 0.2 ? 'middle' : Math.cos(ang) > 0 ? 'start' : 'end';
      return (
        '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" stroke="var(--s3)" stroke-width="0.8"/>' +
        '<text x="' + lx + '" y="' + ly + '" font-size="7" fill="var(--t3)" text-anchor="' + anchor + '" dominant-baseline="middle">' +
        esc(axis.label) + '</text>'
      );
    }).join('');

    const pts = IPO_RADAR_AXES.map(function (axis, i) {
      const val = (scores[axis.key] || 0) / 100;
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const r = maxR * val;
      return (cx + r * Math.cos(ang)).toFixed(1) + ',' + (cy + r * Math.sin(ang)).toFixed(1);
    }).join(' ');

    return (
      '<svg class="nnq-heat-radar-svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">' +
      rings + axes +
      '<polygon points="' + pts + '" fill="rgba(249,115,22,.18)" stroke="#f97316" stroke-width="1.4"/>' +
      '</svg>'
    );
  }

  function renderIpoRadarCard(stock, data) {
    const radar = computeIpoRadar(stock, data);
    const scores = radar.scores || {};
    const summary = IPO_RADAR_AXES.map(function (a) {
      return a.label + ' ' + (scores[a.key] ?? 0);
    }).join(' · ');
    return (
      '<div class="nnq-heat-radar-card">' +
      '<div class="nnq-heat-radar-head">' +
      '<div class="nnq-heat-stock-name">' + esc(stock.name) + ' <span class="nnq-heat-code">' + esc(stock.code) + '</span></div>' +
      '<div class="nnq-heat-radar-sub">热度 ' + (stock.heatIndex ?? '—') + '</div></div>' +
      renderRadarSvg(radar, 168) +
      '<div class="nnq-heat-radar-foot" title="' + esc(summary) + '">' + esc(summary) + '</div></div>'
    );
  }

  function renderIpoRadarModule(data) {
    const stocks = getStockList(data)
      .slice()
      .sort(function (a, b) { return (b.heatIndex || 0) - (a.heatIndex || 0); })
      .slice(0, 6);
    if (!stocks.length) {
      return (
        '<div class="nnq-heat-panel nnq-heat-radar-module">' +
        '<div class="nnq-heat-panel-title"><span>🕸️</span>个股打新预期雷达</div>' +
        '<div class="nnq-heat-empty">暂无上榜个股雷达数据</div></div>'
      );
    }
    return (
      '<div class="nnq-heat-panel nnq-heat-radar-module">' +
      '<div class="nnq-heat-panel-title"><span>🕸️</span>个股打新预期雷达</div>' +
      '<div class="nnq-heat-panel-desc">五维打新态度：看多 · 破发担忧 · 暗盘 · 中签率 · 赛道（0–100）</div>' +
      '<div class="nnq-heat-radar-grid">' + stocks.map(function (s) { return renderIpoRadarCard(s, data); }).join('') + '</div></div>'
    );
  }

  /** 模块2 · 风险预警高亮条（优先读 riskHighlightBars） */
  function buildRiskHighlightBars(data) {
    if (data.riskHighlightBars && data.riskHighlightBars.length) return data.riskHighlightBars;

    const stocks = getStockList(data);
    const spikes = {};
    ((data.riskAlerts && data.riskAlerts.stockSentimentSpikes) || []).forEach(function (s) {
      if (s.code) spikes[s.code] = s;
    });

    const breakRank = (data.keywordStockMap || [])
      .filter(function (r) { return r.word && r.word.indexOf('破发') >= 0; })
      .sort(function (a, b) {
        return ((b.topStock && b.topStock.affinity) || 0) - ((a.topStock && a.topStock.affinity) || 0);
      })
      .slice(0, 3)
      .map(function (r) { return r.topStock && r.topStock.code; })
      .filter(Boolean);
    const breakSet = {};
    breakRank.forEach(function (c) { breakSet[c] = true; });

    const bars = [];
    stocks.forEach(function (stock) {
      const tags = [];
      const triggers = [];
      const spike = spikes[stock.code];
      if (spike && (spike.growthRate || 0) > 0.3) {
        tags.push('负面增速');
        triggers.push('负面情绪单日增速 ' + Math.round((spike.growthRate || 0) * 100) + '%');
      }
      if (breakSet[stock.code]) {
        tags.push('破发TOP3');
        triggers.push('「破发」关键词关联度 TOP3');
      }
      const sponsor = (stock.basicTags && stock.basicTags.sponsor) || '';
      const sRate = lookupSponsorBreakRate(sponsor);
      if (sRate != null && sRate >= 0.25) {
        tags.push('保荐风险');
        triggers.push('保荐人历史破发率约 ' + Math.round(sRate * 100) + '%');
      }
      if (!tags.length) return;

      const concerns = [];
      const bear = (stock.sentimentBreakdown && stock.sentimentBreakdown.bearish && stock.sentimentBreakdown.bearish.pct) || 0;
      if (bear > 0) concerns.push('看空讨论占比 ' + bear + '%');
      ['破发', '估值过高', '劝退'].forEach(function (w) {
        const aff = kwAffinity(stock, w);
        if (aff >= 0.3) concerns.push('「' + w + '」关联 ' + Math.round(aff * 100) + '%');
      });
      if (!concerns.length) concerns.push('社区担忧尚未集中，建议持续跟踪');

      bars.push({
        code: stock.code,
        name: stock.name,
        severity: tags.length >= 2 ? 'high' : 'medium',
        riskTags: tags,
        triggers: triggers,
        concerns: concerns.slice(0, 4),
        sponsorBreakRate: sRate,
      });
    });
    return bars;
  }

  function renderRiskHighlightStrip(bars) {
    if (!bars.length) {
      return (
        '<div class="nnq-heat-risk-strip nnq-heat-risk-strip--ok">' +
        '<div class="nnq-heat-risk-strip-icon">✓</div>' +
        '<div><strong>风险监测正常</strong>' +
        '<div class="nnq-heat-risk-strip-sub">未触发：负面增速&gt;30% · 破发TOP3 · 保荐高破发率</div></div></div>'
      );
    }
    return (
      '<div class="nnq-heat-risk-strip-wrap">' +
      bars.map(function (bar) {
        const tagHtml = (bar.riskTags || []).map(function (t) {
          return '<span class="nnq-heat-risk-tag">' + esc(t) + '</span>';
        }).join('');
        const triggerHtml = (bar.triggers || []).map(function (t) { return esc(t); }).join(' · ');
        const concernHtml = (bar.concerns || []).map(function (c) { return esc(c); }).join('；');
        return (
          '<div class="nnq-heat-risk-strip nnq-heat-risk-strip--' + (bar.severity || 'medium') + '">' +
          '<div class="nnq-heat-risk-strip-icon">⚠</div>' +
          '<div class="nnq-heat-risk-strip-main">' +
          '<div class="nnq-heat-risk-strip-title">' +
          esc(bar.name) + ' <span class="nnq-heat-code">' + esc(bar.code) + '</span>' +
          tagHtml + '</div>' +
          '<div class="nnq-heat-risk-strip-triggers">' + triggerHtml + '</div>' +
          '<div class="nnq-heat-risk-strip-concerns"><strong>核心担忧：</strong>' + concernHtml + '</div></div></div>'
        );
      }).join('') +
      '</div>'
    );
  }

  function aggregateMarketSentiment(data) {
    const stocks = getStockList(data);
    let bullish = 0;
    let bearish = 0;
    let watch = 0;
    stocks.forEach(function (s) {
      const sb = s.sentimentBreakdown || {};
      bullish += sb.bullish?.count || 0;
      bearish += sb.bearish?.count || 0;
      watch += (sb.watch?.count || 0) + (sb.neutral?.count || 0);
    });
    if (bullish + bearish + watch === 0) {
      const sum = data.summary || {};
      bullish = sum.positiveCount || 0;
      bearish = sum.negativeCount || 0;
      watch = sum.neutralCount || 0;
    }
    const total = bullish + bearish + watch || 1;
    return {
      bullish,
      bearish,
      watch,
      bullishPct: (bullish / total) * 100,
      bearishPct: (bearish / total) * 100,
      watchPct: (watch / total) * 100,
      total,
    };
  }

  function buildKeywordStockLookup(data) {
    const map = {};
    (data.keywordStockMap || []).forEach(function (row) {
      if (row.word) map[row.word] = row.topStock || {};
    });
    return map;
  }

  function buildKeywordGrowthLookup(data) {
    const map = {};
    const alerts = (data.riskAlerts && data.riskAlerts.keywordSpikes) || [];
    alerts.forEach(function (a) {
      if (a.word) map[a.word] = a.growthRate;
    });
    const trend = data.dailyTrend || [];
    const last7 = trend.slice(-7);
    const prior7 = trend.slice(-14, -7);
    function sumRiskWords(rows) {
      const c = {};
      rows.forEach(function (row) {
        (row.riskKeywordCounts || []).forEach(function (item) {
          c[item.word] = (c[item.word] || 0) + (item.count || 0);
        });
      });
      return c;
    }
    const recent = sumRiskWords(last7);
    const prior = sumRiskWords(prior7);
    Object.keys(recent).forEach(function (w) {
      if (map[w] != null) return;
      const p = prior[w] || 0;
      const r = recent[w] || 0;
      map[w] = p === 0 ? (r > 0 ? 1 : null) : (r - p) / p;
    });
    return map;
  }

  function classifyKeyword(word) {
    const w = word || '';
    for (const key of ['risk', 'bullish', 'trade', 'fundamental']) {
      const cat = KW_CATEGORIES[key];
      if (cat.words.some(function (k) { return w.includes(k) || k.includes(w); })) return key;
    }
    if (/暗盘|打新|申购|中签/.test(w)) return 'trade';
    if (/招股|基石|保荐/.test(w)) return 'fundamental';
    if (/破发|劝退|避雷/.test(w)) return 'risk';
    return 'fundamental';
  }

  function buildKeywordCategories(data) {
    const stockMap = buildKeywordStockLookup(data);
    const growthMap = buildKeywordGrowthLookup(data);
    const buckets = { trade: [], fundamental: [], risk: [], bullish: [] };
    const seen = {};

    function pushWord(word, count) {
      if (!word || seen[word]) return;
      seen[word] = true;
      const cat = classifyKeyword(word);
      const ts = stockMap[word] || {};
      const gr = growthMap[word];
      buckets[cat].push({
        word: word,
        count: count || 0,
        stock: ts.name && ts.name !== ts.code ? ts.name : ts.code || '—',
        stockCode: ts.code || '',
        growth: gr,
        isRisk: cat === 'risk',
      });
    }

    (data.topKeywords || []).forEach(function (r) { pushWord(r.word, r.count); });
    (data.keywordStockMap || []).forEach(function (r) { pushWord(r.word, r.topStock?.coOccur); });

    Object.keys(buckets).forEach(function (k) {
      buckets[k].sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
    });
    return buckets;
  }

  function buildStockBoards(data) {
    const stocks = getStockList(data).slice();
    const riskCodes = {};
    ((data.riskAlerts && data.riskAlerts.stockSentimentSpikes) || []).forEach(function (r) {
      if (r.code) riskCodes[r.code] = r;
    });

    const heat = stocks.slice().sort(function (a, b) {
      return (b.heatIndex || 0) - (a.heatIndex || 0);
    });

    const bullish = stocks.slice().sort(function (a, b) {
      const ap = (a.sentimentBreakdown && a.sentimentBreakdown.bullish && a.sentimentBreakdown.bullish.pct) || 0;
      const bp = (b.sentimentBreakdown && b.sentimentBreakdown.bullish && b.sentimentBreakdown.bullish.pct) || 0;
      return bp - ap || (b.heatIndex || 0) - (a.heatIndex || 0);
    });

    const risk = stocks
      .filter(function (s) {
        return riskCodes[s.code] || (s.disagreementIndex != null && s.disagreementIndex <= 25) ||
          ((s.sentimentBreakdown && s.sentimentBreakdown.bearish && s.sentimentBreakdown.bearish.pct) || 0) >= 20;
      })
      .sort(function (a, b) {
        const ar = riskCodes[a.code] ? 1 : 0;
        const br = riskCodes[b.code] ? 1 : 0;
        if (br !== ar) return br - ar;
        return (a.disagreementIndex ?? 100) - (b.disagreementIndex ?? 100);
      });

    const sectorMap = {};
    stocks.forEach(function (s) {
      const g = (s.basicTags && s.basicTags.sectorGroup) || '其他';
      if (!sectorMap[g]) {
        sectorMap[g] = { sectorGroup: g, heatScore: 0, stocks: [], mentions: 0 };
      }
      sectorMap[g].heatScore += s.heatIndex || 0;
      sectorMap[g].mentions += s.mentions || 0;
      sectorMap[g].stocks.push(s);
    });
    const sector = Object.values(sectorMap)
      .sort(function (a, b) { return b.heatScore - a.heatScore; })
      .map(function (g) {
        g.stocks.sort(function (a, b) { return (b.heatIndex || 0) - (a.heatIndex || 0); });
        return g;
      });

    return { heat: heat, bullish: bullish, risk: risk, sector: sector };
  }

  function buildConsensusViews(data) {
    return getStockList(data)
      .filter(function (s) { return (s.mentions || 0) >= 1; })
      .slice(0, 6)
      .map(function (s) {
        const sb = s.sentimentBreakdown || {};
        const dom = DOMINANT_LABELS[sb.dominant] || DOMINANT_LABELS.neutral;
        const kws = (s.relatedKeywords || []).slice(0, 4).map(function (k) { return k.word; }).join('、') || '—';
        const highDisagree = s.disagreementIndex != null && s.disagreementIndex <= 25;
        return {
          code: s.code,
          name: s.name,
          dominant: dom.text,
          dominantCls: dom.cls,
          heatIndex: s.heatIndex,
          disagreementIndex: s.disagreementIndex,
          keywords: kws,
          consensus: dom.text + '为主 · 话题聚焦「' + kws + '」',
          bullPoints: (sb.bullish?.pct || 0) > 0
            ? '看多占比 ' + fmtPct(sb.bullish.pct) + '，关注申购与上行空间'
            : '暂无明确看多观点',
          bearPoints: (sb.bearish?.pct || 0) > 0
            ? '看空占比 ' + fmtPct(sb.bearish.pct) + '，关注破发与估值风险'
            : highDisagree ? '观点分散，多空交织' : '暂无明确看空观点',
          highDisagree: highDisagree,
        };
      });
  }

  function extractAiInsight(stock, data) {
    const sb = stock.sentimentBreakdown || {};
    const tags = stock.basicTags || {};
    const dom = sb.dominant || 'neutral';
    const kws = (stock.relatedKeywords || []).slice(0, 3).map(function (k) { return k.word; }).join('、');
    let strategy = '观望等待更多招股反馈';
    if (dom === 'bullish') strategy = '可考虑参与申购，关注孖展与暗盘定价';
    if (dom === 'bearish') strategy = '建议谨慎弃购或降低仓位';
    if (dom === 'watch') strategy = '先观察孖展与同业表现，再决定是否申购';

    return {
      name: stock.name,
      code: stock.code,
      coreView: (DOMINANT_LABELS[dom] || DOMINANT_LABELS.neutral).text + ' · 热度指数 ' + (stock.heatIndex ?? '—'),
      bullLogic: dom === 'bullish' || (sb.bullish?.pct || 0) > 0
        ? '社区讨论偏正面，关键词：' + (kws || '打新/招股')
        : '尚未形成明确看多逻辑',
      bearLogic: dom === 'bearish' || (sb.bearish?.pct || 0) > 0
        ? '存在避雷/破发担忧，需关注估值与市场情绪'
        : '暂无集中看空逻辑',
      strategy: strategy,
      tags: [
        tags.sponsor && '保荐 ' + tags.sponsor,
        tags.sectorGroup && '赛道 ' + tags.sectorGroup,
        tags.issuePe && 'PE ' + tags.issuePe,
      ].filter(Boolean).join(' · '),
    };
  }

  async function fetchNnqHeatJson() {
    const res = await fetch(JSON_FILE + '?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ── 话题聚合分析 ─────────────────────────────────────────

  function topicMatch(word, topic) {
    if (!word || !topic) return false;
    const w = String(word).trim();
    const t = String(topic).trim();
    if (w === t) return true;
    return w.indexOf(t) >= 0 || t.indexOf(w) >= 0;
  }

  function stocksForKeyword(data, topic) {
    const stocks = getStockList(data);
    const affMap = {};
    (data.keywordStockMap || []).forEach(function (row) {
      if (!topicMatch(row.word, topic)) return;
      const ts = row.topStock || {};
      if (ts.code) affMap[ts.code] = Math.max(affMap[ts.code] || 0, ts.affinity || 0);
    });
    return stocks
      .filter(function (s) {
        if (affMap[s.code]) return true;
        return (s.relatedKeywords || []).some(function (k) { return topicMatch(k.word, topic); });
      })
      .map(function (s) {
        const sb = s.sentimentBreakdown || {};
        const dom = DOMINANT_LABELS[sb.dominant] || DOMINANT_LABELS.neutral;
        return {
          code: s.code,
          name: s.name,
          heatIndex: s.heatIndex,
          affinity: affMap[s.code] || kwAffinity(s, topic) || 0,
          dominant: dom.text,
          disagreementIndex: s.disagreementIndex,
          bullishPct: (sb.bullish && sb.bullish.pct) || 0,
          bearishPct: (sb.bearish && sb.bearish.pct) || 0,
        };
      })
      .sort(function (a, b) {
        return (b.affinity || 0) - (a.affinity || 0) || (b.heatIndex || 0) - (a.heatIndex || 0);
      });
  }

  function stocksForSector(data, sector) {
    return getStockList(data)
      .filter(function (s) {
        return ((s.basicTags && s.basicTags.sectorGroup) || '其他') === sector;
      })
      .map(function (s) {
        const sb = s.sentimentBreakdown || {};
        const dom = DOMINANT_LABELS[sb.dominant] || DOMINANT_LABELS.neutral;
        return {
          code: s.code,
          name: s.name,
          heatIndex: s.heatIndex,
          affinity: 1,
          dominant: dom.text,
          disagreementIndex: s.disagreementIndex,
          bullishPct: (sb.bullish && sb.bullish.pct) || 0,
          bearishPct: (sb.bearish && sb.bearish.pct) || 0,
        };
      })
      .sort(function (a, b) { return (b.heatIndex || 0) - (a.heatIndex || 0); });
  }

  function aggregateTopicSentiment(stocks) {
    if (!stocks.length) return { bullish: 0, bearish: 0, watch: 100 };
    let b = 0;
    let r = 0;
    stocks.forEach(function (s) {
      b += s.bullishPct || 0;
      r += s.bearishPct || 0;
    });
    const n = stocks.length;
    const watch = Math.max(0, 100 - (b + r) / n);
    return {
      bullish: Math.round((b / n) * 10) / 10,
      bearish: Math.round((r / n) * 10) / 10,
      watch: Math.round(watch * 10) / 10,
    };
  }

  function aggregateTopic(data, type, topic) {
    const index = data.topicAnalysisIndex || {};
    if (type === 'keyword' && index.keywords && index.keywords[topic]) {
      return index.keywords[topic];
    }
    if (type === 'sector' && index.sectors && index.sectors[topic]) {
      return index.sectors[topic];
    }

    let stocks = type === 'sector' ? stocksForSector(data, topic) : stocksForKeyword(data, topic);
    let mentionCount = stocks.length;
    if (type === 'keyword') {
      (data.topKeywords || []).forEach(function (k) {
        if (topicMatch(k.word, topic)) mentionCount = k.count || mentionCount;
      });
    }
    const sentiment = aggregateTopicSentiment(stocks);
    const disagreements = [];
    const highDis = stocks.filter(function (s) {
      return s.disagreementIndex != null && s.disagreementIndex <= 25;
    });
    if (highDis.length) {
      disagreements.push(
        '观点分化：' + highDis.slice(0, 3).map(function (s) { return s.name + '(' + s.code + ')'; }).join('、')
      );
    }
    const bearish = stocks.filter(function (s) { return (s.bearishPct || 0) >= 20; });
    if (bearish.length) {
      disagreements.push('偏空讨论：' + bearish.slice(0, 3).map(function (s) { return s.name; }).join('、'));
    }
    if (!disagreements.length) {
      disagreements.push(type === 'keyword' && topic.indexOf('破发') >= 0
        ? '破发话题下多空预期交织，需结合暗盘定价判断'
        : '暂未形成显著分歧');
    }
    let strategy = '中性观望，等待更多招股与暗盘反馈';
    if (type === 'keyword' && /破发|劝退|避雷|弃购/.test(topic)) {
      strategy = '偏防御：回避负面关联度高的标的，暗盘弱势则降低首日参与';
    } else if (sentiment.bullish >= 40 && stocks[0]) {
      strategy = '情绪偏暖，重点跟踪 ' + stocks[0].name + ' 孖展与暗盘后再决策';
    } else if (sentiment.bearish >= 30) {
      strategy = '谨慎参与，控制仓位，关注估值与保荐安全边际';
    }
    const result = {
      type: type,
      topic: topic,
      mentionCount: mentionCount,
      sentiment: sentiment,
      relatedStocks: stocks.slice(0, 8),
      disagreements: disagreements,
      strategy: strategy,
    };
    if (type === 'sector') {
      const row = ((data.marketInsights && data.marketInsights.sectorHeat) || []).find(function (r) {
        return r.sectorGroup === topic;
      });
      if (row) result.sectorHeatScore = row.heatScore;
    }
    return result;
  }

  function formatTopicCopy(analysis) {
    if (!analysis) return '';
    const label = analysis.type === 'sector' ? '赛道' : '话题';
    const sent = analysis.sentiment || {};
    const stocks = analysis.relatedStocks || [];
    const lines = [
      '📌 【' + label + '专项】#' + analysis.topic + '#',
      '',
      '🎯 市场情绪',
      '看多 ' + (sent.bullish || 0) + '% · 看空 ' + (sent.bearish || 0) + '% · 观望 ' + (sent.watch || 0) + '%',
      '提及/关联：' + (analysis.mentionCount ?? '—'),
      '',
      '🔗 关联标的',
    ];
    if (stocks.length) {
      stocks.slice(0, 5).forEach(function (s, i) {
        lines.push(
          (i + 1) + '. ' + s.name + '（' + s.code + '）热度 ' + (s.heatIndex ?? '—') + ' · ' + (s.dominant || '—')
        );
      });
    } else {
      lines.push('暂无直接关联个股');
    }
    lines.push('', '⚖️ 核心分歧');
    (analysis.disagreements || []).forEach(function (d) { lines.push('· ' + d); });
    lines.push('', '💡 打新策略参考', analysis.strategy || '', '', '#港股打新 #' + analysis.topic + ' #IPO舆情 #牛牛圈');
    return lines.join('\n');
  }

  function ensureTopicModal() {
    if (document.getElementById('nnq-topic-modal')) return;
    const el = document.createElement('div');
    el.id = 'nnq-topic-modal';
    el.className = 'nnq-heat-modal';
    el.innerHTML =
      '<div class="nnq-heat-modal-backdrop" data-nnq-modal-close="1"></div>' +
      '<div class="nnq-heat-modal-panel" role="dialog" aria-modal="true">' +
      '<button type="button" class="nnq-heat-modal-close" data-nnq-modal-close="1" aria-label="关闭">×</button>' +
      '<div class="nnq-heat-modal-title" id="nnq-topic-title"></div>' +
      '<div class="nnq-heat-modal-body" id="nnq-topic-body"></div>' +
      '<textarea id="nnq-topic-copy" class="nnq-heat-post-preview" rows="10" readonly></textarea>' +
      '<div class="nnq-heat-post-actions" style="margin-top:10px;">' +
      '<button type="button" class="nnq-heat-btn nnq-heat-btn--primary" id="nnq-topic-regen">一键生成文案</button>' +
      '<button type="button" class="nnq-heat-btn" id="nnq-topic-copy-btn">复制分析</button>' +
      '</div>' +
      '<div id="nnq-topic-modal-status" class="nnq-heat-post-status"></div></div>';
    document.body.appendChild(el);
  }

  function renderTopicModalBody(analysis) {
    const sent = analysis.sentiment || {};
    const stocks = analysis.relatedStocks || [];
    let html =
      '<div class="nnq-heat-topic-section"><strong>🎯 市场情绪</strong><p>看多 ' + sent.bullish +
      '% · 看空 ' + sent.bearish + '% · 观望 ' + sent.watch + '%</p></div>';
    html += '<div class="nnq-heat-topic-section"><strong>🔗 关联标的</strong>';
    if (stocks.length) {
      html += '<ul class="nnq-heat-topic-list">' + stocks.map(function (s) {
        return '<li><strong>' + esc(s.name) + '</strong> ' + esc(s.code) +
          ' · 热度 ' + (s.heatIndex ?? '—') + ' · ' + esc(s.dominant) +
          (s.disagreementIndex != null ? ' · 分歧 ' + s.disagreementIndex : '') + '</li>';
      }).join('') + '</ul>';
    } else {
      html += '<p class="nnq-heat-empty" style="padding:8px;">暂无关联个股</p>';
    }
    html += '</div><div class="nnq-heat-topic-section"><strong>⚖️ 核心分歧</strong><ul class="nnq-heat-topic-list">';
    (analysis.disagreements || []).forEach(function (d) {
      html += '<li>' + esc(d) + '</li>';
    });
    html += '</ul></div><div class="nnq-heat-topic-section"><strong>💡 策略参考</strong><p>' +
      esc(analysis.strategy || '') + '</p></div>';
    return html;
  }

  function openTopicModal(data, type, topic) {
    ensureTopicModal();
    const analysis = aggregateTopic(data, type, topic);
    topicModalAnalysis = analysis;
    const modal = document.getElementById('nnq-topic-modal');
    const title = document.getElementById('nnq-topic-title');
    const body = document.getElementById('nnq-topic-body');
    const copy = document.getElementById('nnq-topic-copy');
    const label = type === 'sector' ? '赛道聚合' : '关键词';
    if (title) {
      title.innerHTML = '📌 ' + esc(label) + ' · <span class="nnq-heat-kwmap-word">' + esc(topic) + '</span>';
    }
    if (body) body.innerHTML = renderTopicModalBody(analysis);
    const text = formatTopicCopy(analysis);
    if (copy) copy.value = text;
    if (modal) modal.classList.add('nnq-heat-modal--open');
    document.body.style.overflow = 'hidden';
  }

  function closeTopicModal() {
    const modal = document.getElementById('nnq-topic-modal');
    if (modal) modal.classList.remove('nnq-heat-modal--open');
    document.body.style.overflow = '';
  }

  function bindTopicModal(data) {
    ensureTopicModal();
    if (!global.__nnqTopicModalBound) {
      global.__nnqTopicModalBound = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeTopicModal();
      });
    }
    document.querySelectorAll('[data-nnq-modal-close]').forEach(function (el) {
      el.onclick = closeTopicModal;
    });
    const regen = document.getElementById('nnq-topic-regen');
    if (regen) {
      regen.onclick = function () {
        if (!topicModalAnalysis) return;
        const copy = document.getElementById('nnq-topic-copy');
        const text = formatTopicCopy(topicModalAnalysis);
        if (copy) copy.value = text;
        const st = document.getElementById('nnq-topic-modal-status');
        if (st) st.textContent = '已生成牛牛圈专项文案';
      };
    }
    const copyBtn = document.getElementById('nnq-topic-copy-btn');
    if (copyBtn) {
      copyBtn.onclick = function () {
        const ta = document.getElementById('nnq-topic-copy');
        const text = ta ? ta.value : '';
        if (!text) return;
        const done = function () {
          const st = document.getElementById('nnq-topic-modal-status');
          if (st) st.textContent = '已复制，可直接粘贴到牛牛圈';
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done);
        } else if (ta) {
          ta.removeAttribute('readonly');
          ta.select();
          document.execCommand('copy');
          ta.setAttribute('readonly', 'readonly');
          done();
        }
      };
    }
  }

  function bindTopicClicks(root, data) {
    if (!root) return;
    root.addEventListener('click', function (e) {
      const el = e.target.closest('[data-nnq-topic]');
      if (!el) return;
      e.preventDefault();
      const raw = el.getAttribute('data-nnq-topic') || '';
      const idx = raw.indexOf(':');
      if (idx < 0) return;
      openTopicModal(data, raw.slice(0, idx), raw.slice(idx + 1));
    });
  }

  function topicAttr(type, value) {
    return ' data-nnq-topic="' + esc(type + ':' + value) + '" role="button" tabindex="0" class="nnq-heat-topic-trigger"';
  }

  function renderLoading() {
    const root = document.getElementById('nnq-heat-root');
    if (!root) return;
    root.innerHTML =
      '<div class="nnq-heat-loading"><div class="nnq-heat-spinner"></div><div>正在加载牛牛圈舆情看板…</div></div>';
  }

  function renderError(msg) {
    const root = document.getElementById('nnq-heat-root');
    if (!root) return;
    root.innerHTML =
      '<div class="nnq-heat-empty"><div style="font-weight:700;margin-bottom:8px;">暂无法展示看板数据</div>' +
      '<div style="font-size:13px;line-height:1.6;color:var(--t2);">' + esc(msg) + '</div></div>';
  }

  function renderMeta(data) {
    const meta = data.meta || {};
    const filter = data.filter || {};
    return (
      '<div class="nnq-heat-meta">' +
      '<span>数据源：<a href="https://q.futunn.com/nnq/recommend" target="_blank" rel="noopener noreferrer">富途牛牛圈 · 牛友交流</a></span>' +
      '<span>更新：' + fmtTime(data.updatedAt) + '</span>' +
      '<span>有效 ' + (meta.afterNoiseFilter || meta.afterFilter || data.summary?.totalPosts || 0) + ' 帖' +
      (meta.spamFiltered ? ' · 滤灌水 ' + meta.spamFiltered : '') + '</span>' +
      '<span>heat ' + (filter.heatScoringVersion || meta.heatScoringVersion || 'v3') + ' · 布局 v4</span>' +
      '</div>'
    );
  }

  function renderSentimentPie(sent) {
    const total = sent.total || 1;
    if (total <= 0) return '<div class="nnq-heat-empty">暂无情感数据</div>';

    let acc = 0;
    const slices = [
      { key: 'bullish', pct: sent.bullishPct, color: PIE_COLORS.bullish, label: '看多' },
      { key: 'bearish', pct: sent.bearishPct, color: PIE_COLORS.bearish, label: '看空' },
      { key: 'watch', pct: sent.watchPct, color: PIE_COLORS.watch, label: '观望' },
    ];
    const gradient = slices
      .filter(function (s) { return s.pct > 0; })
      .map(function (s) {
        const start = acc;
        acc += s.pct;
        return s.color + ' ' + start + '% ' + acc + '%';
      })
      .join(', ');

    const legend = slices
      .map(function (s) {
        return (
          '<div class="nnq-heat-pie-leg">' +
          '<span><i class="nnq-heat-pie-dot" style="background:' + s.color + ';display:inline-block;"></i>' +
          s.label + '</span><strong>' + fmtPct(s.pct) + '</strong></div>'
        );
      })
      .join('');

    return (
      '<div class="nnq-heat-pie-wrap">' +
      '<div class="nnq-heat-pie" style="width:148px;height:148px;border-radius:50%;background:conic-gradient(' +
      (gradient || '#e4e4e7 0 100%') +
      ');box-shadow:inset 0 0 0 28px #fff;"></div>' +
      '<div class="nnq-heat-pie-legend">' + legend + '</div></div>'
    );
  }

  function renderDualTrendChart(rows) {
    const list = (rows || []).slice(-10);
    if (!list.length) return '<div class="nnq-heat-empty">暂无走势数据</div>';

    const maxHeat = Math.max.apply(null, list.map(function (r) { return r.weightedHeat || r.heatScore || 0; }).concat([1]));
    const w = 100;
    const h = 100;
    const n = list.length;
    const pad = 4;

    function linePoints(getter) {
      return list
        .map(function (r, i) {
          const x = pad + (i / Math.max(n - 1, 1)) * (w - pad * 2);
          const y = h - pad - (getter(r) / maxHeat) * (h - pad * 2);
          return x.toFixed(1) + ',' + y.toFixed(1);
        })
        .join(' ');
    }

    const heatPts = linePoints(function (r) { return r.weightedHeat || r.heatScore || 0; });
    const sentPts = linePoints(function (r) {
      const s = r.sentiment || {};
      return ((s.positivePct || 0) / 100) * maxHeat;
    });

    const labels = list
      .map(function (r, i) {
        if (i % 2 !== 0 && list.length > 6) return '';
        return '<text x="' + (pad + (i / Math.max(n - 1, 1)) * (w - pad * 2)).toFixed(1) + '" y="' + (h + 14) + '" font-size="4" fill="#a1a1aa" text-anchor="middle">' + esc((r.date || '').slice(5)) + '</text>';
      })
      .join('');

    return (
      '<div class="nnq-heat-line-chart">' +
      '<svg viewBox="0 0 100 118" preserveAspectRatio="none">' +
      '<polyline fill="none" stroke="#f97316" stroke-width="1.5" points="' + heatPts + '"/>' +
      '<polyline fill="none" stroke="#16a34a" stroke-width="1.2" stroke-dasharray="2 2" points="' + sentPts + '"/>' +
      labels +
      '</svg></div>' +
      '<div class="nnq-heat-line-legend">' +
      '<span><i style="background:#f97316;"></i>加权热度</span>' +
      '<span><i style="background:#16a34a;"></i>看多情感</span></div>'
    );
  }

  function renderSectorBars(list) {
    const rows = (list || []).slice(0, 6);
    if (!rows.length) return '<div class="nnq-heat-empty">暂无赛道数据</div>';
    const max = Math.max.apply(null, rows.map(function (r) { return r.heatScore || 0; }).concat([1]));
    return (
      '<div class="nnq-heat-rank-list">' +
      rows.map(function (r, i) {
        const pct = Math.round(((r.heatScore || 0) / max) * 100);
        return (
          '<div class="nnq-heat-rank-row">' +
          '<div class="nnq-heat-rank-idx">' + (i + 1) + '</div>' +
          '<div class="nnq-heat-rank-main"><div class="nnq-heat-rank-title nnq-heat-topic-trigger"' +
          topicAttr('sector', r.sectorGroup || '其他') + '>' + esc(r.sectorGroup || '其他') + '</div>' +
          '<div class="nnq-heat-bar-track"><div class="nnq-heat-bar-fill" style="width:' + pct + '%"></div></div></div>' +
          '<div class="nnq-heat-rank-meta"><div class="nnq-heat-rank-num">' + (r.heatScore || 0) + '</div>' +
          '<div class="nnq-heat-rank-sub">' + (r.postCount || 0) + '帖</div></div></div>'
        );
      }).join('') +
      '</div>'
    );
  }

  function renderMarketOverview(data, sent) {
    const mi = data.marketInsights || {};
    return (
      '<section class="nnq-heat-zone nnq-heat-zone--market">' +
      '<div class="nnq-heat-zone-head"><span class="nnq-heat-zone-step">1</span>市场情绪总览<span class="nnq-heat-zone-sub">近' + (data.filter?.days || 10) + '天</span></div>' +
      '<div class="nnq-heat-overview-grid">' +
      '<div class="nnq-heat-panel"><div class="nnq-heat-panel-title"><span>🎯</span>整体情感占比</div>' +
      '<div class="nnq-heat-panel-desc">看多 / 看空 / 观望 · 环形占比</div>' + renderSentimentPie(sent) + '</div>' +
      '<div class="nnq-heat-panel"><div class="nnq-heat-panel-title"><span>📈</span>热度 & 情感趋势</div>' +
      '<div class="nnq-heat-panel-desc">折线=加权热度 · 虚线=看多情感</div>' + renderDualTrendChart(data.dailyTrend) + '</div>' +
      '<div class="nnq-heat-panel"><div class="nnq-heat-panel-title"><span>🏭</span>赛道热度排行</div>' +
      '<div class="nnq-heat-panel-desc">按赛道聚合 heat v3 指数</div>' + renderSectorBars(mi.sectorHeat) + '</div>' +
      '</div></section>'
    );
  }

  function renderMiniSentBars(sb) {
    return ['bullish', 'bearish', 'watch']
      .map(function (k) {
        const pct = (sb && sb[k] && sb[k].pct) || 0;
        return (
          '<div class="nnq-heat-sent-row">' +
          '<span class="nnq-heat-sent-row-label">' + SENT_ROW_LABELS[k] + '</span>' +
          '<div class="nnq-heat-bar-track"><div class="nnq-heat-bar-fill" style="width:' + pct + '%;background:' + SENT_ROW_COLORS[k] + '"></div></div>' +
          '<span class="nnq-heat-sent-row-pct">' + fmtPct(pct) + '</span></div>'
        );
      })
      .join('');
  }

  function renderStockCard(stock) {
    const sb = stock.sentimentBreakdown || {};
    const dom = DOMINANT_LABELS[sb.dominant] || DOMINANT_LABELS.neutral;
    const tags = stock.basicTags || {};
    const kws = (stock.relatedKeywords || []).slice(0, 4);
    const kwHtml = kws.length
      ? '<div class="nnq-heat-stock-kws">' + kws.map(function (k) {
          return '<span class="nnq-heat-stock-kw">' + esc(k.word) + '</span>';
        }).join('') + '</div>'
      : '';

    const tagLine = [
      tags.sponsor && '保荐 ' + tags.sponsor,
      tags.sectorGroup && tags.sectorGroup,
      tags.issuePe && 'PE ' + tags.issuePe,
    ].filter(Boolean).join(' · ');

    return (
      '<div class="nnq-heat-stock-card nnq-heat-stock-card--compact">' +
      '<div class="nnq-heat-stock-head">' +
      '<div><div class="nnq-heat-stock-name">' + esc(stock.name) + ' <span class="nnq-heat-code">' + esc(stock.code) + '</span></div>' +
      '<div style="font-size:11px;color:var(--t3);margin-top:4px;">热度 <strong style="color:var(--accent);">' + (stock.heatIndex ?? '—') + '</strong>' +
      ' · 分歧度 ' + (stock.disagreementIndex ?? '—') +
      (stock.disagreementIndex != null && stock.disagreementIndex <= 25 ? ' <span style="color:#dc2626;">（高）</span>' : '') +
      '</div></div>' +
      '<span class="nnq-heat-stock-dominant nnq-heat-stock-dominant--' + dom.cls + '">' + dom.text + '</span></div>' +
      '<div class="nnq-heat-sent-rows">' + renderMiniSentBars(sb) + '</div>' +
      kwHtml +
      (tagLine ? '<div style="font-size:11px;color:var(--t2);margin-top:6px;">' + esc(tagLine) + '</div>' : '') +
      '</div>'
    );
  }

  function renderStockBoardPane(id, boards) {
    if (id === 'sector') {
      const groups = boards.sector || [];
      if (!groups.length) return '<div class="nnq-heat-empty">暂无赛道聚合数据</div>';
      return groups.map(function (g) {
        return (
          '<div class="nnq-heat-sector-card">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<strong class="nnq-heat-topic-trigger"' + topicAttr('sector', g.sectorGroup) + '>' + esc(g.sectorGroup) + '</strong>' +
          '<span style="font-family:DM Mono,monospace;color:var(--accent);font-size:13px;">' + Math.round(g.heatScore) + '</span></div>' +
          '<div class="nnq-heat-stock-grid">' + (g.stocks || []).slice(0, 3).map(renderStockCard).join('') + '</div></div>'
        );
      }).join('');
    }
    const list = boards[id] || [];
    if (!list.length) return '<div class="nnq-heat-empty">该维度暂无数据</div>';
    return '<div class="nnq-heat-stock-grid">' + list.slice(0, 8).map(renderStockCard).join('') + '</div>';
  }

  function renderStockBoard(data, boards) {
    const tabs = BOARD_TABS.map(function (t) {
      return (
        '<button type="button" class="nnq-heat-board-tab' + (activeBoardTab === t.id ? ' active' : '') + '" data-nnq-board="' + t.id + '">' +
        esc(t.label) + '</button>'
      );
    }).join('');

    const panes = BOARD_TABS.map(function (t) {
      return (
        '<div class="nnq-heat-board-pane' + (activeBoardTab === t.id ? ' active' : '') + '" data-nnq-pane="' + t.id + '">' +
        renderStockBoardPane(t.id, boards) + '</div>'
      );
    }).join('');

    return (
      '<section class="nnq-heat-zone nnq-heat-zone--stocks">' +
      '<div class="nnq-heat-zone-head"><span class="nnq-heat-zone-step">2</span>个股榜单<span class="nnq-heat-zone-sub">多维度切换</span></div>' +
      renderIpoRadarModule(data) +
      '<div class="nnq-heat-panel">' +
      '<div class="nnq-heat-board-tabs">' + tabs + '</div>' +
      panes +
      '</div></section>'
    );
  }

  function renderKeywordPanel(categories) {
    const html = Object.keys(KW_CATEGORIES)
      .map(function (key) {
        const cat = KW_CATEGORIES[key];
        const items = categories[key] || [];
        return (
          '<div class="nnq-heat-kw-cat">' +
          '<div class="nnq-heat-kw-cat-title"><span>' + cat.icon + '</span>' + esc(cat.title) + '</div>' +
          (items.length
            ? items.slice(0, 8).map(function (item) {
                let grText = '—';
                let grCls = '';
                if (item.growth != null) {
                  grText = (item.growth >= 0 ? '+' : '') + Math.round(item.growth * 100) + '%';
                  grCls = item.growth > 0 ? ' nnq-heat-kw-growth--up' : ' nnq-heat-kw-growth--down';
                }
                return (
                  '<div class="nnq-heat-kw-item nnq-heat-kw-item--clickable' + (item.isRisk ? ' nnq-heat-kw-item--risk' : '') + '"' +
                  topicAttr('keyword', item.word) + '>' +
                  '<div class="nnq-heat-kw-item-word' + (item.isRisk ? ' nnq-heat-kw-item-word--risk' : '') + '">' +
                  '<span>' + esc(item.word) + '</span><span class="nnq-heat-kw-count">' + (item.count || 0) + '次</span></div>' +
                  '<div class="nnq-heat-kw-item-meta">关联 ' + esc(item.stock) + '</div>' +
                  '<div class="nnq-heat-kw-growth' + grCls + '">7日 ' + grText + '</div></div>'
                );
              }).join('')
            : '<div class="nnq-heat-empty" style="padding:12px;">暂无</div>') +
          '</div>'
        );
      })
      .join('');

    return (
      '<section class="nnq-heat-zone nnq-heat-zone--keywords">' +
      '<div class="nnq-heat-zone-head"><span class="nnq-heat-zone-step">3</span>关键词拆解<span class="nnq-heat-zone-sub">点击标签 · 话题聚合</span></div>' +
      '<div class="nnq-heat-panel nnq-heat-kw-panel">' + html + '</div></section>'
    );
  }

  function renderConsensusSection(views) {
    if (!views.length) return '<div class="nnq-heat-empty">暂无足够个股观点用于聚合</div>';
    return views.map(function (v) {
      return (
        '<div class="nnq-heat-consensus-card">' +
        '<div class="nnq-heat-consensus-head">' +
        '<div class="nnq-heat-consensus-name">' + esc(v.name) + ' <span class="nnq-heat-code">' + esc(v.code) + '</span></div>' +
        '<span class="nnq-heat-stock-dominant nnq-heat-stock-dominant--' + v.dominantCls + '">' + esc(v.dominant) + '</span></div>' +
        '<div class="nnq-heat-consensus-body"><strong>共识：</strong>' + esc(v.consensus) + '</div>' +
        (v.highDisagree
          ? '<div class="nnq-heat-consensus-split">' +
            '<div class="nnq-heat-consensus-col nnq-heat-consensus-col--yes"><strong>看多</strong><br>' + esc(v.bullPoints) + '</div>' +
            '<div class="nnq-heat-consensus-col nnq-heat-consensus-col--no"><strong>看空</strong><br>' + esc(v.bearPoints) + '</div></div>'
          : '<div style="font-size:11px;color:var(--t3);margin-top:6px;">分歧度 ' + (v.disagreementIndex ?? '—') + ' · 观点相对一致</div>') +
        '</div>'
      );
    }).join('');
  }

  function renderAiInsights(data) {
    const stocks = getStockList(data).slice(0, 4);
    if (!stocks.length) return '<div class="nnq-heat-empty">暂无结构化提炼数据</div>';
    return stocks.map(function (s) {
      const ai = extractAiInsight(s, data);
      return (
        '<div class="nnq-heat-ai-card">' +
        '<div class="nnq-heat-ai-head">' + esc(ai.name) + ' <span class="nnq-heat-code">' + esc(ai.code) + '</span>' +
        '<span class="nnq-heat-ai-badge">规则提炼</span></div>' +
        (ai.tags ? '<div style="font-size:11px;color:var(--t3);margin-bottom:8px;">' + esc(ai.tags) + '</div>' : '') +
        '<div class="nnq-heat-ai-block"><strong>核心观点</strong>' + esc(ai.coreView) + '</div>' +
        '<div class="nnq-heat-ai-block"><strong>看多逻辑</strong>' + esc(ai.bullLogic) + '</div>' +
        '<div class="nnq-heat-ai-block"><strong>看空逻辑</strong>' + esc(ai.bearLogic) + '</div>' +
        '<div class="nnq-heat-ai-block"><strong>操作策略</strong>' + esc(ai.strategy) + '</div></div>'
      );
    }).join('');
  }

  function buildPostContext(data) {
    const days = (data.filter && data.filter.days) || 10;
    const summary = data.summary || {};
    const meta = data.meta || {};
    const stocks = getStockList(data);
    const sector = ((data.marketInsights && data.marketInsights.sectorHeat) || []);
    const keywords = (data.topKeywords || []).slice(0, 8);
    const riskBars = buildRiskHighlightBars(data);
    const daily = data.dailyTrend || [];
    const recent = daily.slice(-3);
    const prior = daily.slice(-6, -3);
    let rHeat = 0;
    let pHeat = 0;
    recent.forEach(function (d) { rHeat += d.weightedHeat || d.heatScore || 0; });
    prior.forEach(function (d) { pHeat += d.weightedHeat || d.heatScore || 0; });
    if (!pHeat) pHeat = 1;
    const heatDelta = (rHeat - pHeat) / pHeat;
    let heatTrend = '平稳';
    if (heatDelta > 0.15) heatTrend = '升温';
    else if (heatDelta < -0.15) heatTrend = '降温';

    let bSum = 0;
    let sSum = 0;
    let wSum = 0;
    stocks.forEach(function (st) {
      const sb = st.sentimentBreakdown || {};
      bSum += (sb.bullish && sb.bullish.pct) || 0;
      sSum += (sb.bearish && sb.bearish.pct) || 0;
      wSum += ((sb.watch && sb.watch.pct) || 0) + ((sb.neutral && sb.neutral.pct) || 0);
    });
    const n = Math.max(stocks.length, 1);

    const topStocks = stocks
      .slice()
      .sort(function (a, b) { return (b.heatIndex || 0) - (a.heatIndex || 0); })
      .slice(0, 5)
      .map(function (st) {
        const sb = st.sentimentBreakdown || {};
        const dom = DOMINANT_LABELS[sb.dominant] || DOMINANT_LABELS.neutral;
        const radar = computeIpoRadar(st, data);
        return {
          name: st.name,
          code: st.code,
          heatIndex: st.heatIndex,
          disagreementIndex: st.disagreementIndex,
          dominant: dom.text,
          bullishPct: (sb.bullish && sb.bullish.pct) || 0,
          bearishPct: (sb.bearish && sb.bearish.pct) || 0,
          keywords: (st.relatedKeywords || []).slice(0, 4).map(function (k) { return k.word; }),
          tags: st.basicTags || {},
          radar: radar.scores || {},
        };
      });

    const focus = topStocks.slice(0, 2).filter(function (s) { return (s.heatIndex || 0) > 0; }).map(function (s) { return s.name; });
    let avoid = riskBars.slice(0, 3).map(function (b) { return b.name; });
    if (!avoid.length) {
      avoid = topStocks
        .filter(function (s) { return s.bearishPct >= 20 || (s.disagreementIndex != null && s.disagreementIndex <= 20); })
        .map(function (s) { return s.name; })
        .slice(0, 2);
    }

    return {
      updatedAt: data.updatedAt,
      days: days,
      meta: {
        totalPosts: summary.totalPosts || meta.afterNoiseFilter,
        heatTrend: heatTrend,
        heatDeltaPct: Math.round(heatDelta * 1000) / 10,
      },
      sentiment: {
        bullish: Math.round((bSum / n) * 10) / 10,
        bearish: Math.round((sSum / n) * 10) / 10,
        watch: Math.round((wSum / n) * 10) / 10,
      },
      hotSectors: sector.slice(0, 3).map(function (r) {
        return { name: r.sectorGroup, heatScore: r.heatScore };
      }),
      hotKeywords: keywords.map(function (k) { return k.word; }).filter(Boolean),
      topStocks: topStocks,
      riskHighlightBars: riskBars,
      strategy: {
        focus: focus,
        avoid: avoid.length ? avoid : ['暂无触发预警标的'],
        greyTip: '暗盘重点看定价与成交量，首日关注开盘15分钟情绪与基石货是否集中出货',
      },
    };
  }

  const POST_AI_SYSTEM =
    '你是港股 IPO 打新社区的内容编辑，擅长写富途牛牛圈帖子。只根据用户 JSON 数据写作，不得编造未出现的个股或数值。' +
    '输出纯帖子正文，不要 Markdown 代码块。简体中文，适当 emoji、空行分段、文末 3–5 个 #话题标签。' +
    '结构：市场情绪 → 重点个股 → 打新策略。不构成投资建议。';

  function buildPostAiUserPrompt(ctx, style) {
    const json = JSON.stringify(ctx, null, 2);
    if (style === 'deep') {
      return (
        '请基于以下舆情 JSON，生成「深度投研分析版」牛牛圈分析帖（600–900字）。\n\n数据：\n' + json
      );
    }
    return (
      '请基于以下舆情 JSON，生成「简洁打新手账版」牛牛圈分析帖（280–450字，清单化）。\n\n数据：\n' + json
    );
  }

  function generatePostLocal(ctx, style) {
    const days = ctx.days || 10;
    const meta = ctx.meta || {};
    const sent = ctx.sentiment || {};
    const sectors = ctx.hotSectors || [];
    const kws = ctx.hotKeywords || [];
    const stocks = ctx.topStocks || [];
    const risk = ctx.riskHighlightBars || [];
    const strat = ctx.strategy || {};
    const sectorTxt = sectors.slice(0, 2).map(function (s) { return s.name || '其他'; }).join('、') || '暂无集中赛道';
    const kwTxt = kws.slice(0, 4).join('、') || '打新、招股';
    const focus = (strat.focus || []).join('、') || '暂无明显优先标的';
    const avoid = (strat.avoid || []).join('、') || '暂无';
    const dateStr = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Hong_Kong' });

    if (style === 'deep') {
      let text =
        '【港股 IPO 舆情深度】近' + days + '天牛牛圈讨论复盘（' + dateStr + '）\n\n' +
        '一、市场总览\n' +
        '近' + days + '日有效舆情帖约 ' + (meta.totalPosts || '—') + ' 条，讨论热度较前期' + (meta.heatTrend || '平稳') +
        '（约 ' + (meta.heatDeltaPct || 0) + '%）。情绪：看多 ' + sent.bullish + '% / 看空 ' + sent.bearish +
        '% / 观望 ' + sent.watch + '%。赛道 ' + sectorTxt + '；高频词 ' + kwTxt + '。\n\n' +
        '二、重点个股\n';
      stocks.slice(0, 3).forEach(function (s) {
        const tags = s.tags || {};
        const r = s.radar || {};
        text += '\n▎' + s.name + '（' + s.code + '）｜热度 ' + (s.heatIndex || '—') + '\n';
        text += '主导 ' + s.dominant + '，分歧度 ' + (s.disagreementIndex ?? '—') + '。';
        if (tags.sponsor) text += '保荐 ' + tags.sponsor + '；';
        if (tags.sectorGroup) text += '赛道 ' + tags.sectorGroup + '。';
        text += '\n雷达：看多' + (r.bullishSentiment ?? '—') + ' · 破发担忧' + (r.breakConcern ?? '—') +
          ' · 暗盘' + (r.greyMarketExpect ?? '—') + ' · 中签' + (r.lotRateHeat ?? '—') + ' · 赛道' + (r.sectorHeat ?? '—') + '。\n';
      });
      text += '\n三、风险监测\n';
      if (risk.length) {
        risk.forEach(function (b) {
          text += '· ' + b.name + '：' + (b.concerns || []).join('；') + '\n';
        });
      } else {
        text += '暂无显著预警，仍建议跟踪孖展与暗盘定价。\n';
      }
      text +=
        '\n四、策略建议\n优先：' + focus + '。谨慎：' + avoid + '。\n' + (strat.greyTip || '') +
        '\n\n#港股打新 #新股分析 #IPO舆情 #暗盘交易 #富途牛牛';
      return text;
    }

    const lines = [
      '📊 近' + days + '天港股打新舆情手账 | ' + dateStr,
      '',
      '🎯 【市场情绪】',
      '有效讨论 ' + (meta.totalPosts || '—') + ' 条 · 热度' + (meta.heatTrend || '平稳') + '（' + (meta.heatDeltaPct || 0) + '%）',
      '看多 ' + sent.bullish + '% · 看空 ' + sent.bearish + '% · 观望 ' + sent.watch + '%',
      '赛道：' + sectorTxt + '｜话题：' + kwTxt,
      '',
      '🔥 【重点新股】',
    ];
    stocks.slice(0, 3).forEach(function (s, i) {
      const r = s.radar || {};
      lines.push((i + 1) + '️⃣ ' + s.name + '（' + s.code + '）热度 ' + (s.heatIndex || '—'));
      lines.push('   共识' + s.dominant + ' · 分歧' + (s.disagreementIndex ?? '—') + ' · 暗盘预期' + (r.greyMarketExpect ?? '—'));
      if (s.keywords && s.keywords.length) lines.push('   词：' + s.keywords.slice(0, 3).join('、'));
    });
    lines.push('', '⚠️ 【风险提示】');
    if (risk.length) {
      risk.slice(0, 2).forEach(function (b) {
        lines.push('· ' + b.name + '：' + (b.riskTags || []).join('、'));
      });
    } else {
      lines.push('· 未触发负面增速/破发TOP3/保荐高破发率');
    }
    lines.push(
      '',
      '💡 【打新策略】',
      '✅ 优先：' + focus,
      '❌ 谨慎：' + avoid,
      '🌙 ' + (strat.greyTip || ''),
      '',
      '#港股打新 #新股IPO #牛牛圈 #暗盘 #打新日记'
    );
    return lines.join('\n');
  }

  async function callAiPostGenerator(ctx, style) {
    const cfg = global.__IPO_AI_CONFIG__ || {};
    const key = cfg.apiKey || cfg.openaiKey || cfg.token;
    if (!key) return null;
    const model = cfg.model || 'gpt-4o-mini';
    const base = cfg.baseUrl && String(cfg.baseUrl).trim()
      ? String(cfg.baseUrl).replace(/\/$/, '')
      : 'https://api.openai.com/v1';
    const path = cfg.chatPath || '/chat/completions';
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: model,
        temperature: style === 'deep' ? 0.45 : 0.35,
        max_tokens: style === 'deep' ? 1800 : 900,
        messages: [
          { role: 'system', content: POST_AI_SYSTEM },
          { role: 'user', content: buildPostAiUserPrompt(ctx, style) },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return text ? String(text).trim() : null;
  }

  function renderPostGeneratorPanel() {
    const briefActive = postGenStyle === 'brief' ? ' active' : '';
    const deepActive = postGenStyle === 'deep' ? ' active' : '';
    const preview = postGenText || '点击「一键生成」拉取当前看板数据并填充模板…';
    const src = postGenSource
      ? '<span class="nnq-heat-post-src">来源：' + esc(postGenSource) + '</span>'
      : '';
    return (
      '<div class="nnq-heat-panel nnq-heat-post-gen">' +
      '<div class="nnq-heat-panel-title"><span>✍️</span>牛牛圈发文助手</div>' +
      '<div class="nnq-heat-panel-desc">自动读取看板数据 · 支持 AI 润色（需配置 window.__IPO_AI_CONFIG__）</div>' +
      '<div class="nnq-heat-post-toolbar">' +
      '<div class="nnq-heat-board-tabs">' +
      '<button type="button" class="nnq-heat-board-tab' + briefActive + '" data-nnq-post-style="brief">简洁打新手账版</button>' +
      '<button type="button" class="nnq-heat-board-tab' + deepActive + '" data-nnq-post-style="deep">深度投研分析版</button>' +
      '</div>' +
      '<div class="nnq-heat-post-actions">' +
      '<button type="button" class="nnq-heat-btn nnq-heat-btn--primary" id="nnq-post-generate">一键生成</button>' +
      '<button type="button" class="nnq-heat-btn" id="nnq-post-copy">复制正文</button>' +
      src +
      '</div></div>' +
      '<textarea id="nnq-post-preview" class="nnq-heat-post-preview" readonly rows="14">' + esc(preview) + '</textarea>' +
      '<div id="nnq-post-status" class="nnq-heat-post-status"></div></div>'
    );
  }

  function updatePostPreview(text, source) {
    postGenText = text;
    postGenSource = source || '';
    const ta = document.getElementById('nnq-post-preview');
    const st = document.getElementById('nnq-post-status');
    const srcEl = document.querySelector('.nnq-heat-post-src');
    if (ta) ta.value = text;
    if (st) st.textContent = source ? '已生成 · ' + source : '';
    if (srcEl) srcEl.textContent = source ? '来源：' + source : '';
  }

  async function runPostGeneration(data) {
    const status = document.getElementById('nnq-post-status');
    const btn = document.getElementById('nnq-post-generate');
    if (status) status.textContent = '正在生成…';
    if (btn) btn.disabled = true;
    try {
      const ctx = buildPostContext(data);
      let text = await callAiPostGenerator(ctx, postGenStyle);
      if (text) {
        updatePostPreview(text, postGenStyle === 'deep' ? 'AI · 深度投研版' : 'AI · 手账版');
        return;
      }
      text = generatePostLocal(ctx, postGenStyle);
      updatePostPreview(
        text,
        postGenStyle === 'deep' ? '本地模板 · 深度投研版' : '本地模板 · 手账版'
      );
    } catch (e) {
      if (status) status.textContent = '生成失败：' + (e.message || e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindPostGenerator(root, data) {
    if (!root || !data) return;
    root.querySelectorAll('[data-nnq-post-style]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        postGenStyle = btn.getAttribute('data-nnq-post-style') || 'brief';
        root.querySelectorAll('[data-nnq-post-style]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-nnq-post-style') === postGenStyle);
        });
        if (postGenText) runPostGeneration(data);
      });
    });
    const genBtn = root.querySelector('#nnq-post-generate');
    if (genBtn) genBtn.addEventListener('click', function () { runPostGeneration(data); });
    const copyBtn = root.querySelector('#nnq-post-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        const ta = document.getElementById('nnq-post-preview');
        const text = ta ? ta.value : postGenText;
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            const st = document.getElementById('nnq-post-status');
            if (st) st.textContent = '已复制到剪贴板，可直接粘贴到牛牛圈';
          });
        } else if (ta) {
          ta.removeAttribute('readonly');
          ta.select();
          document.execCommand('copy');
          ta.setAttribute('readonly', 'readonly');
        }
      });
    }
  }

  function renderHighHeatPosts(list, threshold) {
    const rows = (list || []).slice(0, 8);
    if (!rows.length) {
      return '<div class="nnq-heat-empty">暂无互动≥' + (threshold || 50) + ' 的高热帖</div>';
    }
    return (
      '<div class="nnq-heat-hot-list">' +
      rows.map(function (p) {
        const sent = sentimentLabel(p.sentiment);
        const link = p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer" class="nnq-heat-post-link">原文</a>' : '';
        return (
          '<div class="nnq-heat-hot-row">' +
          '<div class="nnq-heat-post-head">' +
          '<span class="nnq-heat-post-author">' + esc(p.author || '牛友') + '</span>' +
          '<span class="nnq-heat-sent-tag" style="color:' + sent.color + ';background:' + sent.bg + '">' + sent.text + '</span>' +
          '<span class="nnq-heat-post-eng">互动 ' + (p.engagement || 0) + '</span></div>' +
          '<div class="nnq-heat-hot-excerpt">' + esc(p.excerpt || p.text || '') + '</div>' +
          '<div class="nnq-heat-hot-foot"><span class="nnq-heat-hot-detail">赞 ' + (p.likes ?? '—') + ' · 评 ' + (p.comments ?? '—') + '</span>' +
          '<span class="nnq-heat-post-time">' + fmtTime(p.publishedAt) + '</span>' + link + '</div></div>'
        );
      }).join('') +
      '</div>'
    );
  }

  function renderContentZone(data, consensus) {
    const threshold = data.summary?.highHeatThreshold || data.filter?.highHeatThreshold || 50;
    const hot = data.highHeatPostsList || [];
    return (
      '<section class="nnq-heat-zone nnq-heat-zone--content">' +
      '<div class="nnq-heat-zone-head"><span class="nnq-heat-zone-step">4</span>内容聚合<span class="nnq-heat-zone-sub">共识 · 高热 · 发文助手</span></div>' +
      renderPostGeneratorPanel() +
      '<div class="nnq-heat-content-grid">' +
      '<div class="nnq-heat-panel"><div class="nnq-heat-panel-title"><span>🤝</span>精华观点聚合</div>' +
      '<div class="nnq-heat-panel-desc">同一新股的共识观点与分歧观点</div>' + renderConsensusSection(consensus) + '</div>' +
      '<div class="nnq-heat-panel"><div class="nnq-heat-panel-title"><span>🤖</span>智能结构化提炼</div>' +
      '<div class="nnq-heat-panel-desc">基于规则引擎拆解核心观点与策略（非 LLM）</div>' + renderAiInsights(data) + '</div></div>' +
      '<div class="nnq-heat-hot-section" style="margin-top:4px;">' +
      '<div class="nnq-heat-panel-title" style="margin-bottom:4px;"><span>🔥</span>高热讨论帖 · 互动≥' + threshold + '</div>' +
      renderHighHeatPosts(hot, threshold) +
      '</div></section>'
    );
  }

  function bindBoardTabs(root) {
    if (!root) return;
    root.querySelectorAll('[data-nnq-board]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeBoardTab = btn.getAttribute('data-nnq-board') || 'heat';
        root.querySelectorAll('[data-nnq-board]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-nnq-board') === activeBoardTab);
        });
        root.querySelectorAll('[data-nnq-pane]').forEach(function (p) {
          p.classList.toggle('active', p.getAttribute('data-nnq-pane') === activeBoardTab);
        });
      });
    });
  }

  function renderDashboard(data) {
    const root = document.getElementById('nnq-heat-root');
    if (!root || !data) return;

    const sent = aggregateMarketSentiment(data);
    const boards = buildStockBoards(data);
    const categories = buildKeywordCategories(data);
    const consensus = buildConsensusViews(data);
    const riskBars = buildRiskHighlightBars(data);

    root.innerHTML =
      renderMeta(data) +
      renderRiskHighlightStrip(riskBars) +
      '<div class="nnq-heat-layout">' +
      renderMarketOverview(data, sent) +
      '<div class="nnq-heat-main-row">' +
      renderStockBoard(data, boards) +
      renderKeywordPanel(categories) +
      '</div>' +
      renderContentZone(data, consensus) +
      '</div>';

    bindBoardTabs(root);
    bindPostGenerator(root, data);
    bindTopicClicks(root, data);
    bindTopicModal(data);
  }

  async function ensureNnqHeatLoaded(force) {
    const tab = document.getElementById('tab-listed');
    if (!tab || !tab.classList.contains('active')) return;
    if (nnqHeatLoading) return;
    if (nnqHeatLoaded && !force) {
      if (nnqHeatData) renderDashboard(nnqHeatData);
      return;
    }
    nnqHeatLoading = true;
    renderLoading();
    try {
      const data = await fetchNnqHeatJson();
      nnqHeatData = data;
      nnqHeatLoaded = true;
      renderDashboard(data);
    } catch (e) {
      console.warn('[NNQ Heat]', e);
      renderError(e && e.message ? e.message : '加载失败');
    } finally {
      nnqHeatLoading = false;
    }
  }

  global.ensureNnqHeatLoaded = ensureNnqHeatLoaded;
  global.NNQ_HEAT_BUILD_ID = BUILD_ID;
  global.NnqHeatComputeIpoRadar = computeIpoRadar;
  global.NnqHeatBuildRiskBars = buildRiskHighlightBars;
  global.NnqHeatRenderRadarSvg = renderRadarSvg;
  global.NnqHeatBuildPostContext = buildPostContext;
  global.NnqHeatGeneratePostLocal = generatePostLocal;
  global.NnqHeatGeneratePostAi = callAiPostGenerator;
  global.NnqHeatAggregateTopic = aggregateTopic;
  global.NnqHeatFormatTopicCopy = formatTopicCopy;
})(typeof window !== 'undefined' ? window : globalThis);
