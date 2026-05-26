import type { EnrichedSheetCard } from '../utils/sheetCard';
import { buildModalInsight } from '../utils/sheetCard';
import { fmtPct } from '../utils/data';

interface Props {
  card: EnrichedSheetCard;
  onClose: () => void;
}

export function SheetIpoModal({ card, onClose }: Props) {
  const insight = buildModalInsight(card);
  const sponsorTip =
    card.sponsorBreakRate != null
      ? `主保荐 ${card.primarySponsor} · 近1年破发率约 ${Math.round(card.sponsorBreakRate * 100)}%`
      : `主保荐 ${card.primarySponsor}`;

  return (
    <div className="isd-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="isd-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="isd-modal-title"
      >
        <div className="isd-modal-head">
          <div>
            <h3 id="isd-modal-title" className="isd-modal-title">
              {card.name}
              <span className="isd-code">{card.code}</span>
            </h3>
            <p className="isd-modal-sub">
              {card.sector} · {card.dateLabel} · 热度 {Math.round(card.heatIndex || 0)} · 分歧度{' '}
              {card.sentimentSpread}
            </p>
          </div>
          <button type="button" className="isd-modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="isd-modal-body">
          <section className="isd-modal-block">
            <h4>情绪结构</h4>
            <p>
              {card.sentimentHighlight} · 看多 {fmtPct(card.bullishPct)} · 看空 {fmtPct(card.bearishPct)} ·
              观望 {fmtPct(card.watchPct)} · 破发担忧 {card.breakConcernPct}%
            </p>
          </section>

          <section className="isd-modal-block">
            <h4>看多逻辑</h4>
            <p>{insight.bullLogic}</p>
          </section>

          <section className="isd-modal-block">
            <h4>看空 / 风险</h4>
            <p>{insight.bearLogic}</p>
          </section>

          <section className="isd-modal-block">
            <h4>市场分歧</h4>
            <p>
              多空差 {insight.spread}%（越低表示分歧越大）· {card.consensusLine}
            </p>
          </section>

          <section className="isd-modal-block">
            <h4>打新策略建议</h4>
            <p>{insight.strategy}</p>
          </section>

          <section className="isd-modal-block isd-modal-block--muted">
            <h4>基本面摘要</h4>
            <p>
              {sponsorTip} · 募资 {card.fundraisingHkd}
              {card.fundraisingTag ? `（${card.fundraisingTag}）` : ''}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
