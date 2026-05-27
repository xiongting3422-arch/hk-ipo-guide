export const JSON_FILE = './nnq-heat.json';
export const BUILD_ID = '20260527-board-grid';

export const PIE_COLORS = {
  bullish: '#22c55e',
  bearish: '#ef4444',
  watch: '#6366f1',
} as const;

export const DOMINANT_LABELS: Record<string, { text: string; cls: string }> = {
  bullish: { text: '看多', cls: 'bullish' },
  bearish: { text: '看空', cls: 'bearish' },
  watch: { text: '观望', cls: 'watch' },
  neutral: { text: '中性', cls: 'neutral' },
};

export const SECTOR_ORDER = ['AI/科技', 'AI', '航天', '医药', '消费', '其他'];

export const KW_CATEGORIES = {
  trade: {
    title: '交易词',
    icon: '📊',
    words: ['打新', '申购', '中签', '暗盘', '孖展', '绿鞋', '超额认购', '回拨', '稳价人', '一手中签率'],
  },
  fundamental: {
    title: '基本面词',
    icon: '📋',
    words: ['招股', '基石', '招股书', '市盈率', '保荐', '入场费', '发行', '聆讯', '招股期', '新股'],
  },
  risk: {
    title: '风险词',
    icon: '⚠️',
    words: ['破发', '劝退', '避雷', '坑', '弃购', '估值过高', '割韭菜', '冷场', '超额冷门'],
  },
  bullish: {
    title: '利好词',
    icon: '📈',
    words: ['必打', '大肉', '稳中签', '看好', '梭哈', '值得打', '参与', '冲', '上车'],
  },
} as const;

export const BOARD_TABS = [
  { id: 'heat' as const, label: '热度榜' },
  { id: 'bullish' as const, label: '情绪榜' },
  { id: 'risk' as const, label: '风险预警榜' },
  { id: 'sector' as const, label: '赛道榜' },
];

export const SPONSOR_BREAK_RATES: Record<string, number> = {
  东方证券: 0.34,
  民银资本: 0.31,
  交银国际: 0.29,
  华升资本: 0.28,
  中泰国际: 0.27,
  天风证券: 0.26,
  农银国际: 0.28,
  工银国际: 0.25,
  越秀: 0.24,
  海通: 0.24,
  中银国际: 0.18,
  中国国际金融: 0.22,
  中金: 0.22,
  中信建投: 0.19,
  中信证券: 0.2,
};

export const POST_AI_SYSTEM =
  '你是港股 IPO 打新舆情分析师，擅长将结构化数据写成适合富途牛牛圈发布的短文。语言专业、克制，不用夸张词。';
