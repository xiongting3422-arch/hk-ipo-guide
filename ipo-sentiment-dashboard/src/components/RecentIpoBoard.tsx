import { useMemo, useState } from 'react';
import { BOARD_TABS } from '../constants';
import type { BoardTab, NnqHeatData, SheetFilterMeta, SheetIpoCard, StockBoards } from '../types';
import { SheetIpoModal } from './SheetIpoModal';
import { fmtPct } from '../utils/data';
import {
  boardRowsForTab,
  buildRecentIpoRows,
  filterBoardBySector,
  groupCardViewRows,
  sortBoardRows,
  uniqueBoardSectors,
  type BoardSortMode,
  type EnrichedBoardRow,
} from '../utils/boardEnhance';
import type { EnrichedSheetCard } from '../utils/sheetCard';

interface Props {
  cards: SheetIpoCard[];
  boards: StockBoards;
  data: NnqHeatData;
  filterMeta?: SheetFilterMeta;
}

function breakConcernMeta(pct: number) {
  if (pct >= 25) return { label: `${pct}%`, tone: 'high' as const };
  if (pct > 0) return { label: `${pct}%`, tone: 'mid' as const };
  return { label: '低', tone: 'low' as const };
}

function SentimentMiniBar({ row }: { row: EnrichedBoardRow }) {
  const b = row.bullishPct;
  const r = row.bearishPct;
  const w = row.watchPct;
  const t = Math.max(b + r + w, 0.001);
  return (
    <div
      className="isd-board-sent-bar"
      title={`看多 ${row.enriched.bullishCount} 帖 · 看空 ${row.enriched.bearishCount} 帖 · 观望 ${row.enriched.watchCount} 帖`}
    >
      <span style={{ width: `${(b / t) * 100}%` }} className="isd-board-sent-seg--bull" />
      <span style={{ width: `${(r / t) * 100}%` }} className="isd-board-sent-seg--bear" />
      <span style={{ width: `${(w / t) * 100}%` }} className="isd-board-sent-seg--watch" />
    </div>
  );
}

function ListRowItem({
  row,
  onOpen,
}: {
  row: EnrichedBoardRow;
  onOpen: (c: EnrichedSheetCard) => void;
}) {
  const [showCo, setShowCo] = useState(false);
  const e = row.enriched;
  const breakMeta = breakConcernMeta(e.breakConcernPct);

  return (
    <div
      className={`isd-stock-row isd-stock-row--v2 isd-stock-row--grid${row.riskTags.length ? ' isd-stock-row--risk' : ''}`}
      onClick={() => onOpen(e)}
      onKeyDown={(ev) => ev.key === 'Enter' && onOpen(e)}
      role="button"
      tabIndex={0}
    >
      <div className="isd-stock-head">
        <div className="isd-stock-titleblock">
          <div className="isd-stock-name">
            {row.name}
            <span className="isd-code">{row.code}</span>
            {row.statusTags.map((t) => (
              <span
                key={t}
                className={`isd-board-status-tag${t === '近期上市' ? ' isd-board-status-tag--listed' : ''}`}
              >
                {t}
              </span>
            ))}
          </div>
          <div className={`isd-board-sent-hi isd-board-sent-hi--${e.sentimentHighlightCls}`}>
            {e.sentimentHighlight}
            {!e.hasSentiment && <span className="isd-sheet-no-sent"> · 暂无社区帖</span>}
          </div>
        </div>
        <div className="isd-stock-metrics isd-stock-metrics--triple">
          <div className="isd-stock-metric">
            <div className="isd-heat-num">{Math.round(row.heatIndex)}</div>
            <div className="isd-heat-label">热度</div>
          </div>
          <div className="isd-stock-metric">
            <div className="isd-heat-num isd-heat-num--muted">{e.sentimentSpread}</div>
            <div className="isd-heat-label">{row.disagreementLevel}</div>
          </div>
          <div className="isd-stock-metric">
            <div className={`isd-board-break-chip isd-board-break-chip--${breakMeta.tone}`}>
              {breakMeta.label}
            </div>
            <div className="isd-heat-label">破发担忧</div>
          </div>
        </div>
      </div>

      <div className="isd-board-fund">
        <span className="isd-board-fund-sector">{row.sectorGroup}</span>
        <span
          className="isd-board-sponsor"
          title={e.sponsorBreakRate != null ? `近1年破发率 ${Math.round(e.sponsorBreakRate * 100)}%` : undefined}
        >
          主保荐 {e.primarySponsor}
          {e.sponsorBreakRate != null && <em> {Math.round(e.sponsorBreakRate * 100)}%</em>}
        </span>
        {row.coSponsors.length > 0 && (
          <button
            type="button"
            className="isd-board-co-btn"
            onClick={(ev) => {
              ev.stopPropagation();
              setShowCo(!showCo);
            }}
          >
            联席{row.coSponsors.length}家{showCo ? '▴' : '▾'}
          </button>
        )}
        <span>
          {e.fundraisingHkd}
          {e.fundraisingTag && <em className="isd-sheet-fr-tag">{e.fundraisingTag}</em>}
        </span>
        <span>{e.dateLabel}</span>
      </div>
      {showCo && row.coSponsors.length > 0 && (
        <div className="isd-board-co-list">联席：{row.coSponsors.join('、')}</div>
      )}

      <div className="isd-board-sent-row">
        <SentimentMiniBar row={row} />
        <div className="isd-board-sent-pct">
          <span title="看多">{fmtPct(row.bullishPct)}</span>
          <span title="看空">{fmtPct(row.bearishPct)}</span>
          <span title="观望">{fmtPct(row.watchPct)}</span>
        </div>
      </div>

      {(row.riskTags.length > 0 || row.tipLine) && (
        <div className="isd-board-foot">
          {row.riskTags.length > 0 && (
            <div className="isd-board-risk-tags">
              {row.riskTags.map((t) => (
                <span key={t} className="isd-board-risk-tag">
                  {t}
                </span>
              ))}
            </div>
          )}
          {row.tipLine && <div className="isd-board-tip">{row.tipLine}</div>}
        </div>
      )}
    </div>
  );
}

function ListSection({
  title,
  count,
  rows,
  onOpen,
}: {
  title?: string;
  count?: number;
  rows: EnrichedBoardRow[];
  onOpen: (c: EnrichedSheetCard) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="isd-board-list-section">
      {title && (
        <div className="isd-board-list-section-head">
          <strong>{title}</strong>
          {count != null && <span>{count} 只</span>}
        </div>
      )}
      <div className="isd-stock-list">
        {rows.map((row) => (
          <ListRowItem key={row.enriched.matchKey || row.code} row={row} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

export function RecentIpoBoard({ cards, boards, data, filterMeta }: Props) {
  const meta = filterMeta || {};
  const [tab, setTab] = useState<BoardTab>('heat');
  const [sector, setSector] = useState('all');
  const [sortMode, setSortMode] = useState<BoardSortMode>('heat');
  const [active, setActive] = useState<EnrichedSheetCard | null>(null);

  const enriched = useMemo(() => buildRecentIpoRows(cards, boards, data), [cards, boards, data]);
  const sectors = useMemo(() => uniqueBoardSectors(enriched), [enriched]);
  const filtered = useMemo(() => filterBoardBySector(enriched, sector), [enriched, sector]);

  const heatGroups = useMemo(
    () =>
      groupCardViewRows(filtered).map((g) => ({
        ...g,
        items: sortBoardRows(g.items, sortMode),
      })),
    [filtered, sortMode],
  );

  const listRows = useMemo(() => {
    let list = boardRowsForTab(boards, filtered, tab);
    if (tab !== 'sector') {
      list = sortBoardRows(list, sortMode);
    }
    return list;
  }, [boards, filtered, tab, sortMode]);

  const hasHeatContent = heatGroups.some((g) => g.items.length > 0);

  const sectorSections = useMemo(() => {
    if (tab !== 'sector') return [];
    return boards.sector
      .filter((g) => sector === 'all' || g.sectorGroup === sector)
      .map((g) => ({
        sectorGroup: g.sectorGroup,
        rows: sortBoardRows(
          filtered.filter((r) => r.sectorGroup === g.sectorGroup),
          sortMode,
        ),
      }))
      .filter((g) => g.rows.length > 0);
  }, [tab, boards.sector, sector, filtered, sortMode]);

  return (
    <section className="isd-zone isd-zone--ipo-board">
      <div className="isd-zone-head">
        <span className="isd-step">2</span>
        近期新股看板
        <span className="isd-zone-sub">
          近{meta.pastDays ?? 30}天已招股/上市 + 未来{meta.futureDays ?? 7}天即将招股
          {meta.visibleCount != null ? ` · ${filtered.length}/${meta.visibleCount} 只` : ''}
        </span>
      </div>
      <p className="isd-module-sub">表格基本面 + 社区舆情一体展示，按榜单对比、点击行查看打新策略</p>

      <div className="isd-card">
        <div className="isd-ipo-board-toolbar isd-ipo-board-toolbar--list">
          <div className="isd-tabs isd-tabs--board">
            {BOARD_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`isd-tab${tab === t.id ? ' isd-tab--active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="isd-board-filters">
            <label>
              赛道
              <select value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="all">全部</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {tab !== 'sector' && (
              <label>
                排序
                <select value={sortMode} onChange={(e) => setSortMode(e.target.value as BoardSortMode)}>
                  <option value="heat">热度降序</option>
                  <option value="bullish">看多占比</option>
                  <option value="disagreement">分歧度升序</option>
                  <option value="date">招股日期</option>
                  <option value="breakConcern">破发担忧降序</option>
                  <option value="sponsorBreak">保荐破发率降序</option>
                  <option value="fundraising">募资规模降序</option>
                </select>
              </label>
            )}
          </div>
        </div>

        {tab === 'heat' ? (
          hasHeatContent ? (
            heatGroups.map((g) => (
              <ListSection
                key={g.title}
                title={g.title}
                count={g.items.length}
                rows={g.items}
                onOpen={setActive}
              />
            ))
          ) : (
            <div className="isd-empty">当前筛选条件下无匹配新股</div>
          )
        ) : tab === 'sector' ? (
          sectorSections.length ? (
            sectorSections.map((g) => (
              <ListSection
                key={g.sectorGroup}
                title={g.sectorGroup}
                count={g.rows.length}
                rows={g.rows}
                onOpen={setActive}
              />
            ))
          ) : (
            <div className="isd-empty">暂无赛道数据</div>
          )
        ) : listRows.length ? (
          <ListSection rows={listRows} onOpen={setActive} />
        ) : (
          <div className="isd-empty">暂无榜单数据</div>
        )}
      </div>

      {active && <SheetIpoModal card={active} onClose={() => setActive(null)} />}
    </section>
  );
}
