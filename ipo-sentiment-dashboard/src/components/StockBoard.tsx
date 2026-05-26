import { useMemo, useState } from 'react';
import { BOARD_TABS } from '../constants';
import type { BoardTab, NnqHeatData, StockBoards } from '../types';
import { SheetIpoModal } from './SheetIpoModal';
import { fmtPct } from '../utils/data';
import {
  boardRowsForTab,
  buildEnrichedBoardRows,
  filterBoardBySector,
  sortBoardRows,
  uniqueBoardSectors,
  type EnrichedBoardRow,
} from '../utils/boardEnhance';
import type { EnrichedSheetCard } from '../utils/sheetCard';

interface Props {
  boards: StockBoards;
  data: NnqHeatData;
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

function StockRowItem({
  row,
  onOpen,
}: {
  row: EnrichedBoardRow;
  onOpen: (c: EnrichedSheetCard) => void;
}) {
  const [showCo, setShowCo] = useState(false);
  const e = row.enriched;

  return (
    <div
      className={`isd-stock-row isd-stock-row--v2${row.riskTags.length ? ' isd-stock-row--risk' : ''}`}
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
              <span key={t} className="isd-board-status-tag">
                {t}
              </span>
            ))}
          </div>
          <div className={`isd-board-sent-hi isd-board-sent-hi--${e.sentimentHighlightCls}`}>
            {e.sentimentHighlight}
          </div>
        </div>
        <div className="isd-stock-metrics isd-stock-metrics--dual">
          <div>
            <div className="isd-heat-num">{Math.round(row.heatIndex)}</div>
            <div className="isd-heat-label">热度</div>
          </div>
          <div>
            <div className="isd-heat-num isd-heat-num--muted">{e.sentimentSpread}</div>
            <div className="isd-heat-label">{row.disagreementLevel}</div>
          </div>
        </div>
      </div>

      <div className="isd-board-fund">
        <span>{row.sectorGroup}</span>
        <span className="isd-board-sponsor" title={e.sponsorBreakRate != null ? `近1年破发率 ${Math.round(e.sponsorBreakRate * 100)}%` : undefined}>
          主保荐 {e.primarySponsor}
          {e.sponsorBreakRate != null && (
            <em> {Math.round(e.sponsorBreakRate * 100)}%</em>
          )}
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
          <span>{fmtPct(row.bullishPct)}</span>
          <span>{fmtPct(row.bearishPct)}</span>
          <span>{fmtPct(row.watchPct)}</span>
        </div>
      </div>

      {row.riskTags.length > 0 && (
        <div className="isd-board-risk-tags">
          {row.riskTags.map((t) => (
            <span key={t} className="isd-board-risk-tag">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="isd-board-tip">{row.tipLine}</div>
    </div>
  );
}

export function StockBoard({ boards, data }: Props) {
  const [tab, setTab] = useState<BoardTab>('heat');
  const [sector, setSector] = useState('all');
  const [sortMode, setSortMode] = useState<'heat' | 'date' | 'bullish' | 'disagreement'>('heat');
  const [active, setActive] = useState<EnrichedSheetCard | null>(null);

  const enriched = useMemo(() => buildEnrichedBoardRows(boards, data), [boards, data]);
  const sectors = useMemo(() => uniqueBoardSectors(enriched), [enriched]);

  const rows = useMemo(() => {
    let list = boardRowsForTab(boards, enriched, tab);
    if (tab === 'sector') {
      list = sortBoardRows(filterBoardBySector(enriched, sector), sortMode);
      return list;
    }
    list = filterBoardBySector(list, sector);
    return sortBoardRows(list, sortMode);
  }, [boards, enriched, tab, sector, sortMode]);

  return (
    <section className="isd-zone">
      <div className="isd-zone-head">
        <span className="isd-step">3</span>
        个股榜单
      </div>
      <p className="isd-module-sub">表格基本面 + 社区舆情排行，点击行查看打新策略</p>

      <div className="isd-card">
        <div className="isd-board-toolbar">
          <div className="isd-tabs">
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
            <label>
              排序
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}>
                <option value="heat">热度降序</option>
                <option value="date">招股日期</option>
                <option value="bullish">看多占比</option>
                <option value="disagreement">分歧度升序</option>
              </select>
            </label>
          </div>
        </div>

        {tab === 'sector' ? (
          <div className="isd-sector-board">
            {boards.sector.length ? (
              boards.sector
                .filter((g) => sector === 'all' || g.sectorGroup === sector)
                .map((g) => {
                  const groupRows = sortBoardRows(
                    enriched.filter((r) => r.sectorGroup === g.sectorGroup),
                    sortMode,
                  );
                  if (!groupRows.length) return null;
                  return (
                    <div key={g.sectorGroup} className="isd-sector-group">
                      <div className="isd-sector-group-head">
                        <strong>{g.sectorGroup}</strong>
                        <span>热度 {Math.round(g.heatScore)} · {groupRows.length} 只</span>
                      </div>
                      {groupRows.map((row) => (
                        <StockRowItem key={row.code} row={row} onOpen={setActive} />
                      ))}
                    </div>
                  );
                })
            ) : (
              <div className="isd-empty">暂无赛道数据</div>
            )}
          </div>
        ) : (
          <div className="isd-stock-list">
            {rows.map((row) => (
              <StockRowItem key={row.code} row={row} onOpen={setActive} />
            ))}
            {!rows.length && <div className="isd-empty">暂无榜单数据</div>}
          </div>
        )}
      </div>

      {active && <SheetIpoModal card={active} onClose={() => setActive(null)} />}
    </section>
  );
}
