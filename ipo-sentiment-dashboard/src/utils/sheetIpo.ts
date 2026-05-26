import type { NnqHeatData, SectorHeatRow, SheetIpoCard, StockInsight } from '../types';

const PAST_DAYS = 30;
const FUTURE_DAYS = 7;

const FIELD_ALIASES = {
  name: ['股票名称', '名称', 'name'],
  code: ['股票代码', '代码', 'code'],
  sector: ['行业板块', '板块', '行业', '行业·细分'],
  sponsor: ['保荐人', '保荐机构', '联席保荐人', '保荐'],
  issuePe: ['发行市盈率', '市盈率', 'PE', '发行 pe'],
  subStart: ['招股开始', '认购开始', '起购日期'],
  subEnd: ['招股结束', '认购结束', '截止认购'],
  listingDate: ['上市日期', '挂牌日', '上市日'],
  fundraising: ['募资规模', '集资额', '发行规模', '募资额', '市值（港元）', '市值'],
} as const;

declare global {
  interface Window {
    __IPO_SHEET_CONFIG__?: {
      publishBase?: string;
      gids?: { listed?: number | string };
    };
  }
}

function normKey(s: string): string {
  return String(s || '').replace(/\s+/g, '').trim();
}

function normCode(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 5) return d.padStart(5, '0');
  return d.slice(-5).padStart(5, '0');
}

function normName(name: string): string {
  return String(name || '').replace(/\s+/g, '').trim();
}

function matchKey(code: string, name: string): string {
  return `${normCode(code)}|${normName(name)}`;
}

function cell(row: Record<string, string>, keys: readonly string[]): string {
  const normMap: Record<string, string> = {};
  Object.entries(row).forEach(([k, v]) => {
    normMap[normKey(k)] = String(v ?? '').trim();
  });
  for (const k of keys) {
    const v = normMap[normKey(k)];
    if (v) return v;
  }
  return '';
}

function parseDateFlexible(raw: string): Date | null {
  const s = String(raw || '').trim();
  if (!s || ['—', '-', '待定', 'TBD', 'N/A'].includes(s)) return null;
  const normalized = s.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/\//g, '-');
  const m = normalized.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const digits = s.replace(/\D/g, '');
  const m2 = digits.match(/(\d{4})(\d{2})(\d{2})/);
  if (m2) {
    const d = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function hkToday(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const mo = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  return new Date(y, mo - 1, d);
}

function dateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoDate(d: Date | null): string | undefined {
  if (!d) return undefined;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function namesCompatible(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function isTransposed(matrix: string[][]): boolean {
  if (matrix.length < 2) return false;
  return normKey(matrix[0]?.[0] || '') === '股票名称' && normKey(matrix[1]?.[0] || '') === '股票代码';
}

function pivotTransposed(matrix: string[][]): Record<string, string>[] {
  const nRows = matrix.length;
  const nCols = Math.max(...matrix.map((r) => r.length), 0);
  const out: Record<string, string>[] = [];
  for (let j = 1; j < nCols; j += 1) {
    const row: Record<string, string> = {};
    for (let i = 0; i < nRows; i += 1) {
      const key = normKey(matrix[i]?.[0] || '');
      if (!key) continue;
      row[key] = String(matrix[i]?.[j] ?? '').trim();
    }
    if (Object.values(row).some((v) => v.trim())) out.push(row);
  }
  return out;
}

function parseCsvRows(text: string): Record<string, string>[] {
  const matrix = parseCsv(text.replace(/^\uFEFF/, '')).filter((r) => r.some((c) => c.trim()));
  if (!matrix.length) return [];
  if (isTransposed(matrix)) return pivotTransposed(matrix);
  const headers = matrix[0].map((h) => normKey(h));
  return matrix.slice(1).map((line) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) row[h] = String(line[i] ?? '').trim();
    });
    return row;
  });
}

function rowToSheetIpo(row: Record<string, string>) {
  const code = normCode(cell(row, FIELD_ALIASES.code));
  if (!code || code === '00000') return null;
  const name = cell(row, FIELD_ALIASES.name) || code;
  const subStart = cell(row, FIELD_ALIASES.subStart);
  const subEnd = cell(row, FIELD_ALIASES.subEnd);
  const listing = cell(row, FIELD_ALIASES.listingDate);
  const ipoPeriod =
    subStart && subEnd
      ? `${subStart} ~ ${subEnd}`
      : subStart
        ? `${subStart} ~ 待定`
        : subEnd
          ? `待定 ~ ${subEnd}`
          : '';

  return {
    code,
    name,
    matchKey: matchKey(code, name),
    sector: cell(row, FIELD_ALIASES.sector) || '其他',
    sponsor: cell(row, FIELD_ALIASES.sponsor),
    issuePe: cell(row, FIELD_ALIASES.issuePe),
    fundraising: cell(row, FIELD_ALIASES.fundraising),
    subStart,
    subEnd,
    listingDate: listing,
    ipoPeriod,
    subStartDate: isoDate(parseDateFlexible(subStart)),
    subEndDate: isoDate(parseDateFlexible(subEnd)),
    listingDateParsed: isoDate(parseDateFlexible(listing)),
  };
}

export function passesSheetTimeFilter(
  subStart: Date | null,
  subEnd: Date | null,
  listing: Date | null,
  today: Date = hkToday(),
): boolean {
  const pastCutoff = addDays(today, -PAST_DAYS);
  const futureCutoff = addDays(today, FUTURE_DAYS);

  if (listing && listing < pastCutoff) {
    if (!(subStart && today < subStart && subStart <= futureCutoff)) return false;
  }
  if (subStart && today < subStart && subStart <= futureCutoff) return true;
  if (subStart && subStart >= pastCutoff) return true;
  if (listing && listing >= pastCutoff) return true;
  if (subStart && subEnd && subStart <= today && today <= subEnd) return true;
  if (subEnd && subEnd >= pastCutoff && subEnd <= today) {
    if (!listing || listing >= pastCutoff) return true;
  }
  return false;
}

export function computeSheetStatus(
  subStart: Date | null,
  subEnd: Date | null,
  listing: Date | null,
  today: Date = hkToday(),
): SheetIpoCard['sheetStatus'] {
  if (subStart && today < subStart) return '即将招股';
  if (subStart && subEnd && subStart <= today && today <= subEnd) return '招股中';
  if (listing && listing <= today) return '已上市';
  if (subEnd && subEnd < today && (!listing || listing > today)) return '待上市';
  if (subStart && subStart <= today) return '招股中';
  return '其他';
}

function dominantLabel(insight: StockInsight | undefined): { text: string; cls: string } {
  if (!insight) return { text: '—', cls: 'neutral' };
  const dom = insight.sentimentBreakdown?.dominant || 'neutral';
  const map: Record<string, { text: string; cls: string }> = {
    bullish: { text: '看多', cls: 'bullish' },
    bearish: { text: '看空', cls: 'bearish' },
    watch: { text: '观望', cls: 'watch' },
    neutral: { text: '中性', cls: 'neutral' },
  };
  return map[dom] || map.neutral;
}

function inSubscriptionWindow(subStart: Date | null, subEnd: Date | null, today: Date): boolean {
  return Boolean(subStart && subEnd && subStart <= today && today <= subEnd);
}

function heatThreshold(cards: SheetIpoCard[]): number {
  const heats = cards.map((c) => c.heatIndex || 0).filter((h) => h > 0).sort((a, b) => a - b);
  if (!heats.length) return 100;
  const idx = Math.max(0, Math.floor(heats.length * 0.7) - 1);
  return Math.max(heats[idx], 100);
}

function buildBadges(card: SheetIpoCard, today: Date, threshold: number): SheetIpoCard['badges'] {
  const badges: SheetIpoCard['badges'] = [];
  const ss = card.subStartDate ? dateOnly(new Date(card.subStartDate)) : null;
  const se = card.subEndDate ? dateOnly(new Date(card.subEndDate)) : null;
  const ld = card.listingDateParsed ? dateOnly(new Date(card.listingDateParsed)) : null;

  if (card.sheetStatus === '即将招股' || (ss && today < ss && ss <= addDays(today, FUTURE_DAYS))) {
    badges.push('即将招股');
  }
  if (ld && ld >= addDays(today, -PAST_DAYS) && ld <= today) badges.push('近期上市');
  if ((card.heatIndex || 0) >= threshold && inSubscriptionWindow(ss, se, today)) {
    badges.push('重点关注');
  }
  return badges;
}

function findInsight(
  sheetRow: ReturnType<typeof rowToSheetIpo>,
  byCode: Map<string, StockInsight>,
): StockInsight | undefined {
  if (!sheetRow) return undefined;
  const hit = byCode.get(sheetRow.code);
  if (!hit) return undefined;
  if (!namesCompatible(sheetRow.name, hit.name)) return undefined;
  return hit;
}

export function buildSheetUniverseFromRows(
  sheetRows: Record<string, string>[],
  stockInsights: StockInsight[] = [],
  today: Date = hkToday(),
): Pick<
  NnqHeatData,
  'sheetIpoUniverse' | 'sectorHeatFromSheet' | 'sheetFilter' | 'allowedStockCodes' | 'allowedMatchKeys'
> {
  const byCode = new Map<string, StockInsight>();
  stockInsights.forEach((s) => {
    if (s.code) byCode.set(normCode(s.code), s);
  });

  const filtered: SheetIpoCard[] = [];
  for (const raw of sheetRows) {
    const row = rowToSheetIpo(raw);
    if (!row) continue;
    const ss = row.subStartDate ? dateOnly(new Date(row.subStartDate)) : null;
    const se = row.subEndDate ? dateOnly(new Date(row.subEndDate)) : null;
    const ld = row.listingDateParsed ? dateOnly(new Date(row.listingDateParsed)) : null;
    if (!passesSheetTimeFilter(ss, se, ld, today)) continue;

    const insight = findInsight(row, byCode);
    const dom = dominantLabel(insight);
    const sb = insight?.sentimentBreakdown || {};

    filtered.push({
      ...row,
      sheetStatus: computeSheetStatus(ss, se, ld, today),
      heatIndex: insight?.heatIndex || 0,
      mentions: insight?.mentions || 0,
      disagreementIndex: insight?.disagreementIndex ?? null,
      dominant: dom.text,
      dominantCls: dom.cls,
      bullishPct: sb.bullish?.pct || 0,
      bearishPct: sb.bearish?.pct || 0,
      watchPct: (sb.watch?.pct || 0) + (sb.neutral?.pct || 0),
      hasSentiment: Boolean(insight),
      badges: [],
    });
  }

  const threshold = heatThreshold(filtered);
  filtered.forEach((c) => {
    c.badges = buildBadges(c, today, threshold);
  });

  const sectorMap: Record<string, SectorHeatRow> = {};
  filtered.forEach((card) => {
    const sector = (card.sector || '其他').trim() || '其他';
    if (!sectorMap[sector]) {
      sectorMap[sector] = { sectorGroup: sector, heatScore: 0, mentions: 0, postCount: 0, source: 'google_sheet' };
    }
    sectorMap[sector].heatScore = (sectorMap[sector].heatScore || 0) + (card.heatIndex || 0);
    sectorMap[sector].mentions = (sectorMap[sector].mentions || 0) + (card.mentions || 0);
    sectorMap[sector].postCount = (sectorMap[sector].postCount || 0) + 1;
  });

  const sectorHeatFromSheet = Object.values(sectorMap)
    .map((s) => ({ ...s, heatScore: Math.round((s.heatScore || 0) * 10) / 10 }))
    .sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0));

  return {
    sheetIpoUniverse: filtered,
    sectorHeatFromSheet,
    sheetFilter: {
      pastDays: PAST_DAYS,
      futureDays: FUTURE_DAYS,
      today: isoDate(today) || '',
      totalSheetRows: sheetRows.length,
      visibleCount: filtered.length,
    },
    allowedStockCodes: [...new Set(filtered.map((c) => c.code))].sort(),
    allowedMatchKeys: [...new Set(filtered.map((c) => c.matchKey))].sort(),
  };
}

export async function fetchListedSheetCsv(): Promise<string> {
  const cfg = window.__IPO_SHEET_CONFIG__ || {};
  const base = (
    cfg.publishBase ||
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5R7a29N0wHqOVKXO7Dx016Z_DV0IQ5n16IaTMSPWF2QOqwqud1ViC1Llp0MFwZep8qMUGW_-9SCBU/pub'
  ).replace(/\/$/, '');
  const gid = cfg.gids?.listed ?? 63719317;
  const url = `${base}?gid=${gid}&single=true&output=csv&_t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith('<')) throw new Error('Sheet 返回 HTML，请检查 publishBase');
  return text;
}

export async function enrichDataWithSheet(data: NnqHeatData): Promise<NnqHeatData> {
  if (data.sheetIpoUniverse?.length) return data;
  try {
    const csv = await fetchListedSheetCsv();
    const rows = parseCsvRows(csv);
    const block = buildSheetUniverseFromRows(rows, data.stockInsights || []);
    return {
      ...data,
      ...block,
      marketInsights: {
        ...(data.marketInsights || {}),
        sectorHeatFromSheet: block.sectorHeatFromSheet,
        sectorHeatSource: 'google_sheet',
      },
    };
  } catch {
    return data;
  }
}

export function getSectorHeatFromSheet(data: NnqHeatData): SectorHeatRow[] {
  return (
    data.sectorHeatFromSheet ||
    data.marketInsights?.sectorHeatFromSheet ||
    []
  );
}

export function getAllowedCodes(data: NnqHeatData): Set<string> | null {
  const codes = data.allowedStockCodes;
  if (!codes?.length && !data.sheetIpoUniverse?.length) return null;
  if (codes?.length) return new Set(codes);
  return new Set((data.sheetIpoUniverse || []).map((c) => c.code));
}
