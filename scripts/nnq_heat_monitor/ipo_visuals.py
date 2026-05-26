#!/usr/bin/env python3
"""打新专属可视化：个股雷达图维度 & 风险预警高亮条。"""
from __future__ import annotations

from typing import Any

# 保荐人历史破发率参考（可后续接 Sheet / 外部库；模糊匹配机构名）
SPONSOR_HIST_BREAK_RATE: dict[str, float] = {
    "东方证券": 0.34,
    "民银资本": 0.31,
    "交银国际": 0.29,
    "华升资本": 0.28,
    "中泰国际": 0.27,
    "天风证券": 0.26,
    "中银国际": 0.18,
    "中国国际金融": 0.22,
    "中信建投": 0.19,
    "摩根士丹利": 0.15,
    "高盛": 0.12,
}

RADAR_LABELS: dict[str, str] = {
    "bullishSentiment": "社区看多",
    "breakConcern": "破发担忧",
    "greyMarketExpect": "暗盘预期",
    "lotRateHeat": "中签率热度",
    "sectorHeat": "赛道热度",
}

NEG_GROWTH_THRESHOLD = 0.30
SPONSOR_BREAK_HIGH = 0.25


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def lookup_sponsor_break_rate(sponsor: str) -> float | None:
    s = (sponsor or "").strip()
    if not s:
        return None
    for key, rate in SPONSOR_HIST_BREAK_RATE.items():
        if key in s:
            return rate
    return None


def _kw_affinity(stock: dict[str, Any], word: str) -> float:
    for item in stock.get("relatedKeywords") or []:
        if item.get("word") == word:
            return float(item.get("affinity") or 0)
    return 0.0


def compute_ipo_radar(
    stock: dict[str, Any],
    sector_heat_map: dict[str, float],
    *,
    max_sector_heat: float = 1.0,
) -> dict[str, Any]:
    """五维打新预期雷达（0–100）。"""
    sb = stock.get("sentimentBreakdown") or {}
    tiers = (stock.get("weightedHeat") or {}).get("tiers") or {}
    tags = stock.get("basicTags") or {}

    bullish = float((sb.get("bullish") or {}).get("pct") or 0)
    bearish = float((sb.get("bearish") or {}).get("pct") or 0)
    break_aff = _kw_affinity(stock, "破发")
    break_concern = _clamp(bearish + break_aff * 100)

    grey_aff = max(_kw_affinity(stock, "暗盘"), _kw_affinity(stock, "暗盘套利"))
    grey_posts = int((tiers.get("lotteryShare") or {}).get("posts") or 0)
    grey_market = _clamp(grey_aff * 100 + grey_posts * 20)

    lot_aff = max(_kw_affinity(stock, "中签"), _kw_affinity(stock, "一手中签率"))
    lot_posts = int((tiers.get("lotteryShare") or {}).get("posts") or 0)
    lot_hint = 15.0 if tags.get("lotRateExpect") else 0.0
    lot_rate_heat = _clamp(lot_aff * 100 + lot_posts * 25 + lot_hint)

    group = str(tags.get("sectorGroup") or "其他")
    sector_raw = float(sector_heat_map.get(group) or 0)
    sector_norm = _clamp((sector_raw / max(max_sector_heat, 1.0)) * 100)

    scores = {
        "bullishSentiment": round(bullish, 1),
        "breakConcern": round(break_concern, 1),
        "greyMarketExpect": round(grey_market, 1),
        "lotRateHeat": round(lot_rate_heat, 1),
        "sectorHeat": round(sector_norm, 1),
    }
    return {
        "labels": RADAR_LABELS,
        "scores": scores,
        "order": list(RADAR_LABELS.keys()),
    }


def _break_top3_codes(keyword_stock_map: list[dict[str, Any]]) -> set[str]:
    ranked: list[tuple[str, float]] = []
    for row in keyword_stock_map or []:
        word = str(row.get("word") or "")
        if "破发" not in word:
            continue
        ts = row.get("topStock") or {}
        code = str(ts.get("code") or "").strip()
        if not code:
            continue
        ranked.append((code, float(ts.get("affinity") or ts.get("coOccur") or 0)))
    ranked.sort(key=lambda x: x[1], reverse=True)
    return {c for c, _ in ranked[:3]}


def _core_concerns(stock: dict[str, Any]) -> list[str]:
    sb = stock.get("sentimentBreakdown") or {}
    concerns: list[str] = []
    bear_pct = float((sb.get("bearish") or {}).get("pct") or 0)
    if bear_pct > 0:
        concerns.append(f"看空讨论占比 {bear_pct:.0f}%")
    for w in ("破发", "估值过高", "劝退", "弃购", "避雷"):
        aff = _kw_affinity(stock, w)
        if aff >= 0.3:
            concerns.append(f"「{w}」关联度 {aff * 100:.0f}%")
    if not concerns:
        concerns.append("社区担忧尚未集中，建议持续跟踪")
    return concerns[:4]


def build_risk_highlight_bars(
    stock_insights: list[dict[str, Any]],
    risk_alerts: dict[str, Any] | None,
    keyword_stock_map: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """
    风险预警高亮条：
      - 负面情绪单日增速 > 30%
      - 「破发」关键词关联度 TOP3
      - 保荐人历史破发率偏高
    """
    risk_alerts = risk_alerts or {}
    spikes = {s.get("code"): s for s in risk_alerts.get("stockSentimentSpikes") or [] if s.get("code")}
    break_top3 = _break_top3_codes(keyword_stock_map or [])

    bars: list[dict[str, Any]] = []
    for stock in stock_insights or []:
        code = str(stock.get("code") or "")
        if not code:
            continue
        tags: list[str] = []
        triggers: list[str] = []

        spike = spikes.get(code)
        if spike and float(spike.get("growthRate") or 0) > NEG_GROWTH_THRESHOLD:
            tags.append("负面增速")
            triggers.append(
                f"负面情绪单日增速 {float(spike.get('growthRate') or 0) * 100:.0f}%"
            )

        if code in break_top3:
            tags.append("破发TOP3")
            aff = _kw_affinity(stock, "破发")
            triggers.append(f"「破发」关联度 TOP3（{aff * 100:.0f}%）")

        sponsor = (stock.get("basicTags") or {}).get("sponsor") or ""
        s_rate = lookup_sponsor_break_rate(str(sponsor))
        if s_rate is not None and s_rate >= SPONSOR_BREAK_HIGH:
            tags.append("保荐风险")
            triggers.append(f"保荐人历史破发率约 {s_rate * 100:.0f}%")

        if not tags:
            continue

        severity = "high" if len(tags) >= 2 or (spike and spike.get("flag")) else "medium"
        bars.append(
            {
                "code": code,
                "name": stock.get("name") or code,
                "severity": severity,
                "riskTags": tags,
                "triggers": triggers,
                "concerns": _core_concerns(stock),
                "sponsorBreakRate": s_rate,
            }
        )

    bars.sort(key=lambda b: (0 if b["severity"] == "high" else 1, -len(b["riskTags"])))
    return bars


def enrich_stock_ipo_radars(
    stock_insights: list[dict[str, Any]],
    sector_heat: list[dict[str, Any]] | None,
) -> None:
    sector_map = {str(r.get("sectorGroup") or "其他"): float(r.get("heatScore") or 0) for r in sector_heat or []}
    max_sector = max(sector_map.values()) if sector_map else 1.0
    for stock in stock_insights:
        stock["ipoRadar"] = compute_ipo_radar(stock, sector_map, max_sector_heat=max_sector)
