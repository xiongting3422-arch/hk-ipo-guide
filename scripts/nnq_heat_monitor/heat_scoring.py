#!/usr/bin/env python3
"""
牛牛圈 IPO 话题热度 · 权重与指数计算（v3）

权重优先级（高→低）：
  1. 中签晒单 / 深度分析：10
  2. 带观点评论（非水聊）：5
  3. 普通点赞 / 无意义回复：1
  4. 灌水 / 无关闲聊：0（直接过滤）

核心指标：
  - 个股热度指数 heatIndex = Σ(加权互动) / 时间衰减系数
  - 个股分歧度指数 disagreementIndex = |看多占比 - 看空占比|（越低分歧越大）
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

TZ_CN = timezone(timedelta(hours=8))

PostTier = Literal["lotteryShare", "deepAnalysis", "opinionComment", "likeOnly", "spam"]
SentimentTri = Literal["bullish", "bearish", "watch", "neutral"]

TIER_WEIGHTS: dict[PostTier, float] = {
    "lotteryShare": 10.0,
    "deepAnalysis": 10.0,
    "opinionComment": 5.0,
    "likeOnly": 1.0,
    "spam": 0.0,
}

BULLISH_WORDS = ("看好", "必打", "梭哈", "申购", "冲", "大肉", "稳中签", "参与", "值得打", "上车")
BEARISH_WORDS = ("破发", "劝退", "别打", "回避", "坑", "不申购", "跳过", "避雷", "估值过高", "弃购")
WATCH_WORDS = ("观望", "再看看", "等等", "不确定", "中性", "随缘", "可打可不打")
OPINION_MARKERS = BULLISH_WORDS + BEARISH_WORDS + WATCH_WORDS + (
    "暗盘",
    "打新",
    "招股",
    "孖展",
    "绿鞋",
    "基石",
    "中签率",
    "入场费",
    "稳价",
    "回拨",
)
IPO_CONTEXT_WORDS = (
    "IPO",
    "ipo",
    "新股",
    "打新",
    "招股",
    "申购",
    "中签",
    "暗盘",
    "孖展",
    "绿鞋",
    "基石",
    "破发",
    "聆讯",
    "招股书",
)

WATER_PATTERNS = (
    r"^[顶赞支持加油666👍🤣😂]+$",
    r"^(学习了|膜拜|路过|沙发|打卡|签到|同问|mark|Mark)$",
    r"^(哈哈+|呵呵+|666+)$",
    r"^[\W_]{1,12}$",
)
_WATER_RES = [re.compile(p, re.I) for p in WATER_PATTERNS]


@dataclass
class ScoredPost:
    feed_id: str
    author: str
    text: str
    engagement: int
    likes: int
    comments: int
    shares: int
    published_at: datetime | None
    stocks: list[dict[str, str]]
    post_tier: PostTier
    stock_sentiment: SentimentTri
    tier_weight: float
    weighted_interaction: float
    heat_contribution: float
    days_ago: int


def _today_cn() -> date:
    return datetime.now(TZ_CN).date()


def _post_date(post: dict[str, Any]) -> date | None:
    raw = post.get("publishedAt")
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw))
        if dt.tzinfo:
            return dt.astimezone(TZ_CN).date()
        return dt.date()
    except ValueError:
        return None


def _days_ago(post_date: date | None, *, end: date | None = None) -> int:
    if not post_date:
        return 0
    end = end or _today_cn()
    return max(0, (end - post_date).days)


def time_decay_factor(days_ago: int, window: int = 10) -> float:
    """
    时间衰减系数：越久远越大，用于作除数压低旧帖贡献。
    当天=1.0，窗口最远一天≈2.0（线性）。
    """
    if days_ago <= 0:
        return 1.0
    span = max(window - 1, 1)
    return 1.0 + (min(days_ago, window - 1) / span)


def classify_stock_sentiment(text: str) -> SentimentTri:
    t = text or ""
    b = sum(1 for w in BULLISH_WORDS if w in t)
    s = sum(1 for w in BEARISH_WORDS if w in t)
    w = sum(1 for w in WATCH_WORDS if w in t)
    if b > s and b >= w:
        return "bullish"
    if s > b and s >= w:
        return "bearish"
    if w > 0 and w >= b and w >= s:
        return "watch"
    return "neutral"


def _has_opinion_signal(text: str, sentiment: SentimentTri) -> bool:
    t = text or ""
    if sentiment != "neutral":
        return True
    if any(m in t for m in OPINION_MARKERS):
        return True
    if len(t) >= 80 and any(k in t for k in IPO_CONTEXT_WORDS):
        return True
    return False


def _is_water_chat(text: str, *, has_stocks: bool) -> bool:
    t = re.sub(r"\s+", "", text or "").strip()
    if not t:
        return True
    if has_stocks:
        return False
    if len(t) <= 6 and not any(k in t for k in IPO_CONTEXT_WORDS):
        return True
    for rx in _WATER_RES:
        if rx.match(t):
            return True
    if len(t) < 18 and not any(k in t for k in IPO_CONTEXT_WORDS):
        return True
    return False


def classify_post_tier(
    text: str,
    likes: int,
    comments: int,
    shares: int,
    *,
    has_stocks: bool,
    sentiment: SentimentTri,
) -> PostTier:
    t = text or ""

    if _is_water_chat(t, has_stocks=has_stocks):
        return "spam"

    if any(k in t for k in ("中签", "稳中", "分配结果", "晒单", "拿到", "一手")) and (
        "截图" in t or likes + comments >= 5 or has_stocks
    ):
        return "lotteryShare"

    analysis_hits = sum(
        1 for k in ("招股", "基石", "孖展", "绿鞋", "入场费", "发行比例", "招股书", "保荐")
        if k in t
    )
    if len(t) >= 180 or analysis_hits >= 2:
        return "deepAnalysis"

    if _has_opinion_signal(t, sentiment):
        if len(t) < 30 and likes >= max(comments, shares, 1) and comments == 0:
            return "likeOnly"
        return "opinionComment"

    if len(t) < 30 and likes >= max(comments, shares, 1):
        return "likeOnly"

    if len(re.sub(r"\s+", "", t)) < 10:
        return "spam"

    return "likeOnly"


def raw_interaction_score(likes: int, comments: int, shares: int) -> float:
    return likes * 0.2 + comments * 1.0 + shares * 1.5


def compute_weighted_interaction(
    *,
    tier: PostTier,
    likes: int,
    comments: int,
    shares: int,
) -> float:
    weight = TIER_WEIGHTS[tier]
    if weight <= 0:
        return 0.0
    base = raw_interaction_score(likes, comments, shares)
    return weight * max(base, 1.0)


def compute_post_heat_contribution(
    weighted_interaction: float,
    days_ago: int,
    *,
    window: int = 10,
) -> float:
    if weighted_interaction <= 0:
        return 0.0
    return weighted_interaction / time_decay_factor(days_ago, window)


def score_post(raw: dict[str, Any], *, window: int = 10, end: date | None = None) -> ScoredPost | None:
    """解析单帖；灌水帖返回 None。"""
    text = str(raw.get("text") or "")
    likes = int(raw.get("likes") or 0)
    comments = int(raw.get("comments") or 0)
    shares = int(raw.get("shares") or 0)
    engagement = int(raw.get("engagement") or 0)
    stocks = list(raw.get("stocks") or [])
    has_stocks = bool(stocks)
    sentiment = classify_stock_sentiment(text)
    tier = classify_post_tier(
        text, likes, comments, shares, has_stocks=has_stocks, sentiment=sentiment
    )
    if tier == "spam" or TIER_WEIGHTS[tier] <= 0:
        return None

    pub = None
    if raw.get("publishedAt"):
        try:
            pub = datetime.fromisoformat(str(raw["publishedAt"]))
        except ValueError:
            pub = None
    post_date = _post_date(raw)
    days = _days_ago(post_date, end=end)
    weighted = compute_weighted_interaction(
        tier=tier, likes=likes, comments=comments, shares=shares
    )
    heat = compute_post_heat_contribution(weighted, days, window=window)

    return ScoredPost(
        feed_id=str(raw.get("feedId") or ""),
        author=str(raw.get("author") or ""),
        text=text,
        engagement=engagement,
        likes=likes,
        comments=comments,
        shares=shares,
        published_at=pub,
        stocks=stocks,
        post_tier=tier,
        stock_sentiment=sentiment,
        tier_weight=TIER_WEIGHTS[tier],
        weighted_interaction=weighted,
        heat_contribution=heat,
        days_ago=days,
    )


def filter_valid_posts(
    posts: list[dict[str, Any]],
    *,
    window: int = 10,
    end: date | None = None,
) -> tuple[list[dict[str, Any]], list[ScoredPost]]:
    """过滤灌水帖，返回有效原帖 + 评分对象。"""
    valid_raw: list[dict[str, Any]] = []
    scored: list[ScoredPost] = []
    for p in posts:
        sp = score_post(p, window=window, end=end)
        if sp is None:
            continue
        valid_raw.append(p)
        scored.append(sp)
    return valid_raw, scored


def compute_disagreement_index(posts: list[ScoredPost]) -> float:
    """|看多占比 - 看空占比|；数值越低表示分歧越大。"""
    if not posts:
        return 0.0
    bull = sum(1 for p in posts if p.stock_sentiment == "bullish")
    bear = sum(1 for p in posts if p.stock_sentiment == "bearish")
    total = len(posts)
    bull_pct = bull / total * 100
    bear_pct = bear / total * 100
    return round(abs(bull_pct - bear_pct), 1)


def aggregate_stock_heat(
    scored_posts: list[ScoredPost],
) -> dict[str, dict[str, Any]]:
    """
    按股票代码聚合热度指数与分歧度。
    返回 { code: { name, mentions, heatIndex, disagreementIndex, weightedScore, posts } }
    """
    by_code: dict[str, list[ScoredPost]] = defaultdict(list)
    names: dict[str, str] = {}

    for sp in scored_posts:
        if not sp.stocks:
            continue
        seen: set[str] = set()
        for s in sp.stocks:
            code = (s.get("code") or "").strip()
            if not code or code in seen:
                continue
            seen.add(code)
            name = (s.get("name") or "").strip()
            if name and not name.isdigit():
                names[code] = name
            by_code[code].append(sp)

    out: dict[str, dict[str, Any]] = {}
    for code, bucket in by_code.items():
        heat_index = round(sum(p.heat_contribution for p in bucket), 1)
        weighted = round(sum(p.weighted_interaction for p in bucket), 1)
        out[code] = {
            "name": names.get(code, code),
            "code": code,
            "mentions": len(bucket),
            "posts": len(bucket),
            "heatIndex": heat_index,
            "disagreementIndex": compute_disagreement_index(bucket),
            "weightedScore": weighted,
            "engagement": heat_index,
        }
    return out


def build_top_stocks_ranking(
    scored_posts: list[ScoredPost],
    *,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """按个股热度指数排序，替代原「提及次数+原始互动」。"""
    agg = aggregate_stock_heat(scored_posts)
    rows = sorted(agg.values(), key=lambda x: x["heatIndex"], reverse=True)
    return rows[:limit]
