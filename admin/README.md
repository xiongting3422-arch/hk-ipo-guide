# IPO 轮播管理后台

用于管理网站两处轮播，无需每次改 `index.html` 或手动替换静态文件路径：

| 位置 | 配置键 | 说明 |
|------|--------|------|
| **IPO 主页** Tab 统计卡片下方 | `home` | 宽横幅，建议 **2800×280**；≥2 张时自动轮播 |
| **新股资讯** Tab 顶部 | `news` | 方图轮播，建议 **1:1**、单张 ≤500KB；可配外链 |

访客端从 [`data/site-banners.json`](../data/site-banners.json) 读取配置；图片保存在 `assets/images/` 对应目录。

## 快速开始

1. 安装依赖（项目根目录）：

   ```bash
   npm install
   ```

2. 复制环境变量并设置管理密码：

   ```bash
   cp .env.example .env
   # 编辑 .env，设置 BANNER_ADMIN_PASSWORD=你的强密码
   ```

3. 启动管理 API：

   ```bash
   npm run admin:banners
   ```

4. 浏览器打开：**http://127.0.0.1:8787/admin/**

5. 在画廊中 **添加图片**、**删除**、**↑↓ 调整顺序** → **保存配置** → **发布到线上**

## 让线上访客看到更新

站点托管在 **GitHub Pages**，管理后台默认只写入本机文件。任选一种方式发布：

### 方式 A：一键发布到 GitHub（推荐）

在 `.env` 中配置：

- `GITHUB_TOKEN`：Personal Access Token，需 `repo` 权限  
- `GITHUB_REPO`：默认 `xiongting3422-arch/hk-ipo-guide`  
- `GITHUB_BRANCH`：默认 `main`

保存后点击后台 **「发布到 GitHub（线上生效）」**，约 1–2 分钟 Pages 刷新后，所有访客可见。

### 方式 B：手动 git push

```bash
git add data/site-banners.json assets/images/
git commit -m "chore: 更新轮播图"
git push
```

## 本地预览主站

```bash
npm run preview
# 打开 http://127.0.0.1:5173/index.html
```

## 安全说明

- 切勿将 `.env` 或 `GITHUB_TOKEN` 提交到仓库  
- 管理密码仅保存在服务器环境变量中  
- 不要将管理 API 暴露到公网而不加反向代理 / IP 限制（若需远程管理，建议部署到带 HTTPS 的私有环境）
