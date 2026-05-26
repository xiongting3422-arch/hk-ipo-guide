import { useCallback, useEffect, useState } from 'react';
import { JSON_FILE } from './constants';
import { AiPostGenerator } from './components/AiPostGenerator';
import { HotContent } from './components/HotContent';
import { KeywordPanel } from './components/KeywordPanel';
import { MarketOverview } from './components/MarketOverview';
import { RecentIpoBoard } from './components/RecentIpoBoard';
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

  return (
    <div className="isd-root">
      <MarketOverview data={data} sentiment={sentiment} />

      <RecentIpoBoard
        cards={sheetCards}
        boards={boards}
        data={data}
        filterMeta={data.sheetFilter}
      />

      <KeywordPanel data={data} />

      <HotContent insights={insights} />
      <AiPostGenerator data={data} />
    </div>
  );
}

export default Dashboard;
