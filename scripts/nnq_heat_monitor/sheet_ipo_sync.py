#!/usr/bin/env python3
"""Google Sheet「上市新股」与社区舆情关联、时间窗过滤、赛道聚合。"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from ipo_sheet_loader import (
    FIELD_ALIASES,
    _cell,
    _norm_code,
    _norm_key,
    fetch_listed_csv_text,
    load_ipo_master_from_sheet,
    _parse_csv_rows,
)

TZ_CN = timezone(timedelta(hours=8))
PAST_DAYS = 30
FUTURE_DAYS = 7

SheetIpoStatus = Literal["即将招股", "招股中", "已上市", "待上市", "其他"]
DisplayBadge = Literal["即将招股", "近期上市", "重点关注"]

FIELD_ALIASES_EXTRA: dict[str, tuple[str, ...]] = {
    "listingDate": ("上市日期", "挂牌日", "上市日"),
    "fundraising": ("募资规模", "集资额", "发行规模", "募资额", "市值（港元）", "市值"),
}


def _parse_date_flexible(raw: str) -> date | None:
    s = (raw or "").strip()
    if not s or s in ("—", "-", "待定", "TBD", "N/A"):
        return None
    s = s.replace("年", "-").replace("月", "-").replace("日", "").replace("/", "-").strip()
    m = re.search(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = re.search(r"(\d{4})(\d{2})(\d{2})", re.sub(r"\D", "", s))
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def _norm_name(name: str) -> str:
    return re.sub(r"\s+", "", (name or "").strip())


def _match_key(code: str, name: str) -> str:
    return f"{_norm_code(code)}|{_norm_name(name)}"


def _names_compatible(a: str, b: str) -> bool:
    na, nb = _norm_name(a), _norm_name(b)
    if not na or not nb:
        return True
    if na == nb:
        return True
    return na in nb or nb in na


def row_to_sheet_ipo(row: dict[str, str]) -> dict[str, Any] | None:
    code = _norm_code(_cell(row, *FIELD_ALIASES["code"]))
    if not code or code == "00000":
        return None
    name = _cell(row, *FIELD_ALIASES["name"]) or code
    sub_start = _cell(row, *FIELD_ALIASES["subStart"])
    sub_end = _cell(row, *FIELD_ALIASES["subEnd"])
    listing = _cell(row, *FIELD_ALIASES_EXTRA["listingDate"])
    sector = _cell(row, *FIELD_ALIASES["sector"]) or "其他"
    if sub_start and sub_end:
        ipo_period = f"{sub_start} ~ {sub_end}"
    elif sub_start:
        ipo_period = f"{sub_start} ~ 待定"
    elif sub_end:
        ipo_period = f"待定 ~ {sub_end}"
    else:
        ipo_period = ""

    return {
        "code": code,
        "name": name,
        "matchKey": _match_key(code, name),
        "sector": sector,
        "sponsor": _cell(row, *FIELD_ALIASES["sponsor"]),
        "issuePe": _cell(row, *FIELD_ALIASES["issuePe"]),
        "fundraising": _cell(row, *FIELD_ALIASES_EXTRA["fundraising"]),
        "subStart": sub_start,
        "subEnd": sub_end,
        "listingDate": listing,
        "ipoPeriod": ipo_period,
        "subStartDate": _parse_date_flexible(sub_start),
        "subEndDate": _parse_date_flexible(sub_end),
        "listingDateParsed": _parse_date_flexible(listing),
    }


def compute_sheet_status(
    sub_start: date | None,
    sub_end: date | None,
    listing: date | None,
    *,
    today: date | None = None,
) -> SheetIpoStatus:
    today = today or datetime.now(TZ_CN).date()
    if sub_start and today < sub_start:
        return "即将招股"
    if sub_start and sub_end and sub_start <= today <= sub_end:
        return "招股中"
    if listing and listing <= today:
        return "已上市"
    if sub_end and sub_end < today and (not listing or listing > today):
        return "待上市"
    if sub_start and sub_start <= today:
        return "招股中"
    return "其他"


def passes_sheet_time_filter(
    sub_start: date | None,
    sub_end: date | None,
    listing: date | None,
    *,
    today: date | None = None,
) -> bool:
    """
    严格时间窗：
    - 展示：近30天内已招股 / 已上市
    - 展示：未来7天内即将招股
    - 过滤：上市或招股锚点均早于30天前（且无未来7天招股）
    """
    today = today or datetime.now(TZ_CN).date()
    past_cutoff = today - timedelta(days=PAST_DAYS)
    future_cutoff = today + timedelta(days=FUTURE_DAYS)

    if listing is not None and listing < past_cutoff:
        if not (sub_start is not None and today < sub_start <= future_cutoff):
            return False

    if sub_start is not None and today < sub_start <= future_cutoff:
        return True

    if sub_start is not None and sub_start >= past_cutoff:
        return True

    if listing is not None and listing >= past_cutoff:
        return True

    if sub_start is not None and sub_end is not None and sub_start <= today <= sub_end:
        return True

    if sub_end is not None and sub_end >= past_cutoff and sub_end <= today:
        if listing is None or listing >= past_cutoff:
            return True

    return False


def _insight_lookup(stock_insights: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_code: dict[str, dict[str, Any]] = {}
    for s in stock_insights or []:
        code = _norm_code(str(s.get("code") or ""))
        if code:
            by_code[code] = s
    return by_code


def _find_sentiment(sheet_row: dict[str, Any], by_code: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    code = sheet_row["code"]
    name = sheet_row["name"]
    hit = by_code.get(code)
    if not hit:
        return None
    if not _names_compatible(name, str(hit.get("name") or "")):
        return None
    return hit


def _dominant_label(insight: dict[str, Any] | None) -> tuple[str, str]:
    if not insight:
        return "—", "neutral"
    sb = insight.get("sentimentBreakdown") or {}
    dom = sb.get("dominant") or "neutral"
    labels = {
        "bullish": ("看多", "bullish"),
        "bearish": ("看空", "bearish"),
        "watch": ("观望", "watch"),
        "neutral": ("中性", "neutral"),
    }
    return labels.get(dom, ("中性", "neutral"))


def _heat_threshold(cards: list[dict[str, Any]]) -> float:
    heats = [float(c.get("heatIndex") or 0) for c in cards if (c.get("heatIndex") or 0) > 0]
    if not heats:
        return 100.0
    heats.sort()
    idx = max(0, int(len(heats) * 0.7) - 1)
    return max(heats[idx], 100.0)


def _in_subscription_window(sub_start: date | None, sub_end: date | None, today: date) -> bool:
    if sub_start and sub_end:
        return sub_start <= today <= sub_end
    return False


def build_display_badges(
    card: dict[str, Any],
    *,
    today: date,
    heat_threshold: float,
) -> list[DisplayBadge]:
    badges: list[DisplayBadge] = []
    ss = card.get("subStartDate")
    se = card.get("subEndDate")
    ld = card.get("listingDateParsed")
    status = card.get("sheetStatus")

    if status == "即将招股" or (isinstance(ss, date) and today < ss <= today + timedelta(days=FUTURE_DAYS)):
        badges.append("即将招股")

    if isinstance(ld, date) and ld >= today - timedelta(days=PAST_DAYS) and ld <= today:
        badges.append("近期上市")

    heat = float(card.get("heatIndex") or 0)
    if heat >= heat_threshold and _in_subscription_window(ss, se, today):
        badges.append("重点关注")

    return badges


def load_sheet_ipo_rows() -> list[dict[str, Any]]:
    text = fetch_listed_csv_text()
    raw_rows = _parse_csv_rows(text)
    out: list[dict[str, Any]] = []
    for row in raw_rows:
        parsed = row_to_sheet_ipo(row)
        if parsed:
            out.append(parsed)
    return out


def build_sheet_ipo_universe(
    stock_insights: list[dict[str, Any]] | None = None,
    *,
    sheet_rows: list[dict[str, Any]] | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or datetime.now(TZ_CN).date()
    rows = sheet_rows if sheet_rows is not None else load_sheet_ipo_rows()
    by_code = _insight_lookup(stock_insights or [])

    filtered: list[dict[str, Any]] = []
    for row in rows:
        ss = row.get("subStartDate")
        se = row.get("subEndDate")
        ld = row.get("listingDateParsed")
        if not passes_sheet_time_filter(ss, se, ld, today=today):
            continue

        insight = _find_sentiment(row, by_code)
        dom_text, dom_cls = _dominant_label(insight)
        sb = (insight or {}).get("sentimentBreakdown") or {}

        card: dict[str, Any] = {
            **row,
            "sheetStatus": compute_sheet_status(ss, se, ld, today=today),
            "heatIndex": (insight or {}).get("heatIndex") or 0,
            "mentions": (insight or {}).get("mentions") or 0,
            "disagreementIndex": (insight or {}).get("disagreementIndex"),
            "dominant": dom_text,
            "dominantCls": dom_cls,
            "bullishPct": ((sb.get("bullish") or {}).get("pct") or 0),
            "bearishPct": ((sb.get("bearish") or {}).get("pct") or 0),
            "watchPct": ((sb.get("watch") or {}).get("pct") or 0)
            + ((sb.get("neutral") or {}).get("pct") or 0),
            "hasSentiment": insight is not None,
        }
        filtered.append(card)

    heat_thr = _heat_threshold(filtered)
    for card in filtered:
        card["badges"] = build_display_badges(card, today=today, heat_threshold=heat_thr)
        for k in ("subStartDate", "subEndDate", "listingDateParsed"):
            if isinstance(card.get(k), date):
                card[k] = card[k].isoformat()

    sector_map: dict[str, dict[str, Any]] = {}
    for card in filtered:
        sector = (card.get("sector") or "其他").strip() or "其他"
        bucket = sector_map.setdefault(
            sector,
            {"sectorGroup": sector, "heatScore": 0.0, "stockCount": 0, "mentionSum": 0},
        )
        bucket["heatScore"] += float(card.get("heatIndex") or 0)
        bucket["mentionSum"] += int(card.get("mentions") or 0)
        bucket["stockCount"] += 1

    sector_heat = sorted(
        [
            {
                "sectorGroup": v["sectorGroup"],
                "heatScore": round(v["heatScore"], 1),
                "mentions": v["mentionSum"],
                "postCount": v["stockCount"],
                "source": "google_sheet",
            }
            for v in sector_map.values()
        ],
        key=lambda x: x["heatScore"],
        reverse=True,
    )

    allowed_codes = {c["code"] for c in filtered}
    allowed_keys = {c["matchKey"] for c in filtered}

    return {
        "sheetIpoUniverse": filtered,
        "sectorHeatFromSheet": sector_heat,
        "sheetFilter": {
            "pastDays": PAST_DAYS,
            "futureDays": FUTURE_DAYS,
            "today": today.isoformat(),
            "totalSheetRows": len(rows),
            "visibleCount": len(filtered),
        },
        "allowedStockCodes": sorted(allowed_codes),
        "allowedMatchKeys": sorted(allowed_keys),
    }


def enrich_payload_with_sheet(
    payload: dict[str, Any],
    *,
    ipo_master: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """合并 Sheet universe 到 nnq-heat.json payload。"""
    try:
        sheet_rows = load_sheet_ipo_rows()
    except Exception:
        sheet_rows = []
        for code, entry in (ipo_master or load_ipo_master_from_sheet()).items():
            sheet_rows.append(
                {
                    "code": code,
                    "name": entry.get("name") or code,
                    "matchKey": _match_key(code, str(entry.get("name") or code)),
                    "sector": entry.get("sector") or "其他",
                    "sponsor": entry.get("sponsor") or "",
                    "issuePe": entry.get("issuePe") or "",
                    "fundraising": "",
                    "subStart": (entry.get("ipoPeriod") or "").split("~")[0].strip(),
                    "subEnd": (entry.get("ipoPeriod") or "").split("~")[-1].strip()
                    if "~" in (entry.get("ipoPeriod") or "")
                    else "",
                    "listingDate": "",
                    "ipoPeriod": entry.get("ipoPeriod") or "",
                    "subStartDate": None,
                    "subEndDate": None,
                    "listingDateParsed": None,
                }
            )

    block = build_sheet_ipo_universe(
        payload.get("stockInsights") or [],
        sheet_rows=sheet_rows,
    )
    payload.update(block)
    if block.get("sectorHeatFromSheet"):
        mi = payload.setdefault("marketInsights", {})
        mi["sectorHeatFromSheet"] = block["sectorHeatFromSheet"]
        mi["sectorHeatSource"] = "google_sheet"
    return payload
