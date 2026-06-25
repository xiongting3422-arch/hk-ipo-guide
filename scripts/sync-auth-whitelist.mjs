#!/usr/bin/env node
/**
 * 从 Google Sheet Whitelist 页签同步邮箱名单到 data/auth-whitelist.json
 * 供 auth.js 在无法访问 Google 时（如大陆手机网络）作同源回退。
 *
 * 用法：node scripts/sync-auth-whitelist.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'auth-whitelist.json');

const PUBLISH_BASE =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5R7a29N0wHqOVKXO7Dx016Z_DV0IQ5n16IaTMSPWF2QOqwqud1ViC1Llp0MFwZep8qMUGW_-9SCBU/pub';
const WHITELIST_GID = '1722347318';

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else q = !q;
    } else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => String(s || '').trim());
}

function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (!cells.some((s) => s)) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function pickEmails(rows) {
  const set = new Set();
  for (const row of rows) {
    const keys = Object.keys(row || {});
    const key =
      keys.find((k) => /^email$/i.test(String(k).trim())) ||
      keys.find((k) => /邮箱|郵箱/i.test(String(k)));
    const em = normalizeEmail(key ? row[key] : '');
    if (em) set.add(em);
  }
  return [...set].sort();
}

async function main() {
  const url = `${PUBLISH_BASE}?gid=${WHITELIST_GID}&single=true&output=csv`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const emails = pickEmails(parseCsv(await res.text()));
  if (!emails.length) throw new Error('Whitelist 为空');
  const payload = {
    updatedAt: new Date().toISOString(),
    source: `Google Sheet · Whitelist (gid=${WHITELIST_GID})`,
    emails,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[sync-auth-whitelist] 已写入 ${emails.length} 个邮箱 → ${OUT}`);
}

main().catch((e) => {
  console.error('[sync-auth-whitelist] 失败:', e.message || e);
  process.exit(1);
});
