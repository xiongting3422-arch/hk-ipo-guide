#!/usr/bin/env python3
"""
牛牛圈 IPO 舆情看板 · AI 发文文案生成

用法：
  python3 nnq_post_generator.py [--style brief|deep] [--json path/to/nnq-heat.json]

输出 prompt（stdout）或本地模板文案（--local）。
环境变量（AI 调用，勿写入仓库）：OPENAI_API_KEY 或沿用前端 __IPO_AI_CONFIG__ 同名配置。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Literal

PostStyle = Literal["brief", "deep"]

TZ_CN = timezone(timedelta(hours=8))

# ---------------------------------------------------------------------------
# Prompt 模板（OpenAI-compatible chat/completions）
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """你是港股 IPO 打新社区的内容编辑，擅长写富途牛牛圈帖子。
硬性要求：
1. 只根据用户提供的 JSON 舆情数据写作，不得编造未出现的个股、数值或新闻。
2. 输出纯帖子正文，不要 Markdown 代码块，不要 JSON。
3. 使用简体中文，适配牛牛圈：适当 emoji、空行分段、文末 3–5 个 #话题标签。
4. 结构必须包含：开头市场情绪 → 中部重点个股 → 结尾打新策略。
5. 涉及破发、保荐风险须用谨慎表述，不构成投资建议。"""

USER_PROMPT_BRIEF = """请基于以下舆情 JSON，生成「简洁打新手账版」牛牛圈分析帖。

风格：短句、清单化、每条 1–2 行，总字数 280–450 字。

数据：
{context_json}

模板参考（可改写，勿遗漏模块）：
📊 近{{days}}天港股打新舆情手账
🎯 市场情绪：（看多/看空/观望 + 热度变化 + 赛道热点）
🔥 重点新股：（热度 TOP2–3，各写共识+分歧+一句打新预期）
⚠️ 风险提示
💡 打新策略：优先关注 / 避雷 / 暗盘·首日参考
#港股打新 #新股IPO #牛牛圈 …"""

USER_PROMPT_DEEP = """请基于以下舆情 JSON，生成「深度投研分析版」牛牛圈分析帖。

风格：段落完整、逻辑链清晰，可引用热度指数/分歧度/雷达维度，总字数 600–900 字。

数据：
{context_json}

模板参考：
一、近{{days}}天市场总览（情绪结构、热度趋势、赛道与关键词）
二、重点个股深度（TOP2–3：共识、分歧、ipoRadar 五维解读、保荐/赛道标签）
三、风险监测（riskHighlightBars 如有）
四、策略建议（优先申购/观望/避雷，暗盘与首日操作框架）
文末 #话题标签"""


def _dominant_label(d: str) -> str:
    return {"bullish": "看多", "bearish": "看空", "watch": "观望", "neutral": "中性"}.get(d, "中性")


def build_post_context(payload: dict[str, Any]) -> dict[str, Any]:
    """从 nnq-heat.json 提取发文上下文（与前端 buildPostContext 字段对齐）。"""
    days = int((payload.get("filter") or {}).get("days") or 10)
    summary = payload.get("summary") or {}
    meta = payload.get("meta") or {}
    stocks = payload.get("stockInsights") or payload.get("topStocks") or []
    sector = ((payload.get("marketInsights") or {}).get("sectorHeat")) or []
    keywords = (payload.get("topKeywords") or [])[:8]
    risk_bars = payload.get("riskHighlightBars") or []
    daily = payload.get("dailyTrend") or []

    # 热度趋势：近3天 vs 前3天 weightedHeat
    recent = daily[-3:] if len(daily) >= 3 else daily
    prior = daily[-6:-3] if len(daily) >= 6 else []
    r_heat = sum(d.get("weightedHeat") or 0 for d in recent)
    p_heat = sum(d.get("weightedHeat") or 0 for d in prior) or 1
    heat_delta = (r_heat - p_heat) / p_heat
    if heat_delta > 0.15:
        heat_trend = "升温"
    elif heat_delta < -0.15:
        heat_trend = "降温"
    else:
        heat_trend = "平稳"

    sent_agg = {"bullish": 0.0, "bearish": 0.0, "watch": 0.0}
    for s in stocks:
        sb = s.get("sentimentBreakdown") or {}
        sent_agg["bullish"] += float((sb.get("bullish") or {}).get("pct") or 0)
        sent_agg["bearish"] += float((sb.get("bearish") or {}).get("pct") or 0)
        sent_agg["watch"] += float((sb.get("watch") or {}).get("pct") or 0) + float(
            (sb.get("neutral") or {}).get("pct") or 0
        )
    n = max(len(stocks), 1)
    for k in sent_agg:
        sent_agg[k] = round(sent_agg[k] / n, 1)

    top_stocks = []
    for s in sorted(stocks, key=lambda x: x.get("heatIndex") or 0, reverse=True)[:5]:
        sb = s.get("sentimentBreakdown") or {}
        radar = s.get("ipoRadar") or {}
        top_stocks.append(
            {
                "name": s.get("name"),
                "code": s.get("code"),
                "heatIndex": s.get("heatIndex"),
                "disagreementIndex": s.get("disagreementIndex"),
                "dominant": _dominant_label(sb.get("dominant") or "neutral"),
                "bullishPct": (sb.get("bullish") or {}).get("pct"),
                "bearishPct": (sb.get("bearish") or {}).get("pct"),
                "keywords": [k.get("word") for k in (s.get("relatedKeywords") or [])[:4]],
                "tags": s.get("basicTags") or {},
                "radar": radar.get("scores") or {},
            }
        )

    focus = [s["name"] for s in top_stocks[:2] if (s.get("heatIndex") or 0) > 0]
    avoid = [b.get("name") for b in risk_bars[:3]]
    if not avoid:
        avoid = [
            s["name"]
            for s in top_stocks
            if (s.get("bearishPct") or 0) >= 20 or (s.get("disagreementIndex") or 100) <= 20
        ][:2]

    return {
        "updatedAt": payload.get("updatedAt"),
        "days": days,
        "meta": {
            "totalPosts": summary.get("totalPosts") or meta.get("afterNoiseFilter"),
            "heatTrend": heat_trend,
            "heatDeltaPct": round(heat_delta * 100, 1),
        },
        "sentiment": sent_agg,
        "hotSectors": [
            {"name": r.get("sectorGroup"), "heatScore": r.get("heatScore")}
            for r in sector[:3]
        ],
        "hotKeywords": [k.get("word") for k in keywords if k.get("word")],
        "topStocks": top_stocks,
        "riskHighlightBars": risk_bars,
        "strategy": {
            "focus": focus,
            "avoid": avoid,
            "greyTip": "暗盘重点看定价与成交量，首日关注开盘15分钟情绪与基石货是否集中出货",
        },
    }


def build_ai_messages(context: dict[str, Any], style: PostStyle = "brief") -> list[dict[str, str]]:
    ctx_json = json.dumps(context, ensure_ascii=False, indent=2)
    user_tpl = USER_PROMPT_BRIEF if style == "brief" else USER_PROMPT_DEEP
    user = user_tpl.replace("{context_json}", ctx_json).replace("{{days}}", str(context.get("days", 10)))
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def generate_post_local(context: dict[str, Any], style: PostStyle = "brief") -> str:
    """无 AI 时的模板填充（与前端 generatePostLocal 保持一致）。"""
    days = context.get("days") or 10
    meta = context.get("meta") or {}
    sent = context.get("sentiment") or {}
    sectors = context.get("hotSectors") or []
    kws = context.get("hotKeywords") or []
    stocks = context.get("topStocks") or []
    risk = context.get("riskHighlightBars") or []
    strat = context.get("strategy") or {}

    sector_txt = "、".join(s.get("name") or "其他" for s in sectors[:2]) or "暂无集中赛道"
    kw_txt = "、".join(kws[:4]) or "打新、招股"
    focus = "、".join(strat.get("focus") or []) or "暂无明显优先标的"
    avoid = "、".join(strat.get("avoid") or []) or "暂无触发预警标的"
    date_str = datetime.now(TZ_CN).strftime("%Y-%m-%d")

    if style == "brief":
        lines = [
            f"📊 近{days}天港股打新舆情手账 | {date_str}",
            "",
            "🎯 【市场情绪】",
            f"社区有效讨论 {meta.get('totalPosts') or '—'} 条 · 热度{meta.get('heatTrend') or '平稳'}"
            f"（{meta.get('heatDeltaPct', 0):+.1f}%）",
            f"情绪结构：看多 {sent.get('bullish', 0)}% · 看空 {sent.get('bearish', 0)}% · 观望 {sent.get('watch', 0)}%",
            f"赛道热点：{sector_txt}｜话题：{kw_txt}",
            "",
            "🔥 【重点新股】",
        ]
        for i, s in enumerate(stocks[:3], 1):
            radar = s.get("radar") or {}
            grey = radar.get("greyMarketExpect", "—")
            lines.append(
                f"{i}️⃣ {s.get('name')}（{s.get('code')}）热度 {s.get('heatIndex') or '—'}"
            )
            lines.append(
                f"   共识 {s.get('dominant')} · 分歧度 {s.get('disagreementIndex', '—')}"
                f" · 暗盘预期 {grey}"
            )
            if s.get("keywords"):
                lines.append(f"   关键词：{'、'.join(s['keywords'][:3])}")
        lines.extend(["", "⚠️ 【风险提示】"])
        if risk:
            for b in risk[:2]:
                lines.append(f"· {b.get('name')}：{'、'.join(b.get('riskTags') or [])}")
        else:
            lines.append("· 当前未触发负面增速/破发TOP3/保荐高破发率预警")
        lines.extend(
            [
                "",
                "💡 【打新策略】",
                f"✅ 优先关注：{focus}",
                f"❌ 谨慎/避雷：{avoid}",
                f"🌙 {strat.get('greyTip', '')}",
                "",
                "#港股打新 #新股IPO #牛牛圈 #暗盘 #打新日记",
            ]
        )
        return "\n".join(lines)

    # deep
    intro = (
        f"【港股 IPO 舆情深度】近{days}天牛牛圈讨论复盘（{date_str}）\n\n"
        f"一、市场总览\n"
        f"近{days}日有效舆情帖约 {meta.get('totalPosts') or '—'} 条，讨论热度较前期"
        f"{meta.get('heatTrend') or '平稳'}（约 {meta.get('heatDeltaPct', 0):+.1f}%）。"
        f"情绪结构上，看多 {sent.get('bullish')}% / 看空 {sent.get('bearish')}% / 观望 {sent.get('watch')}%。"
        f"赛道层面，{sector_txt} 占据讨论中心；高频词包括 {kw_txt}。\n"
    )
    body = "\n二、重点个股\n"
    for s in stocks[:3]:
        tags = s.get("tags") or {}
        radar = s.get("radar") or {}
        body += f"\n▎{s.get('name')}（{s.get('code')}）｜热度指数 {s.get('heatIndex')}\n"
        body += f"主导情绪：{s.get('dominant')}；分歧度 {s.get('disagreementIndex')}（越低分歧越大）。\n"
        if tags.get("sponsor"):
            body += f"保荐：{tags.get('sponsor')}；赛道：{tags.get('sectorGroup') or tags.get('sector') or '—'}。\n"
        if radar:
            body += (
                "打新雷达：看多{bullishSentiment} · 破发担忧{breakConcern} · "
                "暗盘{greyMarketExpect} · 中签热度{lotRateHeat} · 赛道{sectorHeat}。\n"
            ).format(**{k: radar.get(k, "—") for k in (
                "bullishSentiment", "breakConcern", "greyMarketExpect", "lotRateHeat", "sectorHeat"
            )})
    risk_sec = "\n三、风险监测\n"
    if risk:
        for b in risk:
            risk_sec += f"· {b.get('name')}：{'; '.join(b.get('concerns') or [])}\n"
    else:
        risk_sec += "暂无显著风险预警触发，仍建议关注孖展与暗盘定价。\n"
    end = (
        f"\n四、策略建议\n"
        f"优先跟踪：{focus}。\n"
        f"建议回避或轻仓：{avoid}。\n"
        f"{strat.get('greyTip')}\n\n"
        f"#港股打新 #新股分析 #IPO舆情 #暗盘交易 #富途牛牛"
    )
    return intro + body + risk_sec + end


EXAMPLE_BRIEF = generate_post_local(
    {
        "days": 10,
        "meta": {"totalPosts": 17, "heatTrend": "升温", "heatDeltaPct": 22.5},
        "sentiment": {"bullish": 42.0, "bearish": 18.0, "watch": 40.0},
        "hotSectors": [{"name": "AI/科技", "heatScore": 156}],
        "hotKeywords": ["暗盘", "申购", "破发"],
        "topStocks": [
            {
                "name": "华曦达",
                "code": "00901",
                "heatIndex": 97,
                "disagreementIndex": 35,
                "dominant": "看多",
                "keywords": ["暗盘", "申购"],
                "radar": {
                    "bullishSentiment": 66,
                    "breakConcern": 12,
                    "greyMarketExpect": 45,
                    "lotRateHeat": 30,
                    "sectorHeat": 78,
                },
            }
        ],
        "riskHighlightBars": [],
        "strategy": {
            "focus": "华曦达",
            "avoid": "暂无",
            "greyTip": "暗盘重点看定价与成交量，首日关注开盘15分钟情绪",
        },
    },
    "brief",
)


def main() -> None:
    ap = argparse.ArgumentParser(description="牛牛圈发文 prompt / 本地文案")
    ap.add_argument("--json", default="", help="nnq-heat.json 路径")
    ap.add_argument("--style", choices=["brief", "deep"], default="brief")
    ap.add_argument("--local", action="store_true", help="输出本地模板文案而非 prompt JSON")
    ap.add_argument("--prompt-only", action="store_true", help="输出 OpenAI messages JSON")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[2]
    path = Path(args.json) if args.json else root / "nnq-heat.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    ctx = build_post_context(payload)

    if args.local:
        print(generate_post_local(ctx, args.style))
        return
    if args.prompt_only:
        print(json.dumps(build_ai_messages(ctx, args.style), ensure_ascii=False, indent=2))
        return
    print("=== SYSTEM ===")
    print(SYSTEM_PROMPT)
    print("\n=== USER ===")
    print(build_ai_messages(ctx, args.style)[1]["content"])


if __name__ == "__main__":
    main()
