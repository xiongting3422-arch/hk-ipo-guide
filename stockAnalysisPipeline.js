/**
 * 新股 AI 分析流水线：机器硬分 → llmClient → JSON
 */
const { jsonrepair } = require('jsonrepair');
const axios = require('axios');
const { requestClaude } = require('./llmClient');

const DEFAULT_PUBLISH_BASE =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5R7a29N0wHqOVKXO7Dx016Z_DV0IQ5n16IaTMSPWF2QOqwqud1ViC1Llp0MFwZep8qMUGW_-9SCBU/pub';
const DEFAULT_LISTED_GID = 63719317;

const SPONSOR_BREAK_RATES = {
  东方证券: 0.34,
  民银资本: 0.31,
  交银国际: 0.29,
  华升资本: 0.28,
  中泰国际: 0.27,
  天风证券: 0.26,
  中银国际: 0.18,
  中国国际金融: 0.22,
  中信建投: 0.19,
  摩根士丹利: 0.15,
  高盛: 0.12,
};

const DIMENSION_KEYS = ['cornerstone', 'greenshoe', 'sponsor', 'financial', 'fundamental', 'valuation'];

const STOCK_ANALYSIS_SYSTEM_PROMPT = `你是顶级中资券商的首席 IPO 策略分析师。你需要结合机器计算出的 0-5 分硬分以及提供的信息，进行【全信息生态的综合跨网研判】。

【分析铁律】
1. 凡是机器给出的 0.0 分（基石、绿鞋、保荐人），绝对不可在文案中进行美化抹平！必须在深度分析中拉响警报，从‘首日全流通无长线资金锁仓’、‘无大行资金买盘托底’、‘无传统保荐人引路或边缘小券商查无此人’等核心博弈心理去撰写。
2. 财务状况：不要只看表面亏损，请穿透财报。分析其属于研发或商誉导致的暂时失血，还是恶意的估值收割。
3. 基本面：【绝对不可只局限于用户给的表格文字！】必须联动你自身庞大的科技与商业知识库，跨网综合研判该企业的真实行业地位、技术含金量与核心壁垒。
4. 估值与博弈：必须交叉推导‘发行量小（盘子小）’与‘缺少锁仓导致情绪冷清，散户货源占比被动抬高、中签率高企’之间的‘多杀多’踩踏博弈。

【返回格式要求】
你必须且只能返回标准的 JSON 对象，不要包含任何前导词或 \`\`\`json 这样的 markdown 标记。格式严格如下：
{
  "summary": "综合概括一句话",
  "dimensions": {
    "cornerstone": { "score": 0.0, "one_liner": "一句话依据", "deep_analysis": "跨网深度分析" },
    "greenshoe": { "score": 0.0, "one_liner": "一句话依据", "deep_analysis": "跨网深度分析" },
    "sponsor": { "score": 3.2, "one_liner": "一句话依据", "deep_analysis": "跨网深度分析" },
    "financial": { "score": 2.5, "one_liner": "一句话依据", "deep_analysis": "跨网深度分析" },
    "fundamental": { "score": 4.2, "one_liner": "一句话依据", "deep_analysis": "跨网深度分析" },
    "valuation": { "score": 3.0, "one_liner": "一句话依据", "deep_analysis": "跨网深度分析" }
  }
}`;

/** 顶级投行 ECM Lead · 刻薄人设（后台 run-ipo-audit 专用） */
const ECM_LEAD_SYSTEM_PROMPT = `你是顶级国际投行 ECM 资本市场部 Lead，性格刻薄、直言不讳，只对可验证的簿记质量、锁仓结构与估值安全边际负责。你厌恶空话、厌恶粉饰、厌恶把散户当流动性出口。

【分析铁律】
1. 机器硬分为 0.0 的基石/绿鞋/保荐人维度：禁止任何美化；深度分析必须点明「无长线锁仓」「无大行托底」「簿记空心化」等致命结构缺陷。
2. 若 table_fields 已提供 cornerstone_investors（基石认购公司/名单）或 cornerstone_pct，必须据此写出具体投资者、认购金额/占比与机构类型；禁止声称「名单未披露」「锁仓期限未披露」——表格事实优先于臆测。
3. 财务：穿透表面亏损，判断是研发/扩张期失血，还是估值收割或商业模式不成立。必须基于 sheet_row_full 与 derived_metrics 计算/核验发行 PE（市值÷净利润，注明口径），并对比同行业典型 PE 区间给出贵/便宜/合理判断。
4. 基本面：结合行业常识与竞争格局，判断技术含金量与壁垒是否被一级市场叙事夸大；须引用 sheet_row_full 中的行业地位、核心优势、主要压力。
5. 估值与博弈：若 sheet_row_full 含折价率/A+H股/市值/招股价，必须引用具体数值展开 AH 定价与博弈分析，禁止用「若H股折价/溢价」等假设句式替代表格事实；交叉分析盘子大小、公开发售比例、中签率与暗盘承接。
6. sheet_row_full 为「上市新股」Tab 全量事实源：分析前须逐项扫读，不得遗漏折价率、基石认购公司、市值、募资、发行股数、行业地位等已填字段。
7. 六个 dimension 必须全部写完，禁止省略 valuation 或留空；单维 deep_analysis 建议 150–450 字，基石名单可归纳为代表机构，避免过长挤占后续维度输出。

【语气】冷峻、专业、带投行内部备忘录质感；一句话依据要短而狠；深度分析要有机理解释，禁止模板空话。

【返回格式】仅输出 JSON，无 Markdown 围栏：
{
  "summary": "一句话综合概括",
  "dimensions": {
    "cornerstone": { "score": 0.0, "one_liner": "一句话依据", "deep_analysis": "深度分析" },
    "greenshoe": { "score": 0.0, "one_liner": "一句话依据", "deep_analysis": "深度分析" },
    "sponsor": { "score": 3.2, "one_liner": "一句话依据", "deep_analysis": "深度分析" },
    "financial": { "score": 2.5, "one_liner": "一句话依据", "deep_analysis": "深度分析" },
    "fundamental": { "score": 4.2, "one_liner": "一句话依据", "deep_analysis": "深度分析" },
    "valuation": { "score": 3.0, "one_liner": "一句话依据", "deep_analysis": "深度分析" }
  }
}`;

function normKey(s) {
  return String(s || '').replace(/\s+/g, '').trim();
}

function normCode(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length <= 5 ? d.padStart(5, '0') : d.slice(-5).padStart(5, '0');
}

function cell(row, keys) {
  if (!row) return '';
  const map = Object.fromEntries(Object.entries(row).map(([k, v]) => [normKey(k), v]));
  for (const k of keys) {
    const v = map[normKey(k)];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function isEmptyCell(s) {
  const t = String(s ?? '').trim();
  return !t || t === '-' || t === '—' || t === '0' || /^无$|^暂无$|^N\/A$/i.test(t);
}

function clampScore05(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 3;
  return Math.round(Math.max(1, Math.min(5, v)) * 10) / 10;
}

function parseExplicitScore05(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s || s === '—' || s === '-') return null;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (n <= 5) return Math.round(n * 10) / 10;
  if (n <= 100) return Math.round((n / 20) * 10) / 10;
  return null;
}

function hasCornerstone(raw) {
  const s = String(raw ?? '').trim();
  if (isEmptyCell(s)) return false;
  if (/无基石|暂无基石|^无$/.test(s) && !/\d/.test(s)) return false;
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return parseFloat(m[1]) > 0;
  return /有|认购|基石投资者/.test(s) && !/^无/.test(s);
}

function hasGreenShoe(raw) {
  const t = String(raw ?? '').trim();
  if (t === '有') return true;
  if (t === '无' || isEmptyCell(t)) return false;
  return /有/.test(t) && !/无/.test(t);
}

function hasSponsor(raw) {
  return !isEmptyCell(raw);
}

function lookupSponsorBreakRate(sponsor) {
  const s = String(sponsor || '');
  for (const key of Object.keys(SPONSOR_BREAK_RATES)) {
    if (s.includes(key)) return SPONSOR_BREAK_RATES[key];
  }
  return null;
}

function scoreSponsorBase(sponsor) {
  const rate = lookupSponsorBreakRate(sponsor);
  if (rate != null) return clampScore05(1 + (1 - rate) * 4);
  if (String(sponsor || '').trim()) return 3;
  return 0;
}

function scoreFinancialBase(row) {
  const explicit = parseExplicitScore05(
    cell(row, ['财务状况分', '财务分', '雷达财务', '财务状况评分']),
  );
  if (explicit != null) return explicit;

  const blob = [
    cell(row, ['财务状况', '财务点评', '财务摘要']),
    cell(row, ['净利润', '营收', '营业收入']),
    cell(row, ['发行市盈率', '市盈率', 'PE', '发行PE']),
  ].join(' ');

  if (/亏损扩大|持续亏损|商誉减值|现金流紧张|失血/.test(blob)) return 2.2;
  if (/扭亏|盈利改善|毛利率提升|现金流回正/.test(blob)) return 4;
  if (/亏损|研发期|投入期/.test(blob)) return 2.8;
  if (/盈利|增长/.test(blob)) return 3.6;
  return 3;
}

function scoreFundamentalBase(row) {
  const explicit = parseExplicitScore05(
    cell(row, ['基本面分', '亮点分', '雷达基本面', '基本面评分']),
  );
  if (explicit != null) return explicit;

  const ratingRaw = cell(row, ['打新星级', '星级', '打新评级', '评级']);
  const rating = parseInt(String(ratingRaw).replace(/\D/g, ''), 10);
  const hl = cell(row, ['核心优势', '公司亮点', '投资亮点']);
  let s = Number.isFinite(rating) && rating >= 1 && rating <= 5 ? 1.4 + rating * 0.72 : 3;
  if (hl.length > 100) s += 0.35;
  else if (hl.length > 40) s += 0.15;
  return clampScore05(s);
}

function scoreValuationBase(row) {
  const explicit = parseExplicitScore05(
    cell(row, ['估值安全度分', '估值分', '雷达估值', '估值评分']),
  );
  if (explicit != null) return explicit;

  const cornerRaw = cell(row, ['基石认购占比', '基石占比', '有无基石', '基石投资者认购占比']);
  const mech = cell(row, ['发行机制', '发售机制']);
  const overRaw = cell(row, ['认购总倍数', '超额倍数', '孖展倍数', '认购倍数']);
  const lot = cell(row, ['每手股数', '每手手数', '发行规模', '募资规模']);
  const discount = parsePercent(cell(row, ['折价率', 'AH折价率', 'A+H折价率', '折让率']));

  let s = 3.2;
  if (!hasCornerstone(cornerRaw)) s -= 0.9;
  if (/机制\s*B|乙组/i.test(mech)) s -= 0.35;
  const over = parseFloat(String(overRaw).replace(/[^\d.]/g, ''));
  if (Number.isFinite(over) && over < 20) s -= 0.45;
  if (/小盘|盘子小|发行比例.*5%|公开发售.*5%/.test(lot + mech)) s -= 0.25;
  if (discount != null) {
    if (discount <= -35) s += 0.35;
    else if (discount <= -15) s += 0.15;
    else if (discount >= 0) s -= 0.45;
  }
  return clampScore05(s);
}

/** 第一步：机器硬分（0–5，三条红线可为 0） */
function computeMachineScores(row) {
  const cornerRaw = cell(row, ['基石认购占比', '基石占比', '有无基石', '基石投资者认购占比']);
  const greenRaw = cell(row, ['绿鞋机制', '绿鞋', '超额配售权', '有无绿鞋']);
  const sponsor = cell(row, ['保荐人', '保荐机构', '联席保荐人', '保荐']);

  const cornerstone = hasCornerstone(cornerRaw) ? clampScore05(scoreCornerstoneFromPct(cornerRaw)) : 0;
  const greenshoe = hasGreenShoe(greenRaw) ? clampScore05(4.2) : 0;
  const sponsorScore = hasSponsor(sponsor) ? scoreSponsorBase(sponsor) : 0;

  return {
    cornerstone: hasCornerstone(cornerRaw) ? cornerstone : 0,
    greenshoe: hasGreenShoe(greenRaw) ? greenshoe : 0,
    sponsor: sponsorScore,
    financial: scoreFinancialBase(row),
    fundamental: scoreFundamentalBase(row),
    valuation: scoreValuationBase(row),
  };
}

function scoreCornerstoneFromPct(raw) {
  const m = String(raw).match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) {
    const pct = parseFloat(m[1]);
    if (pct >= 50) return 5;
    if (pct >= 30) return 4.5;
    if (pct >= 20) return 4;
    if (pct >= 10) return 3.2;
    if (pct > 0) return 2.5;
    return 1;
  }
  return 3.5;
}

function parsePercent(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s || s === '—' || s === '-') return null;
  const m = s.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  if (m) return Math.round(parseFloat(m[1]) * 100) / 100;
  const n = parseFloat(s.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 解析「575.11 亿」「46.01亿」等为亿港元数值 */
function parseMoneyYiHkd(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s || s === '—' || s === '-') return null;
  const m = s.match(/([+-]?\d+(?:\.\d+)?)\s*亿/);
  if (m) return Math.round(parseFloat(m[1]) * 100) / 100;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseMoneyYiCny(raw) {
  return parseMoneyYiHkd(raw);
}

function parseNumberFromText(raw) {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 「上市新股」Tab 全量非空字段（事实源） */
function extractFullSheetRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    const key = String(k || '').trim();
    const val = String(v ?? '').trim();
    if (!key || !val || val === '—' || val === '-') continue;
    out[key] = val;
  }
  return out;
}

/**
 * 从表格字段预解析结构化指标，供 LLM 引用（避免漏读折价率、市值等）
 */
function computeDerivedMetrics(row) {
  const sheet = extractFullSheetRow(row);
  const financialNote = cell(row, ['财务状况', '财务点评', '财务摘要']);
  const ahDiscount = parsePercent(cell(row, ['折价率', 'AH折价率', 'A+H折价率', '折让率']));
  const marketCapHkdYi = parseMoneyYiHkd(cell(row, ['市值（港元）', '市值', '发行市值', '总市值']));
  const fundraisingGrossYi = parseMoneyYiHkd(
    cell(row, ['募资总额（港元）', '募资总额', '集资总额', '募资规模']),
  );
  const fundraisingNetYi = parseMoneyYiHkd(cell(row, ['募资净额（港元）', '募资净额', '集资净额']));
  const ipoPriceHkd = parseNumberFromText(cell(row, ['招股价 (HKD)', '招股价(HKD)', '招股价', '招股價']));
  const issuePeExplicit = parseNumberFromText(
    cell(row, ['发行市盈率', '市盈率', 'PE', '发行PE', '发行PE(倍)']),
  );

  let revenueCnyYi = null;
  let netProfitCnyYi = null;
  let netMarginPct = null;
  const revM = financialNote.match(/营收[^。\n]*?(\d+(?:\.\d+)?)\s*亿/);
  if (revM) revenueCnyYi = parseFloat(revM[1]);
  const profitM = financialNote.match(/(?:净利润|净利)[^。\n]*?([+-]?\d+(?:\.\d+)?)\s*亿/);
  if (profitM) netProfitCnyYi = parseFloat(profitM[1]);
  const marginM = financialNote.match(/净利率[^。\n]*?(\d+(?:\.\d+)?)\s*%/);
  if (marginM) netMarginPct = parseFloat(marginM[1]);
  else if (revenueCnyYi && netProfitCnyYi != null) {
    netMarginPct = Math.round((netProfitCnyYi / revenueCnyYi) * 1000) / 10;
  } else if (revenueCnyYi && /净利率.*承压|个位数|低/.test(financialNote)) {
    netMarginPct = 5;
  }

  let impliedPeHkd = null;
  if (marketCapHkdYi != null && netProfitCnyYi != null && netProfitCnyYi > 0) {
    const profitHkdYi = netProfitCnyYi * 1.1;
    impliedPeHkd = Math.round((marketCapHkdYi / profitHkdYi) * 10) / 10;
  } else if (marketCapHkdYi != null && revenueCnyYi != null && netMarginPct != null && netMarginPct > 0) {
    const estProfitCnyYi = (revenueCnyYi * netMarginPct) / 100;
    const profitHkdYi = estProfitCnyYi * 1.1;
    if (profitHkdYi > 0) impliedPeHkd = Math.round((marketCapHkdYi / profitHkdYi) * 10) / 10;
  }

  return {
    ah_share: cell(row, ['A+H股', 'A+H', '是否A+H']),
    ah_discount_pct: ahDiscount,
    market_cap_hkd_yi: marketCapHkdYi,
    fundraising_gross_hkd_yi: fundraisingGrossYi,
    fundraising_net_hkd_yi: fundraisingNetYi,
    ipo_price_hkd: ipoPriceHkd,
    issue_pe_from_sheet: issuePeExplicit,
    revenue_cny_yi: revenueCnyYi,
    net_profit_cny_yi: netProfitCnyYi,
    net_margin_pct_est: netMarginPct,
    implied_pe_hkd: impliedPeHkd,
    sector: cell(row, ['行业板块', '板块', '行业', '行业·细分']),
    sheet_field_count: Object.keys(sheet).length,
    pe_calc_note:
      impliedPeHkd != null
        ? `市值${marketCapHkdYi}亿港元 ÷ 估算净利润（来自财务状况，CNY→HKD约×1.1）≈ ${impliedPeHkd}x`
        : issuePeExplicit != null
          ? `表格发行市盈率 ${issuePeExplicit}x`
          : '需从财务状况中的营收/净利自行推算 PE',
  };
}

function extractStockFields(row) {
  const cornerstonePct = cell(row, ['基石认购占比', '基石占比', '基石投资者认购占比']);
  const cornerstoneInvestors = cell(row, [
    '基石认购公司',
    '基石投资者',
    '基石投资者名单',
    '基石投资者详情',
    '基石详情',
    '基石名单',
  ]);
  const cornerstoneLock = cell(row, ['基石锁定期', '基石锁仓期', '锁定期', '基石锁定']);
  return {
    name: cell(row, ['股票名称', '名称', 'IPO名称']) || '—',
    code: normCode(cell(row, ['股票代码', '代码', '代号'])),
    sector: cell(row, ['行业板块', '板块', '行业', '行业·细分']),
    industry_position: cell(row, ['行业地位', '行业定位', '竞争地位']),
    ipoPrice: cell(row, ['招股价 (HKD)', '招股价(HKD)', '招股价', '招股價']),
    handFee: cell(row, ['一手入场费', '每手金额', '入场费']),
    lot_size: cell(row, ['每手股数', '每手手数', '每手']),
    ah: cell(row, ['A+H 股', 'A+H', '是否A+H']),
    ah_discount: cell(row, ['折价率', 'AH折价率', 'A+H折价率', '折让率']),
    list_date: cell(row, ['上市日期', '挂牌日期']),
    interest_days: cell(row, ['计息天数', '计息日']),
    subPeriod: [cell(row, ['招股开始', '认购开始']), cell(row, ['招股结束', '认购结束'])].filter(Boolean).join(' ~ '),
    mechanism: cell(row, ['发行机制', '发售机制']),
    greenshoe: cell(row, ['绿鞋机制', '绿鞋', '有无绿鞋']),
    cornerstone_pct: cornerstonePct,
    cornerstone_investors: cornerstoneInvestors,
    cornerstone_lock_period: cornerstoneLock,
    cornerstone: cornerstonePct || cornerstoneInvestors,
    sponsor: cell(row, ['保荐人', '保荐机构', '联席保荐人']),
    market_cap: cell(row, ['市值（港元）', '市值', '发行市值', '总市值']),
    fundraising_gross: cell(row, ['募资总额（港元）', '募资总额', '集资总额']),
    fundraising_net: cell(row, ['募资净额（港元）', '募资净额', '集资净额']),
    issue_shares: cell(row, ['发行数量（股数）', '发行数量', '发售数量']),
    public_offer_shares: cell(row, ['公开发售股数（10%）', '公开发售股数', '公开发售股份']),
    intl_offer_shares: cell(row, ['国际配售股数（90%）', '国际配售股数', '国际配售股份']),
    public_offer_lots: cell(row, ['公开发售部分（手数）', '公开发售手数']),
    issue_pe: cell(row, ['发行市盈率', '市盈率', 'PE', '发行PE']),
    highlights: cell(row, ['核心优势', '公司亮点', '投资亮点']),
    risks: cell(row, ['主要压力', '重要压力', '主要风险', '风险因素']),
    financialNote: cell(row, ['财务状况', '财务点评', '净利润', '发行市盈率', '市盈率']),
    oversubscription: cell(row, ['认购总倍数', '超额倍数', '孖展倍数', '认购倍数']),
  };
}

function parseCsvMatrix(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some(c => String(c).trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some(c => String(c).trim())) rows.push(row);
  }
  return rows;
}

function parseCsvRows(text) {
  const matrix = parseCsvMatrix(text).filter(r => r.some(c => String(c).trim()));
  if (!matrix.length) return [];
  const isTransposed =
    normKey(matrix[0]?.[0]) === '股票名称' && normKey(matrix[1]?.[0]) === '股票代码';
  if (isTransposed) {
    const nRows = matrix.length;
    const nCols = Math.max(...matrix.map(r => r.length), 0);
    const out = [];
    for (let j = 1; j < nCols; j += 1) {
      const row = {};
      for (let i = 0; i < nRows; i += 1) {
        const key = normKey(matrix[i]?.[0] || '');
        if (key) row[key] = String(matrix[i]?.[j] ?? '').trim();
      }
      if (Object.values(row).some(v => String(v).trim())) out.push(row);
    }
    return out;
  }
  const headers = matrix[0].map(h => normKey(h));
  return matrix.slice(1).map(line => {
    const row = {};
    headers.forEach((h, i) => {
      if (h) row[h] = String(line[i] ?? '').trim();
    });
    return row;
  });
}

async function fetchListedSheetRows() {
  const base = String(process.env.IPO_SHEET_PUBLISH_BASE || DEFAULT_PUBLISH_BASE).replace(/\/$/, '');
  const gid = process.env.IPO_SHEET_LISTED_GID || DEFAULT_LISTED_GID;
  const url = `${base}?gid=${gid}&single=true&output=csv&_t=${Date.now()}`;
  const res = await axios.get(url, { timeout: 30000, responseType: 'text' });
  const text = String(res.data || '');
  if (text.trim().startsWith('<')) throw new Error('Google Sheet 返回 HTML，请检查 publishBase');
  return parseCsvRows(text);
}

function findStockRow(rows, { stockName, code }) {
  const list = Array.isArray(rows) ? rows : [];
  if (code) {
    const c = normCode(code);
    const hit = list.find(r => normCode(cell(r, ['股票代码', '代码', '代号'])) === c);
    if (hit) return hit;
  }
  if (stockName) {
    const n = String(stockName).trim();
    return list.find(r => {
      const rn = cell(r, ['股票名称', '名称', 'IPO名称']);
      return rn === n || rn.includes(n) || n.includes(rn);
    });
  }
  return null;
}

function buildUserPrompt(payload) {
  return [
    '请基于以下机器硬分与表格事实，输出严格 JSON（勿 Markdown）：',
    JSON.stringify(payload, null, 2),
    '',
    '【硬性要求】',
    '1. sheet_row_full 是「上市新股」Tab 全量数据源，分析前须逐项使用其中已填字段，不得遗漏折价率、基石认购公司、市值、募资、发行股数、行业地位等。',
    '2. dimensions.financial 必须写出：发行 PE（优先用 derived_metrics.implied_pe_hkd 或 issue_pe_from_sheet）及同行业板块典型 PE 区间对比，判断估值偏贵/合理/便宜。',
    '3. dimensions.valuation：若 derived_metrics.ah_discount_pct 或 table_fields.ah_discount 有值，必须引用具体折价率（如 -44.14%）分析 AH 定价，禁止写「若H股折价/溢价」假设句。',
    '4. dimensions.cornerstone：若 cornerstone_investors 非空，必须引用具体机构名称与金额，不得写「名单未披露」。',
    '5. 各 score 在机器硬分基础上微调（±0.5 以内）；机器为 0.0 的基石/绿鞋/保荐人若硬分为0须保持 0.0。',
    '6. 六个 dimension 均须输出非空 one_liner 与 deep_analysis，valuation 不得省略；篇幅均衡，避免基石维过长导致 valuation 被截断。',
  ].join('\n');
}

function repairJsonCandidate(jsonStr) {
  let s = jsonStr;
  // 常见 LLM 瑕疵：尾逗号、弯引号
  s = s.replace(/[\u201c\u201d\u2018\u2019]/g, m =>
    ({ '\u201c': '"', '\u201d': '"', '\u2018': "'", '\u2019': "'" })[m] || m,
  );
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

function parseAnalysisJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Claude 返回内容中未找到 JSON 对象');
  const slice = candidate.slice(start, end + 1);
  let parsed;
  let lastErr;
  for (const attempt of [slice, repairJsonCandidate(slice)]) {
    try {
      parsed = JSON.parse(attempt);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!parsed) {
    try {
      parsed = JSON.parse(jsonrepair(slice));
    } catch (e) {
      lastErr = e;
    }
  }
  if (!parsed) throw lastErr || new Error('JSON 解析失败');
  if (!parsed || typeof parsed !== 'object') throw new Error('解析结果非对象');
  if (!parsed.dimensions || typeof parsed.dimensions !== 'object') {
    throw new Error('JSON 缺少 dimensions 字段');
  }
  return parsed;
}

function dimensionTextOk(dim) {
  const d = dim && typeof dim === 'object' ? dim : {};
  const liner = String(d.one_liner || d.oneLiner || '').trim();
  const deep = String(d.deep_analysis || d.deepAnalysis || '').trim();
  if (!liner || liner === '—' || liner.length < 6) return false;
  if (!deep || deep === '—' || deep.length < 30) return false;
  return true;
}

function validateAnalysisComplete(parsed) {
  const missing = DIMENSION_KEYS.filter(k => !dimensionTextOk(parsed.dimensions?.[k]));
  const summary = String(parsed.summary || '').trim();
  if (!summary || summary === '—' || summary.length < 10) missing.push('summary');
  if (missing.length) {
    throw new Error(`分析不完整，缺少有效文案：${missing.join(', ')}`);
  }
}

function normalizeDimension(dim, machineScore, key) {
  const d = dim && typeof dim === 'object' ? dim : {};
  let score = Number(d.score);
  if (!Number.isFinite(score)) score = machineScore;
  if (machineScore === 0 && ['cornerstone', 'greenshoe', 'sponsor'].includes(key)) score = 0;
  score = Math.round(score * 10) / 10;
  return {
    score,
    one_liner: String(d.one_liner || d.oneLiner || '').trim() || '—',
    deep_analysis: String(d.deep_analysis || d.deepAnalysis || '').trim() || '—',
  };
}

function normalizeAiResult(parsed, machineScores) {
  const dimensions = {};
  for (const key of DIMENSION_KEYS) {
    dimensions[key] = normalizeDimension(parsed.dimensions[key], machineScores[key], key);
  }
  return {
    summary: String(parsed.summary || '').trim() || '—',
    dimensions,
  };
}

/**
 * @param {{ stockName?: string, code?: string, row?: Record<string, string> }} input
 */
async function runStockAnalysisPipeline(input = {}, options = {}) {
  let row = input.row && typeof input.row === 'object' ? input.row : null;
  if (!row) {
    const rows = await fetchListedSheetRows();
    row = findStockRow(rows, { stockName: input.stockName, code: input.code });
  }
  if (!row) {
    const label = input.stockName || input.code || '未知标的';
    throw new Error(`未在「上市新股」表中找到：${label}`);
  }

  const fields = extractStockFields(row);
  const sheetRowFull = extractFullSheetRow(row);
  const derivedMetrics = computeDerivedMetrics(row);
  const machineScores = computeMachineScores(row);
  const userPayload = {
    stock_name: fields.name,
    stock_code: fields.code,
    machine_scores: machineScores,
    highlights: fields.highlights,
    risks: fields.risks,
    sheet_row_full: sheetRowFull,
    derived_metrics: derivedMetrics,
    table_fields: fields,
  };

  const systemPrompt =
    options.systemPrompt === 'ecm-lead'
      ? ECM_LEAD_SYSTEM_PROMPT
      : options.systemPrompt || STOCK_ANALYSIS_SYSTEM_PROMPT;

  const llmOpts = {
    system: systemPrompt,
    maxTokens: Number(process.env.LLM_MAX_TOKENS || 8192),
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0.25),
  };

  let text;
  let model;
  let parsed;
  let lastParseErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    ({ text, model } = await requestClaude(buildUserPrompt(userPayload), llmOpts));
    try {
      parsed = parseAnalysisJson(text);
      validateAnalysisComplete(parsed);
      break;
    } catch (e) {
      lastParseErr = e;
      if (attempt < 2) {
        console.warn('[stockAnalysisPipeline] 分析不完整或 JSON 无效，自动重试 LLM…', e.message);
      }
    }
  }
  if (!parsed) throw lastParseErr || new Error('JSON 解析失败');

  const ai = normalizeAiResult(parsed, machineScores);

  const scores05 = DIMENSION_KEYS.map(k => ai.dimensions[k].score);
  const totalScore = Math.round(scores05.reduce((a, b) => a + b, 0) * 10) / 10;
  const avgScore = Math.round((totalScore / DIMENSION_KEYS.length) * 10) / 10;

  return {
    stockName: fields.name,
    code: fields.code,
    machineScores,
    summary: ai.summary,
    dimensions: ai.dimensions,
    totalScore,
    avgScore,
    maxTotalScore: DIMENSION_KEYS.length * 5,
    radarScores: scores05.map(s => Math.round(s * 20)),
    meta: {
      model,
      analyzedAt: new Date().toISOString(),
      source: options.source || 'llm-gateway',
      persona: options.systemPrompt === 'ecm-lead' ? 'ecm-lead' : 'default',
    },
  };
}

module.exports = {
  STOCK_ANALYSIS_SYSTEM_PROMPT,
  ECM_LEAD_SYSTEM_PROMPT,
  computeMachineScores,
  computeDerivedMetrics,
  extractFullSheetRow,
  extractStockFields,
  parseAnalysisJson,
  runStockAnalysisPipeline,
  fetchListedSheetRows,
  findStockRow,
  DIMENSION_KEYS,
};
