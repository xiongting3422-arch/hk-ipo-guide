import { KW_CATEGORIES } from '../constants';
import type { HotPost, NnqHeatData } from '../types';

export interface CommunityPostSnippet {
  id: string;
  excerpt: string;
  url: string;
  likes: number;
  comments: number;
  shares: number;
  interaction: number;
  author?: string;
  stocks: { code?: string; name: string }[];
  publishedAt?: string;
}

export interface HotDiscussionTopic {
  typeLabel: string;
  text: string;
  stocks: string[];
  keyword: string;
}

export interface KeywordTopicBlock {
  word: string;
  posts: CommunityPostSnippet[];
}

const GENERIC_WORDS = new Set(['打新', '新股', '申购', '招股', 'IPO', 'ipo', '2026打新', '2026 打新', '港股打新']);

const IPO_TEXT_RE =
  /打新|新股|招股|暗盘|申购|中签|破发|孖展|绿鞋|基石|乙组|回拨|超购|港股\s*IPO|Hong Kong Stock IPO/i;
const IPO_LINK_RE = /hong-kong-stock-ipo|hong-kong-ipos|ipo-subscription|ipo-allocation/i;

function postUrl(post: HotPost): string {
  return post.link || post.url || '';
}

function postText(post: HotPost): string {
  return (post.excerpt || post.text || '').trim();
}

function postInteraction(post: HotPost): number {
  const likes = post.likes || 0;
  const comments = post.comments || 0;
  const shares = post.shares || 0;
  if (post.engagement != null && post.engagement > 0) {
    return Math.max(post.engagement, likes + comments + shares);
  }
  return likes + comments + shares;
}

function postId(post: HotPost, idx: number): string {
  return post.id || postUrl(post) || `${post.author || 'post'}-${idx}`;
}

function truncateText(text: string, max = 100): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function isWithinDays(iso: string | undefined, refIso: string | undefined, days: number): boolean {
  if (!iso) return true;
  const ref = refIso ? new Date(refIso) : new Date();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return true;
  const diff = ref.getTime() - d.getTime();
  return diff >= -86400000 && diff <= days * 86400000;
}

function buildStockIndex(data: NnqHeatData): { code: string; name: string }[] {
  const seen = new Set<string>();
  const stocks: { code: string; name: string }[] = [];
  [...(data.sheetIpoUniverse || []), ...(data.stockInsights || [])].forEach((s) => {
    if (!s.code || seen.has(s.code)) return;
    seen.add(s.code);
    stocks.push({ code: s.code, name: s.name });
  });
  return stocks.sort((a, b) => b.name.length - a.name.length);
}

function relatedStocksFromPost(
  post: HotPost,
  stockIndex: { code: string; name: string }[],
): { code?: string; name: string }[] {
  if (post.relatedStock?.name || post.relatedStock?.code) {
    return [
      {
        code: post.relatedStock.code,
        name: post.relatedStock.name || post.relatedStock.code || '—',
      },
    ];
  }
  const text = postText(post);
  const hits = stockIndex.filter((s) => text.includes(s.name) || text.includes(s.code));
  return hits.slice(0, 3).map((s) => ({ code: s.code, name: s.name }));
}

function isIpoRelatedPost(post: HotPost, stockIndex: { code: string; name: string }[]): boolean {
  const text = postText(post);
  const link = postUrl(post);
  if (IPO_LINK_RE.test(link)) return true;
  if (IPO_TEXT_RE.test(text)) return true;
  return relatedStocksFromPost(post, stockIndex).length > 0;
}

function normalizePost(post: HotPost, idx: number, stockIndex: { code: string; name: string }[]): CommunityPostSnippet {
  const likes = post.likes || 0;
  const comments = post.comments || 0;
  const shares = post.shares || 0;
  return {
    id: postId(post, idx),
    excerpt: truncateText(postText(post), 100),
    url: postUrl(post),
    likes,
    comments,
    shares,
    interaction: postInteraction(post),
    author: post.author,
    stocks: relatedStocksFromPost(post, stockIndex),
    publishedAt: post.publishedAt,
  };
}

export function getCommunityPosts(data: NnqHeatData, days = 7): CommunityPostSnippet[] {
  const stockIndex = buildStockIndex(data);
  const ref = data.updatedAt;
  const posts = data.highHeatPostsList || [];

  return posts
    .filter((p) => isWithinDays(p.publishedAt, ref, days))
    .filter((p) => isIpoRelatedPost(p, stockIndex))
    .map((p, idx) => normalizePost(p, idx, stockIndex))
    .sort((a, b) => b.interaction - a.interaction);
}

function classifyKeyword(word: string): keyof typeof KW_CATEGORIES {
  for (const key of ['risk', 'bullish', 'trade', 'fundamental'] as const) {
    const cat = KW_CATEGORIES[key];
    if (cat.words.some((k) => word.includes(k) || k.includes(word))) return key;
  }
  if (/暗盘|打新|申购|中签|孖展/.test(word)) return 'trade';
  if (/招股|基石|保荐|绿鞋|定价/.test(word)) return 'fundamental';
  if (/破发|劝退|避雷|坑/.test(word)) return 'risk';
  if (/必打|大肉|中签|看好/.test(word)) return 'bullish';
  return 'fundamental';
}

function topicTypeLabel(word: string, category: keyof typeof KW_CATEGORIES): string {
  if (/破发|劝退|避雷|坑|弃购/.test(word)) return '破发担忧';
  if (/募资|百亿|规模/.test(word)) return '募资讨论';
  if (/暗盘|孖展|打新|申购|乙组|回拨/.test(word)) return '打新交易';
  if (/中签|必打|大肉|稳中签/.test(word)) return '中签讨论';
  if (/基石|招股|定价|绿鞋|保荐/.test(word)) return '招股基本面';
  if (category === 'risk') return '风险讨论';
  if (category === 'bullish') return '利好讨论';
  if (category === 'trade') return '交易讨论';
  return '基本面讨论';
}

function postMatchesKeyword(post: HotPost, word: string): boolean {
  const text = postText(post).toLowerCase();
  const w = word.toLowerCase();
  if (text.includes(w)) return true;
  if (post.relatedStock?.name?.includes(word)) return true;
  if (post.relatedStock?.code?.includes(word)) return true;
  return false;
}

function keywordScore(data: NnqHeatData, word: string, posts: HotPost[]): number {
  const countRow = (data.topKeywords || []).find((r) => r.word === word);
  const base = countRow?.count || 0;
  const postEng = posts
    .filter((p) => postMatchesKeyword(p, word))
    .reduce((s, p) => s + postInteraction(p), 0);
  return base * 2 + postEng;
}

function buildTopicLine(
  typeLabel: string,
  keyword: string,
  stocks: string[],
  post?: HotPost,
): string {
  const stockLabel = stocks.length ? stocks.join('、') : '社区';
  const excerpt = post ? truncateText(postText(post), 48) : '';
  if (excerpt && (excerpt.includes(stockLabel.split('、')[0]) || excerpt.length > 12)) {
    return `【${typeLabel}】${excerpt}`;
  }
  if (/募资|规模|百亿/.test(keyword) || /募资|规模|百亿/.test(excerpt)) {
    return `【${typeLabel}】${stockLabel}帖文讨论募资与发行规模`;
  }
  if (/破发|劝退|避雷/.test(keyword)) {
    return `【${typeLabel}】${stockLabel}帖文提及「${keyword}」`;
  }
  return `【${typeLabel}】${stockLabel}围绕「${keyword}」展开讨论`;
}

function collectKeywords(data: NnqHeatData): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  const push = (w?: string) => {
    if (!w || seen.has(w) || GENERIC_WORDS.has(w)) return;
    seen.add(w);
    words.push(w);
  };
  (data.topKeywords || []).forEach((r) => push(r.word));
  (data.keywordStockMap || []).forEach((r) => push(r.word));
  return words;
}

function topStocksForKeyword(data: NnqHeatData, word: string): string[] {
  const names: string[] = [];
  const mapRow = (data.keywordStockMap || []).find((r) => r.word === word);
  if (mapRow?.topStock?.name) names.push(mapRow.topStock.name);
  for (const s of data.stockInsights || []) {
    for (const k of s.relatedKeywords || []) {
      if (!k.word) continue;
      if (k.word.includes(word) || word.includes(k.word)) {
        if (!names.includes(s.name)) names.push(s.name);
      }
    }
  }
  return names.slice(0, 2);
}

export function buildHotDiscussionTopics(data: NnqHeatData): HotDiscussionTopic[] {
  const posts = (data.highHeatPostsList || []).filter((p) =>
    isWithinDays(p.publishedAt, data.updatedAt, 7),
  );
  const keywords = collectKeywords(data);
  const stockIndex = buildStockIndex(data);

  const ranked = keywords
    .map((word) => {
      const cat = classifyKeyword(word);
      const matched = posts.filter((p) => postMatchesKeyword(p, word));
      const topPost = [...matched].sort((a, b) => postInteraction(b) - postInteraction(a))[0];
      const stocks = topStocksForKeyword(data, word);
      if (!stocks.length && topPost) {
        relatedStocksFromPost(topPost, stockIndex).forEach((s) => {
          if (s.name && !stocks.includes(s.name)) stocks.push(s.name);
        });
      }
      return {
        word,
        score: keywordScore(data, word, posts),
        stocks,
        topPost,
        matched,
        typeLabel: topicTypeLabel(word, cat),
      };
    })
    .filter((r) => r.score > 0 && (r.matched.length > 0 || r.stocks.length > 0))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, 4).map((r) => ({
    typeLabel: r.typeLabel,
    keyword: r.word,
    stocks: r.stocks,
    text: buildTopicLine(r.typeLabel, r.word, r.stocks, r.topPost),
  }));
}

export function buildKeywordTopicCategories(
  data: NnqHeatData,
): Record<string, KeywordTopicBlock[]> {
  const stockIndex = buildStockIndex(data);
  const posts = (data.highHeatPostsList || []).filter(
    (p) => isWithinDays(p.publishedAt, data.updatedAt, 7) && isIpoRelatedPost(p, stockIndex),
  );
  const keywords = collectKeywords(data);

  const buckets: Record<string, KeywordTopicBlock[]> = {
    trade: [],
    fundamental: [],
    risk: [],
    bullish: [],
  };
  const usedPostIds = new Set<string>();

  keywords.forEach((word) => {
    const cat = classifyKeyword(word);
    const matched = posts
      .filter((p) => postMatchesKeyword(p, word))
      .sort((a, b) => postInteraction(b) - postInteraction(a))
      .slice(0, 2)
      .map((p, idx) => normalizePost(p, idx, stockIndex));

    if (!matched.length) return;

    matched.forEach((m) => usedPostIds.add(m.id));
    buckets[cat].push({ word, posts: matched });
  });

  Object.keys(buckets).forEach((k) => {
    buckets[k].sort((a, b) => {
      const sa = a.posts.reduce((s, p) => s + p.interaction, 0);
      const sb = b.posts.reduce((s, p) => s + p.interaction, 0);
      return sb - sa;
    });
  });

  // Fill empty categories with best unmatched IPO posts tagged by category keywords
  const keys = Object.keys(KW_CATEGORIES) as (keyof typeof KW_CATEGORIES)[];
  keys.forEach((key) => {
    if (buckets[key].length) return;
    const catWords = KW_CATEGORIES[key].words;
    const fallback = posts
      .filter((p) => {
        const id = postId(p, 0);
        if (usedPostIds.has(id)) return false;
        return catWords.some((w) => postMatchesKeyword(p, w));
      })
      .sort((a, b) => postInteraction(b) - postInteraction(a))
      .slice(0, 1);
    if (!fallback.length) return;
    const word = catWords.find((w) => postMatchesKeyword(fallback[0], w)) || catWords[0];
    buckets[key].push({
      word,
      posts: fallback.map((p, idx) => normalizePost(p, idx, stockIndex)),
    });
  });

  return buckets;
}

export function buildHighEngagementPosts(data: NnqHeatData, limit = 8): CommunityPostSnippet[] {
  return getCommunityPosts(data, 7).slice(0, limit);
}
