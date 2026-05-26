#!/usr/bin/env python3
"""
牛牛圈讨论热度看板 · 舆情分析 v2 扩展

与 nnq_heat_monitor.py 输出的 nnq-heat.json 向后兼容：
  - v1 字段（summary / topStocks / topKeywords / highHeatPostsList）保持不变
  - v2 在根节点追加 schemaVersion=2 及下列扩展块

集成方式（伪代码，见 build_nnq_heat_v2）：
  raw_posts = await fetch_feed_pages(...)
  filtered  = filter_posts(raw_posts, days, MIN_ENGAGEMENT)
  base      = build_analytics(filtered)          # 现有 v1
  v2        = build_nnq_heat_v2(filtered, base)  # 本模块
  payload   = { **base, **v2, "schemaVersion": 2 }
"""
from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, TypedDict

from ipo_sheet_loader import load_ipo_master_from_sheet
from ipo_visuals import build_risk_highlight_bars, enrich_stock_ipo_radars
from topic_aggregation import build_topic_analysis_index

TZ_CN = timezone(timedelta(hours=8))

# ---------------------------------------------------------------------------
# 类型定义（与 nnq-heat.json v2 字段一一对应）
# ---------------------------------------------------------------------------

SentimentTri = Literal["bullish", "bearish", "watch", "neutral"]
PostTier = Literal["lotteryShare", "deepAnalysis", "opinionComment", "likeOnly", "spam"]
InvestorBehavior = Literal["bullishSubscribe", "watchWait", "avoidSkip", "greyArbitrage"]
SectorGroup = Literal["AI/科技", "医药", "消费", "金融", "工业", "其他"]


class SentimentBucket(TypedDict):
    count: int
    pct: float
    weight: float


class StockSentimentBreakdown(TypedDict):
    bullish: SentimentBucket
    bearish: SentimentBucket
    watch: SentimentBucket
    neutral: SentimentBucket
    dominant: SentimentTri


class TierStats(TypedDict):
    posts: int
    weight: float
    score: float


class WeightedHeat(TypedDict):
    rawEngagement: int
    weightedScore: float
    tiers: dict[PostTier, TierStats]


class StockBasicTags(TypedDict, total=False):
    ipoPeriod: str
    issuePe: str
    sponsor: str
    sector: str
    sectorGroup: SectorGroup
    lotRateExpect: str
    source: Literal["google_sheet", "listed_csv", "inferred", "missing"]


class KeywordAffinity(TypedDict):
    word: str
    coOccur: int
    affinity: float


class StockInsight(TypedDict):
    code: str
    name: str
    mentions: int
    heatIndex: float
    disagreementIndex: float
    sentimentBreakdown: StockSentimentBreakdown
    weightedHeat: WeightedHeat
    basicTags: StockBasicTags
    relatedKeywords: list[KeywordAffinity]


class BehaviorShare(TypedDict):
    count: int
    pct: float


class InvestorBehaviorMix(TypedDict):
    bullishSubscribe: BehaviorShare
    watchWait: BehaviorShare
    avoidSkip: BehaviorShare
    greyArbitrage: BehaviorShare
    method: str


class SectorHeatRow(TypedDict):
    sectorGroup: SectorGroup
    heatScore: float
    mentions: int
    postCount: int
    sentimentIdx: float


class DailyTrendRow(TypedDict):
    date: str
    postCount: int
    heatScore: float
    weightedHeat: float
    sentiment: dict[str, float]


class KeywordStockLink(TypedDict):
    word: str
    topStock: dict[str, Any]


class KeywordSpike(TypedDict):
    word: str
    todayCount: int
    prevDayCount: int
    growthRate: float | None
    severity: Literal["low", "medium", "high"]
    window: str


class StockSentimentSpike(TypedDict):
    code: str
    name: str
    negativeCountToday: int
    negativeCountPrev3dAvg: float
    growthRate: float
    flag: bool
    reason: str


class RiskAlerts(TypedDict):
    keywordSpikes: list[KeywordSpike]
    stockSentimentSpikes: list[StockSentimentSpike]
    thresholds: dict[str, float]


class NnqHeatV2Extension(TypedDict):
    schemaVersion: Literal[2]
    stockInsights: list[StockInsight]
    keywordStockMap: list[KeywordStockLink]
    marketInsights: dict[str, Any]
    dailyTrend: list[DailyTrendRow]
    riskAlerts: RiskAlerts


from heat_scoring import (
    ScoredPost,
    TIER_WEIGHTS,
    classify_post_tier,
    classify_stock_sentiment,
    compute_disagreement_index,
    compute_post_heat_contribution,
    compute_weighted_interaction,
)

# ---------------------------------------------------------------------------
# 配置：行为 / 风险规则词典（热度权重见 heat_scoring.py）
# ---------------------------------------------------------------------------

BEHAVIOR_RULES: dict[InvestorBehavior, tuple[str, ...]] = {
    "bullishSubscribe": ("申购", "必打", "冲", "参与打新", "全仓", "梭哈", "值得打"),
    "watchWait": ("观望", "再看看", "等等", "不确定", "可打可不打", "先观察"),
    "avoidSkip": ("别打", "劝退", "跳过", "不申购", "避雷", "弃购"),
    "greyArbitrage": ("暗盘出", "暗盘卖", "暗盘套利", "暗盘开盘", "暗盘赚", "暗盘走"),
}

RISK_KEYWORDS = ("破发", "估值过高", "劝退", "坑", "冷场", "超额冷门", "弃购", "割韭菜")

SECTOR_GROUP_RULES: dict[SectorGroup, tuple[str, ...]] = {
    "AI/科技": ("AI", "人工智能", "半导体", "芯片", "软件", "机器人", "科技", "算力", "3D打印"),
    "医药": ("医药", "生物", "医疗", "创新药", "器械", "中医"),
    "消费": ("消费", "零售", "餐饮", "品牌", "电商", "奢侈品"),
    "金融": ("金融", "银行", "保险", "证券", "支付"),
    "工业": ("工业", "制造", "机械", "材料", "能源", "物流"),
    "其他": (),
}


@dataclass
class ParsedPost:
    feed_id: str
    author: str
    text: str
    engagement: int
    likes: int
    comments: int
    shares: int
    published_at: datetime | None
    stocks: list[dict[str, str]]
    post_tier: PostTier = "opinionComment"
    stock_sentiment: SentimentTri = "neutral"
    investor_behavior: InvestorBehavior | None = None


# ---------------------------------------------------------------------------
# Step 0 · 增强 parse（在 parse_feed_item 之后调用）
# ---------------------------------------------------------------------------

def enrich_post(raw: dict[str, Any]) -> ParsedPost:
    """在现有 parse_feed_item 返回值上追加 tier / 个股情感 / 行为标签。"""
    text = raw.get("text") or ""
    likes = int(raw.get("likes") or 0)
    comments = int(raw.get("comments") or 0)
    shares = int(raw.get("shares") or 0)
    engagement = int(raw.get("engagement") or 0)
    stocks = list(raw.get("stocks") or [])
    sentiment = classify_stock_sentiment(text)
    pub = None
    if raw.get("publishedAt"):
        try:
            pub = datetime.fromisoformat(raw["publishedAt"])
        except ValueError:
            pub = None

    return ParsedPost(
        feed_id=str(raw.get("feedId") or ""),
        author=str(raw.get("author") or ""),
        text=text,
        engagement=engagement,
        likes=likes,
        comments=comments,
        shares=shares,
        published_at=pub,
        stocks=stocks,
        post_tier=classify_post_tier(
            text, likes, comments, shares, has_stocks=bool(stocks), sentiment=sentiment
        ),
        stock_sentiment=sentiment,
        investor_behavior=classify_investor_behavior(text),
    )


def classify_investor_behavior(text: str) -> InvestorBehavior | None:
    t = text or ""
    scores: Counter[InvestorBehavior] = Counter()
    for behavior, phrases in BEHAVIOR_RULES.items():
        if any(p in t for p in phrases):
            scores[behavior] += 1
    if not scores:
        return None
    return scores.most_common(1)[0][0]


def weighted_post_score(post: ParsedPost, *, window: int = 10) -> float:
    """单帖热度贡献（含时间衰减），供赛道/日趋势聚合。"""
    if post.post_tier == "spam" or TIER_WEIGHTS.get(post.post_tier, 0) <= 0:
        return 0.0
    weighted = compute_weighted_interaction(
        tier=post.post_tier,
        likes=post.likes,
        comments=post.comments,
        shares=post.shares,
    )
    days = 0
    if post.published_at:
        d = post.published_at.astimezone(TZ_CN).date() if post.published_at.tzinfo else post.published_at.date()
        days = max(0, (date.today() - d).days)
    return compute_post_heat_contribution(weighted, days, window=window)


def _scored_post_from_parsed(post: ParsedPost, *, window: int = 10) -> ScoredPost:
    weighted = compute_weighted_interaction(
        tier=post.post_tier,
        likes=post.likes,
        comments=post.comments,
        shares=post.shares,
    )
    days = 0
    if post.published_at:
        d = post.published_at.astimezone(TZ_CN).date() if post.published_at.tzinfo else post.published_at.date()
        days = max(0, (date.today() - d).days)
    return ScoredPost(
        feed_id=post.feed_id,
        author=post.author,
        text=post.text,
        engagement=post.engagement,
        likes=post.likes,
        comments=post.comments,
        shares=post.shares,
        published_at=post.published_at,
        stocks=post.stocks,
        post_tier=post.post_tier,
        stock_sentiment=post.stock_sentiment,
        tier_weight=TIER_WEIGHTS.get(post.post_tier, 0),
        weighted_interaction=weighted,
        heat_contribution=compute_post_heat_contribution(weighted, days, window=window),
        days_ago=days,
    )


# ---------------------------------------------------------------------------
# Step 1 · 个股维度
# ---------------------------------------------------------------------------

def build_stock_insights(
    posts: list[ParsedPost],
    ipo_master: dict[str, dict[str, Any]] | None = None,
    *,
    window: int = 10,
) -> list[StockInsight]:
    """
    ipo_master: 从 Google Sheet「上市新股」CSV 或 ipo-live-data 导出的字典
      { "03310": { "name", "sector", "sponsor", "ipoPeriod", "issuePe", "lotRateExpect" } }
    """
    ipo_master = ipo_master or {}
    by_code: dict[str, list[ParsedPost]] = defaultdict(list)
    names: dict[str, str] = {}

    for p in posts:
        for s in p.stocks:
            code = (s.get("code") or "").strip()
            name = (s.get("name") or "").strip()
            if not code:
                continue
            if name and not name.isdigit():
                names[code] = name
            by_code[code].append(p)

    insights: list[StockInsight] = []
    for code, bucket in by_code.items():
        name = names.get(code) or ipo_master.get(code, {}).get("name") or code
        insights.append(_stock_insight_one(code, name, bucket, ipo_master.get(code), window=window))
    insights.sort(key=lambda x: x["heatIndex"], reverse=True)
    return insights


def _stock_insight_one(
    code: str,
    name: str,
    posts: list[ParsedPost],
    master_row: dict[str, Any] | None,
    *,
    window: int = 10,
) -> StockInsight:
    tier_keys: tuple[PostTier, ...] = ("lotteryShare", "deepAnalysis", "opinionComment", "likeOnly")
    tier_acc: dict[PostTier, TierStats] = {
        k: {"posts": 0, "weight": TIER_WEIGHTS[k], "score": 0.0} for k in tier_keys
    }
    sent_acc: Counter[SentimentTri] = Counter()
    sent_weight: Counter[SentimentTri] = Counter()
    kw_co: Counter[str] = Counter()
    raw_eng = 0
    weighted = 0.0
    heat_index = 0.0
    scored_bucket: list[ScoredPost] = []

    for p in posts:
        if p.post_tier == "spam":
            continue
        raw_eng += p.engagement
        sc = weighted_post_score(p, window=window)
        heat_index += sc
        sp = _scored_post_from_parsed(p, window=window)
        scored_bucket.append(sp)
        w_int = sp.weighted_interaction
        weighted += w_int
        if p.post_tier in tier_acc:
            tier_acc[p.post_tier]["posts"] += 1
            tier_acc[p.post_tier]["score"] += w_int
        sent_acc[p.stock_sentiment] += 1
        sent_weight[p.stock_sentiment] += sc
        for kw in _extract_keywords_for_stock(p.text, name, code):
            kw_co[kw] += 1

    total = len(posts) or 1
    dominant = sent_acc.most_common(1)[0][0] if sent_acc else "neutral"

    def _bucket(label: SentimentTri) -> SentimentBucket:
        c = sent_acc[label]
        return {
            "count": c,
            "pct": round(c / total * 100, 1),
            "weight": round(sent_weight[label], 1),
        }

    related = [
        {"word": w, "coOccur": n, "affinity": round(n / total, 2)}
        for w, n in kw_co.most_common(8)
    ]

    return {
        "code": code,
        "name": name,
        "mentions": total,
        "heatIndex": round(heat_index, 1),
        "disagreementIndex": compute_disagreement_index(scored_bucket),
        "sentimentBreakdown": {
            "bullish": _bucket("bullish"),
            "bearish": _bucket("bearish"),
            "watch": _bucket("watch"),
            "neutral": _bucket("neutral"),
            "dominant": dominant,
        },
        "weightedHeat": {
            "rawEngagement": raw_eng,
            "weightedScore": round(weighted, 1),
            "heatIndex": round(heat_index, 1),
            "tiers": tier_acc,
        },
        "basicTags": _merge_basic_tags(code, name, master_row),
        "relatedKeywords": related,
    }


def _extract_keywords_for_stock(text: str, name: str, code: str) -> list[str]:
    hits: list[str] = []
    t = text or ""
    if name and name in t:
        hits.append(name)
    if code in t:
        hits.append(code)
    for w in RISK_KEYWORDS + ("暗盘", "打新", "申购", "中签", "破发", "招股"):
        if w in t:
            hits.append(w)
    return hits


def _merge_basic_tags(code: str, name: str, row: dict[str, Any] | None) -> StockBasicTags:
    row = row or {}
    sector = str(row.get("sector") or row.get("行业") or "")
    return {
        "ipoPeriod": str(row.get("ipoPeriod") or row.get("招股期") or ""),
        "issuePe": str(row.get("issuePe") or row.get("发行市盈率") or row.get("市盈率") or ""),
        "sponsor": str(row.get("sponsor") or row.get("保荐人") or ""),
        "sector": sector,
        "sectorGroup": map_sector_group(sector, name),
        "lotRateExpect": str(row.get("lotRateExpect") or row.get("中签率预期") or row.get("一手中签率") or ""),
        "source": "google_sheet" if row else "missing",
    }


def map_sector_group(sector: str, name: str = "") -> SectorGroup:
    blob = f"{sector} {name}"
    for group, keys in SECTOR_GROUP_RULES.items():
        if group == "其他":
            continue
        if any(k in blob for k in keys):
            return group
    return "其他"


# ---------------------------------------------------------------------------
# Step 2 · 关键词 → 个股映射
# ---------------------------------------------------------------------------

def build_keyword_stock_map(
    posts: list[ParsedPost],
    min_co_occur: int = 1,
) -> list[KeywordStockLink]:
    """
    affinity(word, stock) = co_occur(word, stock) / mentions(word)
    每个 keyword 取 affinity 最高的新股。
    """
    word_stock: dict[str, Counter[str]] = defaultdict(Counter)
    word_total: Counter[str] = Counter()
    code_name: dict[str, str] = {}

    for p in posts:
        words = set(_extract_keywords_for_stock(p.text, "", ""))
        codes = [(s.get("code") or "").strip() for s in p.stocks if s.get("code")]
        for w in words:
            word_total[w] += 1
            for c in codes:
                word_stock[w][c] += 1
                if s_name := next((s.get("name") for s in p.stocks if s.get("code") == c), ""):
                    code_name[c] = str(s_name)

    out: list[KeywordStockLink] = []
    for word, total in word_total.most_common():
        if total < min_co_occur:
            continue
        if word not in word_stock:
            continue
        code, co = word_stock[word].most_common(1)[0]
        out.append(
            {
                "word": word,
                "topStock": {
                    "code": code,
                    "name": code_name.get(code, code),
                    "coOccur": co,
                    "affinity": round(co / total, 2),
                },
            }
        )
    return out[:30]


# ---------------------------------------------------------------------------
# Step 3 · 市场维度
# ---------------------------------------------------------------------------

def build_investor_behavior_mix(posts: list[ParsedPost]) -> InvestorBehaviorMix:
    counter: Counter[InvestorBehavior] = Counter()
    for p in posts:
        if p.investor_behavior:
            counter[p.investor_behavior] += 1
    total = sum(counter.values()) or 1

    def _share(k: InvestorBehavior) -> BehaviorShare:
        c = counter[k]
        return {"count": c, "pct": round(c / total * 100, 1)}

    return {
        "bullishSubscribe": _share("bullishSubscribe"),
        "watchWait": _share("watchWait"),
        "avoidSkip": _share("avoidSkip"),
        "greyArbitrage": _share("greyArbitrage"),
        "method": "rule_based_v3",
    }


def build_sector_heat(
    posts: list[ParsedPost],
    ipo_master: dict[str, dict[str, Any]] | None,
    *,
    window: int = 10,
) -> list[SectorHeatRow]:
    ipo_master = ipo_master or {}
    group_posts: dict[SectorGroup, list[ParsedPost]] = defaultdict(list)

    for p in posts:
        groups: set[SectorGroup] = set()
        for s in p.stocks:
            code = s.get("code") or ""
            sector = (ipo_master.get(code) or {}).get("sector") or ""
            groups.add(map_sector_group(str(sector), s.get("name") or ""))
        if not groups:
            groups.add("其他")
        for g in groups:
            group_posts[g].append(p)

    rows: list[SectorHeatRow] = []
    for group, bucket in group_posts.items():
        heat = sum(weighted_post_score(p, window=window) for p in bucket if p.post_tier != "spam")
        pos = sum(1 for p in bucket if p.stock_sentiment == "bullish")
        neg = sum(1 for p in bucket if p.stock_sentiment == "bearish")
        n = len(bucket) or 1
        rows.append(
            {
                "sectorGroup": group,
                "heatScore": round(heat, 1),
                "mentions": sum(len(p.stocks) for p in bucket),
                "postCount": len(bucket),
                "sentimentIdx": round((pos - neg) / n, 2),
            }
        )
    rows.sort(key=lambda r: r["heatScore"], reverse=True)
    return rows


def build_daily_trend(posts: list[ParsedPost], days: int = 10, *, window: int | None = None) -> list[DailyTrendRow]:
    window = window or days
    """按自然日（Asia/Hong_Kong）聚合近 N 天曲线，含 riskKeywordCounts 供历史对比。"""
    end = date.today()
    start = end - timedelta(days=days - 1)
    buckets: dict[str, list[ParsedPost]] = defaultdict(list)

    for p in posts:
        if not p.published_at:
            continue
        d = p.published_at.astimezone(TZ_CN).date() if p.published_at.tzinfo else p.published_at.date()
        if d < start or d > end:
            continue
        buckets[d.isoformat()].append(p)

    rows: list[DailyTrendRow] = []
    cur = start
    while cur <= end:
        key = cur.isoformat()
        bucket = buckets.get(key, [])
        heat = sum(p.engagement for p in bucket)
        wheat = sum(weighted_post_score(p, window=window) for p in bucket if p.post_tier != "spam")
        pos = sum(1 for p in bucket if p.stock_sentiment == "bullish")
        neg = sum(1 for p in bucket if p.stock_sentiment == "bearish")
        neu = len(bucket) - pos - neg
        n = len(bucket) or 1
        kw_day: Counter[str] = Counter()
        for p in bucket:
            for w in RISK_KEYWORDS:
                if w in (p.text or ""):
                    kw_day[w] += 1
        row: DailyTrendRow = {
            "date": key,
            "postCount": len(bucket),
            "heatScore": heat,
            "weightedHeat": round(wheat, 1),
            "sentiment": {
                "positivePct": round(pos / n * 100, 1),
                "negativePct": round(neg / n * 100, 1),
                "neutralPct": round(neu / n * 100, 1),
            },
        }
        row["riskKeywordCounts"] = [{"word": w, "count": c} for w, c in kw_day.most_common()]  # type: ignore[typeddict-unknown-key]
        rows.append(row)
        cur += timedelta(days=1)
    return rows


# ---------------------------------------------------------------------------
# Step 4 · 风险预警（需历史快照：nnq-heat-history/YYYY-MM-DD.json）
# ---------------------------------------------------------------------------

def build_risk_alerts(
    posts: list[ParsedPost],
    history_snapshots: list[dict[str, Any]] | None = None,
    ipo_master: dict[str, dict[str, Any]] | None = None,
    *,
    keyword_growth_min: float = 1.5,
    stock_neg_growth_min: float = 2.0,
) -> RiskAlerts:
    """
    history_snapshots: 过去若干天的 nnq-heat.json 摘要，至少含 dailyTrend / keyword counts。
    首次部署无历史时，keywordSpikes 仅输出当日计数，growthRate=null。
    """
    ipo_master = ipo_master or {}
    today = datetime.now(TZ_CN).date().isoformat()
    today_posts = [
        p
        for p in posts
        if p.published_at
        and (
            p.published_at.astimezone(TZ_CN).date().isoformat()
            if p.published_at.tzinfo
            else p.published_at.date().isoformat()
        )
        == today
    ]

    # --- 关键词异动 ---
    today_kw: Counter[str] = Counter()
    for p in today_posts:
        for w in RISK_KEYWORDS:
            if w in (p.text or ""):
                today_kw[w] += 1

    prev_kw: Counter[str] = Counter()
    if history_snapshots:
        yesterday = (datetime.now(TZ_CN).date() - timedelta(days=1)).isoformat()
        for snap in history_snapshots:
            for row in snap.get("dailyTrend") or []:
                if row.get("date") != yesterday:
                    continue
                for item in row.get("riskKeywordCounts") or []:
                    prev_kw[item["word"]] += int(item.get("count") or 0)

    keyword_spikes: list[KeywordSpike] = []
    for word, cnt in today_kw.items():
        prev = prev_kw.get(word, 0)
        growth = None if prev == 0 else round((cnt - prev) / prev, 2)
        severity: Literal["low", "medium", "high"] = "low"
        if growth is not None and growth >= keyword_growth_min:
            severity = "high" if growth >= 3 else "medium"
        elif cnt >= 3:
            severity = "medium"
        keyword_spikes.append(
            {
                "word": word,
                "todayCount": cnt,
                "prevDayCount": prev,
                "growthRate": growth,
                "severity": severity,
                "window": "1d",
            }
        )

    # --- 个股负面增速 ---
    stock_neg_today: Counter[str] = Counter()
    stock_neg_hist: dict[str, list[int]] = defaultdict(list)
    for p in today_posts:
        if p.stock_sentiment != "bearish":
            continue
        for s in p.stocks:
            c = s.get("code") or ""
            if c:
                stock_neg_today[c] += 1

    if history_snapshots:
        for snap in history_snapshots[-3:]:
            for item in snap.get("stockNegativeDaily") or []:
                stock_neg_hist[item["code"]].append(int(item.get("count") or 0))

    stock_spikes: list[StockSentimentSpike] = []
    for code, cnt in stock_neg_today.items():
        hist = stock_neg_hist.get(code, [])
        avg = sum(hist) / len(hist) if hist else 0.0
        growth = round((cnt - avg) / avg, 2) if avg > 0 else float(cnt)
        flagged = cnt >= 2 and (avg <= 0 or growth >= stock_neg_growth_min)
        name = (ipo_master.get(code) or {}).get("name") or code
        stock_spikes.append(
            {
                "code": code,
                "name": name,
                "negativeCountToday": cnt,
                "negativeCountPrev3dAvg": round(avg, 2),
                "growthRate": growth,
                "flag": flagged,
                "reason": "负面情绪近1日增速超阈值" if flagged else "",
            }
        )

    return {
        "keywordSpikes": keyword_spikes,
        "stockSentimentSpikes": [s for s in stock_spikes if s["flag"]],
        "thresholds": {
            "keywordGrowthMin": keyword_growth_min,
            "stockNegGrowthMin": stock_neg_growth_min,
        },
    }


# ---------------------------------------------------------------------------
# Step 5 · 汇总：挂载到 nnq-heat.json
# ---------------------------------------------------------------------------

def build_nnq_heat_v2(
    filtered_posts: list[dict[str, Any]],
    base_analytics: dict[str, Any],
    *,
    days: int = 10,
    history_snapshots: list[dict[str, Any]] | None = None,
    ipo_master: dict[str, dict[str, Any]] | None = None,
    sheet_rows: list[dict[str, Any]] | None = None,
) -> NnqHeatV2Extension:
    """在 build_analytics() 之后调用，生成 v2 扩展块。"""
    enriched = [enrich_post(p) for p in filtered_posts]
    enriched = [p for p in enriched if p.post_tier != "spam"]
    master = ipo_master if ipo_master is not None else load_ipo_master_from_sheet()

    stock_insights = build_stock_insights(enriched, master, window=days)
    keyword_map = build_keyword_stock_map(enriched)
    behavior = build_investor_behavior_mix(enriched)
    sector_heat = build_sector_heat(enriched, master, window=days)
    daily = build_daily_trend(enriched, days=days, window=days)
    risk = build_risk_alerts(enriched, history_snapshots, master)
    enrich_stock_ipo_radars(stock_insights, sector_heat)
    risk_bars = build_risk_highlight_bars(stock_insights, risk, keyword_map)
    topic_index = build_topic_analysis_index(
        stock_insights,
        keyword_map,
        base_analytics.get("topKeywords") or [],
        sector_heat,
    )

    base_analytics["topStocks"] = [
        {
            "name": s["name"],
            "code": s["code"],
            "mentions": s["mentions"],
            "engagement": s["heatIndex"],
            "heatIndex": s["heatIndex"],
            "disagreementIndex": s["disagreementIndex"],
            "weightedScore": s["weightedHeat"]["weightedScore"],
            "posts": s["mentions"],
        }
        for s in stock_insights[:10]
    ]

    from sheet_ipo_sync import build_sheet_ipo_universe

    sheet_block = build_sheet_ipo_universe(
        stock_insights,
        sheet_rows=sheet_rows,
    )

    return {
        "schemaVersion": 2,
        "stockInsights": stock_insights,
        "keywordStockMap": keyword_map,
        "marketInsights": {
            "investorBehavior": behavior,
            "sectorHeat": sector_heat,
            "sectorHeatFromSheet": sheet_block.get("sectorHeatFromSheet") or [],
            "sectorHeatSource": "google_sheet",
        },
        "dailyTrend": daily,
        "riskAlerts": risk,
        "riskHighlightBars": risk_bars,
        "topicAnalysisIndex": topic_index,
        **sheet_block,
    }


def _history_dir(repo_root: Path) -> Path:
    raw = os.environ.get("NNQ_HEAT_HISTORY_DIR", "").strip()
    return Path(raw) if raw else repo_root / "nnq-heat-history"


def load_history_snapshots(repo_root: Path, *, max_days: int = 7) -> list[dict[str, Any]]:
    d = _history_dir(repo_root)
    if not d.is_dir():
        return []
    files = sorted(d.glob("*.json"), reverse=True)
    out: list[dict[str, Any]] = []
    for f in files[:max_days]:
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


def build_history_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    """写入 nnq-heat-history/ 的精简快照，供次日 riskAlerts 对比。"""
    today = datetime.now(TZ_CN).date().isoformat()
    stock_neg: Counter[str] = Counter()
    for s in payload.get("stockInsights") or []:
        bear = ((s.get("sentimentBreakdown") or {}).get("bearish") or {}).get("count") or 0
        if bear:
            stock_neg[s.get("code") or ""] += int(bear)
    return {
        "date": today,
        "dailyTrend": payload.get("dailyTrend") or [],
        "stockNegativeDaily": [
            {"code": c, "count": n} for c, n in stock_neg.items() if c and n
        ],
    }


def archive_daily_snapshot(payload: dict[str, Any], repo_root: Path) -> None:
    d = _history_dir(repo_root)
    d.mkdir(parents=True, exist_ok=True)
    snap = build_history_snapshot(payload)
    path = d / f"{snap['date']}.json"
    path.write_text(json.dumps(snap, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
