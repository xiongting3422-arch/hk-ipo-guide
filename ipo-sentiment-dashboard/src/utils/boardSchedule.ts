import type { NnqHeatData } from '../types';

function normCode(raw?: string): string {
  const m = String(raw || '').match(/\d{4,5}/);
  return m ? m[0].padStart(5, '0') : '';
}

function codeFromScheduleRow(row: Record<string, string>): string {
  return normCode(row['股票代码'] || row['代码'] || row.code);
}

/** 与 Sheet「打新时间表」自上而下顺序一致（优先 window 缓存，其次 sheetIpoUniverse 顺序） */
export function buildScheduleOrderMap(data?: NnqHeatData): Map<string, number> {
  const map = new Map<string, number>();
  let idx = 0;

  const win = globalThis as typeof globalThis & {
    __IPO_SCHEDULE_SHEET_ROWS__?: Record<string, string>[];
  };
  const schedRows = win.__IPO_SCHEDULE_SHEET_ROWS__;
  if (Array.isArray(schedRows)) {
    for (const row of schedRows) {
      const code = codeFromScheduleRow(row);
      if (!code || map.has(code)) continue;
      map.set(code, idx++);
    }
  }

  if (!map.size) {
    for (const card of data?.sheetIpoUniverse || []) {
      if (!card.code || map.has(card.code)) continue;
      map.set(card.code, idx++);
    }
  }

  return map;
}

export function compareScheduleOrder(
  codeA: string,
  codeB: string,
  orderMap: Map<string, number>,
  heatA = 0,
  heatB = 0,
): number {
  const ia = orderMap.get(codeA) ?? 9999;
  const ib = orderMap.get(codeB) ?? 9999;
  if (ia !== ib) return ia - ib;
  return heatB - heatA || codeA.localeCompare(codeB);
}
