import { useMemo } from 'react';
import { KW_CATEGORIES } from '../constants';
import type { NnqHeatData } from '../types';
import {
  buildHighEngagementPosts,
  buildHotDiscussionTopics,
  buildKeywordTopicCategories,
  type CommunityPostSnippet,
  type KeywordTopicBlock,
} from '../utils/keywordEnhance';

interface Props {
  data: NnqHeatData;
}

function InteractionBar({ post }: { post: CommunityPostSnippet }) {
  return (
    <div className="isd-kw-interact">
      <span>👍 {post.likes}</span>
      <span>💬 {post.comments}</span>
      <span>↗ {post.shares}</span>
      <span className="isd-kw-interact-total">互动 {post.interaction}</span>
    </div>
  );
}

function PostSnippetCard({ post }: { post: CommunityPostSnippet }) {
  const stockLabel = post.stocks.length
    ? post.stocks.map((s) => s.name).join(' · ')
    : 'IPO 讨论';

  if (!post.url) {
    return (
      <div className="isd-kw-post">
        <div className="isd-kw-post-stock">{stockLabel}</div>
        <p className="isd-kw-post-text">{post.excerpt}</p>
        <InteractionBar post={post} />
      </div>
    );
  }

  return (
    <a
      className="isd-kw-post isd-kw-post--link"
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="isd-kw-post-stock">{stockLabel}</div>
      <p className="isd-kw-post-text">{post.excerpt}</p>
      <InteractionBar post={post} />
    </a>
  );
}

function KeywordTopicCard({ block }: { block: KeywordTopicBlock }) {
  return (
    <div className="isd-kw-topic-block">
      <div className="isd-kw-topic-word">「{block.word}」</div>
      {block.posts.map((post) => (
        <PostSnippetCard key={`${block.word}-${post.id}`} post={post} />
      ))}
    </div>
  );
}

function HighEngagementRow({ post }: { post: CommunityPostSnippet }) {
  const stockLabel = post.stocks.length
    ? post.stocks.map((s) => (s.code ? `${s.name}(${s.code})` : s.name)).join(' · ')
    : 'IPO 相关';

  return (
    <div className="isd-kw-hot-row">
      <div className="isd-kw-hot-main">
        <div className="isd-kw-hot-stock">{stockLabel}</div>
        <p className="isd-kw-hot-text">{post.excerpt}</p>
        <InteractionBar post={post} />
      </div>
      {post.url ? (
        <a className="isd-kw-hot-btn" href={post.url} target="_blank" rel="noopener noreferrer">
          查看原帖
        </a>
      ) : (
        <span className="isd-kw-hot-btn isd-kw-hot-btn--disabled">暂无链接</span>
      )}
    </div>
  );
}

export function KeywordPanel({ data }: Props) {
  const topics = useMemo(() => buildHotDiscussionTopics(data), [data]);
  const categories = useMemo(() => buildKeywordTopicCategories(data), [data]);
  const hotPosts = useMemo(() => buildHighEngagementPosts(data), [data]);
  const keys = Object.keys(KW_CATEGORIES) as (keyof typeof KW_CATEGORIES)[];

  return (
    <section className="isd-zone">
      <div className="isd-zone-head">
        <span className="isd-step">3</span>
        关键词分析
      </div>
      <p className="isd-module-sub">社区 IPO 讨论内容聚合，展示真实帖文与高互动讨论</p>

      <div className="isd-kw-summary isd-card">
        <div className="isd-kw-summary-title">7日高频讨论话题</div>
        {topics.length ? (
          <ul className="isd-kw-summary-list">
            {topics.map((t) => (
              <li key={t.keyword}>{t.text}</li>
            ))}
          </ul>
        ) : (
          <div className="isd-empty isd-empty--sm">近7日暂无集中讨论话题</div>
        )}
      </div>

      <div className="isd-kw-grid">
        {keys.map((key) => {
          const cat = KW_CATEGORIES[key];
          const blocks = categories[key] || [];
          return (
            <div key={key} className="isd-card isd-kw-cat">
              <div className="isd-kw-cat-title">
                <span>{cat.icon}</span>
                {cat.title}
              </div>
              {blocks.length ? (
                blocks.slice(0, 4).map((block) => (
                  <KeywordTopicCard key={block.word} block={block} />
                ))
              ) : (
                <div className="isd-empty isd-empty--sm">暂无相关讨论</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="isd-card isd-kw-hot-zone">
        <div className="isd-kw-hot-title">高互动讨论区</div>
        <p className="isd-kw-hot-sub">近7天 IPO 相关帖文，按互动量（点赞+评论+转发）降序</p>
        {hotPosts.length ? (
          <div className="isd-kw-hot-list">
            {hotPosts.map((post) => (
              <HighEngagementRow key={post.id} post={post} />
            ))}
          </div>
        ) : (
          <div className="isd-empty isd-empty--sm">暂无高互动 IPO 帖文</div>
        )}
      </div>
    </section>
  );
}
