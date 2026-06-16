#!/usr/bin/env node
/**
 * 港股打新分析 API
 * - GET  /api/stock-analysis          读取预生成 JSON 全量
 * - GET  /api/stock-analysis/:code    按代码读取单只
 * - POST /api/get-stock-analysis      实时研判（仅供后端脚本/调试）
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const { runStockAnalysisPipeline } = require(path.join(ROOT, 'stockAnalysisPipeline.js'));

const PORT = Number(process.env.IPO_API_PORT || 8788);
const ANALYSIS_STORE_PATH = path.join(
  ROOT,
  process.env.IPO_ANALYSIS_STORE_PATH || 'data/ipo-analysis-db.json',
);
const ANALYSIS_MIRROR_PATH = path.join(ROOT, 'data/ipo-stock-analysis.json');

function normCode(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length <= 5 ? d.padStart(5, '0') : d.slice(-5).padStart(5, '0');
}

function readAnalysisStore() {
  try {
    const raw = fs.readFileSync(ANALYSIS_STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.stocks && typeof data.stocks === 'object') return data;
    if (data && typeof data === 'object') return { version: 1, updatedAt: null, stocks: data };
    return { version: 1, updatedAt: null, stocks: {} };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      try {
        const raw = fs.readFileSync(ANALYSIS_MIRROR_PATH, 'utf8');
        return JSON.parse(raw);
      } catch {
        return { version: 1, updatedAt: null, stocks: {} };
      }
    }
    throw err;
  }
}

const app = express();

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ipo-analysis-api', port: PORT });
});

/** GET 预生成分析库（前端只读） */
app.get('/api/stock-analysis', (req, res) => {
  try {
    const store = readAnalysisStore();
    const code = normCode(req.query.code);
    if (code) {
      const hit = store.stocks[code];
      if (!hit || !hit.dimensions) {
        return res.json({ ok: false, pending: true, code });
      }
      return res.json({ ok: true, code, ...hit });
    }
    return res.json({ ok: true, ...store });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.get('/api/stock-analysis/:code', (req, res) => {
  try {
    const code = normCode(req.params.code);
    if (!code) return res.status(400).json({ ok: false, error: '无效股票代码' });
    const store = readAnalysisStore();
    const hit = store.stocks[code];
    if (!hit || !hit.dimensions) {
      return res.json({ ok: false, pending: true, code });
    }
    return res.json({ ok: true, code, ...hit });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * POST /api/get-stock-analysis（后端脚本写入 JSON 前可用来生成；浏览器前端请勿调用）
 * Body: { stockName?, code?, row? }
 */
app.post('/api/get-stock-analysis', async (req, res) => {
  const body = req.body || {};
  const stockName = String(body.stockName || body.name || '').trim();
  const code = String(body.code || '').trim();
  const row = body.row && typeof body.row === 'object' ? body.row : undefined;

  if (!stockName && !code && !row) {
    return res.status(400).json({ ok: false, error: '请提供 stockName、code 或 row' });
  }

  try {
    const result = await runStockAnalysisPipeline({ stockName, code, row });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error('[ipo-api] get-stock-analysis', msg);
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`[ipo-api] listening on http://127.0.0.1:${PORT}`);
  console.log(`[ipo-api] GET  http://127.0.0.1:${PORT}/api/stock-analysis`);
  console.log(`[ipo-api] store: ${ANALYSIS_STORE_PATH}`);
});
