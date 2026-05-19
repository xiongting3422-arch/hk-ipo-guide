#!/usr/bin/env python3
"""
新股资讯限额监控：读 Google Sheets「打新时间表」Tab **自上而下前 20 支**有效名称+代码 →
抓取源（顺序）：**智通财经** → **阿思达克 AASTOCKS** → **富途牛牛**（urllib HTML 优先，不足再 Playwright）。
反爬：每只股票抓取结束后随机休眠 **10–20 秒**；每 **5** 只股票强制休眠 **120 秒**。
输出：`ipo_news.json`，条目按发布时间 **降序**；可选环境变量开启门户列表兜底（见 README）。

环境变量：GOOGLE_APPLICATION_CREDENTIALS、IPO_NEWS_SPREADSHEET_ID、
IPO_NEWS_BACKUP_AND_CLEAR_JSON（默认 1：抓取前备份并删除旧 ipo_news.json；设 0 跳过）、
IPO_NEWS_RECENT_HOURS（默认 24：只保留该时间内的资讯；设 0 则改用语义较宽的 IPO_NEWS_MAX_AGE_DAYS 裁剪）
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urljoin

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError as e:  # pragma: no cover
    print("Missing dependency:", e, file=sys.stderr)
    print("Run: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

try:
    from playwright.async_api import TimeoutError as PlaywrightTimeout
    from playwright.async_api import async_playwright
except ImportError as e:  # pragma: no cover
    print("Missing playwright:", e, file=sys.stderr)
    sys.exit(1)

LOG = logging.getLogger("ipo_news_monitor")

# --- 配置（可用环境变量覆盖）---
MAX_SCHEDULE_STOCKS = int(os.environ.get("IPO_NEWS_MAX_SCHEDULE_STOCKS", "20").strip() or "20")
MAX_JSON_ITEMS = int(os.environ.get("IPO_NEWS_JSON_MAX_ITEMS", "200").strip() or "200")
MAX_NEWS_AGE_DAYS = int(os.environ.get("IPO_NEWS_MAX_AGE_DAYS", "120").strip() or "120")
_rh_raw = os.environ.get("IPO_NEWS_RECENT_HOURS", "24").strip()
RECENT_HOURS = float(_rh_raw) if _rh_raw else 24.0
# 无可靠发布时间时用于占位，随后由「最近 N 小时」过滤剔除
UNKNOWN_PUBLISHED_AT = datetime(1970, 1, 1)
_TITLE_FILTER_ON = os.environ.get("IPO_NEWS_TITLE_FILTER", "0").strip() == "1"
# 主流程新增条数低于此值时，抓取门户 IPO 列表页并用宽松名称匹配补全（0=关闭）
_AGGREGATE_MIN = int(os.environ.get("IPO_NEWS_AGGREGATE_MIN", "8").strip() or "8")
_RELAX_PREFIX_MAX = int(os.environ.get("IPO_NEWS_RELAX_PREFIX_MAX", "4").strip() or "4")
# 为 1 时不合并磁盘上已有 ipo_news.json 条目，仅保留本轮抓取（列表更「新」，但会丢失跨次去重前的历史）
_IGNORE_EXISTING_JSON = os.environ.get("IPO_NEWS_IGNORE_EXISTING_JSON", "0").strip() == "1"

USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
]


def _pick_user_agent() -> str:
    """优先 fake-useragent，失败则回退内置列表。"""
    try:
        from fake_useragent import UserAgent

        return str(UserAgent().random)
    except Exception:
        return random.choice(USER_AGENTS)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _json_out_path() -> Path:
    raw = os.environ.get("IPO_NEWS_JSON_OUT", "").strip()
    return Path(raw) if raw else _repo_root() / "ipo_news.json"


def backup_and_remove_json_out() -> None:
    """抓取开始前：备份既有 ipo_news.json 并删除，保证本次输出为全新数据。
    设 IPO_NEWS_BACKUP_AND_CLEAR_JSON=0 可跳过。"""
    if os.environ.get("IPO_NEWS_BACKUP_AND_CLEAR_JSON", "1").strip() == "0":
        LOG.info("IPO_NEWS_BACKUP_AND_CLEAR_JSON=0：跳过备份/清空 JSON")
        return
    path = _json_out_path()
    path = path.resolve()
    if not path.is_file():
        LOG.info("无既有 %s，跳过备份/清空", path.name)
        return
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = path.with_name(f"{path.stem}.bak.{ts}{path.suffix}")
    shutil.copy2(path, bak)
    path.unlink()
    msg = f"已备份旧 JSON → {bak.name}，已删除 {path.name}，开始全新抓取。"
    print(msg)
    LOG.info(msg)


def _norm_header(s: str) -> str:
    return re.sub(r"\s+", "", str(s or "").strip().lower())


def _row_dict(headers: list[str], row: list[str]) -> dict[str, str]:
    d: dict[str, str] = {}
    for i, h in enumerate(headers):
        key = str(h or "").strip()
        if not key:
            continue
        d[key] = str(row[i]).strip() if i < len(row) else ""
    return d


def _digits_to_hk_code(raw: str) -> str:
    s = str(raw or "").strip().upper().replace("ＨＫ", "HK")
    s = re.sub(r"\.HK$", "", s, flags=re.I)
    digits = re.sub(r"\D", "", s)
    if not digits:
        return ""
    return digits[-5:].zfill(5)


def _extract_name(rd: dict[str, str]) -> str:
    for key in (
        "股票名称",
        "名称",
        "IPO名称",
        "股票名",
        "公司全称",
        "公司名称",
        "公司名",
        "申购名称",
        "股票简称",
        "证券简称",
        "简称",
        "中文名称",
        "name",
    ):
        for k, v in rd.items():
            if _norm_header(key) in _norm_header(k) and v:
                return str(v).strip()
    return ""


def _extract_code(rd: dict[str, str]) -> str:
    raw = ""
    for key in (
        "股票代码",
        "代码",
        "代号",
        "上市代号",
        "证券代码",
        "股份代号",
        "申购代码",
        "配售代号",
        "code",
        "ticker",
    ):
        for k, v in rd.items():
            if _norm_header(key) in _norm_header(k) and v:
                raw = str(v).strip()
                break
        if raw:
            break
    return _digits_to_hk_code(raw)


def _score_header_row(row: list[str]) -> int:
    score = 0
    for c in row:
        s = _norm_header(str(c))
        if not s:
            continue
        if any(
            x in s
            for x in (
                "名称",
                "代码",
                "代号",
                "股票",
                "公司",
                "证券",
                "简称",
                "stock",
                "code",
                "ticker",
            )
        ):
            score += 1
    return score


def _find_header_row_index(rows: list[list[str]]) -> int:
    if not rows:
        return 0
    best_i = 0
    best_sc = _score_header_row(rows[0])
    for i in range(1, min(16, len(rows))):
        sc = _score_header_row(rows[i])
        if sc > best_sc:
            best_sc = sc
            best_i = i
    return best_i


def _col_idx_0based(env_key: str) -> int | None:
    raw = os.environ.get(env_key, "").strip()
    if not raw or raw == "0":
        return None
    try:
        n = int(raw)
    except ValueError:
        return None
    if n <= 0:
        return None
    return n - 1


@dataclass
class StockRow:
    """打新时间表自上而下取样的标的（仅名称+代码+行序）。"""

    name: str
    code: str
    sheet_order: int


@dataclass
class NewsItem:
    title: str
    link: str
    published_at: datetime
    source: str
    stock: str

    def key(self) -> tuple[str, str]:
        return (self.title.strip().lower(), self.link.strip())

    def to_sheet_row(self) -> list[str]:
        t = self.published_at.strftime("%Y-%m-%d %H:%M")
        return [self.title, self.link, t, self.source, self.stock]

    def to_json_obj(self) -> dict[str, Any]:
        t = self.published_at.strftime("%Y-%m-%d %H:%M")
        return {
            "stock_name": self.stock,
            "title": self.title,
            "time": t,
            "source_platform": self.source,
            "link": self.link,
            "publishedAt": t,
            "source": self.source,
            "stock": self.stock,
        }


def read_schedule_stocks() -> list[StockRow]:
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    sheet_id = os.environ.get("IPO_NEWS_SPREADSHEET_ID", "").strip()
    if not cred_path or not Path(cred_path).is_file():
        raise SystemExit("Set GOOGLE_APPLICATION_CREDENTIALS to a valid service account JSON path.")
    if not sheet_id:
        raise SystemExit("Set IPO_NEWS_SPREADSHEET_ID to your Google Spreadsheet ID.")

    ws_name = os.environ.get("IPO_SCHEDULE_SHEET", "打新时间表").strip() or "打新时间表"
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_file(cred_path, scopes=scopes)
    gc = gspread.authorize(creds)
    ws = gc.open_by_key(sheet_id).worksheet(ws_name)
    rows = ws.get_all_values()
    if not rows:
        LOG.warning("工作表「%s」无数据", ws_name)
        return []
    hi = _find_header_row_index(rows)
    if hi > 0:
        LOG.info("「%s」检测到表头在第 %d 行（0 起算为第 %d 行）", ws_name, hi + 1, hi)
    headers = [str(h or "").strip() for h in rows[hi]]
    data_rows = rows[hi + 1 :]

    ic_name = _col_idx_0based("IPO_SCHEDULE_COL_NAME")
    ic_code = _col_idx_0based("IPO_SCHEDULE_COL_CODE")

    out: list[StockRow] = []
    seen_code: set[str] = set()
    for offset, row in enumerate(data_rows):
        idx = hi + 2 + offset
        if ic_name is not None and ic_code is not None:
            name = row[ic_name].strip() if ic_name < len(row) else ""
            code = _digits_to_hk_code(row[ic_code] if ic_code < len(row) else "")
        else:
            rd = _row_dict(headers, row)
            name = _extract_name(rd)
            code = _extract_code(rd)
        if not name or not code:
            continue
        if code in seen_code:
            continue
        seen_code.add(code)
        out.append(StockRow(name=name, code=code, sheet_order=idx))
        if len(out) >= MAX_SCHEDULE_STOCKS:
            break

    if out:
        LOG.info(
            "「%s」自上而下取前 %d 支（上限 %d）: %s",
            ws_name,
            len(out),
            MAX_SCHEDULE_STOCKS,
            [(o.name, o.code) for o in out],
        )
    else:
        LOG.warning(
            "「%s」未解析到名称+代码。请检查表头/列名，或设置环境变量 IPO_SCHEDULE_COL_NAME、IPO_SCHEDULE_COL_CODE 为「名称列、代码列」的 1-based 列号（如 2 和 3）。",
            ws_name,
        )
    return out


def _parse_relative_time_cn(text: str) -> datetime | None:
    """解析简/繁中文相对发布时间（列表页常见）。"""
    raw = str(text or "").strip()
    if not raw:
        return None
    now = datetime.now()
    compact = re.sub(r"\s+", "", raw)
    if any(k in compact for k in ("刚刚", "剛剛")):
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
    if "前天" in compact:
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
    rel = _parse_relative_time_cn(text)
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
        r"(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})",
        text,
    )
    if m:
        d, mo, y, hh, mm = (
            int(m.group(1)),
            int(m.group(2)),
            int(m.group(3)),
            int(m.group(4)),
            int(m.group(5)),
        )
        try:
            return datetime(y, mo, d, hh, mm)
        except ValueError:
            pass
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})", text)
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


def title_matches_stock(name: str, code: str, title: str) -> bool:
    t = re.sub(r"\s+", "", str(title or ""))
    if not t:
        return False
    c5 = code.zfill(5)
    c_int = str(int(c5)) if c5.isdigit() else c5
    for c in (c5, c_int, c5.lstrip("0") or c5):
        if c and c in t:
            return True
    n = str(name or "").strip()
    if len(n) >= 2:
        nn = re.sub(r"\s+", "", n)
        if nn and nn in t:
            return True
        if n in str(title):
            return True
    for part in re.split(r"[\s（）()·]+", n):
        p = part.strip()
        if len(p) >= 2 and p in str(title):
            return True
    return False


def article_matches_stock(name: str, code: str, title: str, link: str) -> bool:
    """标题或链接中出现股票名称 / 五位或去零代码，即视为与该标的相关。"""
    if title_matches_stock(name, code, title):
        return True
    c5 = code.zfill(5)
    ci = str(int(c5)) if c5.isdigit() else c5
    blob = f"{link or ''}{title or ''}"
    b = re.sub(r"\s+", "", blob)
    for c in (c5, ci, (c5.lstrip("0") or c5)):
        if c and len(c) >= 3 and c in b:
            return True
    return False


def article_matches_stock_relaxed(name: str, code: str, title: str, link: str) -> bool:
    """门户列表兜底：在严格匹配基础上，允许「简称/前缀」命中（如 翼菲科技 → 翼菲）。"""
    if article_matches_stock(name, code, title, link):
        return True
    compact = re.sub(r"[\s\-·•]", "", str(name or ""))
    if len(compact) < 3:
        return False
    blob = f"{link or ''}{title or ''}"
    tc = re.sub(r"\s+", "", blob)
    upper = max(2, min(_RELAX_PREFIX_MAX, len(compact) - 1))
    for L in range(upper, 1, -1):
        pref = compact[:L]
        if len(pref) >= 2 and pref in tc:
            return True
    return False


def keep_within_recent_hours(items: list[NewsItem], hours: float) -> list[NewsItem]:
    """只保留 published_at 在「当前时间 − hours」之后的条目（与 naive datetime 一致）。"""
    if hours <= 0:
        return list(items)
    cutoff = datetime.now() - timedelta(hours=hours)
    return [it for it in items if it.published_at >= cutoff]


def _url_with_request_ts(url: str) -> str:
    """在抓取 GET URL 后附加 t=毫秒时间戳，降低缓存导致列表/时间陈旧。"""
    u = str(url or "").strip()
    if not u.lower().startswith("http"):
        return u
    ts = str(int(time.time() * 1000))
    if "#" in u:
        base, frag = u.split("#", 1)
        sep = "&" if "?" in base else "?"
        return f"{base}{sep}t={ts}#{frag}"
    sep = "&" if "?" in u else "?"
    return f"{u}{sep}t={ts}"


def filter_cap_sort(
    items: list[NewsItem], name: str, code: str, cap: int
) -> list[NewsItem]:
    if _TITLE_FILTER_ON:
        filtered = [it for it in items if title_matches_stock(name, code, it.title)]
    else:
        filtered = [it for it in items if article_matches_stock(name, code, it.title, it.link)]
    filtered.sort(key=lambda x: x.published_at, reverse=True)
    filtered = keep_within_recent_hours(filtered, RECENT_HOURS)
    return filtered[:cap]


def prune_by_age(items: list[NewsItem]) -> list[NewsItem]:
    """丢弃过久条目；无可靠年份的条目保留。"""
    cutoff = datetime.now() - timedelta(days=max(30, MAX_NEWS_AGE_DAYS))
    out: list[NewsItem] = []
    for it in items:
        if it.published_at.year < 1990:
            out.append(it)
        elif it.published_at >= cutoff:
            out.append(it)
    return out


def _http_get(
    url: str, timeout: float = 24.0, extra_headers: dict[str, str] | None = None
) -> str:
    hdr = {
        "User-Agent": _pick_user_agent(),
        "Accept-Language": "zh-CN,zh-HK;q=0.9,zh-TW;q=0.8,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "no-cache",
    }
    if extra_headers:
        hdr.update(extra_headers)
    bust = _url_with_request_ts(url)
    req = urllib.request.Request(bust, headers=hdr, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def _parse_futu_meta_time(meta_inner: str) -> datetime:
    """解析富途 news-meta 内相对时间 / 简短日期。无法解析时返回 UNKNOWN，避免误用「当前整点」。"""
    now = datetime.now()
    s = re.sub(r"\s+", "", meta_inner)
    m = re.search(r"(\d+)分鐘前", s) or re.search(r"(\d+)分钟前", s)
    if m:
        return now - timedelta(minutes=min(int(m.group(1)), 60 * 24 * 7))
    m = re.search(r"(\d+)小時前", s) or re.search(r"(\d+)小时前", s)
    if m:
        return now - timedelta(hours=min(int(m.group(1)), 24 * 30))
    m = re.search(r"(\d+)天前", meta_inner)
    if m:
        return now - timedelta(days=min(int(m.group(1)), 365))
    if "昨天" in s or "昨日" in s:
        return (now - timedelta(days=1)).replace(
            hour=12, minute=0, second=0, microsecond=0
        )
    if "前天" in s:
        return (now - timedelta(days=2)).replace(
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
    m = re.search(r"(\d{1,2})月(\d{1,2})日", s)
    if m:
        try:
            mo, d = int(m.group(1)), int(m.group(2))
            return now.replace(month=mo, day=d, hour=12, minute=0, second=0, microsecond=0)
        except ValueError:
            pass
    return UNKNOWN_PUBLISHED_AT


def scrape_futu_http(stock: StockRow) -> list[NewsItem]:
    """不依赖 Playwright：拉取富途个股资讯页 HTML 并解析（无头环境常比浏览器自动化更稳）。"""
    items: list[NewsItem] = []
    code5 = stock.code.zfill(5)
    urls = [
        f"https://www.futunn.com/hk/stock/{code5}-HK/news",
        f"https://www.futunn.com/hk/stock/{code5}/news",
        f"https://www.futunn.com/stock/{code5}-HK/news",
    ]
    block = re.compile(
        r'<li class="news-item"[^>]*>\s*<a href="(https://news\.futunn\.com/hk/post/\d+[^"]*)"[^>]*>'
        r'<p class="news-title[^"]*"[^>]*>([^<]+)</p>[\s\S]*?'
        r'<p class="news-meta"[^>]*>([\s\S]*?)</p>\s*</a></li>',
        re.I,
    )
    for url in urls:
        try:
            html = _http_get(url)
        except (urllib.error.URLError, OSError, ValueError) as e:
            LOG.debug("futu_http url=%s err=%s", url, e)
            continue
        for href, title, meta in block.findall(html)[:40]:
            title = re.sub(r"\s+", " ", title).strip()
            href = href.strip().split('"')[0]
            if not title or not href:
                continue
            pub = _parse_futu_meta_time(meta)
            items.append(
                NewsItem(
                    title=title[:500],
                    link=href,
                    published_at=pub,
                    source="futu_http",
                    stock=stock.name,
                )
            )
        if items:
            LOG.info("futu_http %s(%s): %d 条", stock.name, code5, len(items))
            break
    return items


def scrape_etnet_http(stock: StockRow) -> list[NewsItem]:
    """不依赖 Playwright：拉取经济通个股新闻列表 HTML。"""
    items: list[NewsItem] = []
    code5 = stock.code.zfill(5)
    base = "https://www.etnet.com.hk"
    for lang in ("tc", "sc"):
        list_url = f"{base}/www/{lang}/stocks/realtime/quote_news.php?code={code5}"
        try:
            html = _http_get(list_url)
        except (urllib.error.URLError, OSError, ValueError) as e:
            LOG.debug("etnet_http lang=%s err=%s", lang, e)
            continue
        pairs = re.findall(
            r'href="([^"]*quote_news_detail\.php[^"]*)"[^>]*>([^<]{4,500})</a>',
            html,
            re.I,
        )
        seen: set[str] = set()
        for href_raw, title in pairs[:50]:
            title = re.sub(r"[\xa0&nbsp;]+", " ", title, flags=re.I)
            title = re.sub(r"\s+", " ", title).strip()
            href = href_raw.replace("&amp;", "&")
            if not title or href in seen:
                continue
            seen.add(href)
            if not href.startswith("http"):
                href = urljoin(list_url, href)
            pub: datetime | None = None
            m = re.search(r"newsid=(\d{8})", href, re.I)
            if m:
                try:
                    pub = datetime.strptime(m.group(1), "%Y%m%d")
                except ValueError:
                    pub = None
            if not pub:
                pub = UNKNOWN_PUBLISHED_AT
            items.append(
                NewsItem(
                    title=title[:500],
                    link=href,
                    published_at=pub,
                    source="etnet_http",
                    stock=stock.name,
                )
            )
        if items:
            LOG.info("etnet_http %s(%s): %d 条", stock.name, code5, len(items))
            break
    return items


async def scrape_futu(page, stock: StockRow) -> list[NewsItem]:
    items: list[NewsItem] = []
    code5 = stock.code.zfill(5)
    urls = [
        f"https://www.futunn.com/hk/stock/{code5}/news",
        f"https://www.futunn.com/hk/stock/{code5}-HK/news",
        f"https://www.futunn.com/stock/{code5}-HK/news",
    ]
    for url in urls:
        try:
            await page.goto(_url_with_request_ts(url), wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(2)
            root = await page.query_selector(
                ".news-list, [class*='news-list'], [class*='NewsList']"
            )
            if not root:
                continue
            rows = await root.query_selector_all("a, .news-item, li, .item")
            for row in rows[:40]:
                tag = await row.evaluate("el => el.tagName")
                link_el = row if tag and str(tag).upper() == "A" else await row.query_selector("a")
                if not link_el:
                    continue
                href = await link_el.get_attribute("href") or ""
                title = (await link_el.inner_text() or "").strip().split("\n")[0]
                if not href or not title:
                    continue
                if not href.startswith("http"):
                    href = "https://www.futunn.com" + (
                        href if href.startswith("/") else "/" + href
                    )
                time_text = ""
                t_el = await row.query_selector(".time, .date, time, [class*='time']")
                if t_el:
                    time_text = (await t_el.inner_text() or "").strip()
                pub = _parse_time_fuzzy(time_text) or _parse_futu_meta_time(time_text)
                items.append(
                    NewsItem(
                        title=title[:500],
                        link=href,
                        published_at=pub,
                        source="futu",
                        stock=stock.name,
                    )
                )
            if items:
                break
        except (PlaywrightTimeout, Exception) as e:
            LOG.debug("futu url=%s err=%s", url, e)
    return items


async def scrape_aastocks(page, stock: StockRow) -> list[NewsItem]:
    items: list[NewsItem] = []
    code5 = stock.code.zfill(5)
    sym = f"{code5}.hk"
    urls = [
        f"https://www.aastocks.com/sc/stocks/news/aafn-share-news.aspx?symbol={sym}",
        f"https://www.aastocks.com/sc/stocks/news/aafnsearch.aspx?searchtype=1&keyword={quote(stock.name)}",
    ]
    for url in urls:
        try:
            await page.goto(_url_with_request_ts(url), wait_until="domcontentloaded", timeout=55000)
            await asyncio.sleep(3)
            links = await page.query_selector_all("table a[href]")
            if not links:
                links = await page.query_selector_all(
                    'a[href*="NewsContent"], a[href*="newscontent"], a[href*="aafn"]'
                )
            seen: set[str] = set()
            for a in links[:50]:
                href = (await a.get_attribute("href") or "").strip()
                text = (await a.inner_text() or "").replace("\n", " ").strip()
                if not href or "javascript:" in href.lower() or len(text) < 6:
                    continue
                hl = href.lower()
                if not any(
                    k in hl
                    for k in (
                        "aafn",
                        "newscontent",
                        "newsdetail",
                        "news.aastocks",
                        "quote_news",
                    )
                ):
                    continue
                if href in seen:
                    continue
                seen.add(href)
                if not href.startswith("http"):
                    href = urljoin("https://www.aastocks.com/sc/", href)
                time_text = ""
                try:
                    time_text = await a.evaluate(
                        """el => {
                          const tr = el.closest('tr');
                          if (!tr) return '';
                          const tds = tr.querySelectorAll('td');
                          for (const td of tds) {
                            const s = (td.innerText || '').trim();
                            if (/\\d{4}[\\/\\-]\\d/.test(s) || /\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(s)) return s;
                          }
                          return '';
                        }"""
                    )
                except Exception:
                    pass
                pub = _parse_time_fuzzy(time_text) or UNKNOWN_PUBLISHED_AT
                items.append(
                    NewsItem(
                        title=text[:500],
                        link=href,
                        published_at=pub,
                        source="aastocks",
                        stock=stock.name,
                    )
                )
            if items:
                break
        except (PlaywrightTimeout, Exception) as e:
            LOG.debug("aastocks url=%s err=%s", url, e)
    return items


async def scrape_zhitong(page, stock: StockRow) -> list[NewsItem]:
    items: list[NewsItem] = []
    keyword = quote(stock.name)
    urls = [
        f"https://www.zhitongcaijing.com/search?page=1&type=news&keyword={keyword}",
        f"https://www.zhitongcaijing.com/search.html?keyword={keyword}",
    ]
    for url in urls:
        try:
            await page.goto(_url_with_request_ts(url), wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(2)
            try:
                await page.evaluate(
                    "window.scrollTo(0, Math.min(1200, document.body.scrollHeight))"
                )
            except Exception:
                pass
            await asyncio.sleep(1)
            links = await page.query_selector_all(
                'a[href*="/content/"], a[href*="/detail/"], a[href*="/article/"]'
            )
            seen_href: set[str] = set()
            for a in links[:45]:
                href = await a.get_attribute("href")
                title = (await a.inner_text() or "").strip()
                if not href or not title or len(title) < 6:
                    continue
                if href in seen_href:
                    continue
                seen_href.add(href)
                if not href.startswith("http"):
                    href = "https://www.zhitongcaijing.com" + (
                        href if href.startswith("/") else "/" + href
                    )
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
                pub = _parse_time_fuzzy(time_text) or UNKNOWN_PUBLISHED_AT
                items.append(
                    NewsItem(
                        title=title.split("\n")[0][:500],
                        link=href,
                        published_at=pub,
                        source="zhitong",
                        stock=stock.name,
                    )
                )
            if items:
                break
        except (PlaywrightTimeout, Exception) as e:
            LOG.debug("zhitong url=%s err=%s", url, e)
    return items


async def scrape_etnet(page, stock: StockRow) -> list[NewsItem]:
    items: list[NewsItem] = []
    code5 = stock.code.zfill(5)
    base = "https://www.etnet.com.hk"
    for lang in ("tc", "sc"):
        list_url = f"{base}/www/{lang}/stocks/realtime/quote_news.php?code={code5}"
        try:
            await page.goto(_url_with_request_ts(list_url), wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(1.5)
            divs = await page.query_selector_all(".DivArticleList")
            for div in divs[:40]:
                time_text = ""
                date_el = await div.query_selector("p.date, span.date")
                if date_el:
                    time_text = (await date_el.inner_text() or "").strip()
                a = await div.query_selector(
                    'a[href*="quote_news_detail.php"], a[href*="quote_blocktrade_detail.php"]'
                )
                if not a:
                    continue
                href = (await a.get_attribute("href") or "").strip()
                title = (await a.inner_text() or "").strip()
                title = re.sub(r"[\xa0\s]+", " ", title).strip()
                if not href or len(title) < 4:
                    continue
                full = href if href.startswith("http") else urljoin(list_url, href)
                pub = _parse_time_fuzzy(time_text)
                if not pub:
                    m = re.search(r"newsid=(\d{8})", href, re.I)
                    if m:
                        try:
                            pub = datetime.strptime(m.group(1), "%Y%m%d")
                        except ValueError:
                            pub = None
                if not pub:
                    pub = UNKNOWN_PUBLISHED_AT
                items.append(
                    NewsItem(
                        title=title[:500],
                        link=full,
                        published_at=pub,
                        source="etnet",
                        stock=stock.name,
                    )
                )
            if items:
                break
        except (PlaywrightTimeout, Exception) as e:
            LOG.debug("etnet lang=%s err=%s", lang, e)
    return items


async def scrape_eastmoney_search(page, stock: StockRow) -> list[NewsItem]:
    """东方财富资讯搜索（作为「搜索」渠道）。"""
    items: list[NewsItem] = []
    q = quote(f"{stock.name} {stock.code.zfill(5)}")
    url = f"https://so.eastmoney.com/News/s?keyword={q}"
    try:
        await page.goto(_url_with_request_ts(url), wait_until="domcontentloaded", timeout=45000)
        await asyncio.sleep(2.5)
        links = await page.query_selector_all(
            'a[href*="finance.eastmoney.com"], a[href*="stock.eastmoney.com"], a[href*="eastmoney.com/news"]'
        )
        seen: set[str] = set()
        for a in links[:40]:
            href = (await a.get_attribute("href") or "").strip()
            title = (await a.inner_text() or "").strip().split("\n")[0]
            if not href or len(title) < 8:
                continue
            if href in seen:
                continue
            seen.add(href)
            if not href.startswith("http"):
                continue
            time_blob = ""
            try:
                time_blob = await a.evaluate(
                    """el => {
                      const row = el.closest('li,.news-item,.item,.txt,.newsList') || el.parentElement;
                      return row ? (row.innerText || '') : '';
                    }"""
                )
            except Exception:
                pass
            pub = _parse_time_fuzzy(str(time_blob)) or UNKNOWN_PUBLISHED_AT
            items.append(
                NewsItem(
                    title=title[:500],
                    link=href,
                    published_at=pub,
                    source="eastmoney",
                    stock=stock.name,
                )
            )
    except (PlaywrightTimeout, Exception) as e:
        LOG.debug("eastmoney err=%s", e)
    return items


async def scrape_search_channel(page, stock: StockRow) -> list[NewsItem]:
    """搜索：东方财富（经济通已在主流程单独抓取，避免重复）。"""
    return await scrape_eastmoney_search(page, stock)


_SOURCE_LABEL: dict[str, str] = {
    "zhitong": "智通财经",
    "aastocks": "阿思达克",
    "futu_http": "富途牛牛(HTTP)",
    "futu": "富途牛牛",
}


async def scrape_one_stock(page, stock: StockRow) -> list[NewsItem]:
    """核心三源（顺序）：智通财经 → 阿思达克 → 富途牛牛（urllib 优先，不足再 Playwright）。
    股票间 10–20s / 每 5 只 120s 在 run_async；源之间短休眠。"""
    merged: list[NewsItem] = []

    scrapers: list[tuple[str, Any, int]] = [
        ("zhitong", scrape_zhitong, random.randint(6, 10)),
        ("aastocks", scrape_aastocks, random.randint(6, 10)),
    ]
    for key, fn, cap in scrapers:
        lab = _SOURCE_LABEL[key]
        print(f"正在从 [{lab}] 抓取 [{stock.name}]... ", end="", flush=True)
        LOG.info("正在从 [%s] 抓取 [%s]（%s）…", lab, stock.name, stock.code)
        try:
            batch = await fn(page, stock)
            kept = filter_cap_sort(batch, stock.name, stock.code, cap)
            merged.extend(kept)
            n = len(kept)
        except Exception as e:
            LOG.warning("%s %s: %s", stock.name, fn.__name__, e)
            n = 0
        print(f"抓到 {n} 条")
        LOG.info("来源 [%s] %s：计入 %d 条", lab, stock.name, n)
        await asyncio.sleep(random.uniform(1.0, 2.5))

    lab_http = _SOURCE_LABEL["futu_http"]
    print(f"正在从 [{lab_http}] 抓取 [{stock.name}]... ", end="", flush=True)
    LOG.info("正在从 [%s] 抓取 [%s]（%s）…", lab_http, stock.name, stock.code)
    try:
        http_futu_raw = await asyncio.to_thread(scrape_futu_http, stock)
        http_futu_f = filter_cap_sort(
            http_futu_raw, stock.name, stock.code, random.randint(10, 14)
        )
        merged.extend(http_futu_f)
        n_http = len(http_futu_f)
    except Exception as e:
        LOG.warning("%s futu_http: %s", stock.name, e)
        http_futu_f = []
        n_http = 0
    print(f"抓到 {n_http} 条")
    LOG.info("来源 [%s] %s：计入 %d 条", lab_http, stock.name, n_http)
    skip_futu_pw = len(http_futu_f) >= 3

    if not skip_futu_pw:
        lab_pw = _SOURCE_LABEL["futu"]
        print(f"正在从 [{lab_pw}] 抓取 [{stock.name}]... ", end="", flush=True)
        LOG.info("正在从 [%s] 抓取 [%s]（%s）…", lab_pw, stock.name, stock.code)
        try:
            batch = await scrape_futu(page, stock)
            kept = filter_cap_sort(batch, stock.name, stock.code, random.randint(6, 10))
            merged.extend(kept)
            n_pw = len(kept)
        except Exception as e:
            LOG.warning("%s scrape_futu: %s", stock.name, e)
            n_pw = 0
        print(f"抓到 {n_pw} 条")
        LOG.info("来源 [%s] %s：计入 %d 条", lab_pw, stock.name, n_pw)
        await asyncio.sleep(random.uniform(1.0, 2.5))
    return merged


def parse_aastocks_iponews_html(html: str) -> list[tuple[str, str, datetime | None]]:
    """阿思达克新股上市消息列表。"""
    out: list[tuple[str, str, datetime | None]] = []
    base = "https://www.aastocks.com"
    for href, title in re.findall(
        r'href="(/tc/stocks/news/aafn-con/[^"]+)"[^>]*>([^<]{6,500})</a>',
        html,
        re.I,
    ):
        title = re.sub(r"\s+", " ", title).strip()
        if not title:
            continue
        link = base + href.replace("&amp;", "&")
        out.append((title, link, None))
    return out


def parse_sina_hkstock_html(html: str) -> list[tuple[str, str, datetime | None]]:
    """新浪港股首页资讯链接。"""
    out: list[tuple[str, str, datetime | None]] = []
    pat = re.compile(
        r'href="(https?://finance\.sina\.com\.cn/[^"]+doc-[a-z0-9]+[^"]*\.shtm[^"]*)"[^>]*>([^<]{6,300})</a>',
        re.I,
    )
    for href, title in pat.findall(html):
        title = re.sub(r"<[^>]+>", "", title)
        title = re.sub(r"\s+", " ", title).strip()
        if not title:
            continue
        pub: datetime | None = None
        m = re.search(r"/(\d{4}-\d{2}-\d{2})/", href)
        if m:
            pub = _parse_time_fuzzy(m.group(1) + " 12:00")
        out.append((title, href, pub))
    return out


def parse_investing_cn_ipo_search_html(html: str) -> list[tuple[str, str, datetime | None]]:
    """英为财情（简体）IPO 新闻 tab 结果。"""
    out: list[tuple[str, str, datetime | None]] = []
    base = "https://cn.investing.com"
    for href, title in re.findall(
        r'href="(/news/[^"#]+)"[^>]*>([^<]{8,300})</a>',
        html,
        re.I,
    ):
        if "/news/" not in href.lower():
            continue
        title = re.sub(r"\s+", " ", title).strip()
        if len(title) < 8:
            continue
        out.append((title, base + href, None))
    return out


def parse_hket_ipo_channel_html(html: str) -> list[tuple[str, str, datetime | None]]:
    """香港经济日报 inews 新股频道（部分网络会 403）。"""
    if len(html) < 2500 or "403 ERROR" in html[:1200] or "Request blocked" in html[:1200]:
        return []
    out: list[tuple[str, str, datetime | None]] = []
    for href, title in re.findall(
        r'href="(https://inews\.hket\.com/[^"?#]+)"[^>]*>([^<]{6,240})</a>',
        html,
        re.I,
    ):
        if "inews.hket.com" not in href:
            continue
        title = re.sub(r"\s+", " ", title).strip()
        if not title or title in ("登入", "訂閱", "更多"):
            continue
        out.append((title, href, None))
    return out


def scrape_aggregate_ipo_portals(stocks: list[StockRow]) -> list[NewsItem]:
    """主数据源偏少时：抓取门户 IPO/港股资讯列表，按宽松名称+代码匹配打新表标的。"""
    if not stocks:
        return []
    ordered = sorted(stocks, key=lambda x: x.sheet_order)
    sources: list[tuple[str, str, Callable[[str], list[tuple[str, str, datetime | None]]], dict[str, str] | None]] = [
        (
            "aastocks_ipo",
            "https://www.aastocks.com/tc/stocks/market/ipo/iponews.aspx",
            parse_aastocks_iponews_html,
            None,
        ),
        (
            "sina_hkstock",
            "https://finance.sina.com.cn/stock/hkstock/",
            parse_sina_hkstock_html,
            None,
        ),
        (
            "investing_cn_ipo",
            "https://cn.investing.com/search/?q=IPO&tab=news",
            parse_investing_cn_ipo_search_html,
            None,
        ),
        (
            "hket_ipo",
            "https://inews.hket.com/sran009-2/%E6%96%B0%E8%82%A1IPO",
            parse_hket_ipo_channel_html,
            {"Referer": "https://www.hket.com/", "Accept-Language": "zh-HK,zh-TW,zh-CN;q=0.9,en;q=0.8"},
        ),
    ]
    out: list[NewsItem] = []
    for tag, url, parser, xhdr in sources:
        try:
            html = _http_get(url, timeout=28.0, extra_headers=xhdr)
        except Exception as e:
            LOG.debug("aggregate fetch %s err=%s", tag, e)
            continue
        try:
            rows = parser(html)
        except Exception as e:
            LOG.warning("aggregate parse %s err=%s", tag, e)
            continue
        if not rows:
            LOG.debug("aggregate %s: 0 条解析结果", tag)
            continue
        LOG.info("aggregate %s: 解析 %d 条原始链接", tag, len(rows))
        seen_u: set[str] = set()
        for title, link, pub in rows[:100]:
            if link in seen_u:
                continue
            seen_u.add(link)
            if not link.startswith("http"):
                continue
            for st in ordered:
                if article_matches_stock_relaxed(st.name, st.code, title, link):
                    pub2 = pub or UNKNOWN_PUBLISHED_AT
                    out.append(
                        NewsItem(
                            title=title[:500],
                            link=link,
                            published_at=pub2,
                            source=tag,
                            stock=st.name,
                        )
                    )
                    break
    return out[:180]


def dedupe_by_title_link(items: list[NewsItem]) -> list[NewsItem]:
    seen: set[tuple[str, str]] = set()
    out: list[NewsItem] = []
    for it in items:
        k = it.key()
        if not k[0] or not k[1] or k in seen:
            continue
        seen.add(k)
        out.append(it)
    out.sort(key=lambda x: x.published_at, reverse=True)
    return out


def dict_to_news_item(d: dict[str, Any]) -> NewsItem | None:
    title = str(d.get("title") or "").strip()
    link = str(d.get("link") or d.get("url") or "").strip()
    if not title or not link:
        return None
    stock = str(d.get("stock_name") or d.get("stock") or "").strip() or "—"
    src = str(d.get("source_platform") or d.get("source") or "unknown").strip()
    tr = d.get("time") or d.get("publishedAt") or d.get("published_at") or ""
    pub = _parse_time_fuzzy(str(tr)) if tr else None
    if not pub:
        pub = datetime(1970, 1, 1)
    return NewsItem(
        title=title[:500],
        link=link,
        published_at=pub,
        source=src,
        stock=stock,
    )


def load_existing_items(path: Path) -> list[NewsItem]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    raw = data.get("items")
    if not isinstance(raw, list):
        return []
    out: list[NewsItem] = []
    for d in raw:
        if isinstance(d, dict):
            it = dict_to_news_item(d)
            if it:
                out.append(it)
    return out


def merge_incremental(
    existing: list[NewsItem], new_items: list[NewsItem]
) -> list[NewsItem]:
    keys = {it.key() for it in existing}
    merged = list(existing)
    for it in new_items:
        if it.key() not in keys:
            merged.append(it)
            keys.add(it.key())
    merged = dedupe_by_title_link(merged)
    if RECENT_HOURS > 0:
        merged = keep_within_recent_hours(merged, RECENT_HOURS)
    else:
        merged = prune_by_age(merged)
    merged.sort(key=lambda x: x.published_at, reverse=True)
    return merged[:MAX_JSON_ITEMS]


def write_news_sheet(items: list[NewsItem]) -> None:
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    sheet_id = os.environ.get("IPO_NEWS_SPREADSHEET_ID", "").strip()
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_file(cred_path, scopes=scopes)
    gc = gspread.authorize(creds)
    ws_name = os.environ.get("IPO_NEWS_SHEET", "最新资讯").strip() or "最新资讯"
    sh = gc.open_by_key(sheet_id)
    try:
        ws = sh.worksheet(ws_name)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=ws_name, rows=500, cols=8)
    ws.clear()
    ws.append_row(["标题", "链接", "发布时间", "来源", "相关股票"])
    batch = [it.to_sheet_row() for it in items]
    if batch:
        ws.append_rows(batch, value_input_option="USER_ENTERED")


def write_json_payload(items: list[NewsItem], monitored: list[StockRow]) -> None:
    path = _json_out_path()
    stocks_meta = [
        {
            "name": s.name,
            "code": s.code,
            "sheetRow": s.sheet_order,
        }
        for s in monitored
    ]
    items_sorted = sorted(items, key=lambda x: x.published_at, reverse=True)[
        :MAX_JSON_ITEMS
    ]
    payload: dict[str, Any] = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "feed": "schedule_monitor_v20",
        "scheduleSheet": os.environ.get("IPO_SCHEDULE_SHEET", "打新时间表").strip()
        or "打新时间表",
        "maxScheduleStocks": MAX_SCHEDULE_STOCKS,
        "maxNewsAgeDays": MAX_NEWS_AGE_DAYS,
        "recentHours": RECENT_HOURS,
        "monitoredCodes": [s.code for s in monitored],
        "stocksInWindow": stocks_meta,
        "items": [it.to_json_obj() for it in items_sorted],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    LOG.info(
        "Wrote %s (%d items, monitored %d)",
        path,
        len(items_sorted),
        len(monitored),
    )


def random_viewport() -> dict[str, int]:
    if random.random() < 0.45:
        w = random.randint(360, 430)
        h = random.randint(720, 900)
    else:
        w = random.randint(1280, 1536)
        h = random.randint(800, 900)
    return {"width": w, "height": h}


async def run_async(stocks: list[StockRow]) -> list[NewsItem]:
    path = _json_out_path()
    if _IGNORE_EXISTING_JSON:
        existing: list[NewsItem] = []
        LOG.info("IPO_NEWS_IGNORE_EXISTING_JSON=1：不合并旧 JSON，仅本轮抓取结果参与写入")
    else:
        existing = load_existing_items(path)
    new_scraped: list[NewsItem] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        vp = random_viewport()
        context = await browser.new_context(
            user_agent=_pick_user_agent(),
            locale="zh-CN",
            viewport=vp,
        )
        await context.add_init_script(
            """
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
            const oa = navigator.permissions && navigator.permissions.query;
            if (oa) navigator.permissions.query = function(p){return p&&p.name==='notifications'
              ? Promise.resolve({state:'denied'}) : oa.call(navigator.permissions,p);};
            """
        )
        try:
            for i, st in enumerate(stocks):
                page = await context.new_page()
                await page.set_extra_http_headers(
                    {
                        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                        "Referer": "https://www.google.com/",
                    }
                )
                try:
                    if random.random() < 0.5:
                        nv = random_viewport()
                        await page.set_viewport_size(
                            {"width": nv["width"], "height": nv["height"]}
                        )
                except Exception:
                    pass
                try:
                    print(
                        f"[打新时间表 {i + 1}/{len(stocks)}] 开始：{st.name}（{st.code}）",
                        flush=True,
                    )
                    LOG.info(
                        "打新时间表进度 %d/%d：%s（%s）",
                        i + 1,
                        len(stocks),
                        st.name,
                        st.code,
                    )
                    batch = await scrape_one_stock(page, st)
                    new_scraped.extend(batch)
                    log_stock_done(st.name, len(batch))
                finally:
                    await page.close()

                if i + 1 < len(stocks):
                    delay = random.uniform(10.0, 20.0)
                    LOG.info("完成 %s，休眠 %.1f 秒…", st.name, delay)
                    await asyncio.sleep(delay)
                if (i + 1) % 5 == 0 and i + 1 < len(stocks):
                    LOG.info("已完成 %d 只股票，强制休眠 120 秒…", i + 1)
                    await asyncio.sleep(120)
        finally:
            await browser.close()

    if stocks and (
        _AGGREGATE_ALWAYS
        or (_AGGREGATE_MIN > 0 and len(new_scraped) < _AGGREGATE_MIN)
    ):
        if _AGGREGATE_ALWAYS:
            LOG.info(
                "IPO_NEWS_AGGREGATE_ALWAYS=1：合并门户 IPO 列表兜底（主流程 %d 条）…",
                len(new_scraped),
            )
        else:
            LOG.info(
                "主流程共 %d 条（阈值 %d），启动门户 IPO 列表兜底…",
                len(new_scraped),
                _AGGREGATE_MIN,
            )
        try:
            agg = await asyncio.to_thread(scrape_aggregate_ipo_portals, stocks)
            new_scraped.extend(agg)
            LOG.info("门户兜底新增 %d 条", len(agg))
        except Exception as e:
            LOG.warning("门户兜底异常: %s", e)

    merged = merge_incremental(existing, new_scraped)
    return merged


def log_stock_done(stock_name: str, n: int) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    msg = f"[{ts}] 股票{stock_name} 抓取成功，新增{n}条资讯"
    LOG.info(msg)
    print(msg)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    stocks = read_schedule_stocks()
    path = _json_out_path()
    if not stocks:
        LOG.warning("打新时间表前段未解析到名称+代码，仍更新 JSON（合并旧数据）。")
        existing = load_existing_items(path)
        write_json_payload(existing, [])
        try:
            write_news_sheet(existing)
        except Exception as e:
            LOG.warning("未更新表格: %s", e)
        return

    print(
        f"打新时间表本次处理 {len(stocks)} 支（上限 {MAX_SCHEDULE_STOCKS}），将依次抓取。",
        flush=True,
    )
    LOG.info("本次监控 %d 支: %s", len(stocks), [s.name for s in stocks])
    backup_and_remove_json_out()
    items = asyncio.run(run_async(stocks))
    write_news_sheet(items)
    write_json_payload(items, stocks)


if __name__ == "__main__":
    main()
