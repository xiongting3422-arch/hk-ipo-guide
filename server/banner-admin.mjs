#!/usr/bin/env node
/**
 * 轮播图管理 API：上传图片、编辑 data/site-banners.json，可选一键发布到 GitHub Pages 仓库。
 *
 * 环境变量见项目根目录 .env.example
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadDotEnv();
const CONFIG_PATH = path.join(ROOT, 'data', 'site-banners.json');
const HOME_DIR = path.join(ROOT, 'assets', 'images', 'ipo-home-banner');
const NEWS_DIR = path.join(ROOT, 'assets', 'images', 'ipo-news', 'banner');
const ADMIN_DIR = path.join(ROOT, 'admin');

const PORT = Number(process.env.BANNER_ADMIN_PORT || 8787);
const ADMIN_PASSWORD = process.env.BANNER_ADMIN_PASSWORD || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'xiongting3422-arch/hk-ipo-guide';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function requireAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: '未配置 BANNER_ADMIN_PASSWORD，请在 .env 或环境变量中设置管理密码'
    });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!timingSafeEqual(token, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: '未授权' });
  }
  next();
}

async function readConfig() {
  const raw = await fsp.readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

async function writeConfig(config) {
  config.updatedAt = new Date().toISOString();
  await fsp.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return config;
}

function relAssetPath(absPath) {
  return './' + path.relative(ROOT, absPath).split(path.sep).join('/');
}

function safeId(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 48) || 'item';
}

async function saveUploadedImage(zone, file, idHint) {
  const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
  const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  if (!allowed.includes(ext)) {
    throw new Error('仅支持 PNG / JPG / WEBP / GIF');
  }
  const id = safeId(idHint || path.basename(file.originalname, ext));
  const stamp = Date.now();
  const dir = zone === 'home' ? HOME_DIR : NEWS_DIR;
  await fsp.mkdir(dir, { recursive: true });
  const filename = `${id}-${stamp}${ext}`;
  const abs = path.join(dir, filename);
  await fsp.writeFile(abs, file.buffer);
  return relAssetPath(abs);
}

async function githubGetSha(filePath) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub GET ${filePath}: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data.sha;
}

async function githubPutFile(filePath, contentBuffer, message) {
  const sha = await githubGetSha(filePath);
  const body = {
    message,
    content: contentBuffer.toString('base64'),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub PUT ${filePath}: ${res.status} ${t}`);
  }
}

/** 前台读取 JSON 轮播所依赖的静态文件，需与配置一并发布 */
const FRONTEND_PUBLISH_FILES = ['index.html', 'ipo-banners.js'];

async function collectPublishFiles(config) {
  const files = new Map();
  const add = async (relSrc) => {
    if (!relSrc || !relSrc.startsWith('./')) return;
    const rel = relSrc.replace(/^\.\//, '');
    const abs = path.join(ROOT, rel);
    try {
      const buf = await fsp.readFile(abs);
      files.set(rel, buf);
    } catch {
      // 外链或缺失文件跳过
    }
  };
  for (const item of [...(config.home || []), ...(config.news || [])]) {
    await add(item.src);
  }
  const configRel = 'data/site-banners.json';
  files.set(configRel, Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8'));
  for (const rel of FRONTEND_PUBLISH_FILES) {
    try {
      const buf = await fsp.readFile(path.join(ROOT, rel));
      files.set(rel, buf);
    } catch {
      console.warn('[banner-admin] 发布跳过缺失文件:', rel);
    }
  }
  return files;
}

async function publishToGitHub(config) {
  if (!GITHUB_TOKEN) {
    throw new Error('未配置 GITHUB_TOKEN，无法自动发布到 GitHub');
  }
  const files = await collectPublishFiles(config);
  const msg = `chore(banners): 更新轮播配置 ${config.updatedAt}`;
  for (const [rel, buf] of files) {
    await githubPutFile(rel, buf, msg);
  }
  return { published: files.size, repo: GITHUB_REPO, branch: GITHUB_BRANCH };
}

const app = express();
app.use(express.json({ limit: '2mb' }));

function safeAssetRel(raw) {
  let rel = String(raw || '').trim().replace(/^\.?\//, '');
  if (!rel.startsWith('assets/')) return null;
  const abs = path.resolve(ROOT, rel);
  const assetsRoot = path.resolve(ROOT, 'assets');
  if (!abs.startsWith(assetsRoot + path.sep) && abs !== assetsRoot) return null;
  return rel;
}

/** 管理后台缩略图（无需登录，仅允许 assets/ 下文件） */
app.get('/api/asset', (req, res) => {
  const rel = safeAssetRel(req.query.path);
  if (!rel) return res.status(400).send('invalid path');
  const abs = path.join(ROOT, rel);
  res.sendFile(abs, (err) => {
    if (err && !res.headersSent) res.status(404).send('not found');
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    passwordConfigured: !!ADMIN_PASSWORD,
    githubConfigured: !!GITHUB_TOKEN,
    adminUrl: `http://127.0.0.1:${PORT}/admin/`
  });
});

app.get('/api/config', requireAuth, async (_req, res) => {
  try {
    const config = await readConfig();
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/config', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const config = await writeConfig({
      updatedAt: body.updatedAt,
      home: Array.isArray(body.home) ? body.home : [],
      news: Array.isArray(body.news) ? body.news : []
    });
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const zone = req.body?.zone === 'home' ? 'home' : 'news';
    if (!req.file) return res.status(400).json({ error: '缺少文件 file' });
    const src = await saveUploadedImage(zone, req.file, req.body?.id);
    res.json({ ok: true, src, zone });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/publish', requireAuth, async (_req, res) => {
  try {
    const config = await readConfig();
    const result = await publishToGitHub(config);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.use('/data', express.static(path.join(ROOT, 'data')));
app.use('/admin', express.static(ADMIN_DIR));
app.get('/', (_req, res) => res.redirect('/admin/'));

app.listen(PORT, () => {
  console.log(`[banner-admin] http://127.0.0.1:${PORT}/admin/`);
  if (!ADMIN_PASSWORD) {
    console.warn('[banner-admin] 警告: 未设置 BANNER_ADMIN_PASSWORD，API 将拒绝写入');
  }
  if (GITHUB_TOKEN) {
    console.log(`[banner-admin] GitHub 发布已启用 → ${GITHUB_REPO}@${GITHUB_BRANCH}`);
  } else {
    console.log('[banner-admin] 未配置 GITHUB_TOKEN：保存仅写入本地，需自行 git push 后访客才可见');
  }
});
