(function (global) {
  'use strict';

  /** 仅用于登录成功后记住邮箱以便输入框预填；不具备任何“授权令牌”含义，每次进入页面都会用实时名单覆盖校验 */
  var AUTH_EMAIL_KEY = 'auth_email';
  var LEGACY_KEYS = ['auth_status', 'auth_granted_at', 'auth_expires_at'];

  var SHEET_NAME = 'Whitelist';
  var STYLE_ID = 'ipo-auth-style';
  var OVERLAY_ID = 'ipo-auth-overlay';
  var pendingResolvers = [];
  var whitelistGidCache = null;

  function nowMs() {
    return Date.now();
  }

  function isLocalDevHost() {
    var h = String((global.location && global.location.hostname) || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  }

  function normalizeEmail(raw) {
    return String(raw || '').trim().toLowerCase();
  }

  function getStoredEmail() {
    try {
      return normalizeEmail(localStorage.getItem(AUTH_EMAIL_KEY) || '');
    } catch (e) {
      return '';
    }
  }

  /** 清除所有与权限相关的本地项（含历史字段），不信任任何本地“已授权”状态 */
  function clearAllAuthStorage() {
    try {
      localStorage.removeItem(AUTH_EMAIL_KEY);
      LEGACY_KEYS.forEach(function (k) {
        localStorage.removeItem(k);
      });
    } catch (e) {
      // noop
    }
  }

  function stripLegacyGrantKeys() {
    LEGACY_KEYS.forEach(function (k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {
        // noop
      }
    });
  }

  function persistEmailForPrefillOnly(email) {
    try {
      localStorage.setItem(AUTH_EMAIL_KEY, normalizeEmail(email));
    } catch (e) {
      // noop
    }
  }

  function resolvePending(ok) {
    var list = pendingResolvers.slice();
    pendingResolvers = [];
    list.forEach(function (fn) {
      try {
        fn(!!ok);
      } catch (e) {
        // noop
      }
    });
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      'html.__ipo-auth-locked body{overflow:hidden;}' +
      'html.__ipo-auth-locked body > *{visibility:hidden !important;}' +
      'html.__ipo-auth-locked body > #' + OVERLAY_ID + '{visibility:visible !important;}' +
      '#' + OVERLAY_ID + '{position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,#fff 0%,#fff7ed 100%);display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans SC",sans-serif;}' +
      '#' + OVERLAY_ID + ' .ipo-auth-card{width:min(460px,96vw);background:#fff;border:1px solid rgba(249,115,22,.2);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.16);padding:24px 22px;}' +
      '#' + OVERLAY_ID + ' .ipo-auth-title{font-size:22px;font-weight:800;color:#111827;letter-spacing:.01em;}' +
      '#' + OVERLAY_ID + ' .ipo-auth-sub{font-size:13px;color:#4b5563;line-height:1.65;margin-top:8px;}' +
      '#' + OVERLAY_ID + ' .ipo-auth-input{width:100%;margin-top:16px;padding:12px 13px;border-radius:10px;border:1px solid #d1d5db;font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s;}' +
      '#' + OVERLAY_ID + ' .ipo-auth-input:focus{border-color:#f97316;box-shadow:0 0 0 3px rgba(249,115,22,.14);}' +
      '#' + OVERLAY_ID + ' .ipo-auth-btn{margin-top:12px;width:100%;padding:12px 14px;background:#f97316;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;transition:background .15s;}' +
      '#' + OVERLAY_ID + ' .ipo-auth-btn:hover{background:#ea580c;}' +
      '#' + OVERLAY_ID + ' .ipo-auth-btn[disabled]{opacity:.68;cursor:not-allowed;}' +
      '#' + OVERLAY_ID + ' .ipo-auth-tip{font-size:12px;color:#6b7280;line-height:1.6;margin-top:10px;}' +
      '#' + OVERLAY_ID + ' .ipo-auth-error{margin-top:10px;min-height:22px;font-size:12px;color:#dc2626;line-height:1.5;}';
    document.head.appendChild(style);
  }

  function unlock() {
    if (document.documentElement) {
      document.documentElement.classList.remove('__ipo-auth-locked');
    }
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  function lock() {
    if (document.documentElement) {
      document.documentElement.classList.add('__ipo-auth-locked');
    }
  }

  function buildWhitelistCsvUrl(gid) {
    var cfg = global.__IPO_SHEET_CONFIG__ || {};
    var pub = String(cfg.publishBase || '').trim();
    if (!pub) return '';
    var base = pub.replace(/\?.*$/, '').replace(/\/+$/, '');
    if (!/\/pub$/i.test(base)) return '';
    if (gid != null && gid !== '') {
      return base + '?gid=' + encodeURIComponent(String(gid)) + '&single=true&output=csv&t=' + nowMs();
    }
    return '';
  }

  function buildPubHtmlUrl() {
    var cfg = global.__IPO_SHEET_CONFIG__ || {};
    var pub = String(cfg.publishBase || '').trim();
    if (!pub) return '';
    var base = pub.replace(/\?.*$/, '').replace(/\/+$/, '');
    if (!/\/pub$/i.test(base)) return '';
    return base.replace(/\/pub$/i, '/pubhtml');
  }

  function readWhitelistGidFromConfig() {
    var cfg = global.__IPO_SHEET_CONFIG__ || {};
    var gids = cfg.gids || {};
    if (gids.whitelist != null && String(gids.whitelist).trim() !== '') return String(gids.whitelist).trim();
    return null;
  }

  function escapeRegExp(raw) {
    return String(raw || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function parseWhitelistGidFromPubHtml(htmlText) {
    var html = String(htmlText || '');
    if (!html) return null;
    var name = escapeRegExp(SHEET_NAME);
    var reList = [
      new RegExp('name:\\s*"' + name + '"[\\s\\S]{0,260}gid:\\s*"([0-9]+)"', 'i'),
      new RegExp('name:\\s*"' + name + '"[\\s\\S]{0,260}?gid=([0-9]+)', 'i'),
      new RegExp('gid:\\s*"([0-9]+)"[\\s\\S]{0,260}name:\\s*"' + name + '"', 'i'),
    ];
    for (var i = 0; i < reList.length; i++) {
      var m = html.match(reList[i]);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  async function resolveWhitelistGid() {
    if (whitelistGidCache != null) return whitelistGidCache;
    var fromCfg = readWhitelistGidFromConfig();
    if (fromCfg) {
      whitelistGidCache = fromCfg;
      return whitelistGidCache;
    }
    var pubHtmlUrl = buildPubHtmlUrl();
    if (!pubHtmlUrl) return null;
    var res = await fetch(pubHtmlUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('Whitelist gid 解析失败: HTTP ' + res.status);
    var html = await res.text();
    var gid = parseWhitelistGidFromPubHtml(html);
    if (!gid) throw new Error('未找到 Whitelist 页签 gid');
    whitelistGidCache = gid;
    return whitelistGidCache;
  }

  function parseCsvRows(text) {
    if (global.Papa && typeof global.Papa.parse === 'function') {
      var parsed = global.Papa.parse(text, { header: true, skipEmptyLines: true });
      return Array.isArray(parsed.data) ? parsed.data : [];
    }

    var lines = String(text || '').split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];

    function parseLine(line) {
      var out = [];
      var cur = '';
      var q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (ch === '"') {
          if (q && line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            q = !q;
          }
        } else if (ch === ',' && !q) {
          out.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      return out.map(function (s) {
        return String(s || '').trim();
      });
    }

    var headers = parseLine(lines[0]);
    var rows = [];
    for (var l = 1; l < lines.length; l++) {
      var cells = parseLine(lines[l]);
      if (!cells.some(function (s) { return String(s || '').trim(); })) continue;
      var row = {};
      for (var c = 0; c < headers.length; c++) row[headers[c]] = cells[c] || '';
      rows.push(row);
    }
    return rows;
  }

  function pickWhitelistEmails(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    var emailHeaders = ['Email', 'email', '邮箱', '郵箱'];
    var set = new Set();
    rows.forEach(function (row) {
      var keys = Object.keys(row || {});
      var key = keys.find(function (k) {
        var n = String(k || '').trim();
        return emailHeaders.indexOf(n) >= 0;
      });
      if (!key) {
        key = keys.find(function (k) {
          var n = String(k || '').trim().toLowerCase();
          return n === 'email' || n.indexOf('邮箱') >= 0 || n.indexOf('郵箱') >= 0;
        });
      }
      var em = normalizeEmail(key ? row[key] : '');
      if (em) set.add(em);
    });
    return Array.from(set);
  }

  /**
   * 每次调用均发起网络请求拉取 Whitelist 页签 CSV，不使用名单结果内存缓存。
   * （gid 在同一会话内解析一次，减少不必要的 pubhtml 请求）
   */
  async function fetchWhitelistEmailsLive() {
    var gid = await resolveWhitelistGid();
    var url = buildWhitelistCsvUrl(gid);
    if (!url) throw new Error('未配置可用的 Google Sheets 发布地址');
    var res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Whitelist 拉取失败: HTTP ' + res.status);
    var text = await res.text();
    var rows = parseCsvRows(text);
    return pickWhitelistEmails(rows);
  }

  /**
   * 页面加载时：已实时拉取名单；仅当本地记录的邮箱仍存在于当前名单时才解锁。
   * 若名单中存在性校验失败：清空全部本地权限相关存储并维持锁定。
   */
  async function tryUnlockFromLiveWhitelist() {
    if (isLocalDevHost()) {
      unlock();
      console.log('[IPO Auth] 本地预览模式，已跳过授权验证');
      return true;
    }
    lock();
    var stored = getStoredEmail();
    var allowed;
    try {
      allowed = await fetchWhitelistEmailsLive();
    } catch (e) {
      console.warn('[IPO Auth] 实时拉取 Whitelist 失败', e);
      return false;
    }
    if (stored && allowed.indexOf(stored) >= 0) {
      unlock();
      console.log('✅ 身份校验通过，欢迎访问');
      return true;
    }
    if (stored) {
      clearAllAuthStorage();
      lock();
    }
    return false;
  }

  function removeExistingOverlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  function renderOverlay(prefillEmail) {
    if (!document.body) return;
    removeExistingOverlay();
    ensureStyles();
    lock();

    var box = document.createElement('div');
    box.id = OVERLAY_ID;
    box.innerHTML =
      '<div class="ipo-auth-card">' +
      '<div class="ipo-auth-title">访问授权验证</div>' +
      '<div class="ipo-auth-sub">请输入已授权邮箱；系统将实时对照 Google 表格 Whitelist 名单。</div>' +
      '<input class="ipo-auth-input" id="email-input" type="email" autocomplete="email" spellcheck="false" />' +
      '<button class="ipo-auth-btn" id="ipo-auth-submit" type="button">立即进入</button>' +
      '<div class="ipo-auth-tip">如需访问，请发送 姓名+邮箱 至管理员：xiongting3422@Gmail.com </div>' +
      '<div class="ipo-auth-error" id="ipo-auth-error"></div>' +
      '</div>';
    document.body.appendChild(box);

    var input = document.getElementById('email-input');
    var btn = document.getElementById('ipo-auth-submit');
    var err = document.getElementById('ipo-auth-error');
    if (input && prefillEmail) input.value = prefillEmail;

    async function handleSubmit() {
      if (!input || !btn || !err) return;
      var email = normalizeEmail(input.value);
      if (!email) {
        err.textContent = '请输入有效邮箱地址';
        input.focus();
        return;
      }
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = '验证中…';
      try {
        var allowed = await fetchWhitelistEmailsLive();
        if (allowed.indexOf(email) >= 0) {
          persistEmailForPrefillOnly(email);
          unlock();
          resolvePending(true);
          console.log('✅ 身份校验通过，欢迎访问');
          return;
        }
        clearAllAuthStorage();
        lock();
        err.textContent = '您的邮箱尚未获得授权，请联系管理员@vickyxiong（熊婷） 申请';
      } catch (e) {
        err.textContent = '授权服务暂时不可用，请稍后再试';
      } finally {
        btn.disabled = false;
        btn.textContent = '立即进入';
      }
    }

    btn.addEventListener('click', handleSubmit);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') handleSubmit();
    });
    input.focus();
  }

  async function waitForGrant() {
    stripLegacyGrantKeys();
    if (await tryUnlockFromLiveWhitelist()) return true;
    return new Promise(function (resolve) {
      pendingResolvers.push(resolve);
      renderOverlay(getStoredEmail() || '');
    });
  }

  async function bootstrap() {
    ensureStyles();
    if (isLocalDevHost()) {
      unlock();
      resolvePending(true);
      console.log('[IPO Auth] 本地预览模式，已跳过授权验证');
      return;
    }
    lock();
    stripLegacyGrantKeys();
    if (await tryUnlockFromLiveWhitelist()) {
      resolvePending(true);
      return;
    }
    renderOverlay(getStoredEmail() || '');
  }

  global.IPO_AUTH = {
    waitForGrant: waitForGrant,
    /** @deprecated 不再根据本地缓存判断授权；始终为 false，请使用 waitForGrant / 实时名单 */
    isGrantedAndValid: function () {
      return false;
    },
    fetchWhitelistEmails: fetchWhitelistEmailsLive,
    fetchWhitelistEmailsLive: fetchWhitelistEmailsLive,
  };

  ensureStyles();
  lock();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})(typeof window !== 'undefined' ? window : this);
