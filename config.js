/**
 * 站点后台配置：Google Sheet 发布地址、Tab gid、破发流水线、Claude 审计
 * 修改本文件即可，无需改 index.html
 */
(function (global) {
  'use strict';

  /* ── Google Sheet（文件 → 共享 → 发布到网络 → /pub 链接） ── */
  global.__IPO_SHEET_CONFIG__ = Object.assign(
    {
      publishBase:
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5R7a29N0wHqOVKXO7Dx016Z_DV0IQ5n16IaTMSPWF2QOqwqud1ViC1Llp0MFwZep8qMUGW_-9SCBU/pub',
      gids: {
        ipoHome: 1914717842,
        listed: 63719317,
        dark: 976801045,
        schedule: 0,
      },
      tabLabels: {
        ipoHome: 'IPO主页',
        listed: '上市新股',
      },
    },
    global.__IPO_SHEET_CONFIG__ || {},
  );

  /* ── 破发流水线 + Claude 审计（script.js 读取） ── */
  /** 新股 AI 分析 API（server/ipo-api.mjs · npm run api:ipo） */
  global.__IPO_API_BASE__ = global.__IPO_API_BASE__ || 'http://127.0.0.1:8788';

  global.__IPO_APP_CONFIG__ = Object.assign(
    {
      brokenPipeline: {
        /** 页面刷新后后台自动抓取 + 双负筛选 + 跨表缝合 */
        autoRunOnLoad: true,
        /** 等待 ipo-live-data 主表拉取完成的最长时间（ms） */
        waitForMasterMs: 60000,
        /** 主表已就绪时复用缓存，避免重复 fetch */
        preferMasterCache: true,
        /** 破发数据就绪后自动请求 Claude（已固化 LAUNCHED_AUDIT_DATA 时无需开启） */
        autoCallClaude: false,
      },
      claude: {
        /** anthropic | openai-compatible | proxy */
        provider: 'anthropic',
        /** 勿提交真实 Key；也可沿用 window.__IPO_AI_CONFIG__.apiKey */
        apiKey: '',
        model: 'claude-sonnet-4-20250514',
        baseUrl: 'https://api.anthropic.com/v1',
        messagesPath: '/messages',
        chatPath: '/chat/completions',
        maxTokens: 4096,
        temperature: 0.25,
        /** 可选：覆盖 script.js 内 CLAUDE_SYSTEM_PROMPT 默认审计词 */
        systemPrompt: '',
        /** 自建后端代理（推荐，规避浏览器 CORS）：POST JSON { system, user, model } → { text } */
        proxyUrl: '',
      },
    },
    global.__IPO_APP_CONFIG__ || {},
  );

  /**
   * 防呆：script.js 尚未加载时，控制台调用不抛 ReferenceError
   */
  function stub(name) {
    return function stubbed() {
      return Promise.reject(new Error(name + ' 尚未就绪，请确认已加载 ./config.js 与 ./script.js'));
    };
  }

  var stubs = [
    'fetchAndBuildBrokenIpoPrompt',
    'runBrokenIpoPipeline',
    'refreshBrokenIpoPipeline',
    'buildBrokenIpoAuditorPrompt',
    'sendBrokenIpoAuditToClaude',
    'renderFinexyBreakGuidePanel',
    'renderFinexyBreakGuideFromPipeline',
    'parseFinexyAuditJson',
    'formatBrokenIpoPromptString',
    'filterBrokenStocks',
    'mergeBrokenWithListed',
    'fetchIpoHomeAndListedSheets',
  ];
  stubs.forEach(function (name) {
    if (typeof global[name] !== 'function') global[name] = stub(name);
  });
})(typeof window !== 'undefined' ? window : global);
