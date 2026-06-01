import { useCallback, useEffect, useState } from 'react';
import { DASHBOARD_PANELS, JSON_FILE } from './constants';
import { AiPostGenerator } from './components/AiPostGenerator';
import { DashboardShell } from './components/DashboardShell';
import { HotContent } from './components/HotContent';
import { KeywordPanel } from './components/KeywordPanel';
import { MarketOverview } from './components/MarketOverview';
import { RecentIpoBoard } from './components/RecentIpoBoard';
import type { DashboardPanelId } from './constants';
import type { NnqHeatData } from './types';
import {
  aggregateMarketSentiment,
  buildHotPostInsights,
  buildStockBoards,
  getSheetIpoCards,
} from './utils/data';
import { enrichDataWithSheet } from './utils/sheetIpo';

interface DashboardProps {
  forceKey?: number;
}

export function Dashboard({ forceKey = 0 }: DashboardProps) {
  const [data, setData] = useState<NnqHeatData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${JSON_FILE}?_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as NnqHeatData;
      setData(await enrichDataWithSheet(json));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, forceKey]);

  if (loading && !data) {
    return (
      <div className="isd-loading">
        <div className="isd-spinner" />
        <p>正在加载 IPO 舆情看板…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="isd-empty">
        <strong>暂无法展示看板数据</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="isd-loading">
        <div className="isd-spinner" />
        <p>正在加载 IPO 舆情看板…</p>
      </div>
    );
  }

  const sentiment = aggregateMarketSentiment(data);
  const boards = buildStockBoards(data);
  const insights = buildHotPostInsights(data);
  const sheetCards = getSheetIpoCards(data);
  const filterMeta = data.sheetFilter;

  const resolveSubtitle = (id: DashboardPanelId) => {
    if (id === 'board') {
      const base = DASHBOARD_PANELS.find((p) => p.id === 'board')?.subtitle ?? '';
      if (filterMeta?.pastDays != null) {
        return `${base} · 近${filterMeta.pastDays}天已招股/上市 + 未来${filterMeta.futureDays ?? 7}天即将招股`;
      }
      return base;
    }
    return DASHBOARD_PANELS.find((p) => p.id === id)?.subtitle ?? '';
  };

  const renderPanel = (id: DashboardPanelId) => {
    switch (id) {
      case 'overview':
        return <MarketOverview data={data} sentiment={sentiment} hideHead />;
      case 'board':
        return (
          <RecentIpoBoard
            cards={sheetCards}
            boards={boards}
            data={data}
            filterMeta={filterMeta}
            hideHead
          />
        );
      case 'keywords':
        return <KeywordPanel data={data} hideHead />;
      case 'hot':
        return <HotContent insights={insights} hideHead />;
      case 'ai':
        return <AiPostGenerator data={data} hideHead />;
      default:
        return null;
    }
  };

  return (
    <div className="isd-root">
      <DashboardShell
        panels={DASHBOARD_PANELS}
        renderPanel={renderPanel}
        resolveSubtitle={resolveSubtitle}
      />
    </div>
  );
}

export default Dashboard;
