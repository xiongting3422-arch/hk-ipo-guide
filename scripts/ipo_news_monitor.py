#!/usr/bin/env python3
"""
IPO 新闻抓取（独立脚本）

主流程：抓取富途牛牛资讯专题「新股、次新股直達快車」列表（无需 Google 服务账号）。
- 默认 URL：news.futunn.com/hk/news-topics/172/stocks-ipo
- 按标题关键词筛选：新股资讯 / IPO / 暗盘 / 上市首日 等
- 时效：近 N 天（默认 10 天，可用 IPO_NEWS_RECENT_DAYS 调整）
- 输出：项目根目录 **ipo_news.json**（供网站「新股资讯 → 香港 IPO」列表读取）

环境变量：
  IPO_NEWS_FUTU_TOPIC_URL  富途专题页（可选，有默认值）
  IPO_NEWS_RECENT_DAYS     保留最近几天（默认 10）
  IPO_NEWS_SHEET_CSV_URL   可选：发布 CSV，仅用于写入 monitoredCodes 元数据

登录：请勿在代码中写账号密码。若专题需登录，请在本机设置 FUTU_LOGIN_UID / FUTU_LOGIN_PASSWORD（可选，实验性）。
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import logging
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

try:
    from playwright.async_api import TimeoutError as PlaywrightTimeout
    from playwright.async_api import async_playwright
except ImportError as e:  # pragma: no cover
    print("缺少 playwright:", e, file=sys.stderr)
    print("请执行: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)

LOG = logging.getLogger("ipo_news")

SHEET_TAB = os.environ.get("IPO_NEWS_LIST_SHEET", "IPO新闻抓取").strip() or "IPO新闻抓取"
RECENT_DAYS = float(os.environ.get("IPO_NEWS_RECENT_DAYS", "10").strip() or "10")
RECENT_HOURS = RECENT_DAYS * 24.0
PUB_CSV_FETCH_TIMEOUT = float(
    os.environ.get("IPO_NEWS_CSV_TIMEOUT", "45").strip() or "45"
)
DEFAULT_FUTU_TOPIC_URL = (
    "https://news.futunn.com/news-topics/172/stocks-ipo?lang=zh-cn"
)
FUTU_TOPIC_TITLE = "新股、次新股直達快車"
FUTU_TOPIC_HREF_RE = re.compile(
    r'href="(https://(?:news\.futunn\.com(?:/hk)?/post/\d+|q\.futunn\.com/feed/\d+)[^"]*)"',
    re.I,
)

IPO_FOCUS_RE = re.compile(
    r"新股首日|新股资讯|新股資訊|暗盘情报|暗盤情報|新股消息|"
    r"新股定价|新股定價|港股\s*IPO\s*月报|港股\s*IPO\s*月報|"
    r"热门\s*IPO|熱門\s*IPO",
    re.I,
)

IPO_TITLE_RE = re.compile(
    r"新股|次新股|"
    r"IPO|"
    r"港股\s*IPO|热门\s*IPO|熱門\s*IPO|"
    r"新股资讯|新股資訊|新股定价|新股定價|新股消息|新股首日|"
    r"暗盘情报|暗盤情報|"
    r"上市首日|暗盘|暗盤|"
    r"招股|聆讯|聆訊|递表|遞表|孖展|配售|超购|超購|"
    r"挂牌|掛牌|申购|申購|基石|破发|破發|"
    r"暗盘交易|暗盤交易|首日表现|首日表現|打新|上市",
    re.I,
)


@dataclass
class Stock:
    name: str
    code: str  # 5 位数字字符串，如 06872


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def save_path() -> Path:
    """项目根目录下的 ipo_news.json（绝对路径）。"""
    return (_repo_root() / "ipo_news.json").resolve()


def _digits_hk_code(raw: str) -> str:
    s = str(raw or "").strip().upper().replace("ＨＫ", "HK")
    s = re.sub(r"\.HK$", "", s, flags=re.I)
    digits = re.sub(r"\D", "", s)
    if not digits:
        return ""
    return digits[-5:].zfill(5)


def _is_header_row(a: str, b: str) -> bool:
    a = (a or "").strip()
    b = (b or "").strip()
    if not a and not b:
        return True
    if re.search(r"名称|股票", a) and re.search(r"代码|代碼|代号", b):
        return True
    if a in ("股票名称", "名称", "A") and b in ("股票代码", "代码", "B"):
        return True
    return False


def _url_bust(url: str) -> str:
    u = url.strip()
    if not u.lower().startswith("http"):
        return u
    ts = str(int(time.time() * 1000))
    sep = "&" if "?" in u.split("#")[0] else "?"
    if "#" in u:
        base, frag = u.split("#", 1)
        bsep = "&" if "?" in base else "?"
        return f"{base}{bsep}t={ts}#{frag}"
    return f"{u}{sep}t={ts}"


def _parse_relative_cn(text: str) -> datetime | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    now = datetime.now()
    c = re.sub(r"\s+", "", raw)
    if any(k in c for k in ("刚刚", "剛剛")):
        return now
    m = re.search(r"(\d+)\s*秒前", raw)
    if m:
        return now - timedelta(seconds=min(int(m.group(1)), 86400))
    m = re.search(r"(\d+)\s*(?:分钟前|分鐘前)", raw)
    if m:
        return now - timedelta(minutes=min(int(m.group(1)), 60 * 24 * 365))
    m = re.search(r"(\d+)\s*(?:小时前|小時前)", raw)
    if m:
        return now - timedelta(hours=min(int(m.group(1)), 24 * 365))
    m = re.search(r"(\d+)\s*天前", raw)
    if m:
        return now - timedelta(days=min(int(m.group(1)), 365))
    if "前天" in c:
        return (now - timedelta(days=2)).replace(
            hour=12, minute=0, second=0, microsecond=0
        )
    if "昨天" in raw or "昨日" in raw:
        return (now - timedelta(days=1)).replace(
            hour=12, minute=0, second=0, microsecond=0
        )
    return None


def _parse_time_fuzzy(text: str) -> datetime | None:
    text = re.sub(r"\s+", " ", str(text or "").strip())
    if not text:
        return None
    rel = _parse_relative_cn(text)
    if rel:
        return rel
    for fmt in (
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M",
    ):
        try:
            return (
                datetime.strptime(text[:19], fmt)
                if len(text) >= 16
                else datetime.strptime(text, fmt)
            )
        except ValueError:
            continue
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})", text)
    if m:
        return datetime(
            int(m.group(1)),
            int(m.group(2)),
            int(m.group(3)),
            int(m.group(4)),
            int(m.group(5)),
        )
    m = re.search(
        r"(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})",
        text,
    )
    if m:
        try:
            return datetime(
                int(m.group(1)),
                int(m.group(2)),
                int(m.group(3)),
                int(m.group(4)),
                int(m.group(5)),
            )
        except ValueError:
            pass
    return None


def _parse_futu_meta(meta: str) -> datetime | None:
    now = datetime.now()
    s = re.sub(r"\s+", "", meta or "")
    m = re.search(r"(\d+)分鐘前", s) or re.search(r"(\d+)分钟前", s)
    if m:
        return now - timedelta(minutes=min(int(m.group(1)), 60 * 24 * 7))
    m = re.search(r"(\d+)小時前", s) or re.search(r"(\d+)小时前", s)
    if m:
        return now - timedelta(hours=min(int(m.group(1)), 24 * 30))
    if "昨天" in s or "昨日" in s:
        return (now - timedelta(days=1)).replace(
            hour=12, minute=0, second=0, microsecond=0
        )
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s)
    if m:
        try:
            return datetime(
                int(m.group(1)), int(m.group(2)), int(m.group(3)), 12, 0
            )
        except ValueError:
            pass
    return None


def code_in_text(code5: str, title: str, link: str) -> bool:
    """标题或链接中须出现该港股代码（5 位、去前导零、整数形式）。"""
    c5 = code5.zfill(5)
    if c5 == "00000":
        return False
    blob = f"{title or ''}{link or ''}"
    b = re.sub(r"\s+", "", blob)
    variants = {c5}
    if c5.isdigit():
        variants.add(str(int(c5, 10)))
        lz = c5.lstrip("0") or c5
        if len(lz) >= 3:
            variants.add(lz)
    for v in variants:
        if v and v in b:
            return True
    return False


def within_recent_hours(pub: datetime, hours: float) -> bool:
    if hours <= 0:
        return True
    return pub >= datetime.now() - timedelta(hours=hours)


def within_recent_days(pub: datetime, days: float) -> bool:
    if days <= 0:
        return True
    return pub >= datetime.now() - timedelta(days=days)


def matches_ipo_keywords(title: str) -> bool:
    t = str(title or "").strip()
    if IPO_FOCUS_RE.search(t):
        return True
    return bool(IPO_TITLE_RE.search(t))


def detect_ipo_theme(title: str) -> str:
    t = str(title or "").strip()
    head = (t.split("|")[0] or t).strip()
    themes = (
        ("first_day", ("新股首日",)),
        ("ipo_news", ("新股资讯", "新股資訊")),
        ("grey_market", ("暗盘情报", "暗盤情報")),
        ("ipo_msg", ("新股消息",)),
        ("pricing", ("新股定价", "新股定價")),
        ("monthly", ("港股IPO月报", "港股IPO月報")),
        ("hot", ("热门IPO", "熱門IPO")),
    )
    for tid, keys in themes:
        for k in keys:
            if k in head or k in t:
                return tid
    return "other"


def parse_futu_list_time(time_str: str, now: datetime | None = None) -> datetime | None:
    """解析专题列表上的时间（可能仅为 HH:MM 或「昨天」等）。"""
    now = now or datetime.now()
    raw = str(time_str or "").strip()
    if not raw:
        return None
    fuzzy = _parse_time_fuzzy(raw) or _parse_relative_cn(raw) or _parse_futu_meta(raw)
    if fuzzy:
        return fuzzy
    m = re.match(r"^(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})$", raw)
    if m:
        mo, d, hh, mm = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        year = now.year
        try:
            pub = datetime(year, mo, d, hh, mm)
            if pub > now + timedelta(days=1):
                pub = pub.replace(year=year - 1)
            return pub
        except ValueError:
            return None
    m = re.match(r"^(\d{1,2}):(\d{2})$", raw)
    if m:
        hh, mm = int(m.group(1)), int(m.group(2))
        try:
            return now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        except ValueError:
            return None
    m = re.match(r"^(\d{1,2})-(\d{1,2})$", raw)
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        try:
            return now.replace(month=mo, day=d, hour=12, minute=0, second=0, microsecond=0)
        except ValueError:
            return None
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", raw)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 12, 0)
        except ValueError:
            return None
    return None


def fetch_futu_topic_html(url: str) -> str:
    bust = _url_bust(url)
    req = Request(
        bust,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "zh-HK,zh-TW,zh-CN;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Cache-Control": "no-cache",
        },
        method="GET",
    )
    with urlopen(req, timeout=PUB_CSV_FETCH_TIMEOUT) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_futu_topic_html(html: str) -> list[dict[str, Any]]:
    """从富途专题页 HTML 解析资讯条目（按 news-item 分块，兼容嵌套结构）。"""
    if not html or len(html) < 800:
        return []
    now = datetime.now()
    out: list[dict[str, Any]] = []
    seen_links: set[str] = set()
    chunks = re.split(r'<div class="news-item list-item"', html, flags=re.I)
    for chunk in chunks[1:]:
        href_m = FUTU_TOPIC_HREF_RE.search(chunk)
        title_m = re.search(
            r'<p class="title[^"]*"[^>]*>\s*([^<]+?)\s*</p>',
            chunk,
            re.I,
        )
        if not href_m or not title_m:
            continue
        href = href_m.group(1).strip().split('"')[0]
        title = re.sub(r"\s+", " ", title_m.group(1)).strip()
        if not title or href in seen_links:
            continue
        seen_links.add(href)
        if not matches_ipo_keywords(title):
            continue
        time_m = re.search(
            r'<span class="time"[^>]*>\s*([^<]+?)\s*</span>',
            chunk,
            re.I,
        )
        source_m = re.search(
            r'<span class="source"[^>]*>\s*([^<]*?)\s*</span>',
            chunk,
            re.I,
        )
        time_txt = time_m.group(1).strip() if time_m else ""
        pub = parse_futu_list_time(time_txt, now)
        if pub and not within_recent_days(pub, RECENT_DAYS):
            continue
        if not pub and not time_txt:
            continue
        media = (
            re.sub(r"\s+", " ", source_m.group(1)).strip()
            if source_m
            else "富途牛牛"
        )
        out.append(
            _item_dict(
                title[:500],
                href,
                pub,
                "futu_ipo_topic",
                FUTU_TOPIC_TITLE,
                media_source=media,
                time_raw=time_txt,
            )
        )
    return out


async def _optional_futu_login(page) -> None:
    """可选登录（凭据仅来自环境变量，勿写入仓库）。"""
    uid = os.environ.get("FUTU_LOGIN_UID", "").strip()
    pwd = os.environ.get("FUTU_LOGIN_PASSWORD", "").strip()
    if not uid or not pwd:
        return
    try:
        await page.goto(
            _url_bust("https://www.futunn.com/hk/login"),
            wait_until="domcontentloaded",
            timeout=45000,
        )
        await asyncio.sleep(2)
        for sel, val in (
            ('input[type="text"], input[name*="account"], input[placeholder*="账号"]', uid),
            ('input[type="password"]', pwd),
        ):
            el = await page.query_selector(sel)
            if el:
                await el.fill(val)
        btn = await page.query_selector(
            'button[type="submit"], .login-btn, button:has-text("登录"), button:has-text("登入")'
        )
        if btn:
            await btn.click()
            await asyncio.sleep(4)
        LOG.info("已尝试使用环境变量账号登录富途（若失败将仍抓取公开页）")
    except Exception as e:
        LOG.warning("富途可选登录失败（继续公开抓取）: %s", e)


async def scrape_futu_ipo_topic_playwright(url: str) -> list[dict[str, Any]]:
    """Playwright 打开专题页、滚动加载更多后解析。"""
    merged: list[dict[str, Any]] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        ctx = await browser.new_context(
            locale="zh-HK",
            viewport={"width": 1365, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        await ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
        )
        page = await ctx.new_page()
        try:
            await _optional_futu_login(page)
            await page.goto(_url_bust(url), wait_until="domcontentloaded", timeout=55000)
            await asyncio.sleep(2.5)
            for _ in range(10):
                await page.evaluate(
                    "window.scrollTo(0, document.body.scrollHeight)"
                )
                await asyncio.sleep(random.uniform(0.9, 1.6))
            html = await page.content()
            merged = parse_futu_topic_html(html)
        finally:
            await page.close()
            await browser.close()
    return merged


async def scrape_futu_ipo_topic(url: str, out_path: Path) -> list[dict[str, Any]]:
    """HTTP + Playwright 合并抓取富途 IPO 专题。"""
    all_items: list[dict[str, Any]] = []
    print(f"正在抓取富途专题「{FUTU_TOPIC_TITLE}」…", flush=True)
    try:
        html = fetch_futu_topic_html(url)
        http_items = parse_futu_topic_html(html)
        all_items.extend(http_items)
        print(f"  HTTP 解析: {len(http_items)} 条（关键词+近{int(RECENT_DAYS)}天）", flush=True)
        if all_items:
            write_json_dump(out_path, _dedupe_items(all_items), [], url)
    except (HTTPError, URLError, OSError) as e:
        print(f"  HTTP 拉取失败: {e}", flush=True)
    try:
        pw_items = await scrape_futu_ipo_topic_playwright(url)
        all_items.extend(pw_items)
        print(f"  Playwright 解析: {len(pw_items)} 条", flush=True)
    except Exception as e:
        print(f"  Playwright 失败: {e}", flush=True)
        LOG.exception("Playwright 专题抓取异常")
    deduped = _dedupe_items(all_items)
    if deduped:
        write_json_dump(out_path, deduped, [], url)
    return deduped


def _pub_csv_url_with_bust(url: str) -> str:
    """在 CSV 导出 URL 上附加时间戳，降低 CDN/代理缓存。"""
    u = url.strip()
    if not u:
        return u
    ts = str(int(time.time() * 1000))
    sep = "&" if "?" in u.split("#")[0] else "?"
    if "#" in u:
        base, frag = u.split("#", 1)
        bsep = "&" if "?" in base else "?"
        return f"{base}{bsep}_t={ts}#{frag}"
    return f"{u}{sep}_t={ts}"


def _fetch_pub_csv_text(url: str) -> str:
    bust = _pub_csv_url_with_bust(url)
    req = Request(
        bust,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/csv,application/csv,text/plain,*/*",
            "Cache-Control": "no-cache",
        },
        method="GET",
    )
    with urlopen(req, timeout=PUB_CSV_FETCH_TIMEOUT) as resp:
        raw = resp.read()
    return raw.decode("utf-8-sig", errors="replace")


def read_stocks_from_pub_csv() -> list[Stock]:
    """
    从「发布到网络」的 CSV 链接读取标的：第 0 列=A 名称，第 1 列=B 代码。
    需在 Google 表格中对目标工作表启用：文件 → 共享 → 发布到网络 → 发布，并复制 CSV 链接。
    """
    url = os.environ.get("IPO_NEWS_SHEET_CSV_URL", "").strip()
    if not url:
        raise ValueError(
            "请设置环境变量 IPO_NEWS_SHEET_CSV_URL 为表格的 CSV 发布链接 "
            '（格式含 .../pub?gid=...&single=true&output=csv）'
        )
    if "output=csv" not in url.lower() and "/pub" not in url.lower():
        LOG.warning(
            "CSV URL 可能不是标准「发布」导出链接，若失败请检查是否含 pub 与 output=csv"
        )
    try:
        text = _fetch_pub_csv_text(url)
    except HTTPError as e:
        raise RuntimeError(
            f"拉取 CSV 失败：HTTP {e.code} {e.reason}。"
            "请确认已在 Google 表格中「发布到网络」该工作表，且使用当前有效的发布链接。"
        ) from e
    except URLError as e:
        raise RuntimeError(f"拉取 CSV 网络错误: {e}") from e
    except OSError as e:
        raise RuntimeError(f"拉取 CSV 失败: {e}") from e

    if not text.strip():
        raise RuntimeError("CSV 内容为空；请检查发布链接中的 gid 是否对应「IPO新闻抓取」工作表。")

    reader = csv.reader(io.StringIO(text))
    out: list[Stock] = []
    seen: set[str] = set()
    for i, row in enumerate(reader):
        a = row[0].strip() if len(row) > 0 else ""
        b = row[1].strip() if len(row) > 1 else ""
        if i == 0 and _is_header_row(a, b):
            continue
        if not a or not b:
            continue
        code = _digits_hk_code(b)
        if not code or code == "00000":
            continue
        if code in seen:
            continue
        seen.add(code)
        out.append(Stock(name=a, code=code))
    return out


def _item_dict(
    title: str,
    link: str,
    published_at: datetime | None,
    source: str,
    stock_name: str,
    media_source: str = "",
    time_raw: str = "",
) -> dict[str, Any]:
    raw = (time_raw or "").strip()
    if published_at:
        t = published_at.strftime("%Y-%m-%d %H:%M")
    else:
        t = raw or ""
    media = (media_source or "").strip()
    obj: dict[str, Any] = {
        "stock_name": stock_name,
        "title": title[:500],
        "time": t,
        "source_platform": source,
        "link": link,
        "publishedAt": t,
        "source": media or source,
        "stock": stock_name,
        "theme": detect_ipo_theme(title),
    }
    if raw:
        obj["time_raw"] = raw
    if published_at:
        obj["ts"] = int(published_at.timestamp() * 1000)
    if media:
        obj["media_source"] = media
    return obj


async def scrape_zhitong(page, stock: Stock) -> list[dict[str, Any]]:
    """智通财经：用股票名称搜索新闻。"""
    items: list[dict[str, Any]] = []
    kw = quote(stock.name)
    urls = [
        f"https://www.zhitongcaijing.com/search?page=1&type=news&keyword={kw}",
        f"https://www.zhitongcaijing.com/search.html?keyword={kw}",
    ]
    for url in urls:
        try:
            await page.goto(_url_bust(url), wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(random.uniform(1.2, 2.2))
            try:
                await page.evaluate(
                    "window.scrollTo(0, Math.min(1400, document.body.scrollHeight))"
                )
            except Exception:
                pass
            links = await page.query_selector_all(
                'a[href*="/content/"], a[href*="/detail/"], a[href*="/article/"]'
            )
            seen: set[str] = set()
            for a in links[:50]:
                href = (await a.get_attribute("href") or "").strip()
                title = (await a.inner_text() or "").strip()
                if not href or len(title) < 6:
                    continue
                if href in seen:
                    continue
                seen.add(href)
                if not href.startswith("http"):
                    href = "https://www.zhitongcaijing.com" + (
                        href if href.startswith("/") else "/" + href
                    )
                if not code_in_text(stock.code, title, href):
                    continue
                time_text = ""
                try:
                    time_text = await a.evaluate(
                        """el => {
                          const root = el.closest('li,article,.item,.news-item,.news-list-item') || el.parentElement;
                          if (!root) return '';
                          const t = root.querySelector('time,.time,.date,.news-time');
                          return t ? (t.innerText || t.textContent || '').trim() : '';
                        }"""
                    )
                except Exception:
                    pass
                pub = _parse_time_fuzzy(time_text) or _parse_relative_cn(time_text)
                if not pub:
                    continue
                if not within_recent_hours(pub, RECENT_HOURS):
                    continue
                items.append(
                    _item_dict(
                        title.split("\n")[0],
                        href,
                        pub,
                        "zhitong",
                        stock.name,
                    )
                )
            if items:
                break
        except (PlaywrightTimeout, Exception) as e:
            LOG.debug("zhitong %s: %s", url, e)
    return items


async def scrape_futu(page, stock: Stock) -> list[dict[str, Any]]:
    """
    富途牛牛：优先用股票名称搜资讯；若无列表再打开个股资讯页（仍只保留标题/链接含代码的条目）。
    """
    items: list[dict[str, Any]] = []
    name_q = quote(stock.name)
    code5 = stock.code.zfill(5)
    urls = [
        f"https://www.futunn.com/hk/search/news?keyword={name_q}",
        f"https://www.futunn.com/hk/stock/{code5}/news",
        f"https://www.futunn.com/hk/stock/{code5}-HK/news",
    ]
    for url in urls:
        try:
            await page.goto(_url_bust(url), wait_until="domcontentloaded", timeout=50000)
            await asyncio.sleep(random.uniform(1.5, 2.5))
            root = await page.query_selector(
                ".news-list, [class*='news-list'], [class*='NewsList'], .search-result, [class*='search']"
            )
            rows = []
            if root:
                rows = await root.query_selector_all("a, .news-item, li, .item")
            if not rows:
                rows = await page.query_selector_all(
                    ".news-list a, li.news-item a, [class*='news'] a[href*='news.futunn.com'], a[href*='news.futunn.com']"
                )
            seen: set[str] = set()
            for row in rows[:45]:
                tag = await row.evaluate("el => el.tagName")
                link_el = row if tag and str(tag).upper() == "A" else await row.query_selector("a")
                if not link_el:
                    continue
                href = (await link_el.get_attribute("href") or "").strip()
                title = (await link_el.inner_text() or "").strip().split("\n")[0]
                if not href or len(title) < 4:
                    continue
                if "news.futunn.com" not in href and "/news/" not in href.lower():
                    continue
                if not href.startswith("http"):
                    href = "https://www.futunn.com" + (
                        href if href.startswith("/") else "/" + href
                    )
                if href in seen:
                    continue
                seen.add(href)
                if not code_in_text(stock.code, title, href):
                    continue
                time_text = ""
                t_el = await row.query_selector(".time, .date, time, [class*='time'], .news-meta")
                if t_el:
                    time_text = (await t_el.inner_text() or "").strip()
                pub = _parse_time_fuzzy(time_text) or _parse_futu_meta(time_text)
                if not pub:
                    continue
                if not within_recent_hours(pub, RECENT_HOURS):
                    continue
                items.append(_item_dict(title[:500], href, pub, "futu", stock.name))
            if items:
                break
        except (PlaywrightTimeout, Exception) as e:
            LOG.debug("futu %s: %s", url, e)
    return items


async def scrape_one_stock(page, stock: Stock) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    merged.extend(await scrape_zhitong(page, stock))
    await asyncio.sleep(random.uniform(0.8, 1.8))
    merged.extend(await scrape_futu(page, stock))
    return merged


def _item_sort_key(it: dict[str, Any]) -> datetime:
    ts_ms = it.get("ts")
    if isinstance(ts_ms, (int, float)) and ts_ms > 0:
        return datetime.fromtimestamp(ts_ms / 1000)
    raw = str(it.get("time_raw") or it.get("time") or it.get("publishedAt") or "")
    return _parse_time_fuzzy(raw) or parse_futu_list_time(raw) or datetime.min


def _dedupe_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for it in items:
        k = (str(it.get("title", "")).strip().lower(), str(it.get("link", "")).strip())
        if not k[0] or not k[1] or k in seen:
            continue
        seen.add(k)
        out.append(it)
    out.sort(key=_item_sort_key, reverse=True)
    return out


async def run_all(
    stocks: list[Stock],
    out_path: Path,
) -> list[dict[str, Any]]:
    all_items: list[dict[str, Any]] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        ctx = await browser.new_context(
            locale="zh-CN",
            viewport={"width": 1365, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        await ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
        )
        try:
            for st in stocks:
                print(f"正在抓取 [{st.name}] ({st.code})...", end=" ", flush=True)
                page = await ctx.new_page()
                try:
                    batch = await scrape_one_stock(page, st)
                    all_items.extend(batch)
                    print(f"成功（{len(batch)} 条）", flush=True)
                    if all_items:
                        write_json_dump(out_path, _dedupe_items(all_items), stocks)
                except Exception as e:
                    print(f"失败（{e}）", flush=True)
                    LOG.exception("抓取 %s 异常", st.name)
                finally:
                    await page.close()
                if len(stocks) > 1:
                    await asyncio.sleep(random.uniform(2.0, 5.0))
        finally:
            await browser.close()
    return _dedupe_items(all_items)


def delete_old_json(path: Path) -> None:
    if path.is_file():
        path.unlink()
        print(f"已删除旧文件: {path}", flush=True)


def _build_payload(
    items: list[dict[str, Any]],
    stocks: list[Stock],
    topic_url: str = "",
) -> dict[str, Any]:
    age_days = max(1, int(RECENT_DAYS))
    return {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "feed": "futu_ipo_topic_v1",
        "scheduleSheet": SHEET_TAB,
        "dataSource": "futu_news_topic",
        "topicTitle": FUTU_TOPIC_TITLE,
        "topicUrl": topic_url,
        "recentDays": RECENT_DAYS,
        "recentHours": RECENT_HOURS,
        "maxNewsAgeDays": age_days,
        "skipMonitoredFilter": True,
        "preferScheduleOnly": False,
        "monitoredCodes": [s.code for s in stocks],
        "stocksInWindow": [
            {"name": s.name, "code": s.code, "sheetRow": i + 1}
            for i, s in enumerate(stocks)
        ],
        "items": items,
    }


def write_json_dump(
    path: Path,
    items: list[dict[str, Any]],
    stocks: list[Stock],
    topic_url: str = "",
) -> None:
    """使用 json.dump 立即写入磁盘（项目根目录 ipo_news.json）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _build_payload(items, stocks, topic_url)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass
    LOG.info("已写入 %s，共 %d 条", path, len(items))
    print(f"[写入] {path} ，当前条目数: {len(items)}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="抓取富途「新股、次新股直達快車」专题 → 项目根目录 ipo_news.json"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="兼容旧参数：与本脚本行为一致，无额外效果",
    )
    parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    out_path = save_path()
    topic_url = os.environ.get("IPO_NEWS_FUTU_TOPIC_URL", DEFAULT_FUTU_TOPIC_URL).strip()
    print(f"输出文件（项目根目录）: {out_path}", flush=True)
    print(f"富途专题: {topic_url}", flush=True)
    print(f"时效窗口: 近 {int(RECENT_DAYS)} 天 · 关键词筛选 IPO/新股/暗盘 等", flush=True)

    stocks: list[Stock] = []
    csv_url = os.environ.get("IPO_NEWS_SHEET_CSV_URL", "").strip()
    if csv_url:
        try:
            stocks = read_stocks_from_pub_csv()
            print(f"（可选）CSV 标的元数据: {len(stocks)} 个", flush=True)
        except Exception as e:
            print(f"（可选）CSV 读取跳过: {e}", flush=True)

    delete_old_json(out_path)

    items = asyncio.run(scrape_futu_ipo_topic(topic_url, out_path))
    write_json_dump(out_path, items, stocks, topic_url)
    print(f"完成。输出: {out_path} ，条目数: {len(items)}", flush=True)


if __name__ == "__main__":
    main()
