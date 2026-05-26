#!/usr/bin/env python3
"""话题聚合分析：按关键词 / 赛道聚合关联个股讨论。"""
from __future__ import annotations

from typing import Any, Literal

TopicType = Literal["keyword", "sector"]


def _dominant_label(d: str) -> str:
    return {"bullish": "看多", "bearish": "看空", "watch": "观望", "neutral": "中性"}.get(d, "中性")


def _kw_match(word: str, topic: str) -> bool:
    if not word or not topic:
        return False
    w, t = word.strip(), topic.strip()
    if w == t:
        return True
    return t in w or w in t


def _stock_kw_affinity(stock: dict[str, Any], topic: str) -> float:
    for item in stock.get("relatedKeywords") or []:
        if _kw_match(str(item.get("word") or ""), topic):
            return float(item.get("affinity") or item.get("coOccur") or 0)
    return 0.0


def _related_stocks_for_keyword(
    topic: str,
    stock_insights: list[dict[str, Any]],
    keyword_stock_map: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    map_aff: dict[str, float] = {}
    for row in keyword_stock_map or []:
        if not _kw_match(str(row.get("word") or ""), topic):
            continue
        ts = row.get("topStock") or {}
        code = str(ts.get("code") or "").strip()
        if code:
            map_aff[code] = max(map_aff.get(code, 0), float(ts.get("affinity") or 0))

    out: list[dict[str, Any]] = []
    for s in stock_insights or []:
        code = str(s.get("code") or "")
        aff = map_aff.get(code, 0) or _stock_kw_affinity(s, topic)
        if code in map_aff or aff > 0:
            sb = s.get("sentimentBreakdown") or {}
            out.append(
                {
                    "code": code,
                    "name": s.get("name"),
                    "heatIndex": s.get("heatIndex"),
                    "affinity": round(aff, 2),
                    "dominant": _dominant_label(sb.get("dominant") or "neutral"),
                    "disagreementIndex": s.get("disagreementIndex"),
                    "bullishPct": (sb.get("bullish") or {}).get("pct"),
                    "bearishPct": (sb.get("bearish") or {}).get("pct"),
                }
            )
    out.sort(key=lambda x: (x.get("affinity") or 0, x.get("heatIndex") or 0), reverse=True)
    return out


def _related_stocks_for_sector(topic: str, stock_insights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for s in stock_insights or []:
        tags = s.get("basicTags") or {}
        group = str(tags.get("sectorGroup") or "其他")
        if group != topic:
            continue
        sb = s.get("sentimentBreakdown") or {}
        out.append(
            {
                "code": s.get("code"),
                "name": s.get("name"),
                "heatIndex": s.get("heatIndex"),
                "affinity": 1.0,
                "dominant": _dominant_label(sb.get("dominant") or "neutral"),
                "disagreementIndex": s.get("disagreementIndex"),
                "bullishPct": (sb.get("bullish") or {}).get("pct"),
                "bearishPct": (sb.get("bearish") or {}).get("pct"),
            }
        )
    out.sort(key=lambda x: x.get("heatIndex") or 0, reverse=True)
    return out


def _aggregate_sentiment(stocks: list[dict[str, Any]]) -> dict[str, float]:
    if not stocks:
        return {"bullish": 0.0, "bearish": 0.0, "watch": 100.0}
    b = sum(float(s.get("bullishPct") or 0) for s in stocks)
    r = sum(float(s.get("bearishPct") or 0) for s in stocks)
    n = len(stocks)
    watch = max(0.0, 100.0 - (b + r) / n) if n else 100.0
    return {
        "bullish": round(b / n, 1),
        "bearish": round(r / n, 1),
        "watch": round(watch, 1),
    }


def _disagreement_points(stocks: list[dict[str, Any]], topic: str, topic_type: TopicType) -> list[str]:
    pts: list[str] = []
    high = [s for s in stocks if (s.get("disagreementIndex") or 100) <= 25]
    if high:
        pts.append(
            "观点分化明显：" + "、".join(f"{s.get('name')}({s.get('code')})" for s in high[:3])
        )
    bearish = [s for s in stocks if (s.get("bearishPct") or 0) >= 20]
    if bearish:
        pts.append("偏空讨论集中在 " + "、".join(s.get("name") or "" for s in bearish[:3]))
    if topic_type == "keyword" and "破发" in topic and not pts:
        pts.append("破发话题下多空预期交织，需结合暗盘定价判断")
    if not pts:
        pts.append("暂未形成显著分歧，情绪相对一致")
    return pts[:4]


def _strategy_hint(topic: str, topic_type: TopicType, sentiment: dict[str, float], stocks: list[dict[str, Any]]) -> str:
    if topic_type == "keyword" and any(k in topic for k in ("破发", "劝退", "避雷", "弃购")):
        return "偏防御：优先回避负面关联度高的标的，暗盘不及预期则降低首日参与度"
    if sentiment.get("bullish", 0) >= 40:
        top = stocks[0].get("name") if stocks else "高热度标的"
        return f"情绪偏暖，可重点跟踪 {top} 的孖展与暗盘，确认共识后再申购"
    if sentiment.get("bearish", 0) >= 30:
        return "谨慎参与，建议小仓位或观望，关注保荐与估值安全边际"
    return "中性观望：等待更多招股反馈与暗盘成交再决策"


def aggregate_topic(
    topic: str,
    topic_type: TopicType,
    *,
    stock_insights: list[dict[str, Any]] | None = None,
    keyword_stock_map: list[dict[str, Any]] | None = None,
    top_keywords: list[dict[str, Any]] | None = None,
    sector_heat: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    stock_insights = stock_insights or []
    if topic_type == "sector":
        stocks = _related_stocks_for_sector(topic, stock_insights)
        mention = sum(s.get("heatIndex") or 0 for s in stocks)
        sector_row = next((r for r in (sector_heat or []) if r.get("sectorGroup") == topic), None)
        extra = {"sectorHeatScore": (sector_row or {}).get("heatScore")}
    else:
        stocks = _related_stocks_for_keyword(topic, stock_insights, keyword_stock_map)
        mention = 0
        for row in top_keywords or []:
            if _kw_match(str(row.get("word") or ""), topic):
                mention = int(row.get("count") or 0)
                break
        if not mention:
            mention = len(stocks)
        extra = {}

    sentiment = _aggregate_sentiment(stocks)
    disagreements = _disagreement_points(stocks, topic, topic_type)
    strategy = _strategy_hint(topic, topic_type, sentiment, stocks)

    return {
        "type": topic_type,
        "topic": topic,
        "mentionCount": mention,
        "sentiment": sentiment,
        "relatedStocks": stocks[:8],
        "disagreements": disagreements,
        "strategy": strategy,
        **extra,
    }


def build_topic_analysis_index(
    stock_insights: list[dict[str, Any]],
    keyword_stock_map: list[dict[str, Any]] | None,
    top_keywords: list[dict[str, Any]] | None,
    sector_heat: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    keywords: dict[str, Any] = {}
    for row in top_keywords or []:
        w = str(row.get("word") or "").strip()
        if not w or w in keywords:
            continue
        keywords[w] = aggregate_topic(
            w,
            "keyword",
            stock_insights=stock_insights,
            keyword_stock_map=keyword_stock_map,
            top_keywords=top_keywords,
        )

    for row in keyword_stock_map or []:
        w = str(row.get("word") or "").strip()
        if not w or w in keywords:
            continue
        keywords[w] = aggregate_topic(
            w,
            "keyword",
            stock_insights=stock_insights,
            keyword_stock_map=keyword_stock_map,
            top_keywords=top_keywords,
        )

    sectors: dict[str, Any] = {}
    seen: set[str] = set()
    for s in stock_insights or []:
        g = str((s.get("basicTags") or {}).get("sectorGroup") or "其他")
        if g in seen:
            continue
        seen.add(g)
        sectors[g] = aggregate_topic(
            g,
            "sector",
            stock_insights=stock_insights,
            sector_heat=sector_heat,
        )
    for row in sector_heat or []:
        g = str(row.get("sectorGroup") or "")
        if g and g not in sectors:
            sectors[g] = aggregate_topic(
                g,
                "sector",
                stock_insights=stock_insights,
                sector_heat=sector_heat,
            )

    return {"keywords": keywords, "sectors": sectors}


def format_topic_copy(analysis: dict[str, Any]) -> str:
    """生成可直接发牛牛圈的专项分析文案。"""
    topic = analysis.get("topic") or "话题"
    ttype = analysis.get("type") or "keyword"
    label = "赛道" if ttype == "sector" else "话题"
    sent = analysis.get("sentiment") or {}
    stocks = analysis.get("relatedStocks") or []
    lines = [
        f"📌 【{label}专项】#{topic}#",
        "",
        "🎯 市场情绪",
        f"看多 {sent.get('bullish', 0)}% · 看空 {sent.get('bearish', 0)}% · 观望 {sent.get('watch', 0)}%",
        f"提及/关联强度：{analysis.get('mentionCount', '—')}",
        "",
        "🔗 关联标的",
    ]
    if stocks:
        for i, s in enumerate(stocks[:5], 1):
            lines.append(
                f"{i}. {s.get('name')}（{s.get('code')}）热度{s.get('heatIndex', '—')} · {s.get('dominant', '—')}"
            )
    else:
        lines.append("暂无直接关联个股，建议扩大抓取样本")
    lines.extend(["", "⚖️ 核心分歧"])
    for d in analysis.get("disagreements") or []:
        lines.append("· " + d)
    lines.extend(["", "💡 打新策略参考", analysis.get("strategy") or "", "", f"#港股打新 #{topic} #IPO舆情 #牛牛圈"])
    return "\n".join(lines)
