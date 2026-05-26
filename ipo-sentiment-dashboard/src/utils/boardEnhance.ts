import type { NnqHeatData, SheetIpoCard, StockBoardRow, StockBoards } from '../types';
import {
  enrichAllSheetCards,
  enrichSheetCard,
  parseFundraisingNumber,
  statusTags,
  type EnrichedSheetCard,
} from './sheetCard';

export type DisagreementLevel = '低分歧' | '中分歧' | '高分歧';

export interface EnrichedBoardRow extends StockBoardRow {
  enriched: EnrichedSheetCard;
  statusTags: string[];
  disagreementLevel: DisagreementLevel;
  riskTags: string[];
  tipLine: string;
  coSponsors: string[];
  subStartDate?: string;
}

export function disagreementLevel(spread: number): DisagreementLevel {
  if (spread >= 40) return '低分歧';
  if (spread >= 15) return '中分歧';
  return '高分歧';
}

export function buildRiskTags(card: EnrichedSheetCard): string[] {
  const tags: string[] = [];
  if (card.breakConcernPct >= 25) tags.push('破发担忧高');
  if (card.sponsorBreakRate != null && card.sponsorBreakRate >= 0.25) tags.push('保荐人破发率高');
  const fr = parseFundraisingNumber(card.fundraising);
  if (fr != null && fr >= 100) tags.push('募资规模过大');
  if (card.bearishPct >= 40) tags.push('看空集中');
  return tags;
}

export function buildTipLine(card: EnrichedSheetCard, riskTags: string[]): string {
  if (riskTags.includes('保荐人破发率高')) {
    return '保荐人破发率高，申购需更谨慎';
  }
  if (riskTags.includes('破发担忧高')) {
    return `破发担忧 ${card.breakConcernPct}%，建议控制仓位或观望`;
  }
  if (riskTags.includes('募资规模过大')) {
    return '募资规模偏大，关注认购倍数与定价';
  }
  if ((card.heatIndex || 0) >= 800 && ['强烈看多', '看多'].includes(card.sentimentHighlight)) {
    return `破发担忧低，${card.sector || '该赛道'}热门标的`;
  }
  if (card.opportunityWords.length) {
    return `机会：${card.opportunityWords.slice(0, 2).join('、')}`;
  }
  if (!card.hasSentiment) return '暂无社区讨论，以表格基本面为主';
  return card.consensusLine;
}

export type BoardSortMode =
  | 'heat'
  | 'date'
  | 'bullish'
  | 'disagreement'
  | 'breakConcern'
  | 'sponsorBreak'
  | 'fundraising';

function rowFromEnrichedCard(card: EnrichedSheetCard, boardRow?: StockBoardRow): EnrichedBoardRow {
  const riskTags = buildRiskTags(card);
  return {
    code: card.code,
    name: card.name,
    heatIndex: boardRow?.heatIndex ?? card.heatIndex ?? 0,
    bullishPct: boardRow?.bullishPct ?? card.bullishPct ?? 0,
    bearishPct: boardRow?.bearishPct ?? card.bearishPct ?? 0,
    watchPct: boardRow?.watchPct ?? card.watchPct ?? 0,
    disagreementIndex: boardRow?.disagreementIndex ?? card.disagreementIndex ?? card.sentimentSpread,
    sectorGroup: (boardRow?.sectorGroup ?? card.sector) || '其他',
    sponsor: boardRow?.sponsor ?? card.sponsor,
    isRisk: riskTags.length > 0 || !!boardRow?.isRisk,
    enriched: card,
    statusTags: statusTags(card),
    disagreementLevel: disagreementLevel(card.sentimentSpread),
    riskTags,
    tipLine: buildTipLine(card, riskTags),
    coSponsors: parseCoSponsors(card.sponsor),
    subStartDate: card.subStartDate,
  };
}

function parseCoSponsors(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(1);
}

export function buildRecentIpoRows(
  sheetCards: SheetIpoCard[],
  boards: StockBoards,
  data: NnqHeatData,
): EnrichedBoardRow[] {
  const insights = data.stockInsights || [];
  const enrichedCards = enrichAllSheetCards(sheetCards, insights);
  const boardMap = new Map(buildEnrichedBoardRows(boards, data).map((r) => [r.code, r]));
  return enrichedCards.map((card) => {
    const boardRow = boardMap.get(card.code);
    if (boardRow) return boardRow;
    return rowFromEnrichedCard(card);
  });
}

const PENDING_STATUSES = new Set(['即将招股', '招股中', '待上市']);

export function groupCardViewRows(rows: EnrichedBoardRow[]): { title: string; items: EnrichedBoardRow[] }[] {
  const pending = rows.filter((r) => PENDING_STATUSES.has(r.enriched.sheetStatus || ''));
  const recent = rows.filter((r) => !PENDING_STATUSES.has(r.enriched.sheetStatus || ''));
  const byHeat = (list: EnrichedBoardRow[]) =>
    [...list].sort((a, b) => b.heatIndex - a.heatIndex || a.code.localeCompare(b.code));
  const groups: { title: string; items: EnrichedBoardRow[] }[] = [];
  if (pending.length) groups.push({ title: '待上市 / 招股中', items: byHeat(pending) });
  if (recent.length) groups.push({ title: '近期上市', items: byHeat(recent) });
  return groups;
}

export function buildEnrichedBoardRows(
  boards: StockBoards,
  data: NnqHeatData,
): EnrichedBoardRow[] {
  const sheetCards = data.sheetIpoUniverse || [];
  const insights = data.stockInsights || [];
  const enrichedMap = new Map(
    enrichAllSheetCards(sheetCards, insights).map((c) => [c.code, c]),
  );
  const byCode = new Map(insights.map((s) => [s.code, s]));

  const allRows = new Map<string, StockBoardRow>();
  [boards.heat, boards.bullish, boards.risk, ...boards.sector.flatMap((g) => g.stocks)].forEach((r) => {
    allRows.set(r.code, r);
  });

  return [...allRows.values()].map((row) => {
    let enriched = enrichedMap.get(row.code);
    if (!enriched) {
      enriched = enrichSheetCard(
        {
          code: row.code,
          name: row.name,
          matchKey: `${row.code}|${row.name}`,
          sector: row.sectorGroup,
          sponsor: row.sponsor,
          bullishPct: row.bullishPct,
          bearishPct: row.bearishPct,
          watchPct: row.watchPct,
          heatIndex: row.heatIndex,
          disagreementIndex: row.disagreementIndex,
          hasSentiment: true,
        },
        byCode.get(row.code),
        {},
      );
    }

    const riskTags = buildRiskTags(enriched);
    return rowFromEnrichedCard(enriched, { ...row, isRisk: riskTags.length > 0 || row.isRisk });
  });
}

export function filterBoardBySector(rows: EnrichedBoardRow[], sector: string): EnrichedBoardRow[] {
  if (sector === 'all') return rows;
  return rows.filter((r) => (r.sectorGroup || '其他') === sector);
}

export function sortBoardRows(rows: EnrichedBoardRow[], mode: BoardSortMode): EnrichedBoardRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (mode) {
      case 'date':
        return (b.subStartDate || '').localeCompare(a.subStartDate || '') || b.heatIndex - a.heatIndex;
      case 'bullish':
        return b.bullishPct - a.bullishPct || b.heatIndex - a.heatIndex;
      case 'disagreement':
        return a.enriched.sentimentSpread - b.enriched.sentimentSpread || b.heatIndex - a.heatIndex;
      case 'breakConcern':
        return b.enriched.breakConcernPct - a.enriched.breakConcernPct || b.heatIndex - a.heatIndex;
      case 'sponsorBreak':
        return (
          (b.enriched.sponsorBreakRate ?? -1) - (a.enriched.sponsorBreakRate ?? -1) ||
          b.heatIndex - a.heatIndex
        );
      case 'fundraising': {
        const fa = parseFundraisingNumber(a.enriched.fundraising) ?? -1;
        const fb = parseFundraisingNumber(b.enriched.fundraising) ?? -1;
        return fb - fa || b.heatIndex - a.heatIndex;
      }
      default:
        return b.heatIndex - a.heatIndex;
    }
  });
  return sorted;
}

export function boardRowsForTab(
  boards: StockBoards,
  enriched: EnrichedBoardRow[],
  tab: keyof StockBoards,
): EnrichedBoardRow[] {
  const codeSet = new Set<string>();
  if (tab === 'sector') return enriched;
  (boards[tab] as StockBoardRow[]).forEach((r) => codeSet.add(r.code));
  return enriched.filter((r) => codeSet.has(r.code));
}

export function uniqueBoardSectors(rows: EnrichedBoardRow[]): string[] {
  return [...new Set(rows.map((r) => r.sectorGroup || '其他'))].sort();
}
