import type { HotPost, NnqHeatData } from '../types';
import type { EnrichedBoardRow } from './boardEnhance';

function normCode(raw?: string): string {
  const m = String(raw || '').match(/\d{4,5}/);
  return m ? m[0].padStart(5, '0') : '';
}

function postText(p: HotPost): string {
  return String(p.excerpt || p.text || '').replace(/\s+/g, ' ').trim();
}

function postMatchesStock(p: HotPost, code: string, stockName?: string): boolean {
  const c = normCode(code);
  if (!c) return false;
  const rc = normCode(p.relatedStock?.code);
  if (rc && rc === c) return true;
  const blob = `${postText(p)} ${p.relatedStock?.name || ''}`;
  if (blob.includes(c)) return true;
  const lz = c.replace(/^0+/, '');
  if (lz.length >= 3 && blob.includes(lz)) return true;
  const name = String(stockName || '').trim();
  if (name.length >= 2 && blob.includes(name)) return true;
  const compact = name.replace(/[\s\-·•]/g, '');
  if (compact.length >= 2 && blob.replace(/\s+/g, '').includes(compact)) return true;
  return false;
}

const SNIPPET_PATTERNS: RegExp[] = [
  /负债[\d.]+\s*[万亿]?(?:港元|元|HKD)?/g,
  /(?:净)?亏损[\d.]+\s*[万亿]?(?:港元|元)/g,
  /孖展(?:超额)?(?:认购)?[\d.]+\s*倍/g,
  /(?:无|零)基石/g,
  /(?:无|零)绿鞋/g,
  /首日(?:涨幅)?[\d.]+\s*%/g,
  /破发(?:概率|风险|担忧)/g,
  /毛利率[\d.]+\s*%/g,
  /现金流[^，。；]{0,16}/g,
];

const SNIPPET_KEYWORDS = ['负债', '亏损', '孖展', '基石', '绿鞋', '破发', '财务', '申购', '热度', '毛利率'];

function extractSnippetsFromPost(text: string): string[] {
  const out: string[] = [];
  for (const pat of SNIPPET_PATTERNS) {
    const matches = text.match(pat);
    if (matches) out.push(...matches.map((s) => s.trim()));
  }
  for (const part of text.split(/[。！？；\n]/)) {
    const t = part.trim();
    if (t.length < 8 || t.length > 42) continue;
    if (SNIPPET_KEYWORDS.some((k) => t.includes(k))) out.push(t);
  }
  return out;
}

/** 从 highHeatPostsList 取与标的关联、互动最高的社区观点摘要（单条） */
export function getTopCommunityOpinion(code: string, data: NnqHeatData, stockName?: string): string {
  const posts = (data.highHeatPostsList || [])
    .filter((p) => postMatchesStock(p, code, stockName))
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0));

  for (const p of posts) {
    const snippets = extractSnippetsFromPost(postText(p));
    if (snippets[0]) return snippets[0].length > 36 ? `${snippets[0].slice(0, 35)}…` : snippets[0];
    const text = postText(p);
    if (text.length >= 8 && text.length <= 36) return text;
    if (text.length > 36) return `${text.slice(0, 35)}…`;
  }
  return '';
}

/** 特别关注：结构化要点 + 社区帖关键句提取 */
export function getBoardFocusBullets(
  row: EnrichedBoardRow,
  data: NnqHeatData,
  stockName?: string,
): string[] {
  const bullets: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.replace(/\s+/g, ' ').trim();
    if (t.length < 4 || seen.has(t)) return;
    seen.add(t);
    bullets.push(t.length > 36 ? `${t.slice(0, 35)}…` : t);
  };

  const e = row.enriched;
  const name = stockName || row.name;

  if ((row.heatIndex || 0) >= 1000) push('讨论热度高，需重点关注');
  else if ((row.heatIndex || 0) >= 500) push('社区讨论活跃，建议持续跟踪');

  if (e?.breakConcernPct != null && e.breakConcernPct >= 25) {
    push(`破发担忧 ${e.breakConcernPct}%，申购需谨慎`);
  } else if (e?.breakConcernPct != null && e.breakConcernPct >= 12) {
    push(`破发担忧 ${e.breakConcernPct}%，注意定价与孖展`);
  }

  if (e?.sponsorBreakRate != null && e.sponsorBreakRate >= 0.25) {
    push(`保荐人近1年破发率约 ${Math.round(e.sponsorBreakRate * 100)}%`);
  }

  (row.riskTags || []).forEach((t) => {
    if (t === '募资规模过大') push('募资规模偏大，关注认购倍数');
    if (t === '看空集中') push('社区看空声量偏高');
    if (t === '保荐人破发率高') push('保荐人历史破发率偏高');
  });

  (e?.riskWords || []).slice(0, 2).forEach((w) => push(`风险：${w}`));
  (e?.opportunityWords || []).slice(0, 2).forEach((w) => push(`机会：${w}`));

  const posts = (data.highHeatPostsList || [])
    .filter((p) => postMatchesStock(p, row.code, name))
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
    .slice(0, 6);

  for (const p of posts) {
    for (const snippet of extractSnippetsFromPost(postText(p))) {
      push(snippet);
      if (bullets.length >= 4) break;
    }
    if (bullets.length >= 4) break;
  }

  if (!bullets.length && e?.consensusLine && !/^暂无/.test(e.consensusLine)) {
    e.consensusLine.split(' · ').forEach((part) => push(part));
  }
  if (!bullets.length && row.tipLine && !/^暂无/.test(row.tipLine)) {
    push(row.tipLine);
  }
  if (!bullets.length) push('暂无足够社区观点，建议持续跟踪孖展与暗盘');

  return bullets.slice(0, 4);
}
