import { useMemo, useState } from 'react';
import type { SheetFilterMeta, SheetIpoCard, StockInsight } from '../types';
import { SheetIpoModal } from './SheetIpoModal';
import { fmtPct } from '../utils/data';
import {
  enrichAllSheetCards,
  filterSheetCards,
  groupSheetCards,
  sortSheetCards,
  statusTags,
  type EnrichedSheetCard,
  type SentimentFilter,
  type SheetSortKey,
  type StatusFilter,
  uniqueSectors,
} from '../utils/sheetCard';

interface Props {
  cards: SheetIpoCard[];
  stockInsights?: StockInsight[];
  filterMeta?: SheetFilterMeta;
}

function SentimentBar({ card }: { card: EnrichedSheetCard }) {
  const b = card.bullishPct || 0;
  const r = card.bearishPct || 0;
  const w = card.watchPct || 0;
  const total = Math.max(b + r + w, 0.001);

  return (
    <div className="isd-sheet-sent-bar-wrap">
      <div className="isd-sheet-sent-bar" title={`看多 ${card.bullishCount} 帖 · 看空 ${card.bearishCount} 帖 · 观望 ${card.watchCount} 帖`}>
        <span className="isd-sheet-sent-seg isd-sheet-sent-seg--bull" style={{ width: `${(b / total) * 100}%` }} />
        <span className="isd-sheet-sent-seg isd-sheet-sent-seg--bear" style={{ width: `${(r / total) * 100}%` }} />
        <span className="isd-sheet-sent-seg isd-sheet-sent-seg--watch" style={{ width: `${(w / total) * 100}%` }} />
      </div>
      <div className="isd-sheet-sent-pcts">
        <span>{fmtPct(b)}</span>
        <span>{fmtPct(r)}</span>
        <span>{fmtPct(w)}</span>
      </div>
    </div>
  );
}

function SheetCardItem({
  card,
  onOpen,
}: {
  card: EnrichedSheetCard;
  onOpen: (c: EnrichedSheetCard) => void;
}) {
  const tags = statusTags(card);
  const sponsorTip =
    card.sponsorBreakRate != null
      ? `${card.primarySponsor} · 近1年破发率 ${Math.round(card.sponsorBreakRate * 100)}%`
      : card.primarySponsor;
  const frTip =
    card.sectorMedianFundraising != null && card.fundraisingHkd !== '—'
      ? `行业募资中位数约 ${card.sectorMedianFundraising}亿港元`
      : '暂无行业对比';

  return (
    <article
      className="isd-sheet-card isd-sheet-card--v2"
      onClick={() => onOpen(card)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(card)}
      role="button"
      tabIndex={0}
    >
      <div className="isd-sheet-card-head">
        <div className="isd-sheet-card-titleblock">
          <div className="isd-sheet-name">
            {card.name}
            <span className="isd-code">{card.code}</span>
          </div>
          <div className="isd-sheet-tags">
            {tags.map((t) => (
              <span key={t} className={`isd-sheet-tag isd-sheet-tag--${t === '近期上市' ? 'listed' : 'default'}`}>
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="isd-sheet-metrics">
          <div className="isd-sheet-metric">
            <strong>{Math.round(card.heatIndex || 0)}</strong>
            <span>热度</span>
          </div>
          <div className="isd-sheet-metric">
            <strong>{card.sentimentSpread}</strong>
            <span>分歧度</span>
          </div>
        </div>
      </div>

      <div className={`isd-sheet-sent-hi isd-sheet-sent-hi--${card.sentimentHighlightCls}`}>
        {card.sentimentHighlight}
        {!card.hasSentiment && <span className="isd-sheet-no-sent"> · 暂无社区帖</span>}
      </div>

      <SentimentBar card={card} />

      <div className="isd-sheet-fundamentals">
        <div className="isd-sheet-fund-row">
          <span>赛道</span>
          <strong>{card.sector || '—'}</strong>
        </div>
        <div className="isd-sheet-fund-row">
          <span>主保荐</span>
          <strong className="isd-sheet-sponsor" title={sponsorTip}>
            {card.primarySponsor}
            {card.sponsorBreakRate != null && (
              <em className="isd-sheet-sponsor-rate"> {Math.round(card.sponsorBreakRate * 100)}%</em>
            )}
          </strong>
        </div>
        <div className="isd-sheet-fund-row">
          <span>募资</span>
          <strong title={frTip}>
            {card.fundraisingHkd}
            {card.fundraisingTag && <em className="isd-sheet-fr-tag">{card.fundraisingTag}</em>}
          </strong>
        </div>
        <div className="isd-sheet-fund-row">
          <span>日期</span>
          <strong>{card.dateLabel}</strong>
        </div>
      </div>

      <div className="isd-sheet-consensus">
        <span className="isd-sheet-consensus-label">共识/分歧</span>
        <p>{card.consensusLine}</p>
        {card.breakConcernPct > 0 && (
          <span className="isd-sheet-break-warn" title="舆情中破发相关词提及占比">
            破发担忧 {card.breakConcernPct}%
          </span>
        )}
      </div>
    </article>
  );
}

export function SheetIpoCards({ cards, stockInsights = [], filterMeta }: Props) {
  const meta = filterMeta || {};
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all');
  const [sortKey, setSortKey] = useState<SheetSortKey>('heat');
  const [active, setActive] = useState<EnrichedSheetCard | null>(null);

  const enriched = useMemo(() => enrichAllSheetCards(cards, stockInsights), [cards, stockInsights]);
  const sectors = useMemo(() => uniqueSectors(enriched), [enriched]);

  const visible = useMemo(() => {
    const filtered = filterSheetCards(enriched, statusFilter, sectorFilter, sentimentFilter);
    return sortSheetCards(filtered, sortKey);
  }, [enriched, statusFilter, sectorFilter, sentimentFilter, sortKey]);

  const groups = useMemo(() => groupSheetCards(visible), [visible]);

  return (
    <section className="isd-zone">
      <div className="isd-zone-head">
        <span className="isd-step">2</span>
        港股 IPO 舆情卡片
        <span className="isd-zone-sub">
          表格基本面 + 牛牛圈舆情 · 近{meta.pastDays ?? 30}天已招股/上市 + 未来{meta.futureDays ?? 7}天即将招股
          {meta.visibleCount != null ? ` · ${visible.length}/${meta.visibleCount} 只` : ''}
        </span>
      </div>

      <p className="isd-module-sub">
        当前时间窗内每只新股的社区热度、多空分歧与打新关注要点，点击卡片查看完整策略
      </p>

      <div className="isd-sheet-toolbar">
        <div className="isd-sheet-filters">
          <label>
            状态
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
              <option value="all">全部</option>
              <option value="upcoming">即将招股/招股中</option>
              <option value="listed">已上市/待上市</option>
            </select>
          </label>
          <label>
            赛道
            <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}>
              <option value="all">全部</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            情绪
            <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value as SentimentFilter)}>
              <option value="all">全部</option>
              <option value="bullish">偏多</option>
              <option value="bearish">偏空</option>
              <option value="neutral">中性</option>
            </select>
          </label>
        </div>
        <label className="isd-sheet-sort">
          排序
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SheetSortKey)}>
            <option value="heat">热度降序</option>
            <option value="bullish">看多占比降序</option>
            <option value="disagreement">分歧度升序</option>
            <option value="subStart">招股日期升序</option>
          </select>
        </label>
      </div>

      {!visible.length ? (
        <div className="isd-empty">当前筛选条件下无匹配新股</div>
      ) : (
        groups.map((g) => (
          <div key={g.title} className="isd-sheet-group">
            <h3 className="isd-sheet-group-title">{g.title}</h3>
            <div className="isd-sheet-grid">
              {g.items.map((card) => (
                <SheetCardItem key={card.matchKey} card={card} onOpen={setActive} />
              ))}
            </div>
          </div>
        ))
      )}

      {active && <SheetIpoModal card={active} onClose={() => setActive(null)} />}
    </section>
  );
}
