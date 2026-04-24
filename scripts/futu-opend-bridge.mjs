#!/usr/bin/env node
/**
 * 将富途 OpenD 的 WebSocket 行情桥成 JSON HTTP，供浏览器 / ipo-futu-dbl.js 无 CORS 地访问。
 *
 * 前置：本机已登录并运行「富途 OpenD / Moomoo OpenD」，并在 OpenD → API 设置 中创建连接密钥（WebSocket 行情端口一般 33333，不是 11111；11111 为另一路 TCP）。
 *
 * 使用：
 *   FUTU_OPEND_KEY=你的WebSocket密钥 npm run futu-bridge
 * 或
 *   export FUTU_OPEND_KEY=xxx
 *   npm run futu-bridge
 *
 * 接口：GET /quote?code=HK.02726  或  /v1/quote?market=hk&code=02726
 * 返回：{ cur, pct, high, low, name, source: "futu-opend-bridge" }
 */
import http from 'http';
import { URL } from 'url';
import ftWebsocket from 'futu-api/main.js';

const PORT = parseInt(process.env.BRIDGE_PORT || '19999', 10) || 19999;
const HOST = process.env.FUTU_OPEND_HOST || '127.0.0.1';
/** 行情 WebSocket 端口，OpenD 内「API-websocket」可查看，常见 33333 */
const WS_PORT = parseInt(process.env.FUTU_WS_PORT || '33333', 10) || 33333;
const KEY = process.env.FUTU_OPEND_KEY != null ? String(process.env.FUTU_OPEND_KEY) : '';
const QOT_MARKET_HK = 1;

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const j = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(j);
}

function parseCode5(url) {
  const q = url.searchParams;
  const raw = q.get('code') || q.get('security') || '';
  const s = String(raw)
    .trim()
    .toUpperCase();
  if (!s) return null;
  const m = s.match(/(\d{4,5})/);
  if (!m) return null;
  return m[1].padStart(5, '0');
}

/**
 * 单次连接拉取 Qot_GetSecuritySnapshot（无需提前订阅；仍须 OpenD 已登录且密钥有效）
 */
function getSnapshotHk(hk5) {
  return new Promise((resolve, reject) => {
    const code = String(hk5)
      .replace(/\D/g, '')
      .padStart(5, '0');
    if (!/^\d{5}$/.test(code)) {
      reject(new Error('invalid code'));
      return;
    }

    if (!KEY) {
      reject(new Error('FUTU_OPEND_KEY 未设置：请在 OpenD → API 中复制「WebSocket API」密钥，并执行 FUTU_OPEND_KEY=... npm run futu-bridge'));
      return;
    }

    const ws = new ftWebsocket();
    const t = setTimeout(() => {
      try {
        ws.stop();
      } catch (e) {
        /* */
      }
      reject(new Error('opend 请求超时（检查 OpenD 是否在线、WebSocket 端口 ' + WS_PORT + ' 及密钥）'));
    }, 12000);

    ws.onlogin = (ret, msg) => {
      if (!ret) {
        clearTimeout(t);
        try {
          ws.stop();
        } catch (e) {
          /* */
        }
        reject(new Error(String(msg || 'OpenD 登录/握手失败（密钥或端口）')));
        return;
      }

      const req = {
        c2s: {
          securityList: [{ market: QOT_MARKET_HK, code }],
        },
      };
      ws.GetSecuritySnapshot(req)
        .then(res => {
          clearTimeout(t);
          try {
            ws.stop();
          } catch (e) {
            /* */
          }
          const list = res && res.s2c && res.s2c.snapshotList;
          if (!list || !list.length) {
            resolve({ ok: false, err: 'empty snapshot' });
            return;
          }
          const snap = list[0];
          const b = snap && snap.basic;
          if (!b) {
            resolve({ ok: false, err: 'no basic' });
            return;
          }
          const last = Number(b.lastClosePrice) || 0;
          const cur = Number(b.curPrice);
          const pct = last > 0 ? ((cur - last) / last) * 100 : null;
          resolve({
            ok: true,
            fromOpenD: true,
            name: b.name,
            cur,
            last,
            price: cur,
            pct: pct == null || Number.isNaN(pct) ? null : Math.round(pct * 100) / 100,
            chg: pct == null || Number.isNaN(pct) ? null : Math.round(pct * 100) / 100,
            high: b.highPrice != null ? +b.highPrice : null,
            low: b.lowPrice != null ? +b.lowPrice : null,
            open: b.openPrice != null ? +b.openPrice : null,
            source: 'futu-opend-bridge',
            news: [],
          });
        })
        .catch(err => {
          clearTimeout(t);
          try {
            ws.stop();
          } catch (e) {
            /* */
          }
          reject(err);
        });
    };

    try {
      ws.start(HOST, WS_PORT, false, KEY);
    } catch (e) {
      clearTimeout(t);
      reject(e);
    }
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    send(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const p = (u.pathname || '/').replace(/\/$/, '') || '/';
  if (p === '/health' || p === '/') {
    send(res, 200, {
      ok: true,
      opend: {
        host: HOST,
        wsPort: WS_PORT,
        keySet: !!KEY,
        hint: 'GET /quote?code=HK.00700',
      },
    });
    return;
  }

  if (p === '/quote' || p === '/v1/quote' || p === '/api/quote') {
    const code5 = parseCode5(u);
    if (!code5) {
      send(res, 400, { error: 'Need code=HK.xxxxx' });
      return;
    }
    try {
      const j = await getSnapshotHk(code5);
      if (j.ok === false) {
        send(res, 502, { error: j.err || 'snapshot fail' });
        return;
      }
      send(res, 200, j);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      send(res, 503, { error: msg, from: 'futu-opend-bridge' });
    }
    return;
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    [
      '[futu-opend-bridge] listening http://127.0.0.1:' + PORT,
      '  FUTU_OPEND_HOST=' + HOST + '  FUTU_WS_PORT=' + WS_PORT,
      '  密钥: ' + (KEY ? '已设置' : '未设置 — 请设置 FUTU_OPEND_KEY'),
      '  测试: curl "http://127.0.0.1:' + PORT + '/quote?code=HK.00700"',
    ].join('\n'),
  );
});
