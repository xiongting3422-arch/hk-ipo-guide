#!/usr/bin/env python3
"""从 Google Sheet「上市新股」发布 CSV 构建 ipo_master 字典（供 analytics_v2 使用）。"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

LOG = logging.getLogger("nnq_heat_monitor.sheet")

DEFAULT_PUBLISH_BASE = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vT5R7a29N0wHqOVKXO7Dx016Z_DV0IQ5n16IaTMSPWF2QOqwqud1ViC1Llp0MFwZep8qMUGW_-9SCBU/pub"
)
DEFAULT_LISTED_GID = 63719317
FETCH_TIMEOUT = int(os.environ.get("NNQ_HEAT_SHEET_TIMEOUT", "45").strip() or "45")

FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "name": ("股票名称", "名称", "name"),
    "code": ("股票代码", "代码", "code"),
    "sector": ("行业板块", "板块", "行业", "行业·细分"),
    "sponsor": ("保荐人", "保荐机构", "联席保荐人", "保荐"),
    "issuePe": ("发行市盈率", "市盈率", "PE", "发行 pe"),
    "lotRateExpect": ("一手中签率", "中签率", "中签率预期", "稳中一手"),
    "subStart": ("招股开始", "认购开始", "起购日期", "招股日期"),
    "subEnd": ("招股结束", "认购结束", "截止认购"),
}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _norm_key(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").strip())


def _norm_code(raw: str) -> str:
    d = re.sub(r"\D", "", str(raw or ""))
    if not d:
        return ""
    if len(d) <= 5:
        return d.zfill(5)
    return d[-5:].zfill(5) if len(d) >= 5 else d.zfill(5)


def _cell(row: dict[str, Any], *keys: str) -> str:
    if not row:
        return ""
    norm_map = {_norm_key(k): v for k, v in row.items()}
    for k in keys:
        v = norm_map.get(_norm_key(k))
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def _listed_csv_url() -> str:
    base = os.environ.get("NNQ_HEAT_SHEET_PUBLISH_BASE", DEFAULT_PUBLISH_BASE).strip().rstrip("/")
    gid = os.environ.get("NNQ_HEAT_SHEET_LISTED_GID", str(DEFAULT_LISTED_GID)).strip()
    ts = int(time.time() * 1000)
    return f"{base}?gid={gid}&single=true&output=csv&_t={ts}"


def fetch_listed_csv_text() -> str:
    url = _listed_csv_url()
    req = Request(
        url,
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
    try:
        with urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            raw = resp.read()
    except HTTPError as e:
        raise RuntimeError(f"拉取上市新股 CSV 失败 HTTP {e.code}") from e
    except URLError as e:
        raise RuntimeError(f"拉取上市新股 CSV 网络错误: {e}") from e
    text = raw.decode("utf-8-sig", errors="replace")
    head = text.strip()[:512]
    if head.startswith("<") or "<!DOCTYPE" in head.upper():
        raise RuntimeError("Sheet 返回 HTML 而非 CSV，请检查 publishBase 是否已发布到网络")
    return text


def _is_transposed_matrix(matrix: list[list[str]]) -> bool:
    if len(matrix) < 2:
        return False
    a = _norm_key(matrix[0][0] if matrix[0] else "")
    b = _norm_key(matrix[1][0] if matrix[1] else "")
    return a == "股票名称" and b == "股票代码"


def _pivot_transposed(matrix: list[list[str]]) -> list[dict[str, str]]:
    n_rows = len(matrix)
    n_cols = max((len(r) for r in matrix), default=0)
    out: list[dict[str, str]] = []
    for j in range(1, n_cols):
        row: dict[str, str] = {}
        for i in range(n_rows):
            r = matrix[i]
            if not r or not r[0]:
                continue
            key = _norm_key(str(r[0]))
            val = str(r[j]).strip() if j < len(r) and r[j] is not None else ""
            if key:
                row[key] = val
        if any(str(v).strip() for v in row.values()):
            out.append(row)
    return out


def _parse_csv_rows(text: str) -> list[dict[str, str]]:
    reader = csv.reader(io.StringIO(text))
    matrix = [row for row in reader if row and any(str(c).strip() for c in row)]
    if not matrix:
        return []
    if _is_transposed_matrix(matrix):
        LOG.info("检测到「上市新股」宽表转置格式，已 pivot 为行")
        return _pivot_transposed(matrix)
    if not matrix:
        return []
    headers = [_norm_key(h) for h in matrix[0]]
    rows: list[dict[str, str]] = []
    for line in matrix[1:]:
        row: dict[str, str] = {}
        for i, h in enumerate(headers):
            if not h:
                continue
            row[h] = str(line[i]).strip() if i < len(line) else ""
        if any(row.values()):
            rows.append(row)
    return rows


def row_to_master_entry(row: dict[str, str]) -> tuple[str, dict[str, Any]] | None:
    code = _norm_code(_cell(row, *FIELD_ALIASES["code"]))
    if not code or code == "00000":
        return None
    name = _cell(row, *FIELD_ALIASES["name"]) or code
    sub_start = _cell(row, *FIELD_ALIASES["subStart"])
    sub_end = _cell(row, *FIELD_ALIASES["subEnd"])
    if sub_start and sub_end:
        ipo_period = f"{sub_start} ~ {sub_end}"
    elif sub_start:
        ipo_period = f"{sub_start} ~ 待定"
    elif sub_end:
        ipo_period = f"待定 ~ {sub_end}"
    else:
        ipo_period = ""
    return code, {
        "name": name,
        "code": code,
        "sector": _cell(row, *FIELD_ALIASES["sector"]),
        "sponsor": _cell(row, *FIELD_ALIASES["sponsor"]),
        "issuePe": _cell(row, *FIELD_ALIASES["issuePe"]),
        "lotRateExpect": _cell(row, *FIELD_ALIASES["lotRateExpect"]),
        "ipoPeriod": ipo_period,
    }


def load_ipo_master_from_sheet() -> dict[str, dict[str, Any]]:
    """
    返回 { "03310": { name, sector, sponsor, issuePe, lotRateExpect, ipoPeriod } }
    失败时记录 warning 并返回 {}（v2 仍可运行，basicTags.source=missing）。
    """
    if os.environ.get("NNQ_HEAT_SKIP_SHEET", "").strip() == "1":
        LOG.info("NNQ_HEAT_SKIP_SHEET=1：跳过 Sheet 拉取")
        return {}
    try:
        text = fetch_listed_csv_text()
        rows = _parse_csv_rows(text)
    except Exception as e:
        LOG.warning("上市新股 Sheet 拉取失败，basicTags 将为 missing: %s", e)
        return {}

    master: dict[str, dict[str, Any]] = {}
    for row in rows:
        parsed = row_to_master_entry(row)
        if not parsed:
            continue
        code, entry = parsed
        master[code] = entry
    LOG.info("上市新股 Sheet 已加载 %s 只标的", len(master))
    return master
