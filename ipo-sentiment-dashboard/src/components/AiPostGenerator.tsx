import { useState } from 'react';
import type { NnqHeatData } from '../types';
import { buildPostContext, callAiPostGenerator, generatePostLocal } from '../utils/post';

interface Props {
  data: NnqHeatData;
  hideHead?: boolean;
}

export function AiPostGenerator({ data, hideHead }: Props) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const runGenerate = async () => {
    setLoading(true);
    setStatus('正在生成…');
    try {
      const ctx = buildPostContext(data);
      const ai = await callAiPostGenerator(ctx);
      if (ai) {
        setText(ai);
        setStatus('已生成 · AI 润色版');
        return;
      }
      setText(generatePostLocal(ctx));
      setStatus('已生成 · 本地模板（配置 __IPO_AI_CONFIG__ 可启用 AI）');
    } catch (e) {
      setStatus(`生成失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const copyText = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('已复制到剪贴板，可直接粘贴到牛牛圈');
    } catch {
      setStatus('复制失败，请手动选择文本复制');
    }
  };

  return (
    <section className="isd-zone isd-zone--post">
      {!hideHead && (
        <div className="isd-zone-head">
          <span className="isd-step">5</span>
          AI 生成分析贴
        </div>
      )}
      <div className="isd-card isd-post-card">
        <p className="isd-post-desc">
          一键读取当前看板数据，生成包含市场总结、热门股票、机会点、风险点的牛牛圈分析文。
        </p>
        <div className="isd-post-actions">
          <button
            type="button"
            className="isd-btn isd-btn--primary"
            onClick={runGenerate}
            disabled={loading}
          >
            {loading ? '生成中…' : '一键生成分析贴'}
          </button>
          <button type="button" className="isd-btn" onClick={copyText} disabled={!text}>
            复制正文
          </button>
        </div>
        <textarea
          className="isd-post-preview"
          rows={14}
          readOnly
          value={text || '点击「一键生成分析贴」…'}
        />
        {status && <div className="isd-post-status">{status}</div>}
      </div>
    </section>
  );
}
