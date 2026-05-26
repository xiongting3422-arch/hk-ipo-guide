import { POST_AI_SYSTEM } from '../constants';
import type { NnqHeatData, RiskBar } from '../types';
import {
  aggregateMarketSentiment,
  buildRiskHighlightBars,
  getStockList,
} from './data';

export interface PostContext {
  updatedAt?: string;
  days: number;
  meta: { totalPosts?: number; heatTrend: string; heatDeltaPct: number };
  sentiment: { bullish: number; bearish: number; watch: number };
  hotSectors: { name?: string; heatScore?: number }[];
  hotKeywords: string[];
  topStocks: {
    name: string;
    code: string;
    heatIndex?: number;
    disagreementIndex?: number | null;
    dominant: string;
    tags: Record<string, string | undefined>;
  }[];
  riskHighlightBars: RiskBar[];
  strategy: { focus: string[]; avoid: string[]; greyTip: string };
}

export function buildPostContext(data: NnqHeatData): PostContext {
  const days = data.filter?.days || 10;
  const summary = data.summary || {};
  const meta = data.meta || {};
  const stocks = getStockList(data);
  const sector = data.marketInsights?.sectorHeat || [];
  const keywords = (data.topKeywords || []).slice(0, 8);
  const riskBars = buildRiskHighlightBars(data);
  const daily = data.dailyTrend || [];
  const recent = daily.slice(-3);
  const prior = daily.slice(-6, -3);
  let rHeat = 0;
  let pHeat = 0;
  recent.forEach((d) => {
    rHeat += d.weightedHeat || d.heatScore || 0;
  });
  prior.forEach((d) => {
    pHeat += d.weightedHeat || d.heatScore || 0;
  });
  if (!pHeat) pHeat = 1;
  const heatDelta = (rHeat - pHeat) / pHeat;
  let heatTrend = '平稳';
  if (heatDelta > 0.15) heatTrend = '升温';
  else if (heatDelta < -0.15) heatTrend = '降温';

  let bSum = 0;
  let sSum = 0;
  let wSum = 0;
  stocks.forEach((st) => {
    const sb = st.sentimentBreakdown || {};
    bSum += sb.bullish?.pct || 0;
    sSum += sb.bearish?.pct || 0;
    wSum += (sb.watch?.pct || 0) + (sb.neutral?.pct || 0);
  });
  const n = Math.max(stocks.length, 1);

  const topStocks = [...stocks]
    .sort((a, b) => (b.heatIndex || 0) - (a.heatIndex || 0))
    .slice(0, 5)
    .map((st) => {
      const sb = st.sentimentBreakdown || {};
      const domMap: Record<string, string> = {
        bullish: '看多',
        bearish: '看空',
        watch: '观望',
        neutral: '中性',
      };
      return {
        name: st.name,
        code: st.code,
        heatIndex: st.heatIndex,
        disagreementIndex: st.disagreementIndex,
        dominant: domMap[sb.dominant || 'neutral'] || '中性',
        tags: st.basicTags || {},
      };
    });

  const focus = topStocks
    .slice(0, 2)
    .filter((s) => (s.heatIndex || 0) > 0)
    .map((s) => s.name);
  let avoid = riskBars.slice(0, 3).map((b) => b.name);
  if (!avoid.length) {
    avoid = topStocks
      .filter(
        (s) =>
          (stocks.find((x) => x.code === s.code)?.sentimentBreakdown?.bearish?.pct || 0) >= 20,
      )
      .map((s) => s.name)
      .slice(0, 2);
  }

  const sent = aggregateMarketSentiment(data);

  return {
    updatedAt: data.updatedAt,
    days,
    meta: {
      totalPosts: summary.totalPosts || meta.afterNoiseFilter,
      heatTrend,
      heatDeltaPct: Math.round(heatDelta * 1000) / 10,
    },
    sentiment: {
      bullish: Math.round(sent.bullishPct * 10) / 10,
      bearish: Math.round(sent.bearishPct * 10) / 10,
      watch: Math.round(sent.watchPct * 10) / 10,
    },
    hotSectors: sector.slice(0, 3).map((r) => ({
      name: r.sectorGroup,
      heatScore: r.heatScore,
    })),
    hotKeywords: keywords.map((k) => k.word).filter(Boolean),
    topStocks,
    riskHighlightBars: riskBars,
    strategy: {
      focus,
      avoid: avoid.length ? avoid : ['暂无触发预警标的'],
      greyTip: '暗盘重点看定价与成交量，首日关注开盘15分钟情绪与基石货是否集中出货',
    },
  };
}

export function generatePostLocal(ctx: PostContext): string {
  const dateStr = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Hong_Kong' });
  const sectorTxt =
    ctx.hotSectors
      .slice(0, 2)
      .map((s) => s.name || '其他')
      .join('、') || '暂无集中赛道';
  const kwTxt = ctx.hotKeywords.slice(0, 4).join('、') || '打新、招股';
  const focus = ctx.strategy.focus.join('、') || '暂无明显优先标的';
  const avoid = ctx.strategy.avoid.join('、') || '暂无';

  const lines = [
    `📊 港股 IPO 舆情分析 | ${dateStr}`,
    '',
    '━━ 市场总结 ━━',
    `近${ctx.days}日有效讨论 ${ctx.meta.totalPosts ?? '—'} 条 · 热度${ctx.meta.heatTrend}（${ctx.meta.heatDeltaPct}%）`,
    `情绪：看多 ${ctx.sentiment.bullish}% · 看空 ${ctx.sentiment.bearish}% · 观望 ${ctx.sentiment.watch}%`,
    `热门赛道：${sectorTxt}｜高频词：${kwTxt}`,
    '',
    '━━ 热门新股 ━━',
  ];

  ctx.topStocks.slice(0, 3).forEach((s, i) => {
    lines.push(
      `${i + 1}. ${s.name}（${s.code}）热度 ${s.heatIndex ?? '—'} · ${s.dominant} · 分歧 ${s.disagreementIndex ?? '—'}`,
    );
    const t = s.tags;
    if (t.sponsor || t.sectorGroup) {
      lines.push(`   ${t.sectorGroup ? `赛道 ${t.sectorGroup}` : ''}${t.sponsor ? ` · 保荐 ${t.sponsor}` : ''}`);
    }
  });

  lines.push('', '━━ 机会点 ━━');
  lines.push(`✅ 优先跟踪：${focus}`);
  if (ctx.topStocks[0]) {
    lines.push(`✅ ${ctx.topStocks[0].name} 社区关注度领先，可重点看孖展与暗盘定价`);
  } else {
    lines.push('✅ 暂无明显龙头标的，等待新股招股节奏');
  }

  lines.push('', '━━ 风险点 ━━');
  if (ctx.riskHighlightBars.length) {
    ctx.riskHighlightBars.slice(0, 2).forEach((b) => {
      lines.push(`⚠️ ${b.name}：${(b.riskTags || []).join('、')}`);
    });
  } else {
    lines.push('⚠️ 未触发负面增速 / 破发 TOP3 / 保荐高破发率预警');
  }
  lines.push(`❌ 谨慎：${avoid}`);
  lines.push(`🌙 ${ctx.strategy.greyTip}`);
  lines.push('', '#港股打新 #IPO舆情 #新股分析 #牛牛圈 #暗盘');

  return lines.join('\n');
}

export async function callAiPostGenerator(ctx: PostContext): Promise<string | null> {
  const cfg = window.__IPO_AI_CONFIG__ || {};
  const key = cfg.apiKey || cfg.openaiKey || cfg.token;
  if (!key) return null;

  const model = cfg.model || 'gpt-4o-mini';
  const base = cfg.baseUrl?.trim()
    ? cfg.baseUrl.replace(/\/$/, '')
    : 'https://api.openai.com/v1';
  const path = cfg.chatPath || '/chat/completions';

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 900,
      messages: [
        { role: 'system', content: POST_AI_SYSTEM },
        {
          role: 'user',
          content: `请基于以下舆情 JSON，生成一段可直接发布到牛牛圈的港股 IPO 舆情分析（350–550字），包含市场总结、热门股票、机会点、风险点。\n\n${JSON.stringify(ctx)}`,
        },
      ],
    }),
  });

  if (!res.ok) return null;
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  return text ? String(text).trim() : null;
}
