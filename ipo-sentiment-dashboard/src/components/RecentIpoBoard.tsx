import { useMemo, useState } from 'react';
import type { NnqHeatData, SheetFilterMeta, SheetIpoCard, StockBoards } from '../types';
import { SheetIpoModal } from './SheetIpoModal';
import { fmtPct } from '../utils/data';
import { buildRecentIpoRows, boardPrimaryStatusTag, selectBoardDisplayRows, type EnrichedBoardRow } from '../utils/boardEnhance';
import { getBoardFocusBullets } from '../utils/boardOpinion';
import type { EnrichedSheetCard } from '../utils/sheetCard';

interface Props {
  cards: SheetIpoCard[];
  boards: StockBoards;
  data: NnqHeatData;
  filterMeta?: SheetFilterMeta;
  hideHead?: boolean;
}

function breakConcernLabel(pct: number): string {
  if (pct > 0) return `破发担忧 ${pct}%`;
  return '破发担忧 低';
}

function SentimentMiniBar({ row }: { row: EnrichedBoardRow }) {
  const b = row.bullishPct;
  const r = row.bearishPct;
  const w = row.watchPct;
  const t = Math.max(b + r + w, 0.001);
  return (
    <div
      className="isd-board-v3-sent-bar"
      title={`看多 ${row.enriched.bullishCount} 帖 · 看空 ${row.enriched.bearishCount} 帖 · 观望 ${row.enriched.watchCount} 帖`}
    >
      <span style={{ width: `${(b / t) * 100}%` }} className="isd-board-v3-sent-seg--bull" />
      <span style={{ width: `${(r / t) * 100}%` }} className="isd-board-v3-sent-seg--bear" />
      <span style={{ width: `${(w / t) * 100}%` }} className="isd-board-v3-sent-seg--watch" />
    </div>
  );
}

function resolveSpecialFocus(row: EnrichedBoardRow, data: NnqHeatData): string[] {
  return getBoardFocusBullets(row, data, row.name);
}

function BoardCardV3({
  row,
  data,
  onOpen,
}: {
  row: EnrichedBoardRow;
  data: NnqHeatData;
  onOpen: (c: EnrichedSheetCard) => void;
}) {
  const e = row.enriched;
  const specialFocus = resolveSpecialFocus(row, data);
  const primaryStatus = boardPrimaryStatusTag(row);
  const extraBadges = row.statusTags.filter(
    (t) => t !== primaryStatus && t !== '近期上市' && !['招股中', '即将招股', '待上市'].includes(t),
  );
  const sponsorLine =
    e.primarySponsor && e.primarySponsor !== '—'
      ? e.sponsorBreakRate != null
        ? `保荐人：${e.primarySponsor}（近1年破发率约 ${Math.round(e.sponsorBreakRate * 100)}%）`
        : `保荐人：${e.primarySponsor}`
      : '保荐人：—';

  return (
    <article
      className="isd-board-v3-card"
      onClick={() => onOpen(e)}
      onKeyDown={(ev) => ev.key === 'Enter' && onOpen(e)}
      role="button"
      tabIndex={0}
    >
      <h3 className="isd-board-v3-name">{row.name}</h3>

      <div className="isd-board-v3-tags">
        <span className="isd-board-v3-tag isd-board-v3-tag--code">{row.code}.HK</span>
        <span className="isd-board-v3-tag">{row.sectorGroup || '—'}</span>
        <span className="isd-board-v3-tag isd-board-v3-tag--status">{primaryStatus}</span>
        {extraBadges.map((t) => (
          <span key={t} className="isd-board-v3-tag isd-board-v3-tag--status">
            {t}
          </span>
        ))}
        <span className={`isd-board-v3-tag isd-board-v3-tag--sent isd-board-v3-tag--sent-${e.sentimentHighlightCls}`}>
          {e.sentimentHighlight}
        </span>
        <span className="isd-board-v3-tag isd-board-v3-tag--break">{breakConcernLabel(e.breakConcernPct)}</span>
      </div>

      <div className="isd-board-v3-metrics">
        <div className="isd-board-v3-metric">
          <div className="isd-board-v3-metric-val">{Math.round(row.heatIndex)}</div>
          <div className="isd-board-v3-metric-lbl">讨论热度</div>
        </div>
        <div className="isd-board-v3-metric">
          <div className="isd-board-v3-metric-val">{e.sentimentSpread}</div>
          <div className="isd-board-v3-metric-lbl">{row.disagreementLevel}</div>
        </div>
        <div className="isd-board-v3-metric">
          <div className="isd-board-v3-metric-val">{e.breakConcernPct > 0 ? `${e.breakConcernPct}%` : '低'}</div>
          <div className="isd-board-v3-metric-lbl">破发担忧</div>
        </div>
      </div>

      <div className="isd-board-v3-sent-block">
        <SentimentMiniBar row={row} />
        <p className="isd-board-v3-sent-text">
          看多 {fmtPct(row.bullishPct)} · 看空 {fmtPct(row.bearishPct)} · 观望 {fmtPct(row.watchPct)}
        </p>
      </div>

      <p className="isd-board-v3-line">{sponsorLine}</p>
      <p className="isd-board-v3-line">
        募资额：{e.fundraisingHkd}
        {e.fundraisingTag ? `（${e.fundraisingTag}）` : ''}
      </p>

      <div className="isd-board-v3-focus">
        <span className="isd-board-v3-focus-label">特别关注</span>
        <ul className="isd-board-v3-focus-list">
          {specialFocus.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export function RecentIpoBoard({ cards, boards, data, filterMeta, hideHead }: Props) {
  const meta = filterMeta || {};
  const [active, setActive] = useState<EnrichedSheetCard | null>(null);

  const displayRows = useMemo(() => {
    const enriched = buildRecentIpoRows(cards, boards, data);
    return selectBoardDisplayRows(enriched, data);
  }, [cards, boards, data]);

  return (
    <section className="isd-zone isd-zone--ipo-board isd-board-v3-wrap">
      {!hideHead && (
        <>
          <div className="isd-zone-head">
            <span className="isd-step">2</span>
            近期新股看板
          </div>
          <p className="isd-module-sub">
            表格基本面 + 社区舆情一体展示
            {meta.pastDays != null
              ? ` · 近${meta.pastDays}天已招股/上市 + 未来${meta.futureDays ?? 7}天即将招股`
              : ''}
          </p>
        </>
      )}

      <div className="isd-board-v3-body">
        {displayRows.length ? (
          <div className="isd-board-v3-grid">
            {displayRows.map((row) => (
              <BoardCardV3 key={row.enriched.matchKey || row.code} row={row} data={data} onOpen={setActive} />
            ))}
          </div>
        ) : (
          <div className="isd-empty">暂无看板数据</div>
        )}
      </div>

      {active && <SheetIpoModal card={active} onClose={() => setActive(null)} />}
    </section>
  );
}
