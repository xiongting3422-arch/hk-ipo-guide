import {
  BOARD_TABS,
  DOMINANT_LABELS,
  KW_CATEGORIES,
  SPONSOR_BREAK_RATES,
} from '../constants';
import type {
  BoardTab,
  KeywordItem,
  MarketSentiment,
  NnqHeatData,
  PostInsight,
  RiskBar,
  SectorGroup,
  SheetIpoCard,
  StockBoardRow,
  StockBoards,
  StockInsight,
} from '../types';
import { getAllowedCodes, getSectorHeatFromSheet } from './sheetIpo';
import { buildHotContentCards } from './hotContentEnhance';

export function fmtPct(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Math.round(n * 10) / 10}%`;
}

export function fmtTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      timeZone: 'Asia/Hong_Kong',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function getStockList(data: NnqHeatData): StockInsight[] {
  let list: StockInsight[];
  if (data.stockInsights?.length) list = data.stockInsights;
  else {
    list = (data.topStocks || []).map((s) => ({
      code: s.code,
      name: s.name,
      heatIndex: s.heatIndex,
      mentions: s.mentions,
      sentimentBreakdown: { dominant: 'neutral' },
    }));
  }

  const allowed = getAllowedCodes(data);
  if (!allowed) return list;
  return list.filter((s) => allowed.has(s.code));
}

export function getSheetIpoCards(data: NnqHeatData): SheetIpoCard[] {
  return data.sheetIpoUniverse || [];
}

function lookupSponsorBreakRate(sponsor: string): number | null {
  if (!sponsor) return null;
  for (const [key, rate] of Object.entries(SPONSOR_BREAK_RATES)) {
    if (sponsor.includes(key)) return rate;
  }
  return null;
}

function kwAffinity(stock: StockInsight, word: string): number {
  const hit = (stock.relatedKeywords || []).find(
    (k) => k.word === word || k.word.includes(word) || word.includes(k.word),
  );
  return hit?.affinity ?? 0;
}

export function buildRiskHighlightBars(data: NnqHeatData): RiskBar[] {
  if (data.riskHighlightBars?.length) return data.riskHighlightBars;

  const stocks = getStockList(data);
  const spikes: Record<string, { growthRate?: number }> = {};
  (data.riskAlerts?.stockSentimentSpikes || []).forEach((s) => {
    if (s.code) spikes[s.code] = s;
  });

  const breakRank = (data.keywordStockMap || [])
    .filter((r) => r.word?.includes('破发'))
    .sort(
      (a, b) =>
        (b.topStock?.affinity || 0) - (a.topStock?.affinity || 0),
    )
    .slice(0, 3)
    .map((r) => r.topStock?.code)
    .filter(Boolean) as string[];

  const breakSet = new Set(breakRank);
  const bars: RiskBar[] = [];

  stocks.forEach((stock) => {
    const tags: string[] = [];
    const triggers: string[] = [];
    const spike = spikes[stock.code];
    if (spike && (spike.growthRate || 0) > 0.3) {
      tags.push('负面增速');
      triggers.push(`负面情绪单日增速 ${Math.round((spike.growthRate || 0) * 100)}%`);
    }
    if (breakSet.has(stock.code)) {
      tags.push('破发TOP3');
      triggers.push('「破发」关键词关联度 TOP3');
    }
    const sponsor = stock.basicTags?.sponsor || '';
    const sRate = lookupSponsorBreakRate(sponsor);
    if (sRate != null && sRate >= 0.25) {
      tags.push('保荐风险');
      triggers.push(`保荐人历史破发率约 ${Math.round(sRate * 100)}%`);
    }
    if (!tags.length) return;

    const concerns: string[] = [];
    const bear = stock.sentimentBreakdown?.bearish?.pct || 0;
    if (bear > 0) concerns.push(`看空讨论占比 ${bear}%`);
    ['破发', '估值过高', '劝退'].forEach((w) => {
      const aff = kwAffinity(stock, w);
      if (aff >= 0.3) concerns.push(`「${w}」关联 ${Math.round(aff * 100)}%`);
    });
    if (!concerns.length) concerns.push('社区担忧尚未集中，建议持续跟踪');

    bars.push({
      code: stock.code,
      name: stock.name,
      severity: tags.length >= 2 ? 'high' : 'medium',
      riskTags: tags,
      triggers,
      concerns: concerns.slice(0, 4),
    });
  });

  return bars;
}

export function aggregateMarketSentiment(data: NnqHeatData): MarketSentiment {
  const stocks = getStockList(data);
  let bullish = 0;
  let bearish = 0;
  let watch = 0;

  stocks.forEach((s) => {
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
    bullishPct: (bullish / total) * 100,
    bearishPct: (bearish / total) * 100,
    watchPct: (watch / total) * 100,
    total,
  };
}

function sheetMetaForStock(data: NnqHeatData, code: string): SheetIpoCard | undefined {
  return (data.sheetIpoUniverse || []).find((c) => c.code === code);
}

function toBoardRow(stock: StockInsight, riskCodes: Set<string>, data: NnqHeatData): StockBoardRow {
  const sb = stock.sentimentBreakdown || {};
  const dom = DOMINANT_LABELS[sb.dominant || 'neutral'] || DOMINANT_LABELS.neutral;
  const tags = stock.basicTags || {};
  const sheet = sheetMetaForStock(data, stock.code);
  return {
    code: stock.code,
    name: sheet?.name || stock.name,
    heatIndex: stock.heatIndex || 0,
    bullishPct: sb.bullish?.pct || 0,
    bearishPct: sb.bearish?.pct || 0,
    watchPct: (sb.watch?.pct || 0) + (sb.neutral?.pct || 0),
    dominant: dom.text,
    dominantCls: dom.cls,
    disagreementIndex: stock.disagreementIndex ?? null,
    sponsor: sheet?.sponsor || tags.sponsor || '—',
    issuePe: sheet?.issuePe || tags.issuePe || '—',
    sectorGroup: sheet?.sector || tags.sectorGroup || tags.sector || '其他',
    isRisk: riskCodes.has(stock.code),
  };
}

export function buildStockBoards(data: NnqHeatData): StockBoards {
  const stocks = getStockList(data);
  const riskBars = buildRiskHighlightBars(data);
  const riskCodes = new Set(riskBars.map((b) => b.code));
  const rows = stocks.map((s) => toBoardRow(s, riskCodes, data));

  const heat = [...rows].sort((a, b) => b.heatIndex - a.heatIndex);
  const bullish = [...rows]
    .sort((a, b) => b.bullishPct - a.bullishPct || b.heatIndex - a.heatIndex)
    .filter((r) => r.bullishPct > 0 || r.dominantCls === 'bullish');
  const risk = rows.filter((r) => r.isRisk || r.bearishPct >= 15);

  const sectorMap: Record<string, StockBoardRow[]> = {};
  rows.forEach((r) => {
    const g = r.sectorGroup || '其他';
    if (!sectorMap[g]) sectorMap[g] = [];
    sectorMap[g].push(r);
  });

  const sectorHeat = getSectorHeatFromSheet(data);
  const sector: SectorGroup[] = Object.keys(sectorMap)
    .map((sectorGroup) => {
      const heatRow = sectorHeat.find((s) => s.sectorGroup === sectorGroup);
      return {
        sectorGroup,
        heatScore: heatRow?.heatScore || 0,
        stocks: sectorMap[sectorGroup].sort((a, b) => b.heatIndex - a.heatIndex),
      };
    })
    .sort((a, b) => b.heatScore - a.heatScore || b.stocks.length - a.stocks.length);

  return { heat, bullish, risk, sector };
}

function classifyKeyword(word: string): keyof typeof KW_CATEGORIES {
  for (const key of ['risk', 'bullish', 'trade', 'fundamental'] as const) {
    const cat = KW_CATEGORIES[key];
    if (cat.words.some((k) => word.includes(k) || k.includes(word))) return key;
  }
  if (/暗盘|打新|申购|中签/.test(word)) return 'trade';
  if (/招股|基石|保荐/.test(word)) return 'fundamental';
  if (/破发|劝退|避雷/.test(word)) return 'risk';
  return 'fundamental';
}

export function buildKeywordCategories(data: NnqHeatData): Record<string, KeywordItem[]> {
  const stockMap: Record<string, { name?: string; code?: string }> = {};
  (data.keywordStockMap || []).forEach((row) => {
    if (row.word) stockMap[row.word] = row.topStock || {};
  });

  const growthMap: Record<string, number | null> = {};
  (data.riskAlerts?.keywordSpikes || []).forEach((a) => {
    if (a.word) growthMap[a.word] = a.growthRate ?? null;
  });

  const trend = data.dailyTrend || [];
  const last7 = trend.slice(-7);
  const prior7 = trend.slice(-14, -7);
  const sumRisk = (rows: typeof trend) => {
    const c: Record<string, number> = {};
    rows.forEach((row) => {
      (row.riskKeywordCounts || []).forEach((item) => {
        c[item.word] = (c[item.word] || 0) + (item.count || 0);
      });
    });
    return c;
  };
  const recent = sumRisk(last7);
  const prior = sumRisk(prior7);
  Object.keys(recent).forEach((w) => {
    if (growthMap[w] != null) return;
    const p = prior[w] || 0;
    const r = recent[w] || 0;
    growthMap[w] = p === 0 ? (r > 0 ? 1 : null) : (r - p) / p;
  });

  const buckets: Record<string, KeywordItem[]> = {
    trade: [],
    fundamental: [],
    risk: [],
    bullish: [],
  };
  const seen = new Set<string>();

  const pushWord = (word: string, count: number) => {
    if (!word || seen.has(word)) return;
    seen.add(word);
    const cat = classifyKeyword(word);
    const ts = stockMap[word] || {};
    buckets[cat].push({
      word,
      count: count || 0,
      stock: ts.name && ts.name !== ts.code ? ts.name : ts.code || '—',
      growth: growthMap[word] ?? null,
      isRisk: cat === 'risk',
    });
  };

  (data.topKeywords || []).forEach((r) => pushWord(r.word, r.count));
  (data.keywordStockMap || []).forEach((r) => pushWord(r.word, 0));

  Object.keys(buckets).forEach((k) => {
    buckets[k].sort((a, b) => b.count - a.count);
  });

  return buckets;
}

export function buildHotPostInsights(data: NnqHeatData): PostInsight[] {
  return buildHotContentCards(data);
}

export function getSectorHeatSorted(data: NnqHeatData) {
  const rows = [...getSectorHeatFromSheet(data)];
  return rows.sort((a, b) => b.heatScore - a.heatScore);
}

export function getTrendMax(data: NnqHeatData): number {
  const trend = data.dailyTrend || [];
  return Math.max(1, ...trend.map((d) => d.weightedHeat || d.heatScore || 0));
}

export { BOARD_TABS };
export type { BoardTab };
