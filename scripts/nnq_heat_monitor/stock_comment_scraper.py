#!/usr/bin/env python3
"""定向抓取富途个股评论区（SSR DOM 解析，输出结构与牛牛圈 feed 兼容）。"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

LOG = logging.getLogger("nnq_heat_monitor.stock_comments")

STOCK_PAGE_SIZE = int(os.environ.get("NNQ_STOCK_PAGE_SIZE", "20").strip() or "20")
STOCK_SCROLL_ROUNDS = int(os.environ.get("NNQ_STOCK_SCROLL_ROUNDS", "3").strip() or "3")
STOCK_TARGET_LIMIT = int(os.environ.get("NNQ_STOCK_TARGET_LIMIT", "20").strip() or "20")

COMMUNITY_URL = "https://www.futunn.com/hk/stock/{code}-HK/community"

_EXTRACT_ITEMS_JS = """
(maxItems) => {
  const parseCount = (root, selector) => {
    const el = root.querySelector(selector);
    if (!el) return 0;
    const num = el.querySelector('.num, .count, span');
    const raw = (num ? num.textContent : el.textContent) || '';
    const m = String(raw).replace(/,/g, '').match(/\\d+/);
    return m ? Number(m[0]) : 0;
  };

  const out = [];
  const seen = new Set();
  document.querySelectorAll('.nnq-list-item[fid]').forEach((el) => {
    const fid = el.getAttribute('fid');
    if (!fid || seen.has(fid)) return;
    seen.add(fid);

    const profileLink = el.querySelector('.nnq-user-section a[href*="/profile/"]');
    const uidMatch = profileLink?.getAttribute('href')?.match(/profile\\/(\\d+)/);
    const avatarImg = el.querySelector('.nnq-user-section img');
    const nickname =
      el.querySelector('.nnq-user-section .username')?.textContent?.trim() ||
      avatarImg?.getAttribute('alt')?.trim() ||
      '';

    const contentEl =
      el.querySelector('.nnq-list-item-content') ||
      el.querySelector('.feed__wrapper') ||
      el.querySelector('.rich-text-wrapper') ||
      el.querySelector('.nnq-feed-content') ||
      el.querySelector('.feed-content') ||
      el.querySelector('[class*="feed-content"]');
    let text = (contentEl?.innerText || el.innerText || '').trim();
    text = text.replace(/\\s+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();

    const likes = parseCount(el, '.func-like, .func-like-wrapper');
    const comments = parseCount(el, '.func-comment');
    const shares = parseCount(el, '.func-share, .func-icon-share');

    out.push({
      feedId: fid,
      userId: uidMatch ? uidMatch[1] : '',
      author: nickname,
      authorAvatar: avatarImg?.src || '',
      text,
      likes,
      comments,
      shares,
      publishedHint: el.querySelector('.publish-time-text')?.textContent?.trim() || '',
      link: `https://q.futunn.com/feed/${fid}`,
    });
  });

  return out.slice(0, maxItems);
}
"""


def _norm_code(code: str) -> str:
    return re.sub(r"\D", "", code or "")[-5:].zfill(5)


def _community_url(code: str) -> str:
    return COMMUNITY_URL.format(code=_norm_code(code))


async def resolve_stock_id(page, code: str) -> str | None:
    """从个股社区页 HTML 提取 security stock_id（长整型）。"""
    url = _community_url(code)
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=90000)
        if not resp or resp.status >= 400:
            return None
        html = await page.content()
    except Exception as exc:
        LOG.debug("resolve_stock_id goto %s failed: %s", code, exc)
        return None

    for pat in (
        r'stock_id="(\d{10,})"',
        r'"stock_id"\s*:\s*"(\d{10,})"',
        r'stock_id=(\d{10,})',
    ):
        m = re.search(pat, html)
        if m:
            return m.group(1)
    return None


def _dom_item_to_post(
    item: dict[str, Any],
    *,
    code: str,
    name: str,
    classify_sentiment,
) -> dict[str, Any] | None:
    fid = str(item.get("feedId") or "").strip()
    text = str(item.get("text") or "").strip()
    author = str(item.get("author") or "").strip()
    if not fid or not text:
        return None

    likes = int(item.get("likes") or 0)
    comments = int(item.get("comments") or 0)
    shares = int(item.get("shares") or 0)
    engagement = likes + comments + shares

    return {
        "feedId": fid,
        "author": author or "牛友",
        "authorNickname": author or "牛友",
        "authorAvatar": str(item.get("authorAvatar") or "").strip(),
        "authorFollowers": 0,
        "text": text,
        "engagement": engagement,
        "likes": likes,
        "comments": comments,
        "shares": shares,
        "publishedAt": None,
        "timestamp": 0,
        "link": str(item.get("link") or f"https://q.futunn.com/feed/{fid}"),
        "sentiment": classify_sentiment(text),
        "stocks": [{"name": name, "code": _norm_code(code)}],
        "source": "stock_comment",
        "targetStockCode": _norm_code(code),
        "targetStockName": name,
        "publishedHint": str(item.get("publishedHint") or ""),
        "userId": str(item.get("userId") or ""),
    }


async def _scroll_for_more(page, rounds: int) -> None:
    for _ in range(max(0, rounds)):
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(1.2)


async def fetch_stock_comment_posts(
    page,
    targets: list[dict[str, Any]],
    *,
    parse_feed_item,
    is_official_account,
    classify_sentiment,
    max_targets: int | None = None,
) -> list[dict[str, Any]]:
    del parse_feed_item  # DOM 路径不依赖 feed-list JSON
    limit = max_targets or STOCK_TARGET_LIMIT
    all_posts: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for target in targets[:limit]:
        code = str(target.get("code") or "").strip()
        name = str(target.get("name") or code).strip()
        if not code:
            continue

        url = _community_url(code)
        try:
            resp = await page.goto(url, wait_until="load", timeout=90000)
            if not resp or resp.status >= 400:
                LOG.warning("stock community HTTP %s code=%s", resp.status if resp else "?", code)
                continue
            await asyncio.sleep(1.0)
            await _scroll_for_more(page, STOCK_SCROLL_ROUNDS)
            raw_items = await page.evaluate(_EXTRACT_ITEMS_JS, STOCK_PAGE_SIZE)
        except Exception as exc:
            LOG.warning("stock community scrape failed code=%s: %s", code, exc)
            continue

        batch = 0
        for item in raw_items or []:
            post = _dom_item_to_post(
                item,
                code=code,
                name=name,
                classify_sentiment=classify_sentiment,
            )
            if not post:
                continue
            if is_official_account(post.get("author") or ""):
                continue
            fid = str(post["feedId"])
            if fid in seen_ids:
                continue
            seen_ids.add(fid)
            all_posts.append(post)
            batch += 1

        LOG.info("stock %s (%s): comments=%s total=%s", name, code, batch, len(all_posts))
        await asyncio.sleep(0.5)

    return all_posts


async def fetch_stock_comments_with_login(
    uid: str,
    pwd: str,
    targets: list[dict[str, Any]],
    *,
    parse_feed_item,
    is_official_account,
    classify_sentiment,
    futu_login,
) -> list[dict[str, Any]]:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        LOG.warning("playwright not installed, skip stock comment scrape")
        return []

    target_url = "https://q.futunn.com/nnq/recommend"
    async with async_playwright() as p:
        launch_kwargs: dict[str, Any] = {"headless": True}
        try:
            browser = await p.chromium.launch(channel="chrome", **launch_kwargs)
        except Exception:
            browser = await p.chromium.launch(**launch_kwargs)
        ctx = await browser.new_context(
            locale="zh-cn",
            viewport={"width": 1365, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = await ctx.new_page()
        await futu_login(page, target_url, uid, pwd)
        posts = await fetch_stock_comment_posts(
            page,
            targets,
            parse_feed_item=parse_feed_item,
            is_official_account=is_official_account,
            classify_sentiment=classify_sentiment,
        )
        await browser.close()
        return posts
