# 新股资讯限额监控（打新时间表 · 前 20 行）

从 Google Sheets **「打新时间表」**（`IPO_SCHEDULE_SHEET`，默认此名）**自上而下**扫描：不做招股日期、状态等筛选；**跳过无名称或无代码的行**；**同一代码只保留第一次出现**；凑满 **`IPO_NEWS_MAX_SCHEDULE_STOCKS`（默认 20）** 只后停止。表格排序完全由你在 Sheet 中维护。

**表头行**：自动在前 16 行内寻找「名称/代码/证券」等关键词最多的一行作为表头（适合表顶有标题区的情况）。若仍解析失败，可设 **`IPO_SCHEDULE_COL_NAME`**、**`IPO_SCHEDULE_COL_CODE`** 为名称列、代码列的 **Excel 列号（1 起算）**，例如 `2` 和 `5`。

然后对每只标的：**智通财经** → **阿思达克** → **富途**（urllib HTML，不足再 Playwright）；股票间 **10–20 秒**随机休眠，每 **5** 只再休眠 **120 秒**；`User-Agent` 优先 **fake-useragent**。默认 **`IPO_NEWS_TITLE_FILTER=0`**；**`IPO_NEWS_AGGREGATE_ALWAYS` 默认 `0`**（仅三源）；需要门户兜底时设为 `1` 或调 `IPO_NEWS_AGGREGATE_MIN`。

合并后会按 **`IPO_NEWS_MAX_AGE_DAYS`（默认 120，写入 JSON 的 `maxNewsAgeDays`）** 丢弃过久条目，再写入 `ipo_news.json`。

### 门户列表兜底（主流程条数偏少时）

当 **`IPO_NEWS_AGGREGATE_ALWAYS=1`** 或主流程条数低于 **`IPO_NEWS_AGGREGATE_MIN`** 时，额外 HTTP 抓取下列列表（默认 **不启用**，与「仅三源」一致）：

| 说明 | URL |
|------|-----|
| 阿思达克新股上市消息 | [iponews.aspx](https://www.aastocks.com/tc/stocks/market/ipo/iponews.aspx) |
| 新浪港股 | [finance.sina.com.cn/stock/hkstock/](https://finance.sina.com.cn/stock/hkstock/) |
| 英为财情 IPO 新闻搜索 | [cn.investing.com 搜索 IPO](https://cn.investing.com/search/?q=IPO&tab=news) |
| 香港经济日报 inews 新股 | [inews.hket.com 新股 IPO](https://inews.hket.com/sran009-2/%E6%96%B0%E8%82%A1IPO)（部分机房 IP 会 **403**，属站点策略） |

**未接入**：[LiveReport 云研报](https://cloud.livereport8.com/#/originalNews/index) 为前端 Hash 路由 SPA，无稳定公开 HTML 列表接口，纯 urllib 无法可靠解析；若需接入需自行抓包其 API 或改用有头浏览器。

## `ipo_news.json` 与前端

脚本每次写入的顶层字段包括：

- **`monitoredCodes`**、**`stocksInWindow`**：当前「打新时间表」前段解析到的代码与名称；静态页会**只展示与这些标的相关**且在 `maxNewsAgeDays` 内的条目，避免混入无关或过旧泛资讯。
- **`maxNewsAgeDays`**：与脚本裁剪一致，前端二次过滤对齐。
- **`allowFinetFallback` / `useFinetWhenEmpty`**：未设为 `true` 时，页面在 JSON 无可用条目时**不会**自动拉 Finet 泛港股资讯；需要临时兜底时在 JSON 中设为 `true` 即可。

## 环境变量

| 变量 | 说明 |
|------|------|
| `GOOGLE_APPLICATION_CREDENTIALS` | 服务账号 JSON |
| `IPO_NEWS_SPREADSHEET_ID` | 表格 ID |
| `IPO_SCHEDULE_SHEET` | 可选，默认 **`打新时间表`** |
| `IPO_NEWS_MAX_SCHEDULE_STOCKS` | 可选，默认 **`20`** |
| `IPO_NEWS_JSON_MAX_ITEMS` | 可选，默认 **`200`**（合并后 `items` 上限） |
| `IPO_NEWS_MAX_AGE_DAYS` | 可选，默认 **`120`**（过久条目不入库；写入 `maxNewsAgeDays`） |
| `IPO_NEWS_AGGREGATE_MIN` | 可选，默认 **`8`**；当 **`IPO_NEWS_AGGREGATE_ALWAYS=0`** 时，主流程新增条数低于此值才启用门户兜底 |
| `IPO_NEWS_IGNORE_EXISTING_JSON` | 可选，默认 **`0`**；设为 **`1`** 时**不再合并**旧 `ipo_news.json` 里的条目，写入结果**仅含本轮抓取**（列表更贴近当前，但不再保留往轮历史） |
| `IPO_NEWS_AGGREGATE_ALWAYS` | 可选，默认 **`0`**；设为 **`1`** 则每次合并门户 IPO 列表 |
| `IPO_NEWS_RELAX_PREFIX_MAX` | 可选，默认 **`4`**；兜底时名称前缀简称最长字数 |
| `IPO_NEWS_TITLE_FILTER` | 可选，默认 **`0`**（标题或链接匹配）；设为 **`1`** 则仅标题匹配 |
| `IPO_SCHEDULE_COL_NAME` | 可选，名称所在列 **1-based**（与 `IPO_SCHEDULE_COL_CODE` 成对使用） |
| `IPO_SCHEDULE_COL_CODE` | 可选，代码所在列 **1-based** |
| `IPO_NEWS_JSON_OUT` | 可选，输出路径 |
| `IPO_NEWS_SHEET` | 可选，「最新资讯」工作表名 |

## 表头要求

至少能匹配到 **股票名称**（或 名称 / IPO名称 等）与 **股票代码**（或 代码 / 证券代码 等）列；否则前段行会被跳过。

## 运行

```bash
cd scripts/ipo_news_monitor
# 或一行：pip install gspread pandas playwright fake-useragent google-auth python-dotenv
pip install -r requirements.txt
playwright install chromium
export GOOGLE_APPLICATION_CREDENTIALS=...
export IPO_NEWS_SPREADSHEET_ID=...
python ipo_news_monitor.py
```

将生成的 **`ipo_news.json`** 与静态页一同部署。

## 为什么页面上新闻仍偏「旧」？

常见原因与对应处理：

1. **脚本在「增量合并」旧文件**  
   默认会把磁盘上已有 `ipo_news.json` 里的条目与本轮抓取合并，再按 `IPO_NEWS_MAX_AGE_DAYS`（默认 120 天）裁剪。若本轮新抓很少，列表里仍会混大量几天前～几十天前仍合法的历史稿。  
   **处理**：跑脚本前设 `export IPO_NEWS_IGNORE_EXISTING_JSON=1`（仅本轮结果写入）；或把 `IPO_NEWS_MAX_AGE_DAYS` 改小（如 `14` 或 `30`）。

2. **站点解析不到时间**  
   部分来源解析失败会用占位时间，排序或观感会怪。  
   **处理**：看脚本日志；确认智通 / 阿思达克 / 富途可访问。

3. **浏览器或 CDN 缓存旧 JSON**  
   **处理**：前端已对 `ipo_news.json` 使用 `cache: no-store` 与时间戳；部署后强刷（Ctrl+F5）或无痕窗口。

4. **走了 Finet 或内嵌备用稿**  
   未读到有效 JSON 时会看到固定示例或泛资讯。  
   **处理**：确认线上 JSON 含 `items`；打新表资讯勿长期依赖 `allowFinetFallback`。
