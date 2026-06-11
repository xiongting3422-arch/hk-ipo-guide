#!/usr/bin/env node
/**
 * 港股打新分析 API：/api/get-stock-analysis
 * 启动：npm run api:ipo
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const { runStockAnalysisPipeline } = require(path.join(ROOT, 'stockAnalysisPipeline.js'));

const PORT = Number(process.env.IPO_API_PORT || 8788);
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

/**
 * POST /api/get-stock-analysis
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
  console.log(`[ipo-api] POST http://127.0.0.1:${PORT}/api/get-stock-analysis`);
});
