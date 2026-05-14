# 新股资讯 · 静态图片说明

本目录只放 **「新股资讯」** Tab 里会用到的本地图（与 Finet 新闻列表无关，列表为文字链）。

## 顶部轮播（唯一使用本地图的区域）

| 槽位（从左到右） | 文件 | 说明 |
|------------------|------|------|
| 第 1 格 | `banner/slot-1.png` | 轮播最左侧 |
| 第 2 格 | `banner/slot-2.png` | |
| 第 3 格 | `banner/slot-3.png` | |
| 第 4 格 | `banner/slot-4.png` | 第 4 张可在 `index.html` 里配置外链 `href`（见 `IPO_NEWS_BANNER_IMAGES`） |

**维护方式：**

- **只换图、不改尺寸与数量**：直接覆盖对应 `slot-*.png`，保存后推送到 GitHub，线上即更新。
- **改跳转链接**：编辑 `index.html` 中 `IPO_NEWS_BANNER_IMAGES` 里对应项的 `href`（仅第 4 张当前带外链示例，可按需增删字段）。
- **增删轮播张数**：当前无缝滚动逻辑按 **4 张** 编写；若改为 3 张或 5 张，需同步改 `index.html` 里 `IPO_NEWS_BANNER_IMAGES` 与 `ensureIpoNewsBanner` 中 `slice(0, 4)` 等逻辑（或以后可改为读取 `manifest.json`）。

建议单张 **≤500KB**、约 **1:1** 方图，便于加载与排版。
