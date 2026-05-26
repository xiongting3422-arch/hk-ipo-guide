export interface NnqHeatData {
  updatedAt?: string;
  source?: string;
  filter?: {
    days?: number;
    highHeatThreshold?: number;
    heatScoringVersion?: string;
    contentPoolVersion?: string;
    updateIntervalHours?: number;
  };
  summary?: {
    totalPosts?: number;
    positiveCount?: number;
    negativeCount?: number;
    neutralCount?: number;
    highHeatThreshold?: number;
  };
  meta?: {
    afterNoiseFilter?: number;
    afterFilter?: number;
    spamFiltered?: number;
    rawNnqFetched?: number;
    rawStockFetched?: number;
    scrapeTargetCount?: number;
  };
  scrapeTargets?: {
    code: string;
    name: string;
    subStart?: string;
    subEnd?: string;
    listingDate?: string;
    sortDate?: string;
    sector?: string;
  }[];
  contentPool?: {
    nnqFeedCount?: number;
    stockCommentCount?: number;
    mergedCount?: number;
    afterCleanCount?: number;
    highHeatCount?: number;
  };
  topKeywords?: { word: string; count: number }[];
  topStocks?: StockRow[];
  stockInsights?: StockInsight[];
  keywordStockMap?: KeywordStockMapRow[];
  marketInsights?: {
    sectorHeat?: SectorHeatRow[];
    sectorHeatFromSheet?: SectorHeatRow[];
    sectorHeatSource?: string;
  };
  dailyTrend?: DailyTrendRow[];
  riskAlerts?: {
    keywordSpikes?: { word: string; growthRate?: number | null }[];
    stockSentimentSpikes?: { code: string; growthRate?: number }[];
  };
  riskHighlightBars?: RiskBar[];
  highHeatPostsList?: HotPost[];
  sheetIpoUniverse?: SheetIpoCard[];
  sectorHeatFromSheet?: SectorHeatRow[];
  sheetFilter?: SheetFilterMeta;
  allowedStockCodes?: string[];
  allowedMatchKeys?: string[];
}

export type SheetIpoStatus = '即将招股' | '招股中' | '已上市' | '待上市' | '其他';
export type SheetDisplayBadge = '即将招股' | '近期上市' | '重点关注';

export interface SheetFilterMeta {
  pastDays?: number;
  futureDays?: number;
  today?: string;
  totalSheetRows?: number;
  visibleCount?: number;
}

export interface SheetIpoCard {
  code: string;
  name: string;
  matchKey: string;
  sector?: string;
  sponsor?: string;
  issuePe?: string;
  fundraising?: string;
  subStart?: string;
  subEnd?: string;
  listingDate?: string;
  ipoPeriod?: string;
  subStartDate?: string;
  subEndDate?: string;
  listingDateParsed?: string;
  sheetStatus?: SheetIpoStatus;
  heatIndex?: number;
  mentions?: number;
  disagreementIndex?: number | null;
  dominant?: string;
  dominantCls?: string;
  bullishPct?: number;
  bearishPct?: number;
  watchPct?: number;
  hasSentiment?: boolean;
  badges?: SheetDisplayBadge[];
}

export interface StockRow {
  name: string;
  code: string;
  heatIndex?: number;
  mentions?: number;
}

export interface SentimentSlice {
  count?: number;
  pct?: number;
}

export interface StockInsight {
  code: string;
  name: string;
  mentions?: number;
  heatIndex?: number;
  disagreementIndex?: number | null;
  sentimentBreakdown?: {
    bullish?: SentimentSlice;
    bearish?: SentimentSlice;
    watch?: SentimentSlice;
    neutral?: SentimentSlice;
    dominant?: string;
  };
  basicTags?: {
    ipoPeriod?: string;
    issuePe?: string;
    sponsor?: string;
    sector?: string;
    sectorGroup?: string;
    lotRateExpect?: string;
  };
  relatedKeywords?: { word: string; affinity?: number; coOccur?: number }[];
}

export interface KeywordStockMapRow {
  word: string;
  topStock?: { code: string; name: string; affinity?: number };
}

export interface SectorHeatRow {
  sectorGroup: string;
  heatScore: number;
  mentions?: number;
  postCount?: number;
  source?: string;
}

export interface DailyTrendRow {
  date: string;
  postCount?: number;
  heatScore?: number;
  weightedHeat?: number;
  sentiment?: { positivePct?: number; negativePct?: number; neutralPct?: number };
  riskKeywordCounts?: { word: string; count: number }[];
}

export interface RiskBar {
  code: string;
  name: string;
  severity?: string;
  riskTags?: string[];
  triggers?: string[];
  concerns?: string[];
}

export interface HotPost {
  id?: string;
  author?: string;
  authorNickname?: string;
  authorAvatar?: string;
  authorFollowers?: number;
  source?: 'nnq_feed' | 'stock_comment' | string;
  text?: string;
  excerpt?: string;
  url?: string;
  link?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  engagement?: number;
  publishedAt?: string;
  sentiment?: string;
  relatedStock?: { code?: string; name?: string };
}

export interface MarketSentiment {
  bullishPct: number;
  bearishPct: number;
  watchPct: number;
  total: number;
}

export interface KeywordItem {
  word: string;
  count: number;
  stock: string;
  growth: number | null;
  isRisk: boolean;
}

export interface StockBoardRow {
  code: string;
  name: string;
  heatIndex: number;
  bullishPct: number;
  bearishPct: number;
  watchPct: number;
  dominant: string;
  dominantCls: string;
  disagreementIndex: number | null;
  sponsor: string;
  issuePe: string;
  sectorGroup: string;
  isRisk: boolean;
}

export interface SectorGroup {
  sectorGroup: string;
  heatScore: number;
  stocks: StockBoardRow[];
}

export interface StockBoards {
  heat: StockBoardRow[];
  bullish: StockBoardRow[];
  risk: StockBoardRow[];
  sector: SectorGroup[];
}

export interface PostInsight {
  id: string;
  title: string;
  authorNickname?: string;
  authorAvatar?: string;
  authorFollowers?: number;
  tags: string[];
  postTypeLabel: string;
  coreView: string;
  bullLogic: string;
  bearLogic: string;
  strategy: string;
  engagement: number;
  url?: string;
  publishedAt?: string;
  isFallback: boolean;
  fallbackExcerpt?: string;
  fallbackNote?: string;
  /** @deprecated use tags */
  subtitle?: string;
}

export type BoardTab = 'heat' | 'bullish' | 'risk' | 'sector';

declare global {
  interface Window {
    __IPO_AI_CONFIG__?: {
      apiKey?: string;
      openaiKey?: string;
      token?: string;
      model?: string;
      baseUrl?: string;
      chatPath?: string;
    };
    __IPO_SHEET_CONFIG__?: {
      publishBase?: string;
      gids?: { listed?: number | string; ipoHome?: number | string };
    };
    ensureNnqHeatLoaded?: (force?: boolean) => void;
    ensureIpoSentimentLoaded?: (force?: boolean) => void;
  }
}

export {};
