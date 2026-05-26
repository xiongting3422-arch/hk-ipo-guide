#!/usr/bin/env python3
"""从 Google Sheet「上市新股」筛选定向抓取目标。"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sheet_ipo_sync import _parse_date_flexible, passes_sheet_time_filter, row_to_sheet_ipo

TZ_CN = timezone(timedelta(hours=8))


def _coerce_date(val: Any) -> date | None:
    if isinstance(val, date):
        return val
    if isinstance(val, str):
        return _parse_date_flexible(val)
    return None


def _normalize_sheet_row(raw: dict[str, Any]) -> dict[str, Any] | None:
    """load_sheet_ipo_rows 已解析的行可直接使用；原始 CSV 行则再解析一次。"""
    if raw.get("code") and (raw.get("matchKey") or raw.get("subStart") or raw.get("listingDate")):
        row = dict(raw)
        row["subStartDate"] = _coerce_date(row.get("subStartDate")) or _parse_date_flexible(
            str(row.get("subStart") or "")
        )
        row["subEndDate"] = _coerce_date(row.get("subEndDate")) or _parse_date_flexible(
            str(row.get("subEnd") or "")
        )
        row["listingDateParsed"] = _coerce_date(row.get("listingDateParsed")) or _parse_date_flexible(
            str(row.get("listingDate") or "")
        )
        return row
    return row_to_sheet_ipo(raw)


def _sort_date(row: dict[str, Any]) -> date:
    for key in ("listingDateParsed", "subEndDate", "subStartDate"):
        val = _coerce_date(row.get(key))
        if val:
            return val
    return date.min


def select_scrape_targets(
    sheet_rows: list[dict[str, str]],
    *,
    limit: int = 20,
    past_days: int = 30,
    future_days: int = 7,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """
    按上市/招股日期倒序，取最新一批近期新股作为定向抓取目标。
    时间窗：近 past_days 天已招股/上市 + 未来 future_days 天即将招股。
    """
    today = today or datetime.now(TZ_CN).date()
    start = today - timedelta(days=past_days)
    end = today + timedelta(days=future_days)

    parsed: list[dict[str, Any]] = []
    for raw in sheet_rows:
        row = _normalize_sheet_row(raw)
        if not row:
            continue
        ss = _coerce_date(row.get("subStartDate"))
        se = _coerce_date(row.get("subEndDate"))
        ld = _coerce_date(row.get("listingDateParsed"))
        if not passes_sheet_time_filter(ss, se, ld, today=today):
            continue
        dates = [d for d in (ld, se, ss) if isinstance(d, date)]
        if not dates:
            continue
        anchor = max(dates)
        parsed.append(
            {
                "code": row["code"],
                "name": row["name"],
                "subStart": row.get("subStart") or "",
                "subEnd": row.get("subEnd") or "",
                "listingDate": row.get("listingDate") or "",
                "ipoPeriod": row.get("ipoPeriod") or "",
                "sortDate": anchor.isoformat(),
                "sector": row.get("sector") or "",
            }
        )

    parsed.sort(key=lambda r: (r.get("sortDate") or "", r["code"]), reverse=True)
    return parsed[: max(1, limit)]
