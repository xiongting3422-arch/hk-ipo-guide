#!/usr/bin/env python3
"""
牛牛圈「牛友交流」IPO 讨论热度抓取与分析。

数据源：https://q.futunn.com/nnq/recommend （feed-list type=700）
筛选：近 N 天 · IPO 关键词 · 赞+评+转 ≥ 阈值 · 排除官方号
输出：仓库根目录 nnq-heat.json（供 index.html 看板读取）

v2 扩展字段定义与计算伪代码：同目录 analytics_v2.py · 示例 JSON：nnq-heat.v2.example.json

凭据（勿写入仓库）：环境变量 FUTU_LOGIN_UID / FUTU_LOGIN_PASSWORD
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from author_enrich import enrich_posts_profiles
from analytics_v2 import archive_daily_snapshot, build_nnq_heat_v2, load_history_snapshots
from heat_scoring import build_top_stocks_ranking, filter_valid_posts
from ipo_sheet_loader import load_ipo_master_from_sheet
from post_pool import (
    build_pool_stats,
    dedupe_authors_latest,
    dedupe_similar_text,
    merge_post_pools,
)
from sheet_targets import select_scrape_targets
from stock_comment_scraper import fetch_stock_comments_with_login

try:
    from playwright.async_api import async_playwright
except ImportError as exc:  # pragma: no cover
    print("Missing playwright:", exc, file=sys.stderr)
    print("Run: pip install playwright && python -m playwright install chromium", file=sys.stderr)
    sys.exit(1)

LOG = logging.getLogger("nnq_heat_monitor")

TZ_CN = timezone(timedelta(hours=8))
FEED_TYPE = 700  # 牛友交流推荐流
DEFAULT_DAYS = int(os.environ.get("NNQ_HEAT_DAYS", "30").strip() or "30")
MIN_ENGAGEMENT = int(os.environ.get("NNQ_HEAT_MIN_ENGAGEMENT", "0").strip() or "0")
HIGH_HEAT_THRESHOLD = int(os.environ.get("NNQ_HEAT_HIGH_THRESHOLD", "10").strip() or "10")
EXCERPT_LEN = int(os.environ.get("NNQ_HEAT_EXCERPT_LEN", "100").strip() or "100")
MAX_PAGES = int(os.environ.get("NNQ_HEAT_MAX_PAGES", "120").strip() or "120")
PAGE_SIZE = int(os.environ.get("NNQ_HEAT_PAGE_SIZE", "20").strip() or "20")

KEYWORDS = [
    "IPO",
    "ipo",
    "新股",
    "新股分析",
    "中签",
    "暗盘",
    "打新",
    "招股",
    "申购",
    "孖展",
    "绿鞋",
    "基石",
    "招股书",
    "聆讯",
    "首日",
    "破发",
    "超额认购",
    "招股期",
    "一手中签率",
    "回拨",
    "稳价人",
]

OFFICIAL_ACCOUNTS = [
    "牛牛课堂",
    "牛牛課堂",
    "富途期权sir",
    "富途期权Sir",
    "牛牛团队",
    "富途资讯",
    "富途牛牛官方",
    "牛牛新股君",
    "Futu Official",
]

POSITIVE_WORDS = [
    "看好",
    "推荐",
    "必打",
    "冲",
    "稳",
    "大肉",
    "吃肉",
    "中签",
    "暴涨",
    "涨",
    "值得",
    "优质",
    "强推",
    "参与",
    "申购",
    "乐观",
    "机会",
    "收益",
    "翻倍",
    "稳赚",
]

NEGATIVE_WORDS = [
    "破发",
    "劝退",
    "别打",
    "回避",
    "坑",
    "垃圾",
    "冷",
    "亏",
    "跌",
    "不中",
    "浪费",
    "谨慎",
    "风险",
    "撤单",
    "不申购",
    "跳过",
    "失望",
    "割",
    "套牢",
]

STOPWORDS = set(
    "的 了 是 在 我 有 和 就 不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好 自己 这".split()
)

NAME_CODE_RE = re.compile(r"([\u4e00-\u9fffA-Za-z0-9·\-\u3400-\u9fff]{2,16})\s*[\(（]\s*(0\d{4})", re.I)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _json_out() -> Path:
    raw = os.environ.get("NNQ_HEAT_JSON_OUT", "").strip()
    return Path(raw) if raw else _repo_root() / "nnq-heat.json"


def _keyword_pattern() -> re.Pattern[str]:
    alts = sorted({re.escape(k) for k in KEYWORDS if k}, key=len, reverse=True)
    return re.compile("|".join(alts), re.I)


KEYWORD_RE = _keyword_pattern()


def _now_cn() -> datetime:
    return datetime.now(TZ_CN)


def _ts_to_dt(ts: Any) -> datetime | None:
    try:
        n = int(str(ts).strip())
        if n <= 0:
            return None
        return datetime.fromtimestamp(n, TZ_CN)
    except (TypeError, ValueError):
        return None


def _rich_text_to_str(rich: list[dict[str, Any]] | None) -> str:
    if not rich:
        return ""
    parts: list[str] = []
    for item in rich:
        if item.get("type") == 0 and item.get("text"):
            parts.append(str(item["text"]))
        elif item.get("type") == 3:
            stock = item.get("stock") or {}
            name = stock.get("stock_name") or stock.get("name") or stock.get("display_symbol") or ""
            code = stock.get("stock_code") or stock.get("display_symbol") or ""
            if name or code:
                parts.append(f"{name}({code})".strip("()"))
    text = html.unescape("".join(parts))
    return re.sub(r"<br\s*/?>", "\n", text, flags=re.I).strip()


def extract_feed_text(item: dict[str, Any]) -> str:
    parts: list[str] = []
    summary = item.get("summary") or {}
    parts.append(_rich_text_to_str(summary.get("rich_text")))
    orig = item.get("original")
    if isinstance(orig, dict):
        parts.append(_rich_text_to_str(orig.get("rich_text")))
    elif isinstance(orig, str):
        parts.append(html.unescape(orig))
    if item.get("content"):
        parts.append(str(item["content"]))
    if item.get("feed_title"):
        parts.append(str(item["feed_title"]))
    for disc in item.get("discussion_items") or []:
        base = disc.get("base") or {}
        if base.get("discussion_name"):
            parts.append(str(base["discussion_name"]))
    for stock in item.get("stock_items") or []:
        name = stock.get("stock_name") or stock.get("name") or ""
        code = stock.get("stock_code") or stock.get("display_symbol") or ""
        if isinstance(name, dict):
            name = name.get("zh_sc") or name.get("zh-cn") or next(iter(name.values()), "")
        if name:
            parts.append(str(name))
        if code:
            parts.append(str(code))
    return "\n".join(p for p in parts if p).strip()


def get_engagement(item: dict[str, Any]) -> int:
    likes = int((item.get("like") or {}).get("liked_num") or 0)
    comments = int(
        item.get("comments_total_count")
        or (item.get("comment") or {}).get("comment_count")
        or 0
    )
    share_raw = item.get("share_count")
    if share_raw is None:
        share_raw = (item.get("common") or {}).get("share_count")
    shares = int(share_raw or 0)
    return likes + comments + shares


def get_author_name(item: dict[str, Any]) -> str:
    info = item.get("author_info") or item.get("user_info") or {}
    return str(info.get("nick_name") or info.get("user_id") or "").strip()


def get_author_profile(item: dict[str, Any]) -> dict[str, Any]:
    info = item.get("author_info") or item.get("user_info") or {}
    avatar = (
        info.get("avatar")
        or info.get("avator_url")
        or info.get("portrait")
        or info.get("head_url")
        or info.get("profile_image")
        or info.get("avatar_url")
        or ""
    )
    followers = (
        info.get("follower_count")
        or info.get("follower_num")
        or info.get("fans_num")
        or info.get("follow_total")
        or info.get("fans_count")
        or 0
    )
    nickname = str(info.get("nick_name") or info.get("user_name") or get_author_name(item) or "").strip()
    user_id = str(info.get("user_id") or info.get("uid") or "").strip()
    try:
        followers = int(followers)
    except (TypeError, ValueError):
        followers = 0
    return {
        "authorNickname": nickname,
        "authorAvatar": str(avatar).strip(),
        "authorFollowers": followers,
        "userId": user_id,
    }


def _norm_account_name(name: str) -> str:
    return (name or "").strip().replace("課", "课").replace("訊", "讯")


def is_official_account(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return False
    norm = _norm_account_name(n)
    for blocked in OFFICIAL_ACCOUNTS:
        b = _norm_account_name(blocked)
        if b.lower() in norm.lower():
            return True
    if norm.startswith("富途") and any(
        x in norm for x in ("Sir", "sir", "官方", "课堂", "资讯", "团队", "期权", "财报")
    ):
        return True
    if norm.startswith("牛牛") and any(x in norm for x in ("课堂", "团队", "新股君", "官方")):
        return True
    return False


def matches_keywords(text: str) -> bool:
    return bool(KEYWORD_RE.search(text or ""))


def classify_sentiment(text: str) -> str:
    t = text or ""
    pos = sum(1 for w in POSITIVE_WORDS if w in t)
    neg = sum(1 for w in NEGATIVE_WORDS if w in t)
    if pos > neg:
        return "positive"
    if neg > pos:
        return "negative"
    return "neutral"


def extract_stocks(text: str, item: dict[str, Any]) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    by_code: dict[str, str] = {}
    for stock in item.get("stock_items") or []:
        name = stock.get("stock_name") or stock.get("name") or ""
        if isinstance(name, dict):
            name = name.get("zh_sc") or name.get("zh-cn") or ""
        code = str(stock.get("stock_code") or stock.get("display_symbol") or "").strip()
        code = re.sub(r"\.HK$", "", code, flags=re.I)
        name = str(name).strip()
        if code:
            if name:
                by_code[code] = name
            elif code not in by_code:
                by_code[code] = code
    for m in NAME_CODE_RE.finditer(text or ""):
        name = m.group(1).strip()
        code = m.group(2)
        if name and code:
            by_code[code] = name
    for m in re.finditer(r"\b(0\d{4})(?:\.HK)?\b", text or "", re.I):
        code = m.group(1)
        if code not in by_code:
            by_code[code] = code
    for code, name in by_code.items():
        found.append((name, code))
    return found


def extract_topic_keywords(text: str) -> list[str]:
    hits: list[str] = []
    for m in KEYWORD_RE.finditer(text or ""):
        hits.append(m.group(0))
    for m in re.finditer(r"[\u4e00-\u9fffA-Za-z0-9]{2,8}(?:暗盘|打新|中签|破发|招股)", text or ""):
        hits.append(m.group(0))
    return hits


def parse_feed_item(item: dict[str, Any]) -> dict[str, Any] | None:
    comm = item.get("feed_comm") or {}
    ts = comm.get("timestamp") or item.get("timestamp")
    published = _ts_to_dt(ts)
    text = extract_feed_text(item)
    author = get_author_name(item)
    profile = get_author_profile(item)
    engagement = get_engagement(item)
    feed_id = str(comm.get("feed_id") or "")
    slug = str(comm.get("url_slugname") or "")
    link = f"https://q.futunn.com/feed/{feed_id}" if feed_id else ""
    if slug:
        link = f"https://q.futunn.com/nnq/post/{slug}?feed_id={feed_id}"
    return {
        "feedId": feed_id,
        "author": author,
        **profile,
        "text": text,
        "engagement": engagement,
        "likes": int((item.get("like") or {}).get("liked_num") or 0),
        "comments": int(item.get("comments_total_count") or 0),
        "shares": int(item.get("share_count") or 0),
        "publishedAt": published.isoformat() if published else None,
        "timestamp": int(ts) if ts else 0,
        "link": link,
        "sentiment": classify_sentiment(text),
        "stocks": [{"name": n, "code": c} for n, c in extract_stocks(text, item)],
    }


def _excerpt(text: str, limit: int = EXCERPT_LEN) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if len(t) <= limit:
        return t
    return t[:limit].rstrip() + "…"


def _post_passes_content_filter(p: dict[str, Any]) -> bool:
    if p.get("source") == "stock_comment":
        return bool(p.get("stocks") or p.get("targetStockCode"))
    return matches_keywords(p.get("text") or "")


def filter_posts(posts: list[dict[str, Any]], days: int, min_engagement: int) -> list[dict[str, Any]]:
    cutoff = _now_cn() - timedelta(days=days)
    out: list[dict[str, Any]] = []
    for p in posts:
        if is_official_account(p.get("author") or ""):
            continue
        if not _post_passes_content_filter(p):
            continue
        if p.get("engagement", 0) < min_engagement:
            continue
        pub = p.get("publishedAt")
        if pub:
            try:
                dt = datetime.fromisoformat(pub)
                if dt < cutoff:
                    continue
            except ValueError:
                pass
        out.append(p)
    out.sort(key=lambda x: x.get("engagement", 0), reverse=True)
    return out


def build_analytics(
    posts: list[dict[str, Any]],
    scored_posts: list | None = None,
) -> dict[str, Any]:
    total = len(posts)
    pos = sum(1 for p in posts if p.get("sentiment") == "positive")
    neg = sum(1 for p in posts if p.get("sentiment") == "negative")
    neu = total - pos - neg
    high_heat = sum(1 for p in posts if p.get("engagement", 0) >= HIGH_HEAT_THRESHOLD)

    kw_counter: Counter[str] = Counter()
    for p in posts:
        for hit in extract_topic_keywords(p.get("text") or ""):
            kw_counter[hit] += 1

    top_stocks = build_top_stocks_ranking(scored_posts or [], limit=10)

    top_keywords = []
    for word, count in kw_counter.most_common(20):
        if word in STOPWORDS:
            continue
        top_keywords.append({"word": word, "count": count})
    top_keywords = top_keywords[:15]

    hot_candidates = [p for p in posts if p.get("engagement", 0) >= HIGH_HEAT_THRESHOLD]
    hot_candidates = dedupe_authors_latest(hot_candidates)
    hot_candidates = enrich_posts_profiles(hot_candidates)
    hot_candidates.sort(
        key=lambda x: (x.get("engagement", 0), x.get("timestamp") or 0),
        reverse=True,
    )

    hot_posts = []
    for p in hot_candidates:
        hot_posts.append(
            {
                "author": p.get("author"),
                "authorNickname": p.get("authorNickname") or p.get("author"),
                "authorAvatar": p.get("authorAvatar") or "",
                "authorFollowers": p.get("authorFollowers") or 0,
                "source": p.get("source") or "nnq_feed",
                "excerpt": _excerpt(p.get("text") or ""),
                "engagement": p.get("engagement"),
                "likes": p.get("likes"),
                "comments": p.get("comments"),
                "shares": p.get("shares"),
                "sentiment": p.get("sentiment"),
                "publishedAt": p.get("publishedAt"),
                "link": p.get("link"),
                "relatedStock": (p.get("stocks") or [None])[0],
            }
        )

    return {
        "summary": {
            "totalPosts": total,
            "positiveCount": pos,
            "positivePct": round(pos / total * 100, 1) if total else 0,
            "negativeCount": neg,
            "negativePct": round(neg / total * 100, 1) if total else 0,
            "neutralCount": neu,
            "neutralPct": round(neu / total * 100, 1) if total else 0,
            "highHeatPosts": high_heat,
            "highHeatThreshold": HIGH_HEAT_THRESHOLD,
        },
        "topStocks": top_stocks,
        "topKeywords": top_keywords,
        "highHeatPostsList": hot_posts,
    }


async def futu_login(page, target_url: str, uid: str, pwd: str) -> None:
    await page.goto(
        f"https://passport.futunn.com/?target={quote(target_url, safe='')}&type=login&lang=zh-cn",
        wait_until="domcontentloaded",
        timeout=90000,
    )
    await asyncio.sleep(1.5)
    acc = page.locator('input[name="account"]:visible')
    await acc.fill(uid)
    await acc.press("Enter")
    await asyncio.sleep(2.5)
    pwd_input = page.locator('input[type="password"]:visible')
    if await pwd_input.count():
        await pwd_input.fill(pwd)
        await pwd_input.press("Enter")
    await asyncio.sleep(6)


async def fetch_feed_pages(uid: str, pwd: str, days: int) -> list[dict[str, Any]]:
    target = "https://q.futunn.com/nnq/recommend"
    cutoff = _now_cn() - timedelta(days=days)
    all_items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

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
        await futu_login(page, target, uid, pwd)
        if "nnq" not in page.url:
            await page.goto(target, wait_until="domcontentloaded", timeout=90000)
            await asyncio.sleep(3)

        more_mark = "CgIgAA=="
        sequence = "0"
        stop = False

        for page_idx in range(MAX_PAGES):
            if stop:
                break
            qs = (
                f"type={FEED_TYPE}&num={PAGE_SIZE}&load_list_type=1"
                f"&more_mark={quote(more_mark, safe='')}"
                f"&sequence={quote(sequence, safe='')}"
                f"&refresh_cycle_info=%7B%22cycle_info%22:%22%22,%22refresh_cycle%22:0%7D"
                f"&_={int(time.time() * 1000)}"
            )
            url = f"https://q.futunn.com/nnq/feed-list?{qs}"
            resp = await page.request.get(url)
            if resp.status != 200:
                LOG.warning("feed-list HTTP %s page=%s", resp.status, page_idx)
                break
            data = await resp.json()
            feeds = data.get("feed") or []
            if not feeds:
                break

            oldest_in_batch: datetime | None = None
            for raw in feeds:
                parsed = parse_feed_item(raw)
                if not parsed or not parsed.get("feedId"):
                    continue
                fid = parsed["feedId"]
                if fid in seen_ids:
                    continue
                seen_ids.add(fid)
                all_items.append(parsed)
                pub = _ts_to_dt(parsed.get("timestamp"))
                if pub and (oldest_in_batch is None or pub < oldest_in_batch):
                    oldest_in_batch = pub

            LOG.info("page %s: batch=%s total=%s", page_idx + 1, len(feeds), len(all_items))

            if oldest_in_batch and oldest_in_batch < cutoff:
                stop = True

            if not data.get("has_more"):
                break
            more_mark = str(data.get("more_mark") or more_mark)
            sequence = str(data.get("sequence") or sequence)
            await asyncio.sleep(0.6)

        await browser.close()

    return all_items


def write_output(payload: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


async def run_async() -> dict[str, Any]:
    uid = os.environ.get("FUTU_LOGIN_UID", "").strip()
    pwd = os.environ.get("FUTU_LOGIN_PASSWORD", "").strip()
    if not uid or not pwd:
        raise SystemExit(
            "请设置环境变量 FUTU_LOGIN_UID 与 FUTU_LOGIN_PASSWORD（勿写入仓库）"
        )

    days = DEFAULT_DAYS
    LOG.info("抓取牛牛圈 feed type=%s，近 %s 天…", FEED_TYPE, days)
    raw_nnq = await fetch_feed_pages(uid, pwd, days)
    for p in raw_nnq:
        p.setdefault("source", "nnq_feed")

    sheet_rows: list[dict[str, str]] | None = None
    scrape_targets: list[dict[str, Any]] = []
    try:
        from sheet_ipo_sync import load_sheet_ipo_rows

        sheet_rows = load_sheet_ipo_rows()
        scrape_targets = select_scrape_targets(sheet_rows)
        LOG.info("Sheet 定向抓取目标 %s 只", len(scrape_targets))
    except Exception as exc:
        LOG.warning("上市新股 Sheet 明细拉取失败: %s", exc)

    raw_stock: list[dict[str, Any]] = []
    if scrape_targets and os.environ.get("NNQ_HEAT_SKIP_STOCK_COMMENTS", "").strip().lower() not in (
        "1",
        "true",
        "yes",
    ):
        try:
            raw_stock = await fetch_stock_comments_with_login(
                uid,
                pwd,
                scrape_targets,
                parse_feed_item=parse_feed_item,
                is_official_account=is_official_account,
                classify_sentiment=classify_sentiment,
                futu_login=futu_login,
            )
            LOG.info("个股评论区抓取 %s 条", len(raw_stock))
        except Exception as exc:
            LOG.warning("个股评论区抓取失败: %s", exc)

    merged_raw = merge_post_pools(raw_nnq, raw_stock)
    merged_raw = dedupe_similar_text(merged_raw)
    filtered = filter_posts(merged_raw, days, MIN_ENGAGEMENT)
    before_noise = len(filtered)
    filtered, scored_posts = filter_valid_posts(filtered, window=days)
    analytics = build_analytics(filtered, scored_posts)

    repo = _repo_root()
    ipo_master = load_ipo_master_from_sheet()
    if sheet_rows is None:
        try:
            from sheet_ipo_sync import load_sheet_ipo_rows

            sheet_rows = load_sheet_ipo_rows()
        except Exception as exc:
            LOG.warning("上市新股 Sheet 明细拉取失败，将使用 ipo_master 兜底: %s", exc)
    history = load_history_snapshots(repo)
    v2 = build_nnq_heat_v2(
        filtered,
        analytics,
        days=days,
        history_snapshots=history,
        ipo_master=ipo_master,
        sheet_rows=sheet_rows,
    )

    payload = {
        "updatedAt": _now_cn().isoformat(),
        "source": "https://q.futunn.com/nnq/recommend",
        "filter": {
            "days": days,
            "minEngagement": MIN_ENGAGEMENT,
            "highHeatThreshold": HIGH_HEAT_THRESHOLD,
            "keywords": KEYWORDS,
            "excludedAccounts": OFFICIAL_ACCOUNTS,
            "feedType": FEED_TYPE,
            "section": "牛友交流",
            "heatScoringVersion": "v3",
            "contentPoolVersion": "v1",
            "updateIntervalHours": int(os.environ.get("NNQ_HEAT_UPDATE_HOURS", "6").strip() or "6"),
        },
        **analytics,
        **v2,
        "scrapeTargets": scrape_targets,
        "contentPool": build_pool_stats(
            nnq_count=len(raw_nnq),
            stock_count=len(raw_stock),
            merged_count=len(merged_raw),
            after_clean=len(filtered),
            hot_count=len(analytics.get("highHeatPostsList") or []),
        ),
        "meta": {
            "rawFetched": len(merged_raw),
            "rawNnqFetched": len(raw_nnq),
            "rawStockFetched": len(raw_stock),
            "afterFilter": before_noise,
            "afterNoiseFilter": len(filtered),
            "spamFiltered": before_noise - len(filtered),
            "analyticsVersion": "v2",
            "heatScoringVersion": "v3",
            "sheetMasterCount": len(ipo_master),
            "scrapeTargetCount": len(scrape_targets),
        },
    }
    return payload


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    out = _json_out()
    payload = asyncio.run(run_async())
    write_output(payload, out)
    archive_daily_snapshot(payload, _repo_root())
    s = payload["summary"]
    mi = payload.get("marketInsights") or {}
    ib = mi.get("investorBehavior") or {}
    meta = payload.get("meta") or {}
    top = (payload.get("topStocks") or [{}])[0]
    print(
        f"✓ 已写入 {out.name} · heat v3 · 有效帖 {s['totalPosts']} · "
        f"过滤灌水 {meta.get('spamFiltered', 0)} · "
        f"高热 {s['highHeatPosts']} · 个股 {len(payload.get('stockInsights') or [])} · "
        f"TOP1 {top.get('name', '—')} 热度 {top.get('heatIndex', top.get('engagement', '—'))} · "
        f"申购倾向 {ib.get('bullishSubscribe', {}).get('pct', '—')}%",
        flush=True,
    )


if __name__ == "__main__":
    main()
