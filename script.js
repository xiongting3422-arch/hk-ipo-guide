/**
 * 后台数据流：Google Sheet 双 Tab 抓取 → 双负破发筛选 → 跨表缝合 → Claude 高级金融审计师
 */
(function (global) {
  'use strict';

  const IPO_PUB_DEFAULT =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5R7a29N0wHqOVKXO7Dx016Z_DV0IQ5n16IaTMSPWF2QOqwqud1ViC1Llp0MFwZep8qMUGW_-9SCBU/pub';

  const GID_DEFAULT = { ipoHome: 1914717842, listed: 63719317 };

  /**
   * 高级金融审计 System 提示词（Claude API 的 system 角色）
   * 可在 script.js 加载前覆盖：window.CLAUDE_SYSTEM_PROMPT = '…'
   */
  const CLAUDE_SYSTEM_PROMPT_DEFAULT =
    '你现在是顶级国际投行的港股 IPO 高级金融审计师与一级市场簿记专家，拥有超过十五年港股市场配售、回拨机制、基石投资者尽调与二级市场承接分析经验。\n' +
    '你的唯一任务是：对用户随后提供的「破发标的全指标数据集」做穿透式审计分析。\n\n' +
    '【审计方法论】\n' +
    '1. 表现验证：以暗盘表现、首日表现为锚点，反向校验一级定价与簿记区间是否合理；\n' +
    '2. 配售结构：穿透甲乙组档位、申请人数、中签率、回拨比例与超额认购倍数之间的因果链；\n' +
    '3. 条款审计：核查绿鞋、基石占比/锁定期、保荐人声誉对定价背书强度的影响；\n' +
    '4. 流动性陷阱：识别「高倍数申购仍破发」「易中签却阴跌」「每手深度亏损」等典型模式；\n' +
    '5. 板块共振：区分个体特例与同行业/同赛道的系统性估值或流动性风险。\n\n' +
    '【输出格式（必须严格遵守）】\n' +
    '只输出一个 JSON 对象，不要 Markdown、不要代码围栏、不要任何解释性前后缀。结构如下：\n' +
    '{\n' +
    '  "stocks": [\n' +
    '    {\n' +
    '      "name": "股票简称",\n' +
    '      "code": "00501",\n' +
    '      "break_level": "轻度破发|中度破发|重度破发",\n' +
    '      "finexy_tags": ["簿记定价陷阱", "高回拨", "乙组抛压"],\n' +
    '      "fatal_metrics": [\n' +
    '        { "metric_name": "字段名", "value": "表中数值", "impact": "金融机理一句话" }\n' +
    '      ]\n' +
    '    }\n' +
    '  ]\n' +
    '}\n' +
    '每只破发标的各一条 stocks 元素；fatal_metrics 至少 2 条。\n' +
    'fatal_metrics[].impact 必须是针对该标的、该指标的定制机理解释，禁止输出任何通用模板句或空话。\n' +
    'finexy_tags 必须是审计结论标签（如「簿记上沿定价」「乙组筹码抛压」），禁止直接复制表格原始数值。\n\n' +
    '【硬性约束】\n' +
    '- 仅使用数据集中出现的数值与字段，不得编造表外数字、未披露财务或实时新闻\n' +
    '- 数据缺失处必须写「表中未披露」\n' +
    '- 全文使用简体中文，专业、克制，审计报告语气';

  function getClaudeSystemPrompt() {
    const fromConfig =
      (global.__IPO_APP_CONFIG__ && global.__IPO_APP_CONFIG__.claude && global.__IPO_APP_CONFIG__.claude.systemPrompt) ||
      global.CLAUDE_SYSTEM_PROMPT;
    if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
    return CLAUDE_SYSTEM_PROMPT_DEFAULT;
  }

  if (typeof global.CLAUDE_SYSTEM_PROMPT !== 'string' || !global.CLAUDE_SYSTEM_PROMPT.trim()) {
    global.CLAUDE_SYSTEM_PROMPT = CLAUDE_SYSTEM_PROMPT_DEFAULT;
  }

  const HOME_BREAK_FIELDS = [
    ['暗盘表现', '暗盘涨幅', '暗盘涨跌幅'],
    ['首日表现', '上市涨幅', '首日涨幅'],
  ];

  const HOME_SNAPSHOT_ALIASES = [
    ['行业板块', '板块', '行业'],
    ['上市日期', '挂牌日', '上市日'],
    ['招股价', '招股价(HKD)', '招股价 (HKD)'],
    ['上市价', '定价', '发行价'],
    ['超额倍数', '超购', '孖展倍数', '认购倍数'],
    ['现价', '最新价', '現價'],
    ['暗盘一手赚', '暗盘一手赚(HKD)'],
    ['上市一手赚', '首日一手赚'],
    ['累计表现', '累计涨幅', '至今涨幅'],
    ['每手手数', '每手股数', '手数'],
    ['每手金额', '入场费', '一手金额'],
  ];

  const LISTED_PRIORITY_PATTERNS = [
    /^甲组/i,
    /^乙组/i,
    /中签率/,
    /档位/,
    /申请人数/,
    /有效申请/,
    /配售/,
    /回拨/,
    /超额认购/,
    /孖展/,
    /招股/,
    /基石/,
    /绿鞋/,
    /保荐/,
    /发行机制/,
    /入场费/,
    /每手/,
    /招股价/,
    /行业/,
    /核心优势/,
    /主要压力/,
    /风险/,
  ];

  function getAppConfig() {
    return global.__IPO_APP_CONFIG__ || {};
  }

  function getPipelineConfig() {
    return Object.assign(
      {
        autoRunOnLoad: true,
        waitForMasterMs: 60000,
        preferMasterCache: true,
        autoCallClaude: false,
      },
      getAppConfig().brokenPipeline || {},
    );
  }

  function getClaudeConfig() {
    const app = getAppConfig().claude || {};
    const legacy = global.__IPO_AI_CONFIG__ || {};
    return {
      provider: app.provider || legacy.provider || 'anthropic',
      apiKey: app.apiKey || legacy.apiKey || legacy.anthropicKey || legacy.openaiKey || legacy.token || '',
      model: app.model || legacy.model || 'claude-sonnet-4-20250514',
      baseUrl: (app.baseUrl || legacy.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, ''),
      messagesPath: app.messagesPath || '/messages',
      chatPath: app.chatPath || legacy.chatPath || '/chat/completions',
      maxTokens: app.maxTokens || legacy.maxTokens || 4096,
      temperature: app.temperature != null ? app.temperature : 0.25,
      proxyUrl: app.proxyUrl || legacy.proxyUrl || '',
    };
  }

  function normKey(k) {
    return String(k || '')
      .replace(/^\uFEFF/, '')
      .trim();
  }

  function normCode(raw) {
    const s = String(raw ?? '').replace(/\D/g, '');
    if (!s) return '';
    return (s.length > 5 ? s.slice(-5) : s).padStart(5, '0');
  }

  function parsePercent(raw) {
    if (typeof global.__ipoParseSignedMetric === 'function') {
      return global.__ipoParseSignedMetric(raw);
    }
    if (raw == null) return null;
    let s = String(raw).trim();
    if (!s || s === '—' || s === '-' || s === '－') return null;
    s = s.replace(/\u2212/g, '-').replace(/,/g, '').replace(/，/g, '');
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  function getCell(row, aliases) {
    if (!row || typeof row !== 'object') return '';
    if (typeof global.getColumnValue === 'function') {
      return global.getColumnValue(row, aliases);
    }
    const keys = Object.keys(row);
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const alias of list) {
      const an = normKey(alias).replace(/\s/g, '');
      for (const k of keys) {
        if (normKey(k).replace(/\s/g, '') === an && String(row[k] || '').trim()) {
          return String(row[k]).trim();
        }
      }
    }
    for (const alias of list) {
      for (const k of keys) {
        if (normKey(k).includes(alias) && String(row[k] || '').trim()) {
          return String(row[k]).trim();
        }
      }
    }
    return '';
  }

  function extractCode(row) {
    return normCode(getCell(row, ['股票代码', '代码', '代号', '上市代号']));
  }

  function extractName(row) {
    return getCell(row, ['股票名称', '名称', 'IPO名称', '股票名']) || '—';
  }

  function rowHasContent(row) {
    if (!row || typeof row !== 'object') return false;
    return Object.keys(row).some(k => String(row[k] || '').trim() !== '');
  }

  function getPublishBase() {
    const cfg = global.__IPO_SHEET_CONFIG__ || {};
    const raw = cfg.publishBase || cfg.publishUrl || cfg.url || '';
    if (typeof raw === 'string' && raw.trim()) {
      let u = raw.trim().replace(/\/+$/, '');
      if (/spreadsheets\/d\/e\//i.test(u) && !/\/pub$/i.test(u)) u += '/pub';
      return u;
    }
    return IPO_PUB_DEFAULT;
  }

  function getGids() {
    const g = (global.__IPO_SHEET_CONFIG__ && global.__IPO_SHEET_CONFIG__.gids) || {};
    return {
      ipoHome: g.ipoHome != null ? g.ipoHome : GID_DEFAULT.ipoHome,
      listed: g.listed != null ? g.listed : GID_DEFAULT.listed,
    };
  }

  function sheetsCacheReady() {
    const home = global.__IPO_HOME_SHEET__ && Array.isArray(global.__IPO_HOME_SHEET__.rows) ? global.__IPO_HOME_SHEET__.rows : null;
    const listed = Array.isArray(global.__IPO_LISTED_SHEET_ROWS__) ? global.__IPO_LISTED_SHEET_ROWS__ : null;
    return !!(home && home.length && listed && listed.length);
  }

  async function waitForSheetCache(maxMs) {
    const limit = maxMs != null ? maxMs : getPipelineConfig().waitForMasterMs;
    const start = Date.now();
    while (Date.now() - start < limit) {
      if (sheetsCacheReady()) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return sheetsCacheReady();
  }

  async function fetchSheetCsv(tabKey, gid) {
    const ov = global.__IPO_SHEET_CSV_OVERRIDE__ || {};
    let url;
    if (typeof ov[tabKey] === 'string' && ov[tabKey].trim()) {
      url = ov[tabKey].trim();
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
    } else {
      const base = getPublishBase();
      url =
        base +
        '?gid=' +
        encodeURIComponent(gid) +
        '&single=true&output=csv&t=' +
        Date.now() +
        '&tab=' +
        encodeURIComponent(tabKey) +
        '&_=' +
        Math.random().toString(36).slice(2, 9);
    }
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
    });
    const text = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + String(text).slice(0, 160));
    const head = String(text).trim().slice(0, 512);
    if (head.startsWith('<') || /<!DOCTYPE/i.test(head)) {
      throw new Error('Google Sheet 返回 HTML 而非 CSV，请确认已「发布到网络」且 config.js 中 publishBase 正确。');
    }
    return text;
  }

  function parseCsv(text) {
    if (typeof Papa === 'undefined') throw new Error('PapaParse 未加载');
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: h => normKey(h),
        complete: result => resolve(result.data || []),
        error: err => reject(err),
      });
    });
  }

  function isListedTransposedMatrix(matrix) {
    if (!Array.isArray(matrix) || matrix.length < 2) return false;
    return normKey(matrix[0] && matrix[0][0]) === '股票名称' && normKey(matrix[1] && matrix[1][0]) === '股票代码';
  }

  function pivotListedTransposed(matrix) {
    const nRows = matrix.length;
    const nCols = Math.max(0, ...matrix.map(r => (Array.isArray(r) ? r.length : 0)));
    const out = [];
    for (let j = 1; j < nCols; j++) {
      const row = {};
      for (let i = 0; i < nRows; i++) {
        const r = matrix[i];
        if (!r) continue;
        const keyRaw = r[0] != null ? normKey(String(r[0])) : '';
        if (!keyRaw) continue;
        row[keyRaw] = r[j] != null ? String(r[j]).trim() : '';
      }
      if (Object.keys(row).some(k => String(row[k] || '').trim())) out.push(row);
    }
    return out;
  }

  function parseListedCsvMaybeTransposed(text) {
    if (typeof Papa === 'undefined') throw new Error('PapaParse 未加载');
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: false,
        skipEmptyLines: true,
        complete: result => {
          try {
            const matrix = result.data || [];
            if (isListedTransposedMatrix(matrix)) {
              resolve(pivotListedTransposed(matrix));
              return;
            }
            Papa.parse(text, {
              header: true,
              skipEmptyLines: true,
              transformHeader: h => normKey(h),
              complete: r2 => resolve(r2.data || []),
              error: err => reject(err),
            });
          } catch (e) {
            reject(e);
          }
        },
        error: err => reject(err),
      });
    });
  }

  async function fetchIpoHomeAndListedSheets(options) {
    const opts = options || {};
    const pipeCfg = getPipelineConfig();
    const useCache = opts.useCache !== false && pipeCfg.preferMasterCache !== false;

    if (useCache && sheetsCacheReady()) {
      return {
        ipoHomeRows: global.__IPO_HOME_SHEET__.rows.slice(),
        listedRows: global.__IPO_LISTED_SHEET_ROWS__.slice(),
        fromCache: true,
      };
    }

    if (opts.preferMasterFetch !== false && typeof global.fetchMasterDataFromSheet === 'function') {
      await global.fetchMasterDataFromSheet();
      const homeRows = (global.__IPO_HOME_SHEET__ && global.__IPO_HOME_SHEET__.rows) || [];
      const listedRows = global.__IPO_LISTED_SHEET_ROWS__ || [];
      if (homeRows.length || listedRows.length) {
        return { ipoHomeRows: homeRows.slice(), listedRows: listedRows.slice(), fromCache: false, viaMaster: true };
      }
    }

    const G = getGids();
    const [homeText, listedText] = await Promise.all([
      fetchSheetCsv('ipoHome', G.ipoHome),
      fetchSheetCsv('listed', G.listed),
    ]);
    const [homeParsed, listedParsed] = await Promise.all([
      parseCsv(homeText),
      parseListedCsvMaybeTransposed(listedText),
    ]);
    return {
      ipoHomeRows: homeParsed.filter(rowHasContent),
      listedRows: listedParsed.filter(rowHasContent),
      fromCache: false,
      viaMaster: false,
    };
  }

  function isBrokenIpoRow(row) {
    const darkVal = parsePercent(getCell(row, HOME_BREAK_FIELDS[0]));
    const fdVal = parsePercent(getCell(row, HOME_BREAK_FIELDS[1]));
    const reasons = [];
    if (darkVal != null && darkVal < 0) reasons.push('暗盘表现 ' + darkVal + '%（<0%）');
    if (fdVal != null && fdVal < 0) reasons.push('首日表现 ' + fdVal + '%（<0%）');
    return { broken: reasons.length > 0, darkVal, fdVal, reasons };
  }

  function filterBrokenStocks(ipoHomeRows) {
    const brokenStocks = [];
    const seen = new Set();
    (ipoHomeRows || []).forEach(row => {
      if (!rowHasContent(row)) return;
      const code = extractCode(row);
      if (!code || seen.has(code)) return;
      const verdict = isBrokenIpoRow(row);
      if (!verdict.broken) return;
      seen.add(code);
      const homeSnapshot = {};
      HOME_SNAPSHOT_ALIASES.forEach(aliases => {
        const label = aliases[0];
        const val = getCell(row, aliases);
        if (val) homeSnapshot[label] = val;
      });
      brokenStocks.push({
        code,
        name: extractName(row),
        darkPerformance: verdict.darkVal,
        darkPerformanceRaw: getCell(row, HOME_BREAK_FIELDS[0]),
        firstDayPerformance: verdict.fdVal,
        firstDayPerformanceRaw: getCell(row, HOME_BREAK_FIELDS[1]),
        breakReasons: verdict.reasons,
        homeRow: row,
        homeSnapshot,
      });
    });
    return brokenStocks;
  }

  function buildListedIndex(listedRows) {
    const map = new Map();
    (listedRows || []).forEach(row => {
      const code = extractCode(row);
      if (!code) return;
      if (!map.has(code)) map.set(code, row);
    });
    return map;
  }

  function cleanListedFieldValue(val) {
    const s = String(val == null ? '' : val).trim();
    if (!s || s === '—' || s === '-' || /^自动抓取$/i.test(s)) return '';
    return s;
  }

  function sortListedFieldKeys(keys) {
    return keys.slice().sort((a, b) => {
      const pa = LISTED_PRIORITY_PATTERNS.findIndex(p => p.test(a));
      const pb = LISTED_PRIORITY_PATTERNS.findIndex(p => p.test(b));
      const ra = pa >= 0 ? pa : 999;
      const rb = pb >= 0 ? pb : 999;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b, 'zh-CN');
    });
  }

  function rowToFieldMap(row) {
    const out = {};
    Object.keys(row || {}).forEach(k => {
      const v = cleanListedFieldValue(row[k]);
      if (v) out[normKey(k)] = v;
    });
    return out;
  }

  function mergeBrokenWithListed(brokenStocks, listedRows) {
    const listedIndex = buildListedIndex(listedRows);
    return (brokenStocks || []).map(item => {
      const listedRow = listedIndex.get(item.code) || null;
      const listedFields = listedRow ? rowToFieldMap(listedRow) : {};
      return {
        code: item.code,
        name: item.name,
        breakReasons: item.breakReasons,
        homeSnapshot: item.homeSnapshot,
        homePerformance: {
          暗盘表现: item.darkPerformanceRaw || (item.darkPerformance != null ? item.darkPerformance + '%' : ''),
          首日表现: item.firstDayPerformanceRaw || (item.firstDayPerformance != null ? item.firstDayPerformance + '%' : ''),
        },
        listedMatched: !!listedRow,
        listedFields,
      };
    });
  }

  function beijingTimestamp() {
    if (typeof global.formatNow === 'function') {
      const f = global.formatNow();
      if (f && f.fullStr) return f.fullStr;
    }
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString();
    }
  }

  function formatBrokenIpoPromptString(dataset, options) {
    const opts = options || {};
    const records = (dataset && dataset.mergedRecords) || [];
    const brokenStocks = (dataset && dataset.brokenStocks) || [];
    const lines = [];

    lines.push('# 港股 IPO 破发标的全指标数据集');
    lines.push('生成时间：' + beijingTimestamp());
    lines.push('数据源：Google Sheet · IPO主页 + 上市新股');
    lines.push('判定规则：暗盘表现 < 0% 或 首日表现 < 0%（满足任一即列为破发标的）');
    lines.push('破发数量：' + brokenStocks.length + ' 只');
    lines.push('');

    if (!records.length) {
      lines.push('（当前无符合破发判定规则的标的。）');
      return lines.join('\n');
    }

    records.forEach((rec, idx) => {
      lines.push('---');
      lines.push('## ' + (idx + 1) + '. ' + rec.name + '（' + rec.code + '）');
      lines.push('破发触发：' + (rec.breakReasons && rec.breakReasons.length ? rec.breakReasons.join('；') : '—'));
      lines.push('');
      lines.push('【IPO主页 · 表现与行情】');
      Object.keys(rec.homePerformance || {}).forEach(k => {
        if (rec.homePerformance[k]) lines.push('- ' + k + '：' + rec.homePerformance[k]);
      });
      Object.keys(rec.homeSnapshot || {}).forEach(k => {
        lines.push('- ' + k + '：' + rec.homeSnapshot[k]);
      });
      lines.push('');
      if (!rec.listedMatched) {
        lines.push('【上市新股 · 配售详情】');
        lines.push('- （未在「上市新股」Tab 匹配到同代码记录）');
      } else {
        lines.push('【上市新股 · 配售/认购/档位全字段】');
        sortListedFieldKeys(Object.keys(rec.listedFields || {})).forEach(k => {
          lines.push('- ' + k + '：' + rec.listedFields[k]);
        });
      }
      lines.push('');
    });

    if (opts.includeTaskInstruction !== false && opts.claudeInstruction !== false) {
      lines.push('---');
      lines.push(
        opts.claudeInstruction ||
          '请基于以上破发标的全指标数据，完成高级金融审计师视角的穿透分析（个体诊断、板块/配售共性、打新避坑建议）；勿编造表外数字。',
      );
    }

    return lines.join('\n');
  }

  function buildBrokenIpoPromptFromRows(ipoHomeRows, listedRows, options) {
    const brokenStocks = filterBrokenStocks(ipoHomeRows);
    const mergedRecords = mergeBrokenWithListed(brokenStocks, listedRows);
    const dataset = { brokenStocks, mergedRecords };
    const promptText = formatBrokenIpoPromptString(dataset, options);
    return Object.assign({ promptText }, dataset);
  }

  async function fetchAndBuildBrokenIpoPrompt(options) {
    const opts = options || {};
    const fetchResult = await fetchIpoHomeAndListedSheets(opts);
    const built = buildBrokenIpoPromptFromRows(fetchResult.ipoHomeRows, fetchResult.listedRows, opts);
    return Object.assign({}, built, {
      claudeSystemPrompt: getClaudeSystemPrompt(),
      meta: {
        ipoHomeCount: fetchResult.ipoHomeRows.length,
        listedCount: fetchResult.listedRows.length,
        brokenCount: built.brokenStocks.length,
        fromCache: !!fetchResult.fromCache,
        viaMaster: !!fetchResult.viaMaster,
        fetchedAt: new Date().toISOString(),
      },
    });
  }

  /** 高级金融审计：System 常量 + 动态破发数据 user 正文 */
  function buildBrokenIpoAuditorPrompt(dataset, options) {
    const opts = options || {};
    const systemPrompt = opts.systemPrompt || getClaudeSystemPrompt();
    const dataBlock = formatBrokenIpoPromptString(dataset || {}, Object.assign({}, opts, { includeTaskInstruction: false }));
    const userContent =
      '以下是从 Google Sheet（IPO主页 + 上市新股）自动抓取、按双负规则筛选并跨表缝合的破发标的全指标数据。请严格依据 System 指令完成审计分析：\n\n' +
      dataBlock;
    return {
      system: systemPrompt,
      user: userContent,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    };
  }

  function extractClaudeText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.text === 'string') return payload.text.trim();
    if (typeof payload.content === 'string') return payload.content.trim();
    if (Array.isArray(payload.content)) {
      return payload.content
        .map(block => (block && block.text) || '')
        .join('')
        .trim();
    }
    const choice = payload.choices && payload.choices[0];
    const msg = choice && choice.message;
    if (msg && typeof msg.content === 'string') return msg.content.trim();
    return '';
  }

  /* ━━━━━━━━━ Finexy · 破发原因总结 UI ━━━━━━━━━ */
  /** Claude Web 端固化审计包 · 见 launched-audit-data.js */
  const LAUNCHED_AUDIT_DATA = global.LAUNCHED_AUDIT_DATA || [];
  const LAUNCHED_AUDIT_SUMMARY = global.LAUNCHED_AUDIT_SUMMARY || [];
  const FINEXY_BREAK_STYLE_ID = 'finexy-break-guide-css-v5';
  const FINEXY_BREAK_SELECT_ID = 'finexy-break-stock-select';
  let __finexyBreakStocksCache = [];
  let __finexyBreakSelectBound = false;

  function finexyEsc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 过滤与指标墙重复的原表数字标签，仅保留机制/背景类补充标签 */
  function isRawNumericFinexyTag(tag) {
    const t = String(tag || '').trim();
    if (!t) return true;
    if (/^(首日|暗盘|上市|累计)(表现|涨幅|跌幅|一手赚)?\s*[：:\-+]?\s*[+\-−]?\d/.test(t)) return true;
    if (/^[+\-−]?\d[\d.]*%\s*$/.test(t)) return true;
    if (/^(招股价|发行价|超额认购|中签率|每手)\s*[：:\-]?\s*[+\-−$]?\d/.test(t)) return true;
    return false;
  }

  function isMetricRedundantFinexyTag(tag, metrics) {
    const t = String(tag || '').trim();
    if (!t) return true;
    const blob = (metrics || []).map(m => (m.metric_name || '') + ' ' + (m.value || '')).join(' ');
    if (/暗盘/.test(t) && /暗盘[+\-−]?\d|暗盘仅|暗盘\+/.test(blob)) {
      if (/陷阱|操控|机制|缺位|弃用/.test(t)) return false;
      if (/崩盘|表现|溢价|跌幅|出货/.test(t)) return true;
    }
    if (/首日/.test(t) && /首日[+\-−]?\d|首日±/.test(blob) && /表现|跌幅|破发/.test(t)) return true;
    return false;
  }

  function filterFinexyDisplayTags(tags, metrics) {
    return (Array.isArray(tags) ? tags : [])
      .map(t => String(t).trim())
      .filter(Boolean)
      .filter(t => !isRawNumericFinexyTag(t))
      .filter(t => !isMetricRedundantFinexyTag(t, metrics));
  }

  function buildFinexyHeaderTags(stock) {
    const code5 = normCode(stock.code);
    const tags = [code5 + '.HK', stock.break_level || '破发'];
    const extra = filterFinexyDisplayTags(stock.finexy_tags, stock.fatal_metrics);
    extra.forEach(t => {
      if (!tags.includes(t)) tags.push(t);
    });
    return tags;
  }

  function ensureFinexyBreakGuideStyles() {
    const prev = document.getElementById(FINEXY_BREAK_STYLE_ID);
    if (prev) prev.remove();
    ['finexy-break-guide-css', 'finexy-break-guide-css-v2', 'finexy-break-guide-css-v3', 'finexy-break-guide-css-v4'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    const st = document.createElement('style');
    st.id = FINEXY_BREAK_STYLE_ID;
    st.textContent = [
      '#tab-home #ipo-lb-break-guide-section.finexy-break-section{background:transparent!important;border:none!important;box-shadow:none!important;overflow:visible!important;margin-top:36px!important;margin-bottom:24px!important;}',
      '#tab-home #ipo-lb-break-guide-section .finexy-break-panel-wrap{background:transparent!important;border:none!important;padding:0!important;}',
      '#tab-home #ipo-2026-leaderboard-block #ipo-lb-break-guide-section .finexy-break-title,#tab-home #ipo-2026-leaderboard-block #ipo-break-risk-section .ipo-break-risk-title{margin:0 0 32px!important;padding:0 0 0 12px!important;border-left:4px solid #FF6900!important;font-size:18px!important;font-weight:800!important;color:#1a1a1a!important;line-height:1.3!important;background:transparent!important;}',
      '.finexy-break-list{min-height:80px;margin-top:0;}',
      '.finexy-break-view{background:#F7F8FA;border-radius:16px;padding:24px;}',
      '.finexy-break-view__toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px;}',
      '.finexy-break-view__name{margin:0;font-size:22px;font-weight:800;color:#1a1a1a;line-height:1.25;letter-spacing:-.02em;flex:1;min-width:0;}',
      '.finexy-break-view__switch{display:flex;align-items:center;gap:8px;flex-shrink:0;}',
      '.finexy-break-view__switch label{font-size:13px;font-weight:600;color:#546E7A;white-space:nowrap;}',
      '.finexy-break-view__select{appearance:none;-webkit-appearance:none;min-width:148px;padding:8px 32px 8px 12px;border:1px solid #E0E0E0;border-radius:10px;background:#fff url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath fill=\'%23546E7A\' d=\'M1 1l5 5 5-5\'/%3E%3C/svg%3E") no-repeat right 12px center;font-size:13px;font-weight:600;color:#37474F;cursor:pointer;line-height:1.2;}',
      '.finexy-break-view__select:focus{outline:none;border-color:#FF6900;box-shadow:0 0 0 2px rgba(255,105,0,.15);}',
      '.finexy-break-view__tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;}',
      '.finexy-break-view__tag{padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;color:#E65100;background:#FFF3E0;border:1px solid #E65100;line-height:1.25;}',
      '.finexy-break-view__panels{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;background:transparent;padding:0;margin:0;}',
      '.finexy-break-metric-card{background:#fff;border-radius:12px;padding:16px 16px 18px;border:none;box-shadow:0 1px 4px rgba(0,0,0,.06);display:flex;flex-direction:column;min-height:0;}',
      '.finexy-break-metric-card__title{margin:0 0 10px;font-size:14px;font-weight:800;color:#1a1a1a;line-height:1.35;}',
      '.finexy-break-metric-card__text{margin:0;font-size:13px;color:#546E7A;line-height:1.55;flex:1;}',
      '.finexy-break-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:120px;padding:24px 12px;background:#F7F8FA;border-radius:20px;}',
      '.finexy-break-loading__orb{width:32px;height:32px;border-radius:50%;border:3px solid rgba(255,105,0,.15);border-top-color:#FF6900;animation:finexyBreakSpin .85s linear infinite;}',
      '.finexy-break-loading__text{margin:0;font-size:13px;font-weight:600;color:#78909C;}',
      '.finexy-break-empty{margin:0;padding:20px;text-align:center;font-size:13px;line-height:1.6;color:#78909C;background:#F7F8FA;border-radius:20px;}',
      '@keyframes finexyBreakSpin{to{transform:rotate(360deg);}}',
      '@media(max-width:1100px){.finexy-break-view__panels{grid-template-columns:repeat(2,1fr);}}',
      '@media(max-width:640px){.finexy-break-view{padding:16px;}.finexy-break-view__toolbar{flex-direction:column;align-items:stretch;}.finexy-break-view__switch{justify-content:space-between;}.finexy-break-view__select{flex:1;}.finexy-break-view__panels{grid-template-columns:1fr;}}',
    ].join('');
    document.head.appendChild(st);
  }

  /** 将 LAUNCHED_AUDIT_DATA 规范为 Finexy 卡片 payload */
  function normalizeLaunchedAuditPayload(rawList) {
    if (!Array.isArray(rawList) || !rawList.length) return null;
    const stocks = rawList
      .map(stock => {
        const fatal_metrics = (Array.isArray(stock.fatal_metrics) ? stock.fatal_metrics : [])
          .map(m => ({
            metric_name: String((m && (m.metric_name || m.name)) || '').trim(),
            value: String(m && m.value != null ? m.value : '').trim(),
            impact: String((m && m.impact) || '')
              .replace(/\s+/g, ' ')
              .trim(),
          }))
          .filter(m => m.metric_name && m.value && m.impact);
        const finexy_tags = (Array.isArray(stock.finexy_tags) ? stock.finexy_tags : [])
          .map(t => String(t).trim())
          .filter(Boolean);
        return {
          name: String(stock.stock_name || stock.name || '').trim(),
          code: normCode(stock.stock_code || stock.code),
          break_level: String(stock.break_level || '').trim() || '破发',
          finexy_tags,
          fatal_metrics,
        };
      })
      .filter(s => s.name && s.code && s.fatal_metrics.length > 0);
    return stocks.length ? { stocks, source: 'launched' } : null;
  }

  function getLaunchedAuditPayload() {
    return normalizeLaunchedAuditPayload(LAUNCHED_AUDIT_DATA);
  }

  function parseFinexyAuditJson(text) {
    if (!text) return null;
    let raw = String(text).trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
    try {
      const parsed = JSON.parse(raw);
      return normalizeClaudeAuditPayload(Array.isArray(parsed) ? { stocks: parsed } : parsed);
    } catch (e) {
      console.warn('[Finexy] JSON.parse 失败', e, String(text).slice(0, 240));
      return null;
    }
  }

  /** 仅接受 Claude 审计 JSON；清洗后 fatal_metrics / finexy_tags 必须来自模型输出 */
  function normalizeClaudeAuditPayload(raw) {
    if (!raw || !Array.isArray(raw.stocks)) return null;
    const stocks = raw.stocks
      .map(stock => {
        const fatal_metrics = (Array.isArray(stock.fatal_metrics) ? stock.fatal_metrics : [])
          .map(m => ({
            metric_name: String((m && (m.metric_name || m.name)) || '').trim(),
            value: String(m && m.value != null ? m.value : '').trim(),
            impact: String((m && (m.impact || m.analysis || m.mechanism)) || '').trim(),
          }))
          .filter(m => m.metric_name && m.value && m.impact);
        const finexy_tags = (Array.isArray(stock.finexy_tags) ? stock.finexy_tags : [])
          .map(t => String(t).trim())
          .filter(Boolean);
        return {
          name: String(stock.name || '').trim(),
          code: normCode(stock.code),
          break_level: String(stock.break_level || '').trim() || '破发',
          finexy_tags,
          fatal_metrics,
        };
      })
      .filter(s => s.name && s.code && s.fatal_metrics.length > 0);
    return stocks.length ? { stocks, source: 'claude' } : null;
  }

  function resolveClaudeAuditPayload(pipeline) {
    const p = pipeline || global.__IPO_BROKEN_PIPELINE__ || {};
    if (p.claudeResult && p.claudeResult.text) {
      const parsed = parseFinexyAuditJson(p.claudeResult.text);
      if (parsed) return parsed;
    }
    if (p.finexyPayload && p.finexyPayload.source === 'claude' && p.finexyPayload.stocks && p.finexyPayload.stocks.length) {
      return p.finexyPayload;
    }
    return null;
  }

  function showFinexyBreakGuideLoading(message, container) {
    ensureFinexyBreakGuideStyles();
    const wrap = container || document.getElementById('ipo-lb-break-guide-list');
    if (!wrap) return;
    const msg = message || 'Finexy 正在请求 Claude 深度审计…';
    wrap.innerHTML =
      '<div class="finexy-break-loading" role="status" aria-live="polite">' +
      '<div class="finexy-break-loading__orb" aria-hidden="true"></div>' +
      '<p class="finexy-break-loading__text">' +
      finexyEsc(msg) +
      '</p>' +
      '</div>';
  }

  function showFinexyBreakGuideEmpty(message, container) {
    ensureFinexyBreakGuideStyles();
    const wrap = container || document.getElementById('ipo-lb-break-guide-list');
    if (!wrap) return;
    wrap.innerHTML = '<p class="finexy-break-empty">' + finexyEsc(message) + '</p>';
  }

  function renderFinexyBreakStockPanels(stock) {
    return (stock.fatal_metrics || [])
      .map(
        m =>
          '<article class="finexy-break-metric-card">' +
          '<h5 class="finexy-break-metric-card__title">' +
          finexyEsc(m.metric_name) +
          '</h5>' +
          '<p class="finexy-break-metric-card__text">' +
          finexyEsc(m.impact) +
          '</p>' +
          '</article>',
      )
      .join('');
  }

  function renderFinexyBreakStockHeader(stock) {
    const nameEl = document.getElementById('finexy-break-active-name');
    const tagsEl = document.getElementById('finexy-break-active-tags');
    const panelsEl = document.getElementById('finexy-break-active-panels');
    if (!nameEl || !tagsEl || !panelsEl) return;
    nameEl.textContent = stock.name || '';
    const headerTags = buildFinexyHeaderTags(stock);
    tagsEl.innerHTML = headerTags.map(t => '<span class="finexy-break-view__tag">' + finexyEsc(t) + '</span>').join('');
    panelsEl.innerHTML = renderFinexyBreakStockPanels(stock);
  }

  function setFinexyBreakActiveIndex(idx) {
    const stocks = __finexyBreakStocksCache;
    if (!stocks.length) return;
    const i = Math.max(0, Math.min(idx, stocks.length - 1));
    const stock = stocks[i];
    const select = document.getElementById(FINEXY_BREAK_SELECT_ID);
    if (select) select.value = String(i);
    try {
      sessionStorage.setItem('finexy-break-code', normCode(stock.code));
    } catch (e) {
      /* ignore */
    }
    renderFinexyBreakStockHeader(stock);
  }

  function bindFinexyBreakStockSelect() {
    if (__finexyBreakSelectBound) return;
    const select = document.getElementById(FINEXY_BREAK_SELECT_ID);
    if (!select) return;
    select.addEventListener('change', () => {
      setFinexyBreakActiveIndex(parseInt(select.value, 10) || 0);
    });
    __finexyBreakSelectBound = true;
  }

  function renderFinexyBreakCards(payload, container) {
    ensureFinexyBreakGuideStyles();
    const wrap = container || document.getElementById('ipo-lb-break-guide-list');
    if (!wrap) return;
    const section = document.getElementById('ipo-lb-break-guide-section');
    if (section) section.classList.add('finexy-break-section');

    const stocks = (payload && payload.stocks) || [];
    if (!stocks.length) {
      __finexyBreakStocksCache = [];
      showFinexyBreakGuideEmpty('审计数据包为空或格式无效。');
      return;
    }

    __finexyBreakStocksCache = stocks;
    let activeIdx = 0;
    try {
      const saved = sessionStorage.getItem('finexy-break-code');
      if (saved) {
        const found = stocks.findIndex(s => normCode(s.code) === normCode(saved));
        if (found >= 0) activeIdx = found;
      }
    } catch (e) {
      /* ignore */
    }

    const options = stocks
      .map(
        (s, i) =>
          '<option value="' +
          i +
          '">' +
          finexyEsc(s.name) +
          '</option>',
      )
      .join('');

    wrap.innerHTML =
      '<div class="finexy-break-view">' +
      '<div class="finexy-break-view__toolbar">' +
      '<h4 class="finexy-break-view__name" id="finexy-break-active-name"></h4>' +
      '<div class="finexy-break-view__switch">' +
      '<label for="' +
      FINEXY_BREAK_SELECT_ID +
      '">切换标的</label>' +
      '<select id="' +
      FINEXY_BREAK_SELECT_ID +
      '" class="finexy-break-view__select" aria-label="切换破发标的">' +
      options +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div class="finexy-break-view__tags" id="finexy-break-active-tags"></div>' +
      '<div class="finexy-break-view__panels" id="finexy-break-active-panels"></div>' +
      '</div>';

    __finexyBreakSelectBound = false;
    bindFinexyBreakStockSelect();
    setFinexyBreakActiveIndex(activeIdx);
  }

  function renderFinexyBreakGuideFromClaude(pipeline) {
    const launched = getLaunchedAuditPayload();
    if (launched) {
      renderFinexyBreakCards(launched);
      return true;
    }
    const payload = resolveClaudeAuditPayload(pipeline);
    if (!payload) return false;
    publishPipelineState({ finexyPayload: payload, finexySource: 'claude' });
    renderFinexyBreakCards(payload);
    return true;
  }

  async function renderFinexyBreakGuideFromPipeline(pipeline) {
    const launched = getLaunchedAuditPayload();
    if (launched) {
      renderFinexyBreakCards(launched);
      return;
    }

    const p = pipeline || global.__IPO_BROKEN_PIPELINE__ || {};
    if (renderFinexyBreakGuideFromClaude(p)) return;

    const brokenCount =
      (p.meta && p.meta.brokenCount) ||
      (Array.isArray(p.mergedRecords) ? p.mergedRecords.length : 0) ||
      (Array.isArray(p.brokenStocks) ? p.brokenStocks.length : 0);

    if (brokenCount === 0) {
      showFinexyBreakGuideEmpty('当前暂无符合双负规则的破发标的。');
      return;
    }

    if (p.claudeError) {
      showFinexyBreakGuideEmpty('Claude 审计失败：' + p.claudeError + '。请检查 API 配置后重试。');
      return;
    }

    if (p._claudeAuditPending) {
      showFinexyBreakGuideLoading();
      return;
    }

    showFinexyBreakGuideLoading('Finexy 正在请求 Claude 深度审计…');
    publishPipelineState({ _claudeAuditPending: true });
    try {
      const dataset =
        p.mergedRecords && p.mergedRecords.length
          ? p
          : await fetchAndBuildBrokenIpoPrompt({ useCache: true, preferMasterFetch: true });
      const out = await fetchClaudeAuditText(dataset, getPipelineConfig());
      publishPipelineState({ claudeResult: out, claudeError: null });
      renderFinexyBreakGuideFromClaude(Object.assign({}, global.__IPO_BROKEN_PIPELINE__, { claudeResult: out }));
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      publishPipelineState({ claudeError: msg });
      showFinexyBreakGuideEmpty('Claude 审计失败：' + msg);
    } finally {
      publishPipelineState({ _claudeAuditPending: false });
    }
  }

  function renderFinexyBreakGuidePanel() {
    const launched = getLaunchedAuditPayload();
    if (launched) {
      renderFinexyBreakCards(launched);
      return;
    }
    const state = global.__IPO_BROKEN_PIPELINE__ || {};
    if (state.status === 'running') {
      showFinexyBreakGuideLoading('Finexy 正在同步 Google Sheet 破发数据…');
      return;
    }
    renderFinexyBreakGuideFromPipeline(state).catch(err => {
      console.warn('[Finexy Break Guide]', err);
    });
  }

  /* ━━━━━━━━━ 打新破发风险信号 · 3×6 热力网格 ━━━━━━━━━ */
  const IPO_BREAK_RISK_STYLE_ID = 'ipo-break-risk-grid-css';
  const IPO_BREAK_RISK_SIGNALS = global.IPO_BREAK_RISK_SIGNALS || [];
  let __ipoBreakRiskPopoverBound = false;
  let __ipoBreakRiskActiveCell = null;

  function ensureIpoBreakRiskGridStyles() {
    const prev = document.getElementById(IPO_BREAK_RISK_STYLE_ID);
    if (prev) prev.remove();
    const st = document.createElement('style');
    st.id = IPO_BREAK_RISK_STYLE_ID;
    st.textContent = [
      '#tab-home #ipo-2026-leaderboard-block .ipo-break-risk-section{margin-top:48px!important;padding:0!important;background:transparent!important;box-shadow:none!important;border-radius:0!important;position:relative;}',
      '.ipo-break-risk-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;}',
      '.ipo-break-risk-cell{box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;padding:10px 8px;min-height:52px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;line-height:1.35;transition:transform .12s ease,box-shadow .12s ease;}',
      '.ipo-break-risk-cell:hover{transform:translateY(-1px);box-shadow:0 2px 8px rgba(0,0,0,.08);}',
      '.ipo-break-risk-cell.is-active{outline:2px solid #FF6900;outline-offset:2px;}',
      '.ipo-break-risk-cell--deep_red{background:#D84343;color:#fff;}',
      '.ipo-break-risk-cell--mid_red{background:#F4B4B4;color:#8B1A1A;}',
      '.ipo-break-risk-cell--light_red{background:#FFF0F0;color:#A63D3D;}',
      '.ipo-break-risk-popover{position:absolute;z-index:30;display:none;max-width:320px;padding:12px 14px;border-radius:10px;background:#fff;border:1px solid #E0E0E0;box-shadow:0 8px 28px rgba(0,0,0,.12);font-size:13px;line-height:1.55;color:#455A64;pointer-events:none;}',
      '.ipo-break-risk-popover.is-open{display:block;}',
      '@media(max-width:1100px){.ipo-break-risk-grid{grid-template-columns:repeat(3,1fr);}}',
      '@media(max-width:560px){.ipo-break-risk-grid{grid-template-columns:repeat(2,1fr);}.ipo-break-risk-cell{font-size:12px;min-height:48px;padding:8px 6px;}}',
    ].join('');
    document.head.appendChild(st);
  }

  function hideIpoBreakRiskPopover() {
    const pop = document.getElementById('ipo-break-risk-popover');
    if (pop) pop.classList.remove('is-open');
    if (__ipoBreakRiskActiveCell) {
      __ipoBreakRiskActiveCell.classList.remove('is-active');
      __ipoBreakRiskActiveCell = null;
    }
  }

  function positionIpoBreakRiskPopover(cell, pop, section) {
    const cr = cell.getBoundingClientRect();
    const sr = section.getBoundingClientRect();
    const popW = Math.min(320, section.offsetWidth - 16);
    let left = cr.left - sr.left + cr.width / 2 - popW / 2;
    let top = cr.bottom - sr.top + 8;
    if (left < 0) left = 0;
    if (left + popW > section.offsetWidth) left = section.offsetWidth - popW;
    if (top + pop.offsetHeight > section.offsetHeight && cr.top - sr.top > pop.offsetHeight + 8) {
      top = cr.top - sr.top - pop.offsetHeight - 8;
    }
    pop.style.width = popW + 'px';
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function showIpoBreakRiskPopover(cell, impact) {
    const section = document.getElementById('ipo-break-risk-section');
    const pop = document.getElementById('ipo-break-risk-popover');
    if (!section || !pop || !cell) return;
    if (__ipoBreakRiskActiveCell && __ipoBreakRiskActiveCell !== cell) {
      __ipoBreakRiskActiveCell.classList.remove('is-active');
    }
    __ipoBreakRiskActiveCell = cell;
    cell.classList.add('is-active');
    pop.textContent = impact;
    pop.classList.add('is-open');
    positionIpoBreakRiskPopover(cell, pop, section);
  }

  function bindIpoBreakRiskGridEvents(items) {
    const grid = document.getElementById('ipo-break-risk-grid');
    const section = document.getElementById('ipo-break-risk-section');
    if (!grid || !section) return;

    const map = {};
    (items || []).forEach(it => {
      map[String(it.index)] = it;
    });

    grid.querySelectorAll('.ipo-break-risk-cell').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const idx = btn.getAttribute('data-risk-index');
        const item = map[idx];
        if (!item) return;
        if (__ipoBreakRiskActiveCell === btn && document.getElementById('ipo-break-risk-popover')?.classList.contains('is-open')) {
          hideIpoBreakRiskPopover();
          return;
        }
        showIpoBreakRiskPopover(btn, item.popover_impact);
      });
    });

    if (__ipoBreakRiskPopoverBound) return;
    document.addEventListener('click', ev => {
      const t = ev.target;
      if (t && t.closest && (t.closest('#ipo-break-risk-grid') || t.closest('#ipo-break-risk-popover'))) return;
      hideIpoBreakRiskPopover();
    });
    window.addEventListener('resize', hideIpoBreakRiskPopover);
    window.addEventListener('scroll', hideIpoBreakRiskPopover, true);
    __ipoBreakRiskPopoverBound = true;
  }

  function renderIpoBreakRiskGrid() {
    ensureIpoBreakRiskGridStyles();
    const grid = document.getElementById('ipo-break-risk-grid');
    if (!grid) return;
    const items = (global.IPO_BREAK_RISK_SIGNALS && global.IPO_BREAK_RISK_SIGNALS.length
      ? global.IPO_BREAK_RISK_SIGNALS
      : IPO_BREAK_RISK_SIGNALS) || [];
    if (!items.length) return;

    grid.innerHTML = items
      .map(
        it =>
          '<button type="button" class="ipo-break-risk-cell ipo-break-risk-cell--' +
          finexyEsc(it.color_code || 'light_red') +
          '" data-risk-index="' +
          finexyEsc(it.index) +
          '" aria-label="' +
          finexyEsc(it.name) +
          '：' +
          finexyEsc(it.level) +
          '风险">' +
          finexyEsc(it.name) +
          '</button>',
      )
      .join('');

    bindIpoBreakRiskGridEvents(items);
  }

  async function fetchClaudeAuditText(dataset, options) {
    const opts = options || {};
    const cfg = getClaudeConfig();
    const apiKey = opts.apiKey || cfg.apiKey;
    const prompt = buildBrokenIpoAuditorPrompt(dataset, opts);
    const model = opts.model || cfg.model;
    const maxTokens = opts.maxTokens || cfg.maxTokens;
    let out;

    if (cfg.proxyUrl) {
      const res = await fetch(cfg.proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: prompt.system,
          user: prompt.user,
          model,
          maxTokens,
          temperature: cfg.temperature,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('代理请求失败 HTTP ' + res.status + ' · ' + JSON.stringify(json).slice(0, 200));
      const text = extractClaudeText(json);
      if (!text) throw new Error('代理返回空内容');
      out = { text, raw: json, via: 'proxy' };
    } else if (!apiKey) {
      throw new Error('未配置 Claude API Key（config.js → claude.apiKey 或 window.__IPO_AI_CONFIG__.apiKey）');
    } else if (cfg.provider === 'openai-compatible') {
      const res = await fetch(cfg.baseUrl + cfg.chatPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model,
          temperature: cfg.temperature,
          max_tokens: maxTokens,
          messages: prompt.messages,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('OpenAI 兼容接口失败 HTTP ' + res.status + ' · ' + JSON.stringify(json).slice(0, 200));
      const text = extractClaudeText(json);
      if (!text) throw new Error('OpenAI 兼容接口返回空内容');
      out = { text, raw: json, via: 'openai-compatible' };
    } else {
      const res = await fetch(cfg.baseUrl + cfg.messagesPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: cfg.temperature,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const hint =
          res.status === 0 || /Failed to fetch/i.test(String(json))
            ? '（浏览器可能因 CORS 拦截直连 Anthropic，请配置 claude.proxyUrl 自建后端）'
            : '';
        throw new Error('Anthropic 接口失败 HTTP ' + res.status + hint + ' · ' + JSON.stringify(json).slice(0, 240));
      }
      const text = extractClaudeText(json);
      if (!text) throw new Error('Anthropic 返回空内容');
      out = { text, raw: json, via: 'anthropic' };
    }

    const parsed = parseFinexyAuditJson(out.text);
    if (!parsed) {
      throw new Error('Claude 返回内容无法解析为 Finexy JSON（需含 stocks[].fatal_metrics[].impact）');
    }
    return out;
  }

  async function sendBrokenIpoAuditToClaude(dataset, options) {
    const out = await fetchClaudeAuditText(dataset, options);
    publishPipelineState(
      Object.assign({}, global.__IPO_BROKEN_PIPELINE__, dataset || {}, { claudeResult: out, status: 'ready', claudeError: null }),
    );
    renderFinexyBreakGuideFromClaude(global.__IPO_BROKEN_PIPELINE__);
    return out;
  }

  function publishPipelineState(patch) {
    global.__IPO_BROKEN_PIPELINE__ = Object.assign({}, global.__IPO_BROKEN_PIPELINE__ || {}, patch, {
      updatedAt: new Date().toISOString(),
    });
  }

  let pipelineRunPromise = null;

  /**
   * 全自动后台流水线：等待主表 → 抓取/缓存 → 双负筛选 → 跨表缝合 →（可选）Claude 外发
   */
  async function runBrokenIpoPipeline(options) {
    if (pipelineRunPromise && !options?.force) return pipelineRunPromise;

    const opts = Object.assign({}, getPipelineConfig(), options || {});
    pipelineRunPromise = (async () => {
      publishPipelineState({ status: 'running', error: null, claude: null });
      if (!getLaunchedAuditPayload()) {
        showFinexyBreakGuideLoading();
      }

      try {
        if (opts.preferMasterCache !== false) {
          await waitForSheetCache(opts.waitForMasterMs);
        }

        const dataset = await fetchAndBuildBrokenIpoPrompt({
          useCache: opts.preferMasterCache !== false,
          preferMasterFetch: opts.preferMasterFetch !== false,
          claudeInstruction: false,
        });

        const auditorPrompt = buildBrokenIpoAuditorPrompt(dataset);
        let claudeResult = null;

        if (opts.autoCallClaude !== false && dataset.meta && dataset.meta.brokenCount > 0) {
          try {
            claudeResult = await fetchClaudeAuditText(dataset, opts);
            publishPipelineState({ claudeResult, claudeError: null });
          } catch (claudeErr) {
            console.warn('[IPO Broken Pipeline] Claude 外发失败:', claudeErr);
            publishPipelineState({
              claudeError: String(claudeErr && claudeErr.message ? claudeErr.message : claudeErr),
            });
          }
        }

        const result = Object.assign({}, dataset, {
          auditorPrompt,
          claudeResult,
          status: 'ready',
          error: null,
        });

        publishPipelineState(result);
        renderFinexyBreakGuidePanel();
        global.dispatchEvent(new CustomEvent('ipo-broken-pipeline-ready', { detail: result }));
        console.log(
          '[IPO Broken Pipeline] 就绪：破发 ' +
            dataset.meta.brokenCount +
            ' 只 · IPO主页 ' +
            dataset.meta.ipoHomeCount +
            ' 行 · 上市新股 ' +
            dataset.meta.listedCount +
            ' 行',
        );
        return result;
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        publishPipelineState({ status: 'error', error: message });
        console.warn('[IPO Broken Pipeline]', message);
        throw err;
      } finally {
        pipelineRunPromise = null;
      }
    })();

    return pipelineRunPromise;
  }

  async function refreshBrokenIpoPipeline(options) {
    return runBrokenIpoPipeline(Object.assign({}, options || {}, { force: true }));
  }

  function bootstrapBrokenPipeline() {
    const cfg = getPipelineConfig();
    ensureFinexyBreakGuideStyles();
    global.addEventListener('ipo-broken-pipeline-ready', ev => {
      renderFinexyBreakGuideFromPipeline(ev.detail || global.__IPO_BROKEN_PIPELINE__).catch(e => {
        console.warn('[Finexy Break Guide]', e);
      });
    });

    if (document.getElementById('ipo-lb-break-guide-list')) {
      renderFinexyBreakGuidePanel();
    }
    renderIpoBreakRiskGrid();

    if (!cfg.autoRunOnLoad) {
      if (document.getElementById('tab-home')?.classList.contains('active')) {
        renderFinexyBreakGuidePanel();
      }
      return;
    }

    const kick = () => {
      runBrokenIpoPipeline(cfg).catch(() => {
        /* 错误已写入 __IPO_BROKEN_PIPELINE__ */
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', kick, { once: true });
    } else {
      kick();
    }
  }

  /* ── 挂载到 window（最高层，防控制台 ReferenceError） ── */
  global.filterBrokenStocks = filterBrokenStocks;
  global.mergeBrokenWithListed = mergeBrokenWithListed;
  global.formatBrokenIpoPromptString = formatBrokenIpoPromptString;
  global.buildBrokenIpoPromptFromRows = buildBrokenIpoPromptFromRows;
  global.fetchAndBuildBrokenIpoPrompt = fetchAndBuildBrokenIpoPrompt;
  global.fetchIpoHomeAndListedSheets = fetchIpoHomeAndListedSheets;
  global.buildBrokenIpoAuditorPrompt = buildBrokenIpoAuditorPrompt;
  global.sendBrokenIpoAuditToClaude = sendBrokenIpoAuditToClaude;
  global.fetchClaudeAuditText = fetchClaudeAuditText;
  global.runBrokenIpoPipeline = runBrokenIpoPipeline;
  global.refreshBrokenIpoPipeline = refreshBrokenIpoPipeline;
  global.getClaudeSystemPrompt = getClaudeSystemPrompt;
  global.parseFinexyAuditJson = parseFinexyAuditJson;
  global.renderFinexyBreakGuidePanel = renderFinexyBreakGuidePanel;
  global.renderFinexyBreakGuideFromPipeline = renderFinexyBreakGuideFromPipeline;
  global.renderIpoBreakRiskGrid = renderIpoBreakRiskGrid;
  global.renderIpoLbBreakGuide = renderFinexyBreakGuidePanel;
  global.LAUNCHED_AUDIT_DATA = LAUNCHED_AUDIT_DATA;
  global.LAUNCHED_AUDIT_SUMMARY = LAUNCHED_AUDIT_SUMMARY;
  global.CLAUDE_SYSTEM_PROMPT = getClaudeSystemPrompt();
  global.__IPO_BROKEN_PIPELINE__ = global.__IPO_BROKEN_PIPELINE__ || { status: 'idle' };

  bootstrapBrokenPipeline();
})(typeof window !== 'undefined' ? window : global);
