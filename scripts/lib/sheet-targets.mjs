/**
 * 从 Google Sheet「上市新股」读取定向抓取目标（Node 侧，供 pipeline 日志/校验）。
 */
import { fetchListedSheetRows, selectScrapeTargets } from './google-sheet-targets.mjs';

export async function loadScrapeTargetsFromSheet(options = {}) {
  const rows = await fetchListedSheetRows(options);
  return selectScrapeTargets(rows, options);
}
