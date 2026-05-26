#!/usr/bin/env python3
"""通过富途 user card-info 接口补全作者头像与粉丝数。"""
from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any

LOG = logging.getLogger("nnq_heat_monitor.author_enrich")

_CACHE: dict[str, dict[str, Any]] = {}
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def fetch_user_card(user_id: str) -> dict[str, Any]:
    uid = str(user_id or "").strip()
    if not uid or uid == "0":
        return {}
    if uid in _CACHE:
        return _CACHE[uid]

    url = f"https://q.futunn.com/api/user/card-info?userId={uid}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        LOG.debug("card-info failed uid=%s: %s", uid, exc)
        _CACHE[uid] = {}
        return {}

    user_info = data.get("user_info") or {}
    base_info = data.get("base_info") or {}
    out = {
        "authorNickname": str(user_info.get("nick") or "").strip(),
        "authorAvatar": str(user_info.get("avatar") or "").strip(),
        "authorFollowers": int(base_info.get("follower_num") or 0),
    }
    _CACHE[uid] = out
    time.sleep(0.12)
    return out


def enrich_post_profile(post: dict[str, Any]) -> dict[str, Any]:
    uid = str(post.get("userId") or post.get("authorUserId") or "").strip()
    if not uid:
        return post

    card = fetch_user_card(uid)
    if not card:
        return post

    merged = dict(post)
    nick = card.get("authorNickname")
    avatar = card.get("authorAvatar")
    followers = card.get("authorFollowers")

    if nick:
        merged["authorNickname"] = nick
        merged["author"] = nick
    if avatar:
        merged["authorAvatar"] = avatar
    if followers is not None:
        merged["authorFollowers"] = followers
    return merged


def enrich_posts_profiles(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    uids = {
        str(p.get("userId") or p.get("authorUserId") or "").strip()
        for p in posts
        if str(p.get("userId") or p.get("authorUserId") or "").strip()
    }
    for uid in uids:
        fetch_user_card(uid)
    return [enrich_post_profile(p) for p in posts]
