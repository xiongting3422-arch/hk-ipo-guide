/**
 * 站点轮播配置：从 data/site-banners.json 加载，供 IPO 主页 Banner 与新股资讯轮播使用。
 * 管理后台更新 JSON 与图片后，访客刷新即可看到最新内容（JSON 带 updatedAt 防缓存）。
 */
(function (global) {
  'use strict';

  var CONFIG_URL = './data/site-banners.json';
  var loadPromise = null;

  var FALLBACK = {
    updatedAt: 'fallback',
    home: [
      {
        id: 'home-fallback-1',
        src: './assets/images/ipo-home-banner/slide-01-2x.png',
        alt: '剂泰科技-P 暗盘涨幅 319%，一手赚 16750',
        width: 2800,
        height: 280,
        enabled: true,
        order: 0
      }
    ],
    news: [
      { id: 'news-fallback-1', src: './assets/images/ipo-news/banner/slot-1.png', href: '', enabled: true, order: 0 },
      { id: 'news-fallback-2', src: './assets/images/ipo-news/banner/slot-2.png', href: '', enabled: true, order: 1 },
      { id: 'news-fallback-3', src: './assets/images/ipo-news/banner/slot-3.png', href: '', enabled: true, order: 2 },
      {
        id: 'news-fallback-4',
        src: './assets/images/ipo-news/banner/slot-4.png',
        href: 'https://invest.futuhk.com/ipo_season',
        enabled: true,
        order: 3
      }
    ]
  };

  function sortEnabled(items) {
    return (items || [])
      .filter(function (item) {
        return item && item.enabled !== false && item.src;
      })
      .sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });
  }

  function applyConfig(raw) {
    var cfg = raw || FALLBACK;
    global.IPO_HOME_BANNER_BUILD = String(cfg.updatedAt || Date.now()).replace(/[:.]/g, '');
    global.IPO_HOME_BANNERS = sortEnabled(cfg.home).map(function (item) {
      return {
        src: item.src,
        alt: item.alt || 'IPO 主页轮播图',
        width: item.width || 2800,
        height: item.height || 280
      };
    });
    global.IPO_NEWS_BANNER_IMAGES = sortEnabled(cfg.news).map(function (item) {
      var row = { src: item.src };
      if (item.href && String(item.href).trim()) row.href = String(item.href).trim();
      return row;
    });
    global.__ipoBannerConfigLoaded = true;
    return cfg;
  }

  function loadSiteBanners() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(CONFIG_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(applyConfig)
      .catch(function (err) {
        console.warn('[ipo-banners] 加载配置失败，使用内置兜底:', err);
        return applyConfig(FALLBACK);
      });
    return loadPromise;
  }

  /** 配置变更后强制重新拉取（管理后台保存后预览用） */
  function reloadSiteBanners() {
    loadPromise = null;
    global.__ipoBannerConfigLoaded = false;
    return loadSiteBanners();
  }

  global.loadSiteBanners = loadSiteBanners;
  global.reloadSiteBanners = reloadSiteBanners;
  applyConfig(FALLBACK);
})(typeof window !== 'undefined' ? window : global);
