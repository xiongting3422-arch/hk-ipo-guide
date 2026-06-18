#!/usr/bin/env node
/**
 * 网页驱动 · 按需增量新股六维审计
 *
 * 1. 读取/生成 data/ipo-list.json（与网页横滑 6 卡一致）
 * 2. 对比 data/ipo-analysis-db.json，找出缺分析标的
 * 3. 仅对缺数标的从 Google Sheet 精准捞一行
 * 4. Claude ECM Lead 人设审计 → 追加写入 DB → git push
 *
 * 用法：
 *   node scripts/run-ipo-audit.js
 *   node scripts/run-ipo-audit.js --refresh-roster
 *   node scripts/run-ipo-audit.js --code=01392
 *   node scripts/run-ipo-audit.js --dry-run --no-push
 *   node scripts/run-ipo-audit.js --code=02335 --verbose
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ROSTER_PATH = path.join(ROOT, 'data/ipo-list.json');
const DB_PATH = path.join(ROOT, 'data/ipo-analysis-db.json');
const FRONTEND_MIRROR_PATH = path.join(ROOT, 'data/ipo-stock-analysis.json');

const { buildRosterPayload, normStockCode } = require('../lib/ipo-roster');
const {
  fetchListedSheetRows,
  findStockRow,
  runStockAnalysisPipeline,
} = require('../stockAnalysisPipeline');

function parseArgs(argv) {
  const flags = {
    refreshRoster: false,
    dryRun: false,
    noPush: false,
    verbose: false,
    code: null,
    limit: 1,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--refresh-roster') flags.refreshRoster = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--no-push') flags.noPush = true;
    else if (arg === '--verbose' || arg === '-v') flags.verbose = true;
    else if (arg === '--all') flags.limit = 99;
    else if (arg.startsWith('--code=')) flags.code = normStockCode(arg.split('=')[1]);
    else if (arg.startsWith('--limit=')) flags.limit = Math.max(1, parseInt(arg.split('=')[1], 10) || 1);
  }
  return flags;
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn('[run-ipo-audit] 读取失败', filePath, e.message);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function hasCompleteAnalysis(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!entry.dimensions || typeof entry.dimensions !== 'object') return false;
  const keys = ['cornerstone', 'greenshoe', 'sponsor', 'financial', 'fundamental', 'valuation'];
  return keys.every(k => {
    const dim = entry.dimensions[k];
    return dim && dim.one_liner && String(dim.one_liner).trim() && dim.one_liner !== '—';
  });
}

function loadAnalysisDb() {
  const raw = readJson(DB_PATH, { version: 1, updatedAt: null, stocks: {} });
  if (!raw.stocks || typeof raw.stocks !== 'object') raw.stocks = {};
  return raw;
}

function saveAnalysisDb(db) {
  db.updatedAt = new Date().toISOString();
  writeJson(DB_PATH, db);
  writeJson(FRONTEND_MIRROR_PATH, db);
}

async function loadOrBuildRoster(flags) {
  if (!flags.refreshRoster && fs.existsSync(ROSTER_PATH)) {
    const cached = readJson(ROSTER_PATH, null);
    if (cached && Array.isArray(cached.stocks) && cached.stocks.length) {
      console.log('[run-ipo-audit] 名册来源: ipo-list.json ·', cached.stocks.length, '只');
      return cached;
    }
  }

  console.log('[run-ipo-audit] 从 Google Sheet 生成网页展示名册…');
  const rows = await fetchListedSheetRows();
  const roster = buildRosterPayload(rows);
  if (!flags.dryRun) writeJson(ROSTER_PATH, roster);
  console.log(
    '[run-ipo-audit] 名册已',
    flags.dryRun ? '计算（dry-run 未写入）' : '写入',
    ROSTER_PATH,
    '·',
    roster.stocks.map(s => s.name).join('、') || '(空)',
  );
  return roster;
}

function findPendingStocks(roster, db, flags) {
  const stocks = (roster.stocks || []).filter(s => s.code && s.name);
  if (flags.code) {
    const target = stocks.filter(s => normStockCode(s.code) === flags.code);
    if (!target.length) {
      throw new Error(`代码 ${flags.code} 不在当前网页展示名册中`);
    }
    return target.slice(0, flags.limit);
  }
  return stocks.filter(s => !hasCompleteAnalysis(db.stocks[normStockCode(s.code)])).slice(0, flags.limit);
}

function analysisToDbEntry(result) {
  return {
    stockName: result.stockName,
    code: normStockCode(result.code),
    summary: result.summary,
    dimensions: result.dimensions,
    totalScore: result.totalScore,
    avgScore: result.avgScore,
    maxTotalScore: result.maxTotalScore,
    radarScores: result.radarScores,
    machineScores: result.machineScores,
    meta: result.meta,
  };
}

function gitPushDeploy(flags, commitMsg) {
  if (flags.dryRun || flags.noPush) {
    console.log('[run-ipo-audit] 跳过 git push（dry-run / --no-push）');
    return;
  }
  const files = [
    'data/ipo-list.json',
    'data/ipo-analysis-db.json',
    'data/ipo-stock-analysis.json',
  ];
  try {
    execSync('git rev-parse --git-dir', { cwd: ROOT, stdio: 'pipe' });
  } catch {
    console.warn('[run-ipo-audit] 非 git 仓库，跳过 push');
    return;
  }
  for (const rel of files) {
    if (fs.existsSync(path.join(ROOT, rel))) {
      execSync(`git add ${rel}`, { cwd: ROOT, stdio: 'inherit' });
    }
  }
  try {
    execSync(`git diff --cached --quiet`, { cwd: ROOT, stdio: 'pipe' });
    console.log('[run-ipo-audit] 无变更可提交');
    return;
  } catch {
    /* has staged changes */
  }
  execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: ROOT, stdio: 'inherit' });
  const branch = process.env.GITHUB_BRANCH || 'main';
  execSync(`git push origin ${branch}`, { cwd: ROOT, stdio: 'inherit' });
  console.log('[run-ipo-audit] 已 push origin', branch);
}

function printVerboseAudit(entry) {
  console.log('\n===== 六维审计 JSON（完整） =====');
  console.log(
    JSON.stringify(
      {
        stockName: entry.stockName,
        code: entry.code,
        summary: entry.summary,
        totalScore: entry.totalScore,
        avgScore: entry.avgScore,
        radarScores: entry.radarScores,
        machineScores: entry.machineScores,
        dimensions: entry.dimensions,
        meta: entry.meta,
      },
      null,
      2,
    ),
  );
}

async function auditOneStock(stock, sheetRows, flags) {
  const code = normStockCode(stock.code);
  const name = stock.name;
  console.log(`\n[run-ipo-audit] ▶ 定向审计 ${name} (${code})`);

  const row = findStockRow(sheetRows, { code, stockName: name });
  if (!row) throw new Error(`表格中未找到 ${name} / ${code}`);

  const result = await runStockAnalysisPipeline(
    { code, stockName: name, row },
    { systemPrompt: 'ecm-lead', source: 'run-ipo-audit' },
  );

  console.log(
    `[run-ipo-audit] ✓ ${name} 总分 ${result.totalScore} · 模型 ${result.meta?.model || '—'}`,
  );
  const entry = analysisToDbEntry(result);
  if (flags && flags.verbose) printVerboseAudit(entry);
  return entry;
}

async function main() {
  const flags = parseArgs(process.argv);
  console.log('[run-ipo-audit] 网页驱动增量审计启动', flags.dryRun ? '(dry-run)' : '');

  const roster = await loadOrBuildRoster(flags);
  const db = loadAnalysisDb();
  const pending = findPendingStocks(roster, db, flags);

  if (!pending.length) {
    console.log('[run-ipo-audit] 当前展示名册全部已有六维分析，无需审计');
    return;
  }

  console.log(
    '[run-ipo-audit] 待审计',
    pending.length,
    '只:',
    pending.map(s => s.name).join('、'),
  );

  const sheetRows = await fetchListedSheetRows();
  const audited = [];

  for (const stock of pending) {
    const entry = await auditOneStock(stock, sheetRows, flags);
    const code = normStockCode(entry.code);
    db.stocks[code] = entry;
    audited.push(entry.stockName || code);
    if (!flags.dryRun) saveAnalysisDb(db);
  }

  if (!flags.dryRun) {
    saveAnalysisDb(db);
    gitPushDeploy(
      flags,
      `chore(audit): 增量六维分析 ${audited.join('、')}`,
    );
  }

  console.log('\n[run-ipo-audit] 完成 · 本次审计', audited.length, '只');
}

main().catch(err => {
  console.error('[run-ipo-audit] 失败:', err.message || err);
  process.exit(1);
});
