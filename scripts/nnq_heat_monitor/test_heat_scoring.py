#!/usr/bin/env python3
"""heat_scoring 单元测试。"""
from datetime import date, datetime, timedelta, timezone

from heat_scoring import (
    TIER_WEIGHTS,
    build_top_stocks_ranking,
    classify_post_tier,
    compute_disagreement_index,
    filter_valid_posts,
    score_post,
    time_decay_factor,
)

TZ_CN = timezone(timedelta(hours=8))


def _post(text, **kw):
    base = {
        "feedId": "1",
        "author": "u",
        "text": text,
        "likes": kw.get("likes", 2),
        "comments": kw.get("comments", 1),
        "shares": kw.get("shares", 0),
        "engagement": kw.get("likes", 2) + kw.get("comments", 1),
        "publishedAt": kw.get(
            "publishedAt",
            datetime.now(TZ_CN).isoformat(),
        ),
        "stocks": kw.get("stocks", []),
    }
    return base


def test_tier_weights():
    assert TIER_WEIGHTS["lotteryShare"] == 10
    assert TIER_WEIGHTS["deepAnalysis"] == 10
    assert TIER_WEIGHTS["opinionComment"] == 5
    assert TIER_WEIGHTS["likeOnly"] == 1
    assert TIER_WEIGHTS["spam"] == 0


def test_spam_filtered():
    posts = [
        _post("666"),
        _post("顶一下"),
        _post("創想三維03388值得申购，孖展火热", stocks=[{"name": "創想三維", "code": "03388"}]),
    ]
    valid, scored = filter_valid_posts(posts)
    assert len(valid) == 1
    assert scored[0].post_tier in ("opinionComment", "deepAnalysis", "lotteryShare", "likeOnly")


def test_time_decay_recent_higher():
    today = date.today()
    old = today - timedelta(days=9)
    recent = score_post(
        _post(
            "03388暗盘表现不错，继续申购",
            stocks=[{"name": "A", "code": "03388"}],
            publishedAt=datetime.combine(today, datetime.min.time(), TZ_CN).isoformat(),
        ),
        end=today,
    )
    ancient = score_post(
        _post(
            "03388暗盘表现不错，继续申购",
            stocks=[{"name": "A", "code": "03388"}],
            publishedAt=datetime.combine(old, datetime.min.time(), TZ_CN).isoformat(),
        ),
        end=today,
    )
    assert recent and ancient
    assert recent.heat_contribution > ancient.heat_contribution


def test_disagreement_index():
    posts = [
        score_post(_post("看好申购03388", stocks=[{"name": "A", "code": "03388"}])),
        score_post(_post("别打03388会破发", stocks=[{"name": "A", "code": "03388"}])),
    ]
    posts = [p for p in posts if p]
    idx = compute_disagreement_index(posts)
    assert idx == 0.0


def test_top_stocks_by_heat_index():
    posts = [
        score_post(_post("短评", likes=1, comments=0, stocks=[{"name": "A", "code": "00001"}])),
        score_post(
            _post(
                "深度分析：03388招股書基石孖展绿鞋，申购建议",
                likes=5,
                comments=8,
                stocks=[{"name": "B", "code": "03388"}],
            )
        ),
    ]
    scored = [p for p in posts if p]
    top = build_top_stocks_ranking(scored)
    assert top[0]["code"] == "03388"
    assert "heatIndex" in top[0]
    assert "disagreementIndex" in top[0]


if __name__ == "__main__":
    test_tier_weights()
    test_spam_filtered()
    test_time_decay_recent_higher()
    test_disagreement_index()
    test_top_stocks_by_heat_index()
    print("ok")
