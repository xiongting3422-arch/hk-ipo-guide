# 新股资讯 · 静态图片说明

本目录只放 **「新股资讯」** Tab 里会用到的本地图（与 Finet 新闻列表无关，列表为文字链）。

## 顶部轮播（唯一使用本地图的区域）

| 槽位（从左到右） | 文件 | 说明 |
|------------------|------|------|
| 第 1 格 | `banner/slot-1.png` | 轮播最左侧 |
| 第 2 格 | `banner/slot-2.png` | |
| 第 3 格 | `banner/slot-3.png` | |
| 第 4 格 | `banner/slot-4.png` | 第 4 张可在 `index.html` 里配置外链 `href`（见 `IPO_NEWS_BANNER_IMAGES`） |

**维护方式（推荐）：**

使用 **轮播管理后台**：项目根目录执行 `npm run admin:banners`，打开 http://127.0.0.1:8787/admin/ 上传与管理。配置保存在 `data/site-banners.json`，详见 [`admin/README.md`](../../../admin/README.md)。

**手动维护（旧方式）：**

- **只换图**：覆盖 `slot-*.png` 并更新 `data/site-banners.json` 中对应 `src`。
- **改链接 / 增删张数**：编辑 `data/site-banners.json` 的 `news` 数组（前台会自动读取，无需改 `index.html`）。

建议单张 **≤500KB**、约 **1:1** 方图，便于加载与排版。
