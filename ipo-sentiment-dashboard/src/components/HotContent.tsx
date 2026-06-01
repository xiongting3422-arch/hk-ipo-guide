import type { PostInsight } from '../types';

interface Props {
  insights: PostInsight[];
  hideHead?: boolean;
}

function formatFollowers(count: number): string {
  if (count == null || Number.isNaN(count) || count < 0) return '0粉';
  if (count === 0) return '0粉';
  if (count >= 10000) {
    const wan = count / 10000;
    const text = wan >= 10 ? Math.round(wan).toString() : wan.toFixed(1).replace(/\.0$/, '');
    return `${text}万粉`;
  }
  return `${count}粉`;
}

function displayName(item: PostInsight): string {
  return item.authorNickname || item.title || '牛友';
}

export function HotContent({ insights, hideHead }: Props) {
  return (
    <section className="isd-zone">
      {!hideHead && (
        <>
          <div className="isd-zone-head">
            <span className="isd-step">4</span>
            高热内容聚合
          </div>
          <p className="isd-module-sub">同发布者仅保留1条最新高互动帖，结构化提炼核心信息</p>
        </>
      )}

      <div className="isd-hot-grid">
        {insights.length ? (
          insights.map((item) => (
            <article key={item.id} className="isd-hot-card isd-hot-card--compact">
              <header className="isd-hot-head">
                <div className="isd-hot-user">
                  {item.authorAvatar ? (
                    <img
                      className="isd-hot-avatar"
                      src={item.authorAvatar}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="isd-hot-avatar isd-hot-avatar--placeholder" aria-hidden>
                      {displayName(item).slice(0, 1)}
                    </div>
                  )}
                  <div className="isd-hot-user-meta">
                    <div className="isd-hot-author-row">
                      <strong>{displayName(item)}</strong>
                      {(item.authorFollowers ?? 0) > 1000 && (
                        <span className="isd-hot-kol">【KOL】</span>
                      )}
                      <span className="isd-hot-type">{item.postTypeLabel}</span>
                    </div>
                    <span className="isd-hot-fans">{formatFollowers(item.authorFollowers ?? 0)}</span>
                  </div>
                </div>
                <span className="isd-hot-eng">互动 {item.engagement}</span>
              </header>

              {item.isFallback ? (
                <div className="isd-hot-block isd-hot-block--fallback isd-hot-block--compact">
                  <label>原文摘要</label>
                  <p>{item.fallbackExcerpt}</p>
                  {item.fallbackNote && (
                    <span className="isd-hot-fallback-note">{item.fallbackNote}</span>
                  )}
                </div>
              ) : (
                <div className="isd-hot-body">
                  <div className="isd-hot-block isd-hot-block--compact">
                    <label>核心观点</label>
                    <p>{item.coreView}</p>
                  </div>
                  {item.bullLogic && (
                    <div className="isd-hot-block isd-hot-block--compact">
                      <label>关键基本面</label>
                      <p className="isd-hot-kv">{item.bullLogic}</p>
                    </div>
                  )}
                  {item.strategy && (
                    <div className="isd-hot-block isd-hot-block--compact">
                      <label>打新相关策略</label>
                      <p>{item.strategy}</p>
                    </div>
                  )}
                </div>
              )}

              <footer className="isd-hot-foot">
                <div className="isd-hot-foot-left">
                  {item.url ? (
                    <a className="isd-hot-link" href={item.url} target="_blank" rel="noopener noreferrer">
                      查看原帖 →
                    </a>
                  ) : (
                    <span className="isd-hot-link isd-hot-link--disabled">暂无原帖链接</span>
                  )}
                  {item.publishedAt && <span className="isd-hot-time">{item.publishedAt}</span>}
                </div>
                {item.tags.length > 0 && (
                  <div className="isd-hot-tags isd-hot-tags--foot">
                    {item.tags.map((tag) => (
                      <span key={tag} className="isd-hot-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </footer>
            </article>
          ))
        ) : (
          <div className="isd-empty">暂无符合筛选条件的高热 IPO 帖文</div>
        )}
      </div>
    </section>
  );
}
