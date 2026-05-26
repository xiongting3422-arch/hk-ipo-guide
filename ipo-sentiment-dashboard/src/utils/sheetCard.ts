import { SPONSOR_BREAK_RATES } from '../constants';
import type { SheetIpoCard, SheetIpoStatus, StockInsight } from '../types';

export type SentimentFilter = 'all' | 'bullish' | 'bearish' | 'neutral';
export type StatusFilter = 'all' | 'upcoming' | 'listed';
export type SheetSortKey = 'heat' | 'bullish' | 'disagreement' | 'subStart';

export type SentimentHighlight =
  | '强烈看多'
  | '看多'
  | '中性'
  | '看空'
  | '强烈看空';

const RISK_WORDS = ['破发', '劝退', '避雷', '弃购', '估值过高', '坑', '割', '冷场'];
const BULL_WORDS = ['必打', '大肉', '看好', '参与', '冲', '稳中签', '值得打', '梭哈'];
const SPONSOR_ALIASES: [string, string][] = [
  ['中国国际金融', '中金'],
  ['中信建投', '中信建投'],
  ['中信证券', '中信证券'],
  ['农银国际', '农银国际'],
  ['工银国际', '工银国际'],
  ['越秀融资', '越秀'],
  ['富途', '富途'],
  ['海通国际', '海通'],
  ['交银国际', '交银国际'],
  ['民银资本', '民银资本'],
  ['东方证券', '东方证券'],
  ['中银国际', '中银国际'],
  ['中泰国际', '中泰国际'],
  ['天风证券', '天风证券'],
  ['华升资本', '华升资本'],
  ['德意志', '德银'],
  ['Jefferies', 'Jefferies'],
];

export interface EnrichedSheetCard extends SheetIpoCard {
  primarySponsor: string;
  sponsorBreakRate: number | null;
  fundraisingHkd: string;
  fundraisingTag?: string;
  dateLabel: string;
  sentimentSpread: number;
  sentimentHighlight: SentimentHighlight;
  sentimentHighlightCls: string;
  breakConcernPct: number;
  consensusLine: string;
  opportunityWords: string[];
  riskWords: string[];
  bullishCount: number;
  bearishCount: number;
  watchCount: number;
  sectorMedianFundraising: number | null;
  insight?: StockInsight;
}

function normSponsorKey(name: string): string {
  return name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
}

export function simplifySponsorName(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '—';
  for (const [key, short] of SPONSOR_ALIASES) {
    if (s.includes(key)) return short;
  }
  return s
    .replace(/有限公司/g, '')
    .replace(/融资/g, '')
    .replace(/证券/g, '')
    .replace(/\(香港\)/g, '')
    .trim()
    .slice(0, 8);
}

export function parsePrimarySponsor(raw?: string): string {
  if (!raw) return '—';
  const first = raw.split(/[,，、;；]/)[0]?.trim() || raw;
  return simplifySponsorName(first);
}

export function lookupSponsorBreakRate(sponsor: string): number | null {
  if (!sponsor || sponsor === '—') return null;
  const n = normSponsorKey(sponsor);
  for (const [key, rate] of Object.entries(SPONSOR_BREAK_RATES)) {
    if (n.includes(normSponsorKey(key)) || normSponsorKey(key).includes(n)) return rate;
  }
  for (const [key] of SPONSOR_ALIASES) {
    if (sponsor.includes(key) && SPONSOR_BREAK_RATES[key]) {
      return SPONSOR_BREAK_RATES[key];
    }
  }
  return null;
}

export function parseFundraisingNumber(raw?: string): number | null {
  if (!raw) return null;
  const s = raw.replace(/,/g, '');
  const range = s.match(/([\d.]+)\s*[-~～]\s*([\d.]+)/);
  if (range) {
    return (parseFloat(range[1]) + parseFloat(range[2])) / 2;
  }
  const m = s.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

export function formatFundraisingHkd(raw?: string): { label: string; value: number | null; tag?: string } {
  const val = parseFundraisingNumber(raw);
  if (val == null) return { label: '—', value: null };
  const rounded = Math.round(val * 10) / 10;
  const tag = rounded >= 100 ? '超百亿' : undefined;
  return { label: `${rounded}亿港元`, value: rounded, tag };
}

function fmtMd(iso?: string): string {
  if (!iso) return '';
  const p = iso.slice(5).replace('-', '/');
  return p;
}

export function formatIpoDates(card: SheetIpoCard): string {
  const start = fmtMd(card.subStart);
  const end = fmtMd(card.subEnd);
  const list = fmtMd(card.listingDate);
  const parts: string[] = [];
  if (start && end && start !== end) parts.push(`${start}–${end} 招股`);
  else if (start) parts.push(`${start} 招股`);
  if (list) parts.push(`${list} 上市`);
  return parts.join(' · ') || '—';
}

export function computeSentimentHighlight(
  bullish: number,
  bearish: number,
): { label: SentimentHighlight; cls: string } {
  if (bullish >= 60) return { label: '强烈看多', cls: 'strong-bull' };
  if (bullish >= 40) return { label: '看多', cls: 'bullish' };
  if (bearish >= 60) return { label: '强烈看空', cls: 'strong-bear' };
  if (bearish >= 40) return { label: '看空', cls: 'bearish' };
  return { label: '中性', cls: 'neutral' };
}

function keywordHits(
  keywords: StockInsight['relatedKeywords'],
  pool: string[],
): string[] {
  const hits: string[] = [];
  for (const k of keywords || []) {
    const w = k.word || '';
    if (pool.some((p) => w.includes(p) || p.includes(w))) hits.push(w);
  }
  return [...new Set(hits)].slice(0, 3);
}

export function computeBreakConcernPct(keywords: StockInsight['relatedKeywords'], mentions = 0): number {
  if (!mentions || !keywords?.length) return 0;
  let riskCo = 0;
  for (const k of keywords) {
    if (RISK_WORDS.some((r) => (k.word || '').includes(r))) {
      riskCo += k.coOccur || 0;
    }
  }
  return Math.min(100, Math.round((riskCo / mentions) * 100));
}

export function buildConsensusLine(opportunity: string[], risk: string[]): string {
  const parts: string[] = [];
  if (opportunity.length) parts.push(`机会：${opportunity.join('、')}`);
  if (risk.length) parts.push(`风险：${risk.join('、')}`);
  if (!parts.length) return '暂无明确共识词，建议持续跟踪孖展与暗盘';
  return parts.join(' · ');
}

export function statusTags(card: SheetIpoCard): string[] {
  const tags: string[] = [];
  const st = card.sheetStatus;
  if (st === '即将招股' || st === '招股中') tags.push(st);
  else if (st === '已上市') tags.push('近期上市');
  else if (st === '待上市') tags.push('待上市');
  (card.badges || []).forEach((b) => {
    if (!tags.includes(b)) tags.push(b);
  });
  return tags.slice(0, 2);
}

export function enrichSheetCard(
  card: SheetIpoCard,
  insight: StockInsight | undefined,
  sectorMedians: Record<string, number>,
): EnrichedSheetCard {
  const sb = insight?.sentimentBreakdown;
  const bullish = card.bullishPct ?? sb?.bullish?.pct ?? 0;
  const bearish = card.bearishPct ?? sb?.bearish?.pct ?? 0;
  const watch = card.watchPct ?? (sb?.watch?.pct || 0) + (sb?.neutral?.pct || 0);
  const spread = Math.round(Math.abs(bullish - bearish) * 10) / 10;
  const hi = computeSentimentHighlight(bullish, bearish);
  const primarySponsor = parsePrimarySponsor(card.sponsor);
  const fr = formatFundraisingHkd(card.fundraising);
  const sector = card.sector || '其他';
  const opportunityWords = keywordHits(insight?.relatedKeywords, BULL_WORDS);
  const riskWords = keywordHits(insight?.relatedKeywords, RISK_WORDS);

  return {
    ...card,
    bullishPct: bullish,
    bearishPct: bearish,
    watchPct: watch,
    primarySponsor,
    sponsorBreakRate: lookupSponsorBreakRate(primarySponsor),
    fundraisingHkd: fr.label,
    fundraisingTag: fr.tag,
    dateLabel: formatIpoDates(card),
    sentimentSpread: spread,
    sentimentHighlight: hi.label,
    sentimentHighlightCls: hi.cls,
    breakConcernPct: computeBreakConcernPct(insight?.relatedKeywords, card.mentions || insight?.mentions),
    consensusLine: buildConsensusLine(opportunityWords, riskWords),
    opportunityWords,
    riskWords,
    bullishCount: sb?.bullish?.count || 0,
    bearishCount: sb?.bearish?.count || 0,
    watchCount: (sb?.watch?.count || 0) + (sb?.neutral?.count || 0),
    sectorMedianFundraising: sectorMedians[sector] ?? null,
    insight,
  };
}

function groupRank(status?: SheetIpoStatus): number {
  if (status === '即将招股' || status === '招股中') return 0;
  if (status === '待上市') return 1;
  if (status === '已上市') return 2;
  return 3;
}

export function enrichAllSheetCards(
  cards: SheetIpoCard[],
  insights: StockInsight[],
): EnrichedSheetCard[] {
  const byCode = new Map(insights.map((s) => [s.code, s]));
  const sectorVals: Record<string, number[]> = {};
  cards.forEach((c) => {
    const v = parseFundraisingNumber(c.fundraising);
    if (v == null) return;
    const sec = c.sector || '其他';
    if (!sectorVals[sec]) sectorVals[sec] = [];
    sectorVals[sec].push(v);
  });
  const sectorMedians: Record<string, number> = {};
  Object.entries(sectorVals).forEach(([sec, arr]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    sectorMedians[sec] = sorted[Math.floor(sorted.length / 2)];
  });

  return cards.map((c) => enrichSheetCard(c, byCode.get(c.code), sectorMedians));
}

export function filterSheetCards(
  cards: EnrichedSheetCard[],
  status: StatusFilter,
  sector: string,
  sentiment: SentimentFilter,
): EnrichedSheetCard[] {
  return cards.filter((c) => {
    if (status === 'upcoming' && !['即将招股', '招股中'].includes(c.sheetStatus || '')) return false;
    if (status === 'listed' && !['已上市', '待上市'].includes(c.sheetStatus || '')) return false;
    if (sector !== 'all' && (c.sector || '其他') !== sector) return false;
    if (sentiment === 'bullish' && !['强烈看多', '看多'].includes(c.sentimentHighlight)) return false;
    if (sentiment === 'bearish' && !['强烈看空', '看空'].includes(c.sentimentHighlight)) return false;
    if (sentiment === 'neutral' && c.sentimentHighlight !== '中性') return false;
    return true;
  });
}

export function sortSheetCards(cards: EnrichedSheetCard[], sortKey: SheetSortKey): EnrichedSheetCard[] {
  const sorted = [...cards];
  sorted.sort((a, b) => {
    const ga = groupRank(a.sheetStatus);
    const gb = groupRank(b.sheetStatus);
    if (ga !== gb) return ga - gb;

    switch (sortKey) {
      case 'bullish':
        return (b.bullishPct || 0) - (a.bullishPct || 0) || (b.heatIndex || 0) - (a.heatIndex || 0);
      case 'disagreement':
        return (a.sentimentSpread || 0) - (b.sentimentSpread || 0) || (b.heatIndex || 0) - (a.heatIndex || 0);
      case 'subStart':
        return (a.subStartDate || '').localeCompare(b.subStartDate || '') || (b.heatIndex || 0) - (a.heatIndex || 0);
      default:
        return (b.heatIndex || 0) - (a.heatIndex || 0);
    }
  });
  return sorted;
}

export function groupSheetCards(cards: EnrichedSheetCard[]): { title: string; items: EnrichedSheetCard[] }[] {
  const upcoming = cards.filter((c) => ['即将招股', '招股中'].includes(c.sheetStatus || ''));
  const listed = cards.filter((c) => !['即将招股', '招股中'].includes(c.sheetStatus || ''));
  const groups: { title: string; items: EnrichedSheetCard[] }[] = [];
  if (upcoming.length) groups.push({ title: '即将招股 / 招股中', items: upcoming });
  if (listed.length) groups.push({ title: '近期上市 / 待上市', items: listed });
  return groups;
}

export function uniqueSectors(cards: EnrichedSheetCard[]): string[] {
  return [...new Set(cards.map((c) => c.sector || '其他'))].sort();
}

export function buildModalInsight(card: EnrichedSheetCard) {
  const bullish = card.bullishPct || 0;
  const bearish = card.bearishPct || 0;
  const spread = card.sentimentSpread;
  const bullLogic =
    card.opportunityWords.length || bullish > 0
      ? `社区偏正面关键词：${card.opportunityWords.join('、') || '打新/招股'}，看多占比 ${bullish}%`
      : '暂无集中看多逻辑';
  const bearLogic =
    card.riskWords.length || bearish > 0
      ? `风险词：${card.riskWords.join('、') || '破发担忧'}，看空占比 ${bearish}%`
      : '暂无集中看空逻辑';
  let strategy = '观望，等待孖展与暗盘定价后再决策';
  if (card.sentimentHighlight === '强烈看多' || card.sentimentHighlight === '看多') {
    strategy = spread >= 40 ? '共识偏强，可考虑参与申购，关注孖展倍数与暗盘表现' : '情绪偏多但分歧仍在，建议控制仓位';
  } else if (card.sentimentHighlight === '强烈看空' || card.sentimentHighlight === '看空') {
    strategy = '避雷为主，建议弃购或仅小仓位试探';
  } else if (spread < 15) {
    strategy = '多空胶着、分歧较大，优先观察同业与基石后再定';
  }
  return { bullLogic, bearLogic, strategy, spread };
}
