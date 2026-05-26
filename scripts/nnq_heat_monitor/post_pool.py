#!/usr/bin/env python3
"""统一内容池：合并、去重、同发布者保留最新一条（高热列表用）。"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any


def _author_key(post: dict[str, Any]) -> str:
    nick = str(post.get("authorNickname") or post.get("author") or "").strip()
    if nick:
        return nick.lower()
    return str(post.get("feedId") or post.get("link") or id(post))


def _post_ts(post: dict[str, Any]) -> float:
    raw = post.get("publishedAt")
    if not raw:
        return float(post.get("timestamp") or 0)
    try:
        return datetime.fromisoformat(str(raw)).timestamp()
    except ValueError:
        return float(post.get("timestamp") or 0)


def _post_rank(post: dict[str, Any]) -> tuple[float, float, int]:
    return (
        _post_ts(post),
        float(post.get("engagement") or 0),
        int(post.get("likes") or 0) + int(post.get("comments") or 0),
    )


def _feed_key(post: dict[str, Any]) -> str:
    fid = str(post.get("feedId") or "").strip()
    if fid:
        return f"fid:{fid}"
    link = str(post.get("link") or "").strip()
    if link:
        return f"link:{link}"
    text = re.sub(r"\s+", " ", str(post.get("text") or ""))[:160]
    return f"hash:{hash(text)}:{_author_key(post)}"


def _text_fingerprint(text: str) -> str:
    t = re.sub(r"\s+", "", (text or "").strip().lower())
    t = re.sub(r"https?://\S+", "", t)
    return t[:160]


def merge_post_pools(*pools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for pool in pools:
        for post in pool or []:
            key = _feed_key(post)
            prev = merged.get(key)
            if prev is None or _post_rank(post) > _post_rank(prev):
                merged[key] = post
    return list(merged.values())


def dedupe_similar_text(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    kept: list[dict[str, Any]] = []
    for post in sorted(posts, key=_post_rank, reverse=True):
        fp = _text_fingerprint(str(post.get("text") or ""))
        if len(fp) < 12:
            kept.append(post)
            continue
        if fp in seen:
            continue
        seen.add(fp)
        kept.append(post)
    return kept


def dedupe_authors_latest(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_author: dict[str, dict[str, Any]] = {}
    for post in posts:
        key = _author_key(post)
        prev = by_author.get(key)
        if prev is None or _post_rank(post) > _post_rank(prev):
            by_author[key] = post
    return list(by_author.values())


def build_pool_stats(
    *,
    nnq_count: int,
    stock_count: int,
    merged_count: int,
    after_clean: int,
    hot_count: int,
) -> dict[str, int]:
    return {
        "nnqFeedCount": nnq_count,
        "stockCommentCount": stock_count,
        "mergedCount": merged_count,
        "afterCleanCount": after_clean,
        "highHeatCount": hot_count,
    }
