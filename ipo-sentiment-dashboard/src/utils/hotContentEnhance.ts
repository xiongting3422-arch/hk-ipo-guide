import type { HotPost, NnqHeatData, PostInsight, SheetIpoCard } from '../types';

const MIN_INTERACTION = 10;
const MAX_CARDS = 8;
const FALLBACK_LEN = 100;

const IPO_KW =
  /打新|新股|招股|暗盘|破发|中签|孖展|绿鞋|基石|乙组|回拨|超购|港股\s*IPO|Hong Kong Stock IPO|hong-kong-stock-ipo/i;
const IPO_LINK_RE = /hong-kong-stock-ipo|hong-kong-ipos|ipo-subscription|ipo-allocation/i;

const INDUSTRY_NOISE =
  /美股|纳指|标普|道琼斯|SpaceX|OpenAI|Anthropic|半导体板块|谷歌|微软|亚马逊|Meta Platforms|苹果\(|GOOG|MSFT|AMZN|NVDA|QQQ|13F|实盘:\s*继续跟踪沪深|U\.S\. and Hong Kong Stock Market Analysis/i;

const DATA_LINE_RE = /招股定价|招股价|每手股数|入场费|基石占比|发行比例|发行后总市值|📍公司|💰|📚|📙|🚪/;

type PostClassifyType = 'fundamental' | 'trend' | 'industry' | 'allotment' | 'general';

interface MatchedStock {
  code: string;
  name: string;
  sector?: string;
}

interface ExtractedFields {
  coreView: string;
  fundamentals: string;
  strategy: string;
}

function postUrl(post: HotPost): string {
  return post.link || post.url || '';
}

function postText(post: HotPost): string {
  return (post.excerpt || post.text || '').replace(/\s+/g, ' ').trim();
}

function postInteraction(post: HotPost): number {
  const likes = post.likes || 0;
  const comments = post.comments || 0;
  const shares = post.shares || 0;
  const sum = likes + comments + shares;
  if (post.engagement != null && post.engagement > 0) {
    return Math.max(post.engagement, sum);
  }
  return sum;
}

function postTimestamp(post: HotPost): number {
  if (!post.publishedAt) return 0;
  const t = new Date(post.publishedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function authorKey(post: HotPost): string {
  const author = (post.author || '').trim();
  if (author) return author;
  return postUrl(post) || post.id || 'unknown';
}

function buildSheetStockIndex(data: NnqHeatData): MatchedStock[] {
  const seen = new Set<string>();
  const stocks: MatchedStock[] = [];
  (data.sheetIpoUniverse || []).forEach((c: SheetIpoCard) => {
    if (!c.code || seen.has(c.code)) return;
    seen.add(c.code);
    stocks.push({ code: c.code, name: c.name, sector: c.sector });
  });
  return stocks.sort((a, b) => b.name.length - a.name.length);
}

function matchSheetStocks(post: HotPost, sheetStocks: MatchedStock[]): MatchedStock[] {
  if (post.relatedStock?.code) {
    const hit = sheetStocks.find((s) => s.code === post.relatedStock?.code);
    if (hit) return [hit];
  }
  const text = postText(post);
  return sheetStocks.filter((s) => text.includes(s.name) || text.includes(s.code)).slice(0, 3);
}

function hasIpoKeywordSignal(post: HotPost): boolean {
  const text = postText(post);
  return IPO_KW.test(text) || IPO_LINK_RE.test(postUrl(post));
}

function isPureIndustryNoise(text: string, stocks: MatchedStock[]): boolean {
  const namesHit = stocks.some((s) => text.includes(s.name) || text.includes(s.code));
  const ipoFocused =
    /📍公司|招股定价|申购计划|hong-kong-stock-ipo|暗盘|中签|乙组|破发|孖展倍数|发行比例|入场费/.test(text);
  if (namesHit && (ipoFocused || IPO_KW.test(text))) return false;
  if (INDUSTRY_NOISE.test(text) && !ipoFocused) return true;
  if (/行业分析|产业链|板块轮动|大盘/.test(text) && !namesHit) return true;
  return false;
}

function isStockCommentPost(post: HotPost): boolean {
  return post.source === 'stock_comment';
}

function minInteraction(data: NnqHeatData): number {
  const fromFilter = data.filter?.highHeatThreshold ?? data.summary?.highHeatThreshold;
  return fromFilter != null && fromFilter > 0 ? fromFilter : MIN_INTERACTION;
}

export function filterHotIpoPosts(data: NnqHeatData): HotPost[] {
  const sheetStocks = buildSheetStockIndex(data);
  if (!sheetStocks.length) return [];
  const threshold = minInteraction(data);

  return (data.highHeatPostsList || []).filter((post) => {
    if (postInteraction(post) < threshold) return false;
    const stocks = matchSheetStocks(post, sheetStocks);
    if (!stocks.length) return false;
    if (isStockCommentPost(post)) return true;
    if (!hasIpoKeywordSignal(post)) return false;
    return !isPureIndustryNoise(postText(post), stocks);
  });
}

function dedupeByAuthor(posts: HotPost[]): HotPost[] {
  const groups = new Map<string, HotPost[]>();
  posts.forEach((post) => {
    const key = authorKey(post);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(post);
  });

  const picked: HotPost[] = [];
  groups.forEach((list) => {
    const best = [...list].sort((a, b) => {
      const tb = postTimestamp(b) - postTimestamp(a);
      if (tb !== 0) return tb;
      return postInteraction(b) - postInteraction(a);
    })[0];
    if (best) picked.push(best);
  });
  return picked;
}

function compositeRank(post: HotPost): number {
  const interaction = postInteraction(post);
  const recency = postTimestamp(post) / 1e10;
  return interaction * 1000 + recency;
}

function selectDisplayPosts(data: NnqHeatData): HotPost[] {
  return dedupeByAuthor(filterHotIpoPosts(data))
    .sort((a, b) => compositeRank(b) - compositeRank(a))
    .slice(0, MAX_CARDS);
}

function classifyPostType(text: string): PostClassifyType {
  if (/中签|乙组|回拨|配发|一手中签|稳获|摇号|分配结果|开奖/.test(text)) return 'allotment';
  if (/📍公司|招股定价|基石占比|入场费|发行比例|招股书|绿鞋|保荐|募资|总市值|发行后/.test(text)) {
    return 'fundamental';
  }
  if (/暗盘|首日|涨幅|破发|上市后|开盘表现|高开|低开/.test(text)) return 'trend';
  if (/赛道|行业|板块|产业链/.test(text)) return 'industry';
  return 'general';
}

function postTypeLabel(type: PostClassifyType): string {
  const map: Record<PostClassifyType, string> = {
    fundamental: '基本面分析',
    trend: '走势预测',
    industry: '行业分析',
    allotment: '中签经验',
    general: '打新讨论',
  };
  return map[type];
}

function pickField(text: string, pattern: RegExp): string {
  const m = text.match(pattern);
  return m?.[1]?.trim().replace(/\s+/g, ' ').replace(/…+$/, '') || '';
}

function extractFundamentalMap(text: string): Record<string, string> {
  const greenshoe = /绿鞋[：:\s]*有|♋绿鞋：有/.test(text)
    ? '有'
    : /绿鞋[：:\s]*无|♋绿鞋：无/.test(text)
      ? '无'
      : '';

  return {
    招股价: pickField(text, /(?:招股定价|招股价)[：:\s]*([0-9.]+港元?)/),
    每手股数: pickField(text, /每手股数[：:\s]*([0-9]+股)/),
    入场费: pickField(text, /入场费[：:\s]*([0-9.]+港元?)/),
    发行比例: pickField(text, /发行比例[：:\s]*([0-9.]+%)/),
    基石占比: pickField(text, /基石占比[：:\s]*([0-9.]+%|无)/),
    绿鞋: greenshoe,
    发行后总市值: pickField(text, /发行后总市值[：:\s]*([0-9.]+\s*亿[^📙\s…]*|[^📙\s…]+)/),
  };
}

function formatFundamentals(fields: Record<string, string>): string {
  return Object.entries(fields)
    .filter(([, v]) => v && v !== '—')
    .map(([k, v]) => `${k}:${v}`)
    .join(' | ');
}

function cleanText(text: string): string {
  return text
    .replace(/📍|💰|📚|📙|🚪|♋|🪨|🏠|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text: string): string[] {
  return cleanText(text)
    .split(/[。！？\n；;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

function buildCoreSentence(stocks: MatchedStock[], text: string, type: PostClassifyType): string {
  const name = stocks[0]?.name || '该新股';
  const f = extractFundamentalMap(text);

  if (f.招股价 && f.发行后总市值) {
    return `${name}招股价${f.招股价}，发行后总市值${f.发行后总市值}`;
  }
  if (f.招股价) {
    return `${name}招股价${f.招股价}，社区讨论其招股定价与申购安排`;
  }

  if (type === 'allotment') {
    const hit = splitSentences(text).find((s) => /中签|乙组|回拨|配发|门槛/.test(s));
    if (hit && hit.length <= 72) return hit.endsWith('。') ? hit.slice(0, -1) : hit;
    return `${name}中签与配售结果引发社区讨论`;
  }

  if (type === 'trend') {
    const hit = splitSentences(text).find((s) => /暗盘|首日|破发|涨幅|表现/.test(s));
    if (hit && hit.length <= 72 && !DATA_LINE_RE.test(hit)) {
      return hit.endsWith('。') ? hit.slice(0, -1) : hit;
    }
    return `${name}上市/暗盘表现成为讨论焦点`;
  }

  const hit = splitSentences(text).find((s) => s.includes(name) && s.length <= 72 && !DATA_LINE_RE.test(s));
  if (hit) return hit.endsWith('。') ? hit.slice(0, -1) : hit;

  return `${name}为近期港股IPO讨论标的`;
}

function extractStrategy(text: string, type: PostClassifyType, stocks: MatchedStock[]): string {
  const candidates = splitSentences(text).filter(
    (s) =>
      s.length >= 8 &&
      s.length <= 72 &&
      !DATA_LINE_RE.test(s) &&
      /孖展|申购|资金|仓位|参与|观望|弃购|暗盘|乙组|甲组|利率|分配|建议|关注|门槛|回拨|理性|控制/.test(s),
  );

  if (candidates.length) {
    const best = candidates[0];
    return best.endsWith('。') ? best.slice(0, -1) : best;
  }

  if (type === 'fundamental') return '关注孖展利率与认购倍数，合理分配申购资金';
  if (type === 'allotment') return '参考乙组门槛与回拨情况，按需安排申购';
  if (type === 'trend') return '结合暗盘与首日表现再决策是否参与';
  if (stocks.length) return `持续跟踪${stocks[0].name}孖展与舆情变化`;
  return '';
}

function extractFields(text: string, type: PostClassifyType, stocks: MatchedStock[]): ExtractedFields {
  const fundamentals = formatFundamentals(extractFundamentalMap(text));
  const coreView = buildCoreSentence(stocks, text, type);
  const strategy = extractStrategy(text, type, stocks);

  if (type === 'allotment' && !fundamentals) {
    const allotBits = [
      pickField(text, /乙组[^，。；;]{0,20}/) && `乙组:${pickField(text, /(乙组[^，。；;]{0,24})/)}`,
      pickField(text, /回拨[^，。；;]{0,16}/) && `回拨:${pickField(text, /(回拨[^，。；;]{0,16})/)}`,
      pickField(text, /孖展[^，。；;]{0,16}/) && `孖展:${pickField(text, /(孖展[^，。；;]{0,16})/)}`,
    ].filter(Boolean);
    return {
      coreView,
      fundamentals: allotBits.join(' | '),
      strategy,
    };
  }

  return { coreView, fundamentals, strategy };
}

function isMeaningfulExtraction(fields: ExtractedFields): boolean {
  if (!fields.coreView || fields.coreView.length < 8) return false;
  return !!(fields.fundamentals || fields.strategy);
}

function stockTags(stocks: MatchedStock[]): string[] {
  return stocks.map((s) => s.name).slice(0, 3);
}

function fmtPostTime(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      timeZone: 'Asia/Hong_Kong',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function truncate(text: string, max: number): string {
  const t = cleanText(text);
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function authorProfile(post: HotPost) {
  return {
    authorNickname: post.authorNickname || post.author || '牛友',
    authorAvatar: post.authorAvatar || '',
    authorFollowers: post.authorFollowers ?? 0,
  };
}

function buildCard(post: HotPost, idx: number, data: NnqHeatData): PostInsight | null {
  const sheetStocks = buildSheetStockIndex(data);
  const stocks = matchSheetStocks(post, sheetStocks);
  if (!stocks.length) return null;

  const text = postText(post);
  if (!text) return null;

  const type = classifyPostType(text);
  const fields = extractFields(text, type, stocks);
  const interaction = postInteraction(post);
  const url = postUrl(post);
  const id = post.id || url || `${authorKey(post)}-${idx}`;
  const profile = authorProfile(post);

  if (!isMeaningfulExtraction(fields)) {
    return {
      id,
      title: post.author || '牛友',
      ...profile,
      tags: stockTags(stocks),
      postTypeLabel: postTypeLabel(type),
      coreView: '',
      bullLogic: '',
      bearLogic: '',
      strategy: '',
      engagement: interaction,
      url: url || undefined,
      publishedAt: fmtPostTime(post.publishedAt),
      isFallback: true,
      fallbackExcerpt: truncate(text, FALLBACK_LEN),
      fallbackNote: '查看原帖了解详情',
    };
  }

  return {
    id,
    title: post.author || '牛友',
    ...profile,
    tags: stockTags(stocks),
    postTypeLabel: postTypeLabel(type),
    coreView: fields.coreView,
    bullLogic: fields.fundamentals,
    bearLogic: '',
    strategy: fields.strategy,
    engagement: interaction,
    url: url || undefined,
    publishedAt: fmtPostTime(post.publishedAt),
    isFallback: false,
  };
}

export function buildHotContentCards(data: NnqHeatData): PostInsight[] {
  const posts = selectDisplayPosts(data);
  const cards: PostInsight[] = [];

  posts.forEach((post, idx) => {
    const card = buildCard(post, idx, data);
    if (!card) return;
    if (card.isFallback && !card.fallbackExcerpt) return;
    cards.push(card);
  });

  return cards.slice(0, MAX_CARDS);
}
