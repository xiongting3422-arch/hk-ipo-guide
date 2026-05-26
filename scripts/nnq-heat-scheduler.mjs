#!/usr/bin/env node
/**
 * 每 6 小时执行一次 NNQ 舆情抓取管道（可通过 NNQ_HEAT_UPDATE_HOURS 覆盖间隔）。
 *
 * 用法:
 *   node scripts/nnq-heat-scheduler.mjs
 *   NNQ_HEAT_UPDATE_HOURS=6 node scripts/nnq-heat-scheduler.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pipeline = path.join(repoRoot, 'scripts', 'nnq-heat-pipeline.mjs');
const hours = Number(process.env.NNQ_HEAT_UPDATE_HOURS || 6);
const intervalMs = Math.max(1, hours) * 60 * 60 * 1000;

function runOnce() {
  return new Promise((resolve, reject) => {
    const started = new Date().toISOString();
    console.log(`[nnq-heat-scheduler] start ${started}`);
    const child = spawn('node', [pipeline], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`[nnq-heat-scheduler] done ${new Date().toISOString()}`);
        resolve(undefined);
      } else {
        reject(new Error(`pipeline exit ${code}`));
      }
    });
  });
}

async function loop() {
  for (;;) {
    try {
      await runOnce();
    } catch (e) {
      console.error('[nnq-heat-scheduler] error:', e.message || e);
    }
    console.log(`[nnq-heat-scheduler] next run in ${hours}h`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

runOnce()
  .then(() => loop())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
