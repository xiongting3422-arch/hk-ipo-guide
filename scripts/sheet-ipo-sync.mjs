#!/usr/bin/env node
/**
 * 从 Google Sheet「上市新股」拉取数据，合并到 nnq-heat.json（无需重跑爬虫）。
 * 用法: node scripts/sheet-ipo-sync.mjs [nnq-heat.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const jsonPath = path.resolve(repoRoot, process.argv[2] || 'nnq-heat.json');

const py = spawnSync(
  'python3',
  [
    '-c',
    `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(repoRoot, 'scripts', 'nnq_heat_monitor'))})
from sheet_ipo_sync import enrich_payload_with_sheet
p = json.loads(open(${JSON.stringify(jsonPath)}, encoding='utf-8').read())
enrich_payload_with_sheet(p)
print(json.dumps(p, ensure_ascii=False, indent=2))
`,
  ],
  { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
);

if (py.status !== 0) {
  console.error(py.stderr || py.stdout || 'Python enrich failed');
  process.exit(py.status || 1);
}

fs.writeFileSync(jsonPath, `${py.stdout.trim()}\n`, 'utf-8');
console.log(`Updated ${jsonPath} with sheetIpoUniverse, sheetListedSnapshot, sectorHeatFromSheet`);
