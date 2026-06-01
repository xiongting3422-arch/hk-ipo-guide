import { useEffect, useRef, useState } from 'react';
import { PIE_COLORS } from '../constants';
import type { DailyTrendRow, MarketSentiment, SectorHeatRow } from '../types';
import { fmtPct, getTrendMax } from '../utils/data';
import { getSectorHeatFromSheet } from '../utils/sheetIpo';
import type { NnqHeatData } from '../types';

interface Props {
  data: NnqHeatData;
  sentiment: MarketSentiment;
  hideHead?: boolean;
}

function fmtHeat(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function SentimentPie({ sentiment }: { sentiment: MarketSentiment }) {
  const slices = [
    { key: 'bullish', pct: sentiment.bullishPct, color: PIE_COLORS.bullish, label: '看多' },
    { key: 'bearish', pct: sentiment.bearishPct, color: PIE_COLORS.bearish, label: '看空' },
    { key: 'watch', pct: sentiment.watchPct, color: PIE_COLORS.watch, label: '观望' },
  ];
  const dominant = [...slices].sort((a, b) => b.pct - a.pct)[0];
  const r = 54;
  const stroke = 22;
  const cx = 68;
  const cy = 68;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="isd-card isd-pie-card">
      <div className="isd-card-title">整体情绪</div>
      <p className="isd-module-sub">当前时间窗内，社区对新股帖子的看多、看空与观望占比</p>
      <div className="isd-pie-wrap">
        <div className="isd-pie-chart">
          <svg viewBox="0 0 136 136" className="isd-pie-svg" aria-label="情绪饼图">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f4f4f5" strokeWidth={stroke} />
            {slices.map((s) => {
              if (s.pct <= 0) return null;
              const len = (s.pct / 100) * circ;
              const dash = `${Math.max(len - 2, 0)} ${circ - len + 2}`;
              const el = (
                <circle
                  key={s.key}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
              );
              offset += len;
              return el;
            })}
          </svg>
          <div className="isd-pie-center">
            <strong>{fmtPct(dominant.pct)}</strong>
            <span>{dominant.label}</span>
          </div>
        </div>
        <div className="isd-pie-legend">
          {slices.map((s) => (
            <div key={s.key} className="isd-pie-leg">
              <span className="isd-pie-leg-label">
                <i className="isd-dot isd-dot--lg" style={{ background: s.color }} />
                {s.label}
              </span>
              <strong>{fmtPct(s.pct)}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmtShortDate(iso: string): string {
  const p = iso.slice(5).replace('-', '/');
  return p;
}

interface TrendPoint {
  x: number;
  y: number;
  val: number;
  date: string;
  postCount: number;
  positivePct: number;
  negativePct: number;
  riskWords: string;
}

function buildSmoothPath(points: TrendPoint[]): string {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx.toFixed(1)} ${p0.y.toFixed(1)}, ${cx.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
}

function findPeakIndices(points: TrendPoint[], maxPeaks = 2): number[] {
  if (points.length < 3) return [];

  const avg = points.reduce((s, p) => s + p.val, 0) / points.length;
  const threshold = Math.max(avg * 1.35, 300);

  const localMax: { i: number; val: number }[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[i - 1]?.val ?? -Infinity;
    const cur = points[i].val;
    const next = points[i + 1]?.val ?? -Infinity;
    if (cur >= prev && cur >= next && cur >= threshold) {
      localMax.push({ i, val: cur });
    }
  }

  localMax.sort((a, b) => b.val - a.val);
  const picked: number[] = [];
  for (const peak of localMax) {
    if (picked.some((idx) => Math.abs(idx - peak.i) < 5)) continue;
    picked.push(peak.i);
    if (picked.length >= maxPeaks) break;
  }
  return picked.sort((a, b) => a - b);
}

const TREND_VB_W = 520;
const TREND_VB_H = 132;

function PeakCalloutHtml({ point, vbW, vbH }: { point: TrendPoint; vbW: number; vbH: number }) {
  const boxW = 108;
  const boxH = 64;
  const gap = 10;
  const margin = 6;
  const anchorX = point.x;
  const anchorY = point.y;

  let boxX = anchorX + gap + 7;
  let boxY = anchorY - boxH / 2;
  boxY = Math.max(margin, Math.min(boxY, vbH - margin - boxH));

  if (boxX + boxW > vbW - margin) {
    boxX = anchorX - gap - boxW - 7;
  }
  if (boxX < margin) {
    boxX = margin;
  }

  const sentimentHint =
    point.positivePct >= point.negativePct + 10
      ? `看多 ${Math.round(point.positivePct)}%`
      : point.negativePct >= point.positivePct + 10
        ? `看空 ${Math.round(point.negativePct)}%`
        : `中性 ${Math.round(100 - point.positivePct - point.negativePct)}%`;

  return (
    <div
      className="isd-peak-html"
      style={{
        left: `${(boxX / vbW) * 100}%`,
        top: `${(boxY / vbH) * 100}%`,
        width: boxW,
        height: boxH,
      }}
    >
      <div className="isd-peak-html-date">{fmtShortDate(point.date)}</div>
      <div className="isd-peak-html-row">
        <span className="isd-peak-html-label">加权热度</span>
        <strong className="isd-peak-html-value">{Math.round(point.val).toLocaleString('zh-CN')}</strong>
      </div>
      <div className="isd-peak-html-meta">
        {point.postCount} 帖 · {sentimentHint}
      </div>
      {point.riskWords ? <span className="isd-peak-html-risk">{point.riskWords}</span> : null}
    </div>
  );
}

function PeakConnector({
  point,
  vbW,
  vbH,
  sx,
  sy,
}: {
  point: TrendPoint;
  vbW: number;
  vbH: number;
  sx: number;
  sy: number;
}) {
  const boxW = 108;
  const gap = 10;
  const margin = 6;
  const anchorX = point.x;
  const anchorY = point.y;

  let boxX = anchorX + gap + 7;
  let boxY = anchorY - 32;
  boxY = Math.max(margin, Math.min(boxY, vbH - margin - 64));

  if (boxX + boxW > vbW - margin) {
    boxX = anchorX - gap - boxW - 7;
  }

  const boxOnRight = boxX > anchorX;
  const lineX1 = boxOnRight ? anchorX + 6 : boxX + boxW + 2;
  const lineX2 = boxOnRight ? boxX - 2 : anchorX - 6;

  return (
    <g vectorEffect="non-scaling-stroke">
      <line
        x1={lineX1}
        y1={anchorY}
        x2={lineX2}
        y2={anchorY}
        stroke="rgba(234,88,12,.35)"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <ellipse
        cx={anchorX}
        cy={anchorY}
        rx={7 / sx}
        ry={7 / sy}
        fill="rgba(249,115,22,.15)"
      />
      <ellipse
        cx={anchorX}
        cy={anchorY}
        rx={4.5 / sx}
        ry={4.5 / sy}
        fill="#fff"
        stroke="#ea580c"
        strokeWidth={2.5 / Math.min(sx, sy)}
      />
    </g>
  );
}

function TrendChart({ trend, max, days }: { trend: DailyTrendRow[]; max: number; days: number }) {
  const title = `近${days}天加权热度趋势`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: TREND_VB_W, h: TREND_VB_H });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setBox({ w: width, h: height });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!trend.length) {
    return (
      <div className="isd-card isd-trend-card">
        <div className="isd-card-title">{title}</div>
        <div className="isd-empty">暂无趋势数据</div>
      </div>
    );
  }

  const w = TREND_VB_W;
  const h = TREND_VB_H;
  const padL = 28;
  const padR = 4;
  const padT = 8;
  const padB = 16;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const step = trend.length > 1 ? innerW / (trend.length - 1) : 0;
  const yMax = Math.max(1, max * 1.04);
  const sx = box.w / w;
  const sy = box.h / h;
  const strokeScale = 1 / Math.min(sx, sy);

  const points: TrendPoint[] = trend.map((d, i) => {
    const val = d.weightedHeat ?? d.heatScore ?? 0;
    const x = padL + i * step;
    const y = padT + innerH - (val / yMax) * innerH;
    const sent = d.sentiment || {};
    const riskTop = (d.riskKeywordCounts || [])
      .slice(0, 1)
      .map((r) => r.word)
      .join('');
    return {
      x,
      y,
      val,
      date: d.date,
      postCount: d.postCount ?? 0,
      positivePct: sent.positivePct ?? 0,
      negativePct: sent.negativePct ?? 0,
      riskWords: riskTop,
    };
  });

  const linePath = buildSmoothPath(points);
  const baseY = padT + innerH;
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${baseY.toFixed(1)} L ${points[0].x.toFixed(1)} ${baseY.toFixed(1)} Z`;
  const peakIndices = findPeakIndices(points, 2);

  const yTicks = [0, yMax * 0.5, yMax];
  const labelEvery = trend.length <= 12 ? 2 : trend.length <= 20 ? 3 : 5;
  const xLabelIndices = new Set<number>([0, trend.length - 1]);
  for (let i = 0; i < trend.length; i += labelEvery) {
    xLabelIndices.add(i);
  }

  return (
    <div className="isd-card isd-trend-card">
      <div className="isd-card-title">{title}</div>
      <p className="isd-module-sub">近30日社区对港股新股的讨论热度走势，越高代表当天舆情越活跃</p>
      <div className="isd-trend-chart-wrap" ref={wrapRef}>
        <svg className="isd-line-chart" width={box.w} height={box.h} role="img" aria-label={title}>
          <g transform={`scale(${sx}, ${sy})`}>
            <defs>
              <linearGradient id="isdLineFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {yTicks.map((tick) => {
              const y = padT + innerH - (tick / yMax) * innerH;
              return (
                <line
                  key={tick}
                  x1={padL}
                  y1={y}
                  x2={padL + innerW}
                  y2={y}
                  stroke="rgba(0,0,0,.05)"
                  strokeDasharray={tick === 0 ? undefined : '3 3'}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {points.map((p, i) =>
              xLabelIndices.has(i) ? (
                <line
                  key={`grid-${p.date}`}
                  x1={p.x}
                  y1={padT}
                  x2={p.x}
                  y2={baseY}
                  stroke="rgba(0,0,0,.04)"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}

            <path d={areaPath} fill="url(#isdLineFill)" />
            <path
              d={linePath}
              fill="none"
              stroke="#f97316"
              strokeWidth={2.5 * strokeScale}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {points.map((p, i) => {
              if (peakIndices.includes(i)) return null;
              return (
                <ellipse
                  key={p.date}
                  cx={p.x}
                  cy={p.y}
                  rx={2.5 / sx}
                  ry={2.5 / sy}
                  fill="#fff"
                  stroke="#fb923c"
                  strokeWidth={1.5 * strokeScale}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{`${p.date} · 加权热度 ${Math.round(p.val * 10) / 10} · ${p.postCount} 帖`}</title>
                </ellipse>
              );
            })}

            {peakIndices.map((idx) => (
              <PeakConnector key={points[idx].date} point={points[idx]} vbW={w} vbH={h} sx={sx} sy={sy} />
            ))}
          </g>
        </svg>

        <div className="isd-trend-labels">
          {yTicks.map((tick) => {
            const y = padT + innerH - (tick / yMax) * innerH;
            return (
              <span
                key={tick}
                className="isd-trend-y-label"
                style={{ top: `${(y / h) * 100}%` }}
              >
                {fmtHeat(tick)}
              </span>
            );
          })}

          {points.map((p, i) =>
            xLabelIndices.has(i) ? (
              <span
                key={`${p.date}-label`}
                className={`isd-trend-x-label${i === 0 ? ' isd-trend-x-label--start' : ''}${i === points.length - 1 ? ' isd-trend-x-label--end' : ''}`}
                style={{ left: `${(p.x / w) * 100}%` }}
              >
                {p.date.slice(5)}
              </span>
            ) : null,
          )}

          {peakIndices.map((idx) => (
            <PeakCalloutHtml key={points[idx].date} point={points[idx]} vbW={w} vbH={h} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SectorBars({ sectors }: { sectors: SectorHeatRow[] }) {
  const max = Math.max(1, ...sectors.map((s) => s.heatScore || 0));
  const display = sectors.length
    ? sectors
    : [{ sectorGroup: '暂无赛道数据', heatScore: 0, source: 'google_sheet' }];

  return (
    <div className="isd-card isd-sector-card">
      <div className="isd-card-title">赛道热度排行</div>
      <p className="isd-module-sub">各赛道新股在社区讨论中的累计热度总和，数值越高代表该板块越受关注</p>
      <div className="isd-sector-list">
        {display.slice(0, 6).map((s) => (
          <div key={s.sectorGroup} className="isd-sector-row">
            <div className="isd-sector-main">
              <div className="isd-sector-head">
                <span>{s.sectorGroup}</span>
                <strong>{Math.round(s.heatScore)}</strong>
              </div>
              <div className="isd-bar-track">
                <div
                  className="isd-bar-fill"
                  style={{ width: `${Math.round(((s.heatScore || 0) / max) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MarketOverview({ data, sentiment, hideHead }: Props) {
  const trend = data.dailyTrend || [];
  const sectors = getSectorHeatFromSheet(data);
  const days = data.filter?.days || trend.length || 30;

  return (
    <section className="isd-zone">
      {!hideHead && (
        <div className="isd-zone-head">
          <span className="isd-step">1</span>
          市场总览
        </div>
      )}
      <div className="isd-overview-grid">
        <SentimentPie sentiment={sentiment} />
        <TrendChart trend={trend} max={getTrendMax(data)} days={days} />
        <SectorBars sectors={sectors} />
      </div>
    </section>
  );
}
