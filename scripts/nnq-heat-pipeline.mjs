#!/usr/bin/env node
/**
 * NNQ 舆情数据管道：Google Sheet 上市新股 → 定向个股评论 + 牛牛圈 IPO 帖 → nnq-heat.json
 *
 * 用法:
 *   node scripts/nnq-heat-pipeline.mjs
 *   node scripts/nnq-heat-pipeline.mjs --sheet-only   # 仅 Sheet 合并，不重跑爬虫
 *
 * 环境变量:
 *   FUTU_LOGIN_UID / FUTU_LOGIN_PASSWORD  富途登录（完整抓取必填）
 *   NNQ_HEAT_JSON_OUT                     输出路径，默认 ./nnq-heat.json
 *   NNQ_HEAT_UPDATE_HOURS                 调度间隔（小时），默认 6
 *   NNQ_STOCK_TARGET_LIMIT                Sheet 定向抓取新股数量，默认 20
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScrapeTargetsFromSheet, loadSheetListedSnapshot } from './lib/sheet-targets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pyDir = path.join(repoRoot, 'scripts', 'nnq_heat_monitor');
const jsonOut = path.resolve(repoRoot, process.env.NNQ_HEAT_JSON_OUT || 'nnq-heat.json');
const sheetOnly = process.argv.includes('--sheet-only');

function log(msg) {
  console.log(`[nnq-heat-pipeline] ${msg}`);
}

async function previewTargets() {
  try {
    const [targets, snapshot] = await Promise.all([
      loadScrapeTargetsFromSheet(),
      loadSheetListedSnapshot(),
    ]);
    log(`Sheet 上市新股共 ${snapshot.totalCount} 条 · 定向抓取 ${targets.length} 只`);
    targets.slice(0, 5).forEach((t) => log(`  · ${t.name} (${t.code}) ${t.sortDate}`));
  } catch (e) {
    log(`Sheet 目标预览失败: ${e.message}`);
  }
}

function runPython(args, label) {
  const res = spawnSync('python3', args, {
    cwd: repoRoot,
    env: { ...process.env, PYTHONPATH: pyDir },
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout || `${label} failed`);
    process.exit(res.status || 1);
  }
  if (res.stdout?.trim()) process.stdout.write(res.stdout);
  return res.stdout;
}

async function main() {
  await previewTargets();

  if (sheetOnly) {
    log('仅执行 Sheet 合并…');
    const sync = spawnSync('node', [path.join(repoRoot, 'scripts', 'sheet-ipo-sync.mjs'), jsonOut], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    process.exit(sync.status || 0);
  }

  if (!process.env.FUTU_LOGIN_UID || !process.env.FUTU_LOGIN_PASSWORD) {
    console.error('请设置 FUTU_LOGIN_UID 与 FUTU_LOGIN_PASSWORD');
    process.exit(1);
  }

  log('启动 Python 抓取（牛牛圈 + 个股评论区 + 统一清洗）…');
  runPython([path.join(pyDir, 'nnq_heat_monitor.py')], 'nnq heat monitor');

  if (!fs.existsSync(jsonOut)) {
    console.error(`未找到输出文件 ${jsonOut}`);
    process.exit(1);
  }

  log('刷新 Sheet universe / sheetListedSnapshot…');
  const sync = spawnSync('node', [path.join(repoRoot, 'scripts', 'sheet-ipo-sync.mjs'), jsonOut], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (sync.status !== 0) {
    process.exit(sync.status || 1);
  }

  log(`完成 → ${jsonOut}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
