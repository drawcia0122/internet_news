const pageType = document.body.dataset.adultPage || 'top';
const contentElement = document.querySelector('#adult-page-content');
const titleElement = document.querySelector('#adult-page-title');
const descriptionElement = document.querySelector('#adult-page-description');
const refreshStatusElement = document.querySelector('#adult-refresh-status');
const sortControlsElement = document.querySelector('#adult-sort-controls');
const mobileMenuButton = document.querySelector('#mobile-menu-button');
const mobileNavDrawer = document.querySelector('#mobile-nav-drawer');

const ADULT_CACHE_TTL_MS = 90 * 1000;
const ADULT_REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const isFileProtocol = window.location.protocol === 'file:';

const PAGE_CONFIG = {
  top: {
    title: 'アダルト編集ポータル',
    description: 'ランキングの再掲ではなく、何が流行り、なぜ伸び、お得度がどこにあるかを先に読むための入口です。',
    refreshDefault: '編集サマリーを先頭に出し、その下でランキング・急上昇・セール・キャンペーンを確認できます。',
    sorts: [],
  },
  ranking: {
    title: 'ランキング',
    description: '売れ筋を確認する棚です。マガジンで方向感を掴んだ後に、実際の順位を確認する役割に限定します。',
    refreshDefault: 'FANZA / DLsite / ジャンル別の売れ筋を順位中心で表示します。',
    sorts: [
      { value: 'ranking', label: 'ランキング順' },
      { value: 'popular', label: '人気順' },
      { value: 'priceLow', label: '価格が安い順' },
      { value: 'priceHigh', label: '価格が高い順' },
    ],
    defaultSort: 'ranking',
  },
  trending: {
    title: '急上昇',
    description: '今伸びている作品、ジャンル、タグ、サークルを別軸で追います。',
    refreshDefault: '前回順位との差分から急上昇を抽出します。',
    sorts: [
      { value: 'rise', label: '上昇幅順' },
      { value: 'popular', label: '人気順' },
      { value: 'ranking', label: '現在順位順' },
      { value: 'priceLow', label: '価格が安い順' },
    ],
    defaultSort: 'rise',
  },
  magazine: {
    title: 'マガジン',
    description: 'このセクションの主役です。テーマごとにまとめ、今何を買うべきかまで短く判断できる構成にします。',
    refreshDefault: 'FANZA / DLsite / Ci-en のテーマ別特集を、要約・注目ポイント・おすすめ作品つきで表示します。',
    sorts: [
      { value: 'featured', label: 'おすすめ順' },
      { value: 'popular', label: '人気順' },
      { value: 'recent', label: '新しい順' },
    ],
    defaultSort: 'featured',
  },
  campaign: {
    title: 'キャンペーン',
    description: '開催中イベント、クーポン、ポイント還元、特集企画を商品一覧とは別視点で整理します。',
    refreshDefault: '終了日時、割引、還元、関連作品をまとめて確認できます。',
    sorts: [
      { value: 'endSoon', label: '終了が近い順' },
      { value: 'value', label: 'お得度順' },
      { value: 'popular', label: '人気順' },
    ],
    defaultSort: 'endSoon',
  },
  sale: {
    title: 'セール注目作品',
    description: '割引率、現在価格、通常価格、残り期間を主役にして、今お得な作品を探します。',
    refreshDefault: '価格情報と valueScore を最優先で並べます。',
    sorts: [
      { value: 'value', label: 'お得度順' },
      { value: 'discount', label: '割引率順' },
      { value: 'priceLow', label: '価格が安い順' },
      { value: 'priceHigh', label: '価格が高い順' },
      { value: 'ranking', label: 'ランキング順' },
    ],
    defaultSort: 'value',
  },
};

let adultFeatureItems = [];
let adultTrendItems = [];
let adultArchiveItems = [];
let refreshStatusTimer;
let lastRefreshStartedAt = 0;
let activeSort = PAGE_CONFIG[pageType]?.defaultSort || '';
const EXCLUDED_ADULT_GENRES = new Set(['AI作品']);

init();

function init() {
  if (titleElement) titleElement.textContent = PAGE_CONFIG[pageType]?.title || 'アダルトポータル';
  if (descriptionElement) descriptionElement.textContent = PAGE_CONFIG[pageType]?.description || '';
  renderSortControls();
  wireMobileMenu();
  adultFeatureItems = loadAdultFeatureCache();
  adultTrendItems = loadAdultTrendCache();
  adultArchiveItems = loadAdultArchiveCache();
  renderAdultPage();
  refreshLiveData({ silent: true });
  window.setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - lastRefreshStartedAt < ADULT_REFRESH_INTERVAL_MS - 5000) return;
    refreshLiveData({ silent: false });
  }, ADULT_REFRESH_INTERVAL_MS);
}

document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (!image.classList.contains('adult-thumb') && !image.classList.contains('adult-related-thumb')) return;
  const wrapper = image.closest('.adult-thumb-wrap, .adult-related-thumb-wrap');
  if (wrapper) wrapper.remove();
}, true);

async function refreshLiveData({ silent = false } = {}) {
  lastRefreshStartedAt = Date.now();
  if (!silent) showRefreshStatus('アダルトポータルを更新中...');

  const status = await loadAdultData();
  if (silent) return;

  if (!status.ok) {
    if (isFileProtocol) {
      showRefreshStatus('取得失敗: file:// では読めません。http://localhost:8000 で開いてください');
      return;
    }
    showRefreshStatus(`取得失敗: ${status.error ?? 'データ取得エラー'}`);
    return;
  }

  showRefreshStatus('更新を確認: ' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
}

async function loadAdultData() {
  let errorMessage = null;
  try {
    const [featuresPayload, trendsPayload, archivePayload] = await Promise.all([
      fetchJsonWithCache({ cacheKey: 'adult-features', endpoints: ['./data/adult-features.json'], ttlMs: ADULT_CACHE_TTL_MS }),
      fetchJsonWithCache({ cacheKey: 'adult-trends', endpoints: ['./data/adult-trends.json'], ttlMs: ADULT_CACHE_TTL_MS }),
      fetchJsonWithCache({ cacheKey: 'adult-trends-archive', endpoints: ['./data/adult-trends-archive.json'], ttlMs: ADULT_CACHE_TTL_MS }),
    ]);
    adultArchiveItems = payloadItems(archivePayload);
    const archiveMap = buildArchiveMap(adultArchiveItems);
    adultTrendItems = payloadItems(trendsPayload).map((item) => normalizeAdultTrendItem(item, archiveMap.get(item.id)));
    adultFeatureItems = payloadItems(featuresPayload).map((item) => normalizeAdultFeatureItem(item));
  } catch (error) {
    errorMessage = error?.message || '取得エラー';
  }

  saveAdultFeatureCache(adultFeatureItems);
  saveAdultTrendCache(adultTrendItems);
  saveAdultArchiveCache(adultArchiveItems);
  renderAdultPage();

  return {
    ok: adultFeatureItems.length > 0 || adultTrendItems.length > 0,
    count: adultFeatureItems.length + adultTrendItems.length,
    error: errorMessage,
  };
}

function renderAdultPage() {
  if (!contentElement) return;
  const model = buildPortalModel();
  if (refreshStatusElement) {
    refreshStatusElement.textContent = PAGE_CONFIG[pageType]?.refreshDefault || '';
  }

  if (pageType === 'ranking') {
    contentElement.innerHTML = renderRankingPage(model);
    return;
  }
  if (pageType === 'trending') {
    contentElement.innerHTML = renderTrendingPage(model);
    return;
  }
  if (pageType === 'magazine') {
    contentElement.innerHTML = renderMagazinePage(model);
    return;
  }
  if (pageType === 'campaign') {
    contentElement.innerHTML = renderCampaignPage(model);
    return;
  }
  if (pageType === 'sale') {
    contentElement.innerHTML = renderSalePage(model);
    return;
  }
  contentElement.innerHTML = renderTopPage(model);
}

function buildPortalModel() {
  const rawRankingItems = attachRelatedTrendItems(adultTrendItems.filter((item) => item.ranking));
  const visibleTrendItems = attachRelatedTrendItems(adultTrendItems.filter(isVisibleAdultTrendItem));
  const visibleFeatureItems = adultFeatureItems.filter(isVisibleAdultFeatureItem);
  const rankingItems = rawRankingItems;
  const saleItems = visibleTrendItems.filter((item) => item.adultDisplayType === 'sale' || item.discountRate !== null || item.price !== null || item.originalPrice !== null);
  const campaignItems = visibleTrendItems.filter((item) => item.adultDisplayType === 'campaign');
  const trendingWorks = visibleTrendItems.filter((item) => item.rankChange > 0 || item.adultDisplayType === 'trending');
  const magazineFeatures = [...visibleFeatureItems].sort(compareFeatureItemsForMagazine);
  const campaignPool = dedupeById([
    ...campaignItems,
    ...saleItems.filter((item) => item.saleEndDate || item.discountRate !== null || /クーポン|ポイント|還元|特集|セール/i.test([item.title, item.summary, ...(item.tags ?? [])].join(' '))),
  ]);
  const magazineSections = buildMagazineSections({ features: magazineFeatures, trendItems: visibleTrendItems });
  const campaignStories = buildCampaignStories({ campaignItems: campaignPool, saleItems, features: magazineFeatures, trendItems: visibleTrendItems });
  const editorLead = buildEditorLead({ sections: magazineSections, saleItems, campaignItems: campaignPool, trendItems: visibleTrendItems });

  return {
    editorLead,
    rankingTop: sortItems([...rankingItems], 'ranking').slice(0, 3),
    rankingFanza: sortItems(rankingItems.filter((item) => item.adultSourceGroup === 'fanza'), activeSort).slice(0, 50),
    rankingDlsite: sortItems(rankingItems.filter((item) => item.adultSourceGroup === 'dlsite'), activeSort).slice(0, 50),
    rankingGenres: [
      '同人音声',
      '同人ゲーム',
      'エロ漫画',
      'AV',
    ].map((genre) => ({
      genre,
      items: sortItems(rankingItems.filter((item) => item.adultPrimaryGenre === genre), activeSort).slice(0, 20),
    })),
    trendingTop: sortItems([...trendingWorks], 'rise').slice(0, 3),
    trendingWorks: sortItems([...trendingWorks], activeSort || 'rise').slice(0, 30),
    trendingGenres: aggregateTrendBuckets(trendingWorks, (item) => item.adultPrimaryGenre || '未分類'),
    trendingTags: aggregateTrendBuckets(trendingWorks, (item) => item.tags || []),
    trendingMakers: aggregateTrendBuckets(trendingWorks, (item) => item.maker || ''),
    magazineTop: magazineFeatures.slice(0, 3),
    magazineSections,
    magazineBySource: ['fanza', 'dlsite', 'cien'].map((sourceGroup) => ({
      sourceGroup,
      items: magazineFeatures.filter((item) => item.sourceGroupKey === sourceGroup),
    })),
    campaignTop: sortItems([...campaignPool], 'endSoon').slice(0, 3),
    campaignItems: sortItems([...campaignPool], activeSort || 'endSoon'),
    campaignStories,
    saleTop: sortItems([...saleItems], 'value').slice(0, 3),
    saleItems: sortItems([...saleItems], activeSort || 'value'),
  };
}

function isVisibleAdultTrendItem(item) {
  return !EXCLUDED_ADULT_GENRES.has(contentGenreLabel(item));
}

function isVisibleAdultFeatureItem(item) {
  const primaryGenre = String(item?.primaryGenre ?? item?.adultPrimaryGenre ?? '');
  if (EXCLUDED_ADULT_GENRES.has(primaryGenre)) return false;
  if (Array.isArray(item?.tags) && item.tags.some((tag) => EXCLUDED_ADULT_GENRES.has(String(tag)))) return false;
  if (Array.isArray(item?.relatedItems) && item.relatedItems.length) {
    const visibleRelated = item.relatedItems.filter((related) => !EXCLUDED_ADULT_GENRES.has(contentGenreLabel(related)));
    item.relatedItems = visibleRelated;
    if (!visibleRelated.length) return false;
  }
  return !/AI作品|生成AI/.test(String(item?.title ?? ''));
}

function renderTopPage(model) {
  return [
    '<section class="adult-home-grid">',
    renderEditorLead(model.editorLead),
    '<section class="adult-panel adult-magazine-hero-panel">',
    '<div class="adult-panel-head"><h2>今週のマガジン</h2><p>公式サイトへ行く前に、今の流れと買いどころを先に把握するための要約です。</p></div>',
    model.magazineSections.length
      ? '<div class="adult-editorial-stack">' + model.magazineSections.slice(0, 2).map((section, index) => renderMagazineStory(section, index, { featured: true })).join('') + '</div>'
      : renderEmptyPanel('今週の特集を準備中です', 'テーマがまとまり次第、要約とおすすめ作品をここへ表示します。'),
    '</section>',
    '<div class="adult-entry-grid">',
    renderEntryCard('📰', 'マガジン', './adult-magazine.html', '要約・分析・おすすめを読む'),
    renderEntryCard('🎁', 'キャンペーン', './adult-campaign.html', '開催中イベントと期限を確認'),
    renderEntryCard('💰', 'セール注目作品', './adult-sale.html', '割引率と価格でお得作品を探す'),
    renderEntryCard('📈', '急上昇', './adult-trending.html', '前回との差分から伸び筋を追跡'),
    renderEntryCard('🏆', 'ランキング', './adult-ranking.html', '最後に順位を確認する'),
    '</div>',
    '<div class="adult-summary-stack">',
    renderTopSummary('🎁 開催中キャンペーン', model.campaignTop, 'campaign'),
    renderTopSummary('💰 本日の激安作品TOP3', model.saleTop, 'sale'),
    renderTopSummary('📈 急上昇TOP3', model.trendingTop, 'trending'),
    renderTopSummary('🏆 人気ランキングTOP3', model.rankingTop, 'ranking'),
    '</div>',
    '</section>',
  ].join('');
}

function renderRankingPage(model) {
  return [
    renderSectionIntro('DLsite公式ランキング', 'DLsite 24時間ランキングを、公式順位そのままで確認します。'),
    renderWorkGrid(sortItems([...model.rankingDlsite], 'ranking').slice(0, 20), 'ranking'),
    renderSectionIntro('FANZA公式ランキング', 'FANZA 側の取得データも、公式順位を優先して表示します。'),
    renderWorkGrid(sortItems([...model.rankingFanza], 'ranking').slice(0, 20), 'ranking'),
    renderSectionIntro('DLsiteジャンル別整理', '以下は公式順位を崩さず、ジャンルごとに見直しやすく再配置した一覧です。'),
    renderGenreRankingSections(groupRankingItemsByContext(model.rankingDlsite, 'DLsite')),
    renderSectionIntro('FANZAジャンル別整理', '以下は FANZA の順位データをジャンル単位で見直すための補助一覧です。'),
    renderGenreRankingSections(groupRankingItemsByContext(model.rankingFanza, 'FANZA')),
    renderSectionIntro('ジャンル横断ランキング', '同人音声 / AI作品 / 同人ゲーム / エロ漫画 / AV を横断で比較します。'),
    renderGenreRankingSections(normalizeStandaloneGenreGroups(model.rankingGenres), { standalone: true }),
  ].join('');
}

function renderTrendingPage(model) {
  return [
    renderSectionIntro('急上昇作品', '前回順位からどれだけ伸びたかを表示します。'),
    renderWorkGrid(model.trendingWorks, 'trending'),
    '<div class="adult-metric-grid">',
    renderMetricPanel('急上昇ジャンル', model.trendingGenres),
    renderMetricPanel('急上昇タグ', model.trendingTags),
    renderMetricPanel('急上昇サークル', model.trendingMakers),
    '</div>',
  ].join('');
}

function renderMagazinePage(model) {
  return [
    renderEditorLead(model.editorLead, true),
    '<section class="adult-panel adult-magazine-panel">',
    '<div class="adult-panel-head"><h2>特集一覧</h2><p>同じセール、ジャンル、サークル、更新テーマを1本の読み物として統合しています。</p></div>',
    model.magazineSections.length
      ? '<div class="adult-editorial-stack">' + model.magazineSections.map((section, index) => renderMagazineStory(section, index)).join('') + '</div>'
      : renderEmptyPanel('特集データを整理中です', 'adult-trends.json と adult-features.json にテーマがたまると、ここへ特集として表示します。'),
    '</section>',
    model.magazineBySource.map((group) => {
      const sourceName = sourceGroupLabel(group.sourceGroup);
      return [
        '<section class="adult-panel adult-magazine-panel">',
        `<div class="adult-panel-head"><h2>${escapeHtml(sourceName)}特集アーカイブ</h2><p>ソース別に元データを一覧できます。</p></div>`,
        group.items.length
          ? '<div class="adult-magazine-layout">' + group.items.map((item, index) => renderMagazineFeature(item, index)).join('') + '</div>'
          : renderEmptyPanel('特集データを整理中です', 'テーマが集まり次第ここへ表示します。'),
        '</section>',
      ].join('');
    }).join(''),
  ].join('');
}

function renderCampaignPage(model) {
  return [
    renderSectionIntro('開催中キャンペーン', 'FANZA / DLsite / クーポン / ポイント還元 / 特集企画を、作品一覧とは別に要約付きで整理します。'),
    renderCampaignStoryGrid(model.campaignStories),
    renderWorkGrid(model.campaignItems, 'campaign'),
  ].join('');
}

function renderSalePage(model) {
  return [
    renderSectionIntro('セール注目作品', '割引率、現在価格、通常価格、残り期間を優先して表示します。'),
    renderWorkGrid(model.saleItems, 'sale'),
  ].join('');
}

function renderSectionIntro(title, description) {
  return `<section class="adult-panel"><div class="adult-panel-head"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></section>`;
}

function renderTopSummary(title, items, mode) {
  return [
    '<section class="adult-panel">',
    `<div class="adult-panel-head"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(items.length ? `${items.length}件を表示` : 'データ整理中')}</p></div>`,
    renderWorkGrid(items, mode, true),
    '</section>',
  ].join('');
}

function renderMagazineSummary(title, items) {
  return [
    '<section class="adult-panel">',
    `<div class="adult-panel-head"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(items.length ? `${items.length}本の特集` : '特集データ整理中')}</p></div>`,
    items.length
      ? '<div class="adult-feature-grid">' + items.map((item, index) => renderMagazineFeature(item, index, true)).join('') + '</div>'
      : renderEmptyPanel('今週の特集を準備中です', 'テーマがまとまり次第、ここにおすすめ特集を表示します。'),
    '</section>',
  ].join('');
}

function renderEditorLead(lead, compact = false) {
  if (!lead) {
    return '<section class="adult-panel adult-editorial-lead"><div class="adult-panel-head"><h2>編集サマリー</h2><p>トレンド集計後にここへ要約を表示します。</p></div></section>';
  }
  return [
    `<section class="adult-panel adult-editorial-lead${compact ? ' adult-editorial-lead-compact' : ''}">`,
    '<div class="adult-editorial-eyebrow">EDITORIAL LEAD</div>',
    `<div class="adult-editorial-head"><div><p class="adult-editorial-kicker">${escapeHtml(lead.kicker)}</p><h2>${escapeHtml(lead.title)}</h2></div><p>${escapeHtml(lead.summary)}</p></div>`,
    lead.points?.length ? '<div class="adult-editorial-points">' + lead.points.map((point) => `<span>${escapeHtml(point)}</span>`).join('') + '</div>' : '',
    lead.recommendations?.length ? '<div class="adult-editorial-picks">' + lead.recommendations.map((item) => renderEditorPick(item)).join('') + '</div>' : '',
    '</section>',
  ].join('');
}

function renderEditorPick(item) {
  const href = item.detailUrl || item.url || '#';
  const external = /^https?:\/\//i.test(href);
  const thumb = item.thumbnail ? `<div class="adult-editor-pick-thumb"><img class="adult-related-thumb" src="${escapeHtml(item.thumbnail)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer" /></div>` : '';
  return [
    `<a class="adult-editor-pick" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>`,
    thumb,
    '<div>',
    `<strong>${escapeHtml(item.title)}</strong>`,
    `<p>${escapeHtml(item.reason || '今週の注目作品')}</p>`,
    `<small>${escapeHtml(formatRecommendationMeta(item))}</small>`,
    '</div>',
    '</a>',
  ].join('');
}

function renderEntryCard(icon, title, href, description) {
  return [
    `<a class="adult-entry-card" href="${escapeHtml(href)}">`,
    `<span class="adult-entry-icon">${escapeHtml(icon)}</span>`,
    `<strong>${escapeHtml(title)}</strong>`,
    `<p>${escapeHtml(description)}</p>`,
    '<span class="adult-entry-link">入口を見る →</span>',
    '</a>',
  ].join('');
}

function renderWorkGrid(items, mode, compact = false) {
  if (!Array.isArray(items) || !items.length) {
    return renderEmptyPanel('対象データがまだありません', mode === 'sale'
      ? '価格情報付きのセールデータ取得後に表示します。'
      : mode === 'campaign'
        ? 'キャンペーン・クーポン・ポイント還元のデータ取得後に表示します。'
        : 'adult-trends.json の履歴が増えるとここに表示します。');
  }
  return `<div class="${compact ? 'adult-list-grid adult-list-grid-compact' : 'adult-list-grid'}">${items.map((item) => renderWorkCard(item, mode, compact)).join('')}</div>`;
}

function renderWorkCard(item, mode, compact = false, { displayRank = null } = {}) {
  const href = './adult-topic.html?id=' + encodeURIComponent(item.routeId ?? item.id ?? '');
  const title = item.title || 'アダルトトレンド';
  const makerLabel = item.adultSourceGroup === 'dlsite' ? 'サークル' : 'メーカー';
  const priceBlock = renderPriceBlock(item, mode);
  const changeBlock = mode === 'trending' ? renderRankChange(item) : '';
  const deadline = renderDeadline(item);
  const badges = renderBadgeRow(item.badges);
  const thumb = item.thumbnailUrl ? `<a class="adult-thumb-wrap" href="${escapeHtml(href)}"><img class="adult-thumb" src="${escapeHtml(item.thumbnailUrl)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer" /></a>` : '';

  return [
    `<article class="adult-card adult-portal-card ${compact ? 'adult-portal-card-compact' : ''}">`,
    (displayRank || item.ranking) ? `<div class="adult-rank-badge">${escapeHtml(String(displayRank || item.ranking))}位</div>` : '',
    mode === 'sale' && item.discountRate !== null ? `<div class="adult-sale-badge">🔥 ${escapeHtml(String(item.discountRate))}%OFF</div>` : '',
    thumb,
    '<div class="adult-card-body">',
    `<div class="adult-card-meta"><span>${escapeHtml(sourceGroupLabel(item.adultSourceGroup))} · ${escapeHtml(item.adultPrimaryGenre || '未分類')}</span><strong>VS ${escapeHtml(String(item.valueScore ?? 0))}</strong></div>`,
    badges,
    `<h3><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></h3>`,
    `<p>${escapeHtml(item.summary || '注目作品を整理中です。')}</p>`,
    '<dl class="adult-card-points">',
    `<div><dt>${escapeHtml(makerLabel)}</dt><dd>${escapeHtml(item.maker || '未取得')}</dd></div>`,
    `<div><dt>ジャンル</dt><dd>${escapeHtml(item.adultPrimaryGenre || item.genre || '未分類')}</dd></div>`,
    mode !== 'campaign' ? `<div><dt>順位</dt><dd>${escapeHtml(displayRank ? `${displayRank}位` : (item.ranking ? `${item.ranking}位` : '順位未取得'))}${displayRank && item.ranking && displayRank !== item.ranking ? `<small class="adult-rank-origin">元 ${escapeHtml(String(item.ranking))}位</small>` : ''}</dd></div>` : '',
    '</dl>',
    changeBlock,
    priceBlock,
    renderInlineRelatedWorks(item.relatedItems),
    deadline,
    `<div class="adult-card-footer"><span>${escapeHtml(item.sourceName || sourceGroupLabel(item.adultSourceGroup))}</span><div class="adult-card-actions">${item.sourceUrl ? `<a class="adult-source-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">公式を見る ↗</a>` : ''}<a href="${escapeHtml(href)}">詳細を見る</a></div></div>`,
    '</div>',
    '</article>',
  ].join('');
}

function renderMagazineFeature(feature, index, compact = false) {
  const href = feature.primaryItemId ? './adult-topic.html?id=' + encodeURIComponent(feature.primaryItemId) : feature.sourceUrl || '#';
  const thumb = feature.thumbnailUrl ? `<a class="adult-thumb-wrap adult-feature-thumb" href="${escapeHtml(href)}"><img class="adult-thumb" src="${escapeHtml(feature.thumbnailUrl)}" alt="${escapeHtml(feature.title)}" loading="lazy" referrerpolicy="no-referrer" /></a>` : '';
  return [
    `<article class="adult-feature-card ${compact ? 'adult-feature-card-compact' : ''}" style="animation-delay:${index * 45}ms">`,
    `<div class="adult-feature-meta"><span class="adult-feature-source">${escapeHtml(feature.sourceGroup || sourceGroupLabel(feature.sourceGroupKey))}</span><strong>HOT ${escapeHtml(String(feature.importance ?? 0))}</strong></div>`,
    thumb,
    '<div class="adult-feature-body">',
    `<h3><a href="${escapeHtml(href)}">${escapeHtml(feature.title)}</a></h3>`,
    `<p class="adult-feature-summary">${escapeHtml(feature.summary || '特集情報を整理中です。')}</p>`,
    `<dl class="adult-feature-points"><div><dt>注目理由</dt><dd>${escapeHtml(feature.whyHot || '話題が集中しているため注目しています。')}</dd></div><div><dt>更新</dt><dd>${escapeHtml(formatAdultDate(feature.updatedAt))}</dd></div></dl>`,
    feature.tags?.length ? `<div class="adult-chip-row">${feature.tags.slice(0, 6).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : '',
    '<div class="adult-related-strip"><div class="adult-related-strip-head"><strong>おすすめ作品</strong><a href="' + escapeHtml(href) + '">特集を見る</a></div><div class="adult-related-row">' + renderRelatedItems(feature.relatedItems) + '</div></div>',
    '</div>',
    '</article>',
  ].join('');
}

function renderMagazineStory(section, index, { featured = false } = {}) {
  return [
    `<article class="adult-story-card${featured ? ' adult-story-card-featured' : ''}" style="animation-delay:${index * 45}ms">`,
    `<div class="adult-story-head"><div><p class="adult-story-kicker">${escapeHtml(section.kicker || 'FEATURE')}</p><h3>${escapeHtml(section.title)}</h3></div><strong>${escapeHtml(section.scoreLabel || '')}</strong></div>`,
    `<p class="adult-story-summary">${escapeHtml(section.summary || '特集情報を整理中です。')}</p>`,
    section.keyPoints?.length ? '<ul class="adult-story-points">' + section.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join('') + '</ul>' : '',
    section.recommendedWorks?.length ? '<div class="adult-story-recommend-grid">' + section.recommendedWorks.map((item) => renderMagazineRecommendation(item)).join('') + '</div>' : '',
    section.relatedWorks?.length ? '<div class="adult-story-related"><strong>関連作品</strong><div class="adult-story-related-row">' + section.relatedWorks.map((item) => renderStoryRelatedItem(item)).join('') + '</div></div>' : '',
    '</article>',
  ].join('');
}

function renderMagazineRecommendation(item) {
  const href = item.detailUrl || item.url || '#';
  const external = /^https?:\/\//i.test(href);
  const thumb = item.thumbnail ? `<div class="adult-story-rec-thumb"><img class="adult-thumb" src="${escapeHtml(item.thumbnail)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer" /></div>` : '';
  return [
    `<a class="adult-story-recommendation" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>`,
    thumb,
    '<div class="adult-story-rec-body">',
    `<strong>${escapeHtml(item.title)}</strong>`,
    `<p>${escapeHtml(item.reason || 'おすすめ理由を整理中')}</p>`,
    '<div class="adult-story-price-line">',
    item.priceLabel ? `<span>${escapeHtml(item.priceLabel)}</span>` : '',
    item.discountLabel ? `<span>${escapeHtml(item.discountLabel)}</span>` : '',
    item.rankLabel ? `<span>${escapeHtml(item.rankLabel)}</span>` : '',
    item.remainingLabel ? `<span>${escapeHtml(item.remainingLabel)}</span>` : '',
    '</div>',
    '</div>',
    '</a>',
  ].join('');
}

function renderStoryRelatedItem(item) {
  const href = item.detailUrl || item.url || '#';
  const external = /^https?:\/\//i.test(href);
  return `<a class="adult-story-related-link" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${escapeHtml(item.title || '関連作品')}</a>`;
}

function renderCampaignStoryGrid(stories) {
  if (!Array.isArray(stories) || !stories.length) {
    return renderEmptyPanel('キャンペーン情報を整理中です', '取得済みのセール・還元データを統合して、ここへ要約を表示します。');
  }
  return '<section class="adult-panel adult-campaign-story-panel"><div class="adult-panel-head"><h2>お得情報の整理</h2><p>現在走っている施策をテーマ単位でまとめています。</p></div><div class="adult-campaign-story-grid">' + stories.map((story) => renderCampaignStory(story)).join('') + '</div></section>';
}

function renderCampaignStory(story) {
  return [
    '<article class="adult-campaign-story">',
    `<div class="adult-story-head"><div><p class="adult-story-kicker">${escapeHtml(story.kicker || 'CAMPAIGN')}</p><h3>${escapeHtml(story.title)}</h3></div><strong>${escapeHtml(story.scoreLabel || '')}</strong></div>`,
    `<p class="adult-story-summary">${escapeHtml(story.summary || '')}</p>`,
    story.points?.length ? '<ul class="adult-story-points">' + story.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('') + '</ul>' : '',
    story.items?.length ? '<div class="adult-story-related-row">' + story.items.map((item) => renderStoryRelatedItem(item)).join('') + '</div>' : '',
    '</article>',
  ].join('');
}

function renderMetricPanel(title, items) {
  return [
    '<section class="adult-panel adult-metric-panel">',
    `<div class="adult-panel-head"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(items.length ? `${items.length}件を表示` : 'データ整理中')}</p></div>`,
    items.length
      ? '<div class="adult-mini-list">' + items.slice(0, 12).map((item) => `<article class="adult-mini-card"><strong>${escapeHtml(item.label)}</strong><span>急上昇値 +${escapeHtml(String(item.score))}</span><small>${escapeHtml(item.meta)}</small></article>`).join('') + '</div>'
      : renderEmptyPanel('急上昇データを整理中です', '履歴データが増えるとここへ集計して表示します。'),
    '</section>',
  ].join('');
}

function renderGenreRankingSections(groups, options = {}) {
  if (!Array.isArray(groups) || !groups.length) {
    return renderEmptyPanel('対象データがまだありません', '同ジャンルのランキングデータが入ると横並びで表示します。');
  }
  const sections = groups
    .filter((group) => Array.isArray(group.items) && group.items.length)
    .map((group) => [
      `<section class="adult-panel${options.standalone ? '' : ' adult-genre-ranking-panel'}">`,
      `<div class="adult-panel-head"><h3>${escapeHtml(group.genre)}</h3><p>${escapeHtml(group.items.length ? `${group.items.length}件を表示` : 'データ整理中')}</p></div>`,
      renderHorizontalRankingTrack(group.items.slice(0, 12)),
      '</section>',
    ].join(''))
    .join('');
  return sections || renderEmptyPanel('対象データがまだありません', '同ジャンルのランキングデータが入ると横並びで表示します。');
}

function renderHorizontalRankingTrack(items) {
  if (!Array.isArray(items) || !items.length) {
    return renderEmptyPanel('対象データがまだありません', 'ランキングデータ取得後に表示します。');
  }
  return `<div class="adult-ranking-track">${items.map((item) => renderWorkCard(item, 'ranking', true)).join('')}</div>`;
}

function renderRankChange(item) {
  if (!item.previousRank || !item.ranking || item.rankChange <= 0) return '';
  return [
    '<div class="adult-rank-change">',
    '<strong>📈 急上昇</strong>',
    `<span>前回 ${escapeHtml(String(item.previousRank))}位</span>`,
    '<span>↓</span>',
    `<span>今日 ${escapeHtml(String(item.ranking))}位</span>`,
    `<em>上昇幅 +${escapeHtml(String(item.rankChange))}</em>`,
    '</div>',
  ].join('');
}

function renderPriceBlock(item, mode) {
  if (item.price === null && item.originalPrice === null && item.discountRate === null) {
    return mode === 'sale' || mode === 'campaign'
      ? '<div class="adult-price-stack adult-price-stack-empty"><strong>価格情報を整理中</strong><span>取得でき次第ここへ表示します。</span></div>'
      : '';
  }
  return [
    '<div class="adult-price-stack">',
    item.discountRate !== null ? `<strong>${escapeHtml(String(item.discountRate))}%OFF</strong>` : '',
    item.originalPrice !== null ? `<span class="adult-price-compare">通常 ${escapeHtml(formatYen(item.originalPrice))}</span>` : '',
    item.price !== null ? `<span class="adult-price-main">現在 ${escapeHtml(formatYen(item.price))}</span>` : '',
    item.ranking ? `<span class="adult-price-meta">${escapeHtml(sourceGroupLabel(item.adultSourceGroup))}ランキング${escapeHtml(String(item.ranking))}位</span>` : '',
    '</div>',
  ].join('');
}

function renderDeadline(item) {
  if (!item.saleEndDate) return '';
  const remaining = formatRemainingTime(item.saleEndDate);
  return `<div class="adult-deadline"><strong>終了</strong><span>${escapeHtml(formatAdultDate(item.saleEndDate))}</span><em>${escapeHtml(remaining)}</em></div>`;
}

function renderBadgeRow(badges) {
  if (!Array.isArray(badges) || !badges.length) return '';
  return `<div class="adult-badge-row">${badges.map((badge) => `<span class="adult-badge adult-badge-${escapeHtml(badge.kind)}">${escapeHtml(badge.label)}</span>`).join('')}</div>`;
}

function renderInlineRelatedWorks(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return [
    '<div class="adult-inline-related">',
    '<strong>関連作品</strong>',
    '<div class="adult-inline-related-list">',
    items.slice(0, 3).map((item) => {
      const href = item.url || item.detailUrl || '#';
      const external = /^https?:\/\//i.test(href);
      return `<a class="adult-inline-related-link" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${escapeHtml(item.title || '関連作品')}</a>`;
    }).join(''),
    '</div>',
    '</div>',
  ].join('');
}

function renderRelatedItems(items) {
  if (!Array.isArray(items) || !items.length) return '<div class="adult-related-empty">関連作品を整理中です。</div>';
  return items.slice(0, 8).map((item) => {
    const href = item.url || item.detailUrl || '#';
    const external = /^https?:\/\//i.test(href);
    const thumb = item.thumbnail ? `<div class="adult-related-thumb-wrap"><img class="adult-related-thumb" src="${escapeHtml(item.thumbnail)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer" /></div>` : '';
    return `<a class="adult-related-mini" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${thumb}<span>${escapeHtml(item.title || '関連作品')}</span></a>`;
  }).join('');
}

function renderEmptyPanel(title, description) {
  return `<article class="adult-card adult-card-empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></article>`;
}

function buildEditorLead({ sections, saleItems, campaignItems, trendItems }) {
  const topSection = sections[0];
  if (!topSection) return null;
  const activeSource = topSection.sourceLabel || 'DLsite';
  const hotTheme = topSection.themeLabel || 'セール';
  const deepDiscountCount = saleItems.filter((item) => Number(item.discountRate ?? 0) >= 50).length;
  const topRankCount = trendItems.filter((item) => Number(item.ranking ?? 0) > 0 && Number(item.ranking ?? 0) <= 10).length;
  const campaignCount = campaignItems.length;
  return {
    kicker: `今週の${activeSource}`,
    title: `${activeSource}は「${hotTheme}」が主戦場です`,
    summary: `${activeSource}の上位作と値引き対象が重なっており、先に特集を読んでから個別作品へ入る方が判断しやすい状態です。順位だけでなく、割引、残り期間、関連テーマをまとめて確認できます。`,
    points: [
      `${deepDiscountCount}件が50%OFF以上`,
      `TOP10圏内が${topRankCount}件`,
      `開催中のお得情報を${campaignCount}件整理`,
    ].filter(Boolean),
    recommendations: topSection.recommendedWorks?.slice(0, 3) ?? [],
  };
}

function buildMagazineSections({ features, trendItems }) {
  const sections = features.map((feature) => buildMagazineSection(feature, trendItems)).filter(Boolean);
  return sections.sort((left, right) => compareNumber(right.score, left.score) || compareDate(right.updatedAt, left.updatedAt));
}

function buildMagazineSection(feature, trendItems) {
  const related = resolveFeatureTrendItems(feature, trendItems);
  if (!related.length && !feature.relatedItems?.length) return null;
  const sourceLabel = feature.sourceGroup || sourceGroupLabel(feature.sourceGroupKey);
  const discounts = related.filter((item) => Number(item.discountRate ?? 0) > 0);
  const topRanks = related.filter((item) => Number(item.ranking ?? 0) > 0 && Number(item.ranking ?? 0) <= 10);
  const rising = related.filter((item) => Number(item.rankChange ?? 0) > 0);
  const genre = contentGenreLabel(related[0] || feature);
  return {
    id: feature.id,
    kicker: `${sourceLabel} MAGAZINE`,
    title: feature.title,
    sourceLabel,
    themeLabel: genre === '未分類' ? 'セール' : genre,
    summary: buildMagazineStorySummary(feature, { related, discounts, topRanks, rising, sourceLabel }),
    keyPoints: buildMagazineKeyPoints({ feature, related, discounts, topRanks, rising }),
    recommendedWorks: buildMagazineRecommendations(related, feature.relatedItems),
    relatedWorks: buildStoryRelatedWorks(related, feature.relatedItems),
    score: Number(feature.importance ?? 0),
    scoreLabel: `HOT ${Number(feature.importance ?? 0)}`,
    updatedAt: feature.updatedAt,
  };
}

function buildMagazineStorySummary(feature, { related, discounts, topRanks, rising, sourceLabel }) {
  const first = related[0];
  const lead = first?.title || feature.primaryItemTitle || '注目作品';
  if (feature.featureType === 'sale') {
    return `${sourceLabel}では値引き付き作品がまとまっており、${lead}を軸に買いどころを整理できます。価格差と終了時刻を一緒に見た方が取りこぼしが少ない特集です。`;
  }
  if (feature.sourceGroupKey === 'cien') {
    return `${sourceLabel}では制作進捗や新作告知が連続しており、作品を買う前にクリエイターの動きをまとめて追える状態です。`;
  }
  return `${lead}を中心に、${topRanks.length}件の上位作と${discounts.length}件の値引き対象が重なっています。何が流行り、なぜ強いかを短時間で把握するための特集です。`;
}

function buildMagazineKeyPoints({ feature, related, discounts, topRanks, rising }) {
  const points = [];
  if (discounts.length) {
    const bestDiscount = Math.max(...discounts.map((item) => Number(item.discountRate ?? 0)));
    points.push(`${discounts.length}件が値引き中。最大 ${bestDiscount}%OFF`);
  }
  if (topRanks.length) {
    points.push(`ランキング上位 ${topRanks.length}件。最高 ${Math.min(...topRanks.map((item) => Number(item.ranking ?? 999)))}位`);
  }
  if (rising.length) {
    points.push(`急上昇 ${rising.length}件。伸び筋を同時に確認可能`);
  }
  if (feature.trendReasons?.length) {
    points.push(`注目理由: ${feature.trendReasons.slice(0, 2).join(' / ')}`);
  }
  return points.slice(0, 4);
}

function buildMagazineRecommendations(related, fallbackItems) {
  const seeds = related.length ? related : (fallbackItems ?? []);
  return seeds.slice(0, 3).map((item) => {
    const resolved = item.routeId || item.sourceUrl ? item : null;
    const thumb = pickCardImageUrl(item);
    return {
      title: item.title || '注目作品',
      thumbnail: thumb,
      url: item.sourceUrl || item.url || '',
      detailUrl: item.routeId ? './adult-topic.html?id=' + encodeURIComponent(item.routeId) : item.detailUrl || '',
      priceLabel: item.price !== null && item.price !== undefined ? `現在 ${formatYen(item.price)}` : '',
      discountLabel: item.discountRate !== null && item.discountRate !== undefined ? `${item.discountRate}%OFF` : '',
      rankLabel: item.ranking ? `${item.ranking}位` : item.rank ? `${item.rank}位` : '',
      remainingLabel: item.saleEndDate ? formatRemainingTime(item.saleEndDate) : '',
      reason: recommendationReason(item, resolved),
    };
  });
}

function buildStoryRelatedWorks(related, fallbackItems) {
  const seeds = related.slice(3, 9);
  if (seeds.length) {
    return seeds.map((item) => ({
      title: item.title,
      url: item.sourceUrl || '',
      detailUrl: item.routeId ? './adult-topic.html?id=' + encodeURIComponent(item.routeId) : '',
    }));
  }
  return (fallbackItems ?? []).slice(3, 9).map((item) => ({
    title: item.title || '関連作品',
    url: item.url || '',
    detailUrl: item.detailUrl || '',
  }));
}

function buildCampaignStories({ campaignItems, saleItems, features, trendItems }) {
  const stories = [];
  const dlsiteItems = campaignItems.filter((item) => item.adultSourceGroup === 'dlsite');
  const fanzaItems = campaignItems.filter((item) => item.adultSourceGroup === 'fanza');
  const saleHeavy = saleItems.filter((item) => Number(item.discountRate ?? 0) >= 50);
  const featureSales = features.filter((item) => item.featureType === 'sale');

  if (dlsiteItems.length || featureSales.some((item) => item.sourceGroupKey === 'dlsite')) {
    stories.push(buildCampaignStoryModel('DLsite', 'DLsiteで回っている施策', dlsiteItems.length ? dlsiteItems : saleItems.filter((item) => item.adultSourceGroup === 'dlsite')));
  }
  if (fanzaItems.length || featureSales.some((item) => item.sourceGroupKey === 'fanza')) {
    stories.push(buildCampaignStoryModel('FANZA', 'FANZAで回っている施策', fanzaItems.length ? fanzaItems : saleItems.filter((item) => item.adultSourceGroup === 'fanza')));
  }
  if (saleHeavy.length) {
    stories.push(buildCampaignStoryModel('VALUE', '大型値引きまとめ', saleHeavy));
  }
  if (!stories.length && trendItems.length) {
    stories.push(buildCampaignStoryModel('GUIDE', '現在拾えているお得情報', saleItems.length ? saleItems : trendItems.slice(0, 6)));
  }
  return stories.slice(0, 4);
}

function buildCampaignStoryModel(kicker, title, items) {
  const sorted = sortItems([...(items ?? [])], 'value').slice(0, 6);
  const priced = sorted.filter((item) => item.price !== null && item.price !== undefined);
  const timed = sorted.filter((item) => item.saleEndDate);
  return {
    kicker,
    title,
    scoreLabel: `${sorted.length}件`,
    summary: `${sorted.length}件の対象から、割引率、価格、終了時刻が見えるものを優先して整理しています。`,
    points: [
      priced.length ? `価格表示あり ${priced.length}件` : '',
      timed.length ? `終了時刻あり ${timed.length}件` : '',
      sorted.some((item) => Number(item.discountRate ?? 0) >= 50) ? '50%OFF以上を含む' : '中小幅の値引きが中心',
    ].filter(Boolean),
    items: sorted.map((item) => ({
      title: item.title,
      url: item.sourceUrl || '',
      detailUrl: item.routeId ? './adult-topic.html?id=' + encodeURIComponent(item.routeId) : '',
    })),
  };
}

function resolveFeatureTrendItems(feature, trendItems) {
  const candidates = [];
  const seen = new Set();
  for (const related of feature.relatedItems ?? []) {
    const match = trendItems.find((item) => item.id === related.id || item.routeId === related.id || item.title === related.title);
    const resolved = match || related;
    const key = resolved.id || resolved.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(resolved);
  }
  return candidates;
}

function recommendationReason(item) {
  if (Number(item.discountRate ?? 0) >= 70) return '大幅値引き中';
  if (Number(item.rankChange ?? 0) > 0) return `急上昇 +${item.rankChange}`;
  if (Number(item.ranking ?? 0) > 0) return `ランキング ${item.ranking}位`;
  return '特集内で注目';
}

function formatRecommendationMeta(item) {
  return [item.discountLabel, item.priceLabel, item.rankLabel, item.remainingLabel].filter(Boolean).join(' / ');
}

function dedupeById(items) {
  const map = new Map();
  for (const item of items) {
    const key = item?.id || item?.title;
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function normalizeAdultFeatureItem(item) {
  const relatedItems = Array.isArray(item.relatedItems) ? item.relatedItems.map((related) => ({
    ...related,
    title: String(related?.title ?? '関連作品'),
    thumbnail: pickCardImageUrl(related),
    url: related?.url ?? '',
    detailUrl: related?.detailUrl ?? (related?.id ? './adult-topic.html?id=' + encodeURIComponent(related.id) : related?.url ?? '#'),
  })) : [];
  return {
    ...item,
    sourceGroup: item.sourceGroup ?? sourceGroupLabel(item.sourceGroupKey),
    sourceGroupKey: item.sourceGroupKey ?? normalizeSourceGroupKey(item.sourceGroup),
    importance: Number(item.importance ?? 0),
    title: String(item.title ?? 'アダルト特集'),
    summary: String(item.summary ?? '').trim(),
    whyHot: String(item.whyHot ?? item.reason ?? '').trim(),
    thumbnailUrl: pickCardImageUrl(item) ?? pickCardImageUrl(relatedItems[0]),
    relatedItems,
    tags: Array.isArray(item.tags) ? item.tags : [],
    updatedAt: item.updatedAt ?? null,
  };
}

function normalizeAdultTrendItem(item, archivedItem) {
  const mergedHistory = dedupeHistory([...(archivedItem?.history ?? []), ...(item.history ?? [])]);
  const ranking = normalizeNullableNumber(item.ranking ?? item.rank);
  const price = normalizePriceValue(item.price ?? item.currentPrice ?? item.salePrice ?? extractPriceFromText(item.summary ?? item.title));
  const originalPrice = normalizePriceValue(item.originalPrice ?? item.regularPrice ?? item.listPrice);
  const discountRate = normalizeDiscountRate(item.discountRate ?? extractDiscountFromText(item.summary ?? item.title), price, originalPrice);
  const adultSourceGroup = normalizeSourceGroupKey(item.adultSourceGroup ?? item.sourceGroup ?? item.sourceName ?? item.source);
  const adultDisplayType = normalizeDisplayType(item, discountRate);
  const previousRank = findPreviousRank(mergedHistory, ranking);
  const rankChange = previousRank && ranking ? previousRank - ranking : 0;
  const adultPrimaryGenre = item.adultPrimaryGenre ?? item.genre ?? inferPrimaryGenre(item);
  const adultHotScore = Number(item.adultHotScore ?? item.score ?? 0);
  const saleEndDate = normalizeDateValue(item.saleEndDate ?? item.campaignEndDate ?? item.endDate ?? item.endsAt);
  const valueScore = calculateValueScore({
    valueScore: item.valueScore,
    discountRate,
    ranking,
    adultHotScore,
    rankChange,
    adultDisplayType,
  });

  return {
    ...item,
    routeId: buildAdultRouteId(item),
    sourceName: item.sourceName ?? item.source ?? sourceGroupLabel(adultSourceGroup),
    thumbnailUrl: pickCardImageUrl(item),
    trendReasons: Array.isArray(item.trendReasons) ? item.trendReasons : Array.isArray(item.hotReasons) ? item.hotReasons : [],
    tags: Array.isArray(item.tags) ? item.tags : [],
    categoryLabels: Array.isArray(item.categoryLabels) ? item.categoryLabels : [],
    maker: String(item.maker ?? item.circle ?? item.brand ?? '').trim(),
    adultSourceGroup,
    adultDisplayType,
    adultPrimaryGenre,
    adultHotScore,
    price,
    originalPrice,
    discountRate,
    currency: item.currency ?? 'JPY',
    saleEndDate,
    ranking,
    valueScore,
    history: mergedHistory,
    previousRank,
    rankChange,
    badges: buildBadges({ ranking, discountRate, rankChange, adultDisplayType, featured: false }),
    relatedItems: Array.isArray(item.relatedItems) ? item.relatedItems : [],
  };
}

function attachRelatedTrendItems(items) {
  return items.map((item) => {
    const relatedItems = items
      .filter((candidate) => candidate.id !== item.id)
      .filter((candidate) => candidate.adultSourceGroup === item.adultSourceGroup)
      .filter((candidate) => rankingContextLabel(candidate.sourceKey, candidate.sourceName || sourceGroupLabel(candidate.adultSourceGroup)) === rankingContextLabel(item.sourceKey, item.sourceName || sourceGroupLabel(item.adultSourceGroup)))
      .filter((candidate) => contentGenreLabel(candidate) === contentGenreLabel(item))
      .sort((left, right) => {
        const leftGap = Math.abs(Number(left.ranking ?? 999) - Number(item.ranking ?? 999));
        const rightGap = Math.abs(Number(right.ranking ?? 999) - Number(item.ranking ?? 999));
        return leftGap - rightGap || compareByRanking(left, right) || compareByHot(left, right);
      })
      .slice(0, 3)
      .map((related) => ({
        id: related.id,
        title: related.title,
        url: related.sourceUrl,
        detailUrl: './adult-topic.html?id=' + encodeURIComponent(related.routeId ?? related.id ?? ''),
      }));
    return {
      ...item,
      relatedItems,
    };
  });
}

function aggregateTrendBuckets(items, selector) {
  const map = new Map();
  for (const item of items) {
    const values = selector(item);
    const list = Array.isArray(values) ? values : [values];
    for (const rawValue of list) {
      const value = String(rawValue ?? '').trim();
      if (!value) continue;
      const current = map.get(value) ?? { label: value, score: 0, items: 0, bestRank: null };
      current.score += Math.max(1, item.rankChange || 1);
      current.items += 1;
      current.bestRank = current.bestRank === null || (item.ranking && item.ranking < current.bestRank) ? item.ranking : current.bestRank;
      map.set(value, current);
    }
  }
  return [...map.values()]
    .sort((left, right) => right.score - left.score || right.items - left.items || String(left.label).localeCompare(String(right.label), 'ja'))
    .map((item) => ({
      label: item.label,
      score: item.score,
      meta: item.bestRank ? `関連 ${item.items}件 / 最高 ${item.bestRank}位` : `関連 ${item.items}件`,
    }));
}

function groupRankingItemsByContext(items, sourceName) {
  const map = new Map();
  for (const item of items) {
    const contextLabel = rankingContextLabel(item.sourceKey, sourceName);
    const genre = contentGenreLabel(item);
    const key = `${contextLabel}::${genre}`;
    const current = map.get(key) ?? [];
    current.push(item);
    map.set(key, current);
  }
  return [...map.entries()]
    .sort((left, right) => compareRankingGroupKey(left[0], right[0]) || right[1].length - left[1].length)
    .map(([key, groupedItems]) => {
      const [contextLabel, genre] = key.split('::');
      return {
        genre: `${contextLabel} / ${genre}`,
        items: sortItems([...groupedItems], 'ranking'),
      };
    });
}

function normalizeStandaloneGenreGroups(groups) {
  return (groups ?? []).map((group) => ({
    ...group,
    genre: group.genre,
    items: sortItems([...(group.items ?? [])], 'ranking'),
  }));
}

function compareRankingGroupKey(leftKey, rightKey) {
  const [leftContext, leftGenre] = String(leftKey).split('::');
  const [rightContext, rightGenre] = String(rightKey).split('::');
  return compareRankingContextLabel(leftContext, rightContext)
    || compareGenreLabel(leftGenre, rightGenre)
    || String(leftKey).localeCompare(String(rightKey), 'ja');
}

function compareRankingContextLabel(left, right) {
  const order = ['デイリーランキング', '新着ランキング', '漫画ランキング', 'AVランキング', 'その他ランキング'];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
}

function compareGenreLabel(left, right) {
  const order = ['AV', '同人音声', 'AI作品', '同人ゲーム', 'エロ漫画', '業界ニュース', '未分類'];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
}

function rankingContextLabel(sourceKey, sourceName) {
  const key = String(sourceKey ?? '').toLowerCase();
  if (key.includes('books') && key.includes('ranking')) return `${sourceName} 漫画ランキング`;
  if (key.includes('new')) return `${sourceName} 新着ランキング`;
  if (key.includes('ranking')) return `${sourceName} デイリーランキング`;
  if (key.includes('videoa')) return `${sourceName} AVランキング`;
  return `${sourceName} その他ランキング`;
}

function contentGenreLabel(item) {
  const candidates = [
    item.adultPrimaryGenre,
    item.genre,
    ...(Array.isArray(item.categoryLabels) ? item.categoryLabels : []),
    ...(Array.isArray(item.tags) ? item.tags : []),
  ].filter(Boolean).map((value) => String(value));
  for (const candidate of candidates) {
    if (/同人音声|ASMR|ボイス|音声/.test(candidate)) return '同人音声';
    if (/AI|生成AI/.test(candidate)) return 'AI作品';
    if (/同人ゲーム|RPG|ADV|SLG|ゲーム/.test(candidate)) return '同人ゲーム';
    if (/エロ漫画|漫画|コミック/.test(candidate)) return 'エロ漫画';
    if (/AV|女優|ビデオ|動画/.test(candidate)) return 'AV';
  }
  return item.adultPrimaryGenre === 'セール' ? '未分類' : (item.adultPrimaryGenre || '未分類');
}

function sortItems(items, sortKey) {
  if (sortKey === 'discount') {
    return items.sort((left, right) => compareNumber(right.discountRate, left.discountRate) || compareByRanking(left, right) || compareByHot(left, right));
  }
  if (sortKey === 'priceLow') {
    return items.sort((left, right) => compareNumber(left.price, right.price) || compareByRanking(left, right) || compareByHot(left, right));
  }
  if (sortKey === 'priceHigh') {
    return items.sort((left, right) => compareNumber(right.price, left.price) || compareByRanking(left, right) || compareByHot(left, right));
  }
  if (sortKey === 'popular') {
    return items.sort((left, right) => compareByHot(left, right) || compareByRanking(left, right));
  }
  if (sortKey === 'rise') {
    return items.sort((left, right) => compareNumber(right.rankChange, left.rankChange) || compareByRanking(left, right) || compareByHot(left, right));
  }
  if (sortKey === 'endSoon') {
    return items.sort((left, right) => compareDate(left.saleEndDate, right.saleEndDate) || compareNumber(right.valueScore, left.valueScore) || compareByHot(left, right));
  }
  if (sortKey === 'featured') {
    return items.sort(compareFeatureItemsForMagazine);
  }
  if (sortKey === 'recent') {
    return items.sort((left, right) => compareDate(right.updatedAt, left.updatedAt) || compareNumber(right.importance, left.importance));
  }
  if (sortKey === 'value') {
    return items.sort((left, right) => compareNumber(right.valueScore, left.valueScore) || compareNumber(right.discountRate, left.discountRate) || compareByRanking(left, right) || compareByHot(left, right));
  }
  return items.sort((left, right) => compareByRanking(left, right) || compareByHot(left, right));
}

function compareFeatureItemsForMagazine(left, right) {
  return compareNumber(right.importance, left.importance)
    || compareDate(right.updatedAt, left.updatedAt)
    || String(left.title ?? '').localeCompare(String(right.title ?? ''), 'ja');
}

function compareByRanking(left, right) {
  const leftRank = left.ranking ?? Number.MAX_SAFE_INTEGER;
  const rightRank = right.ranking ?? Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank;
}

function compareByHot(left, right) {
  return compareNumber(right.adultHotScore, left.adultHotScore);
}

function compareNumber(left, right) {
  const normalizedLeft = Number.isFinite(Number(left)) ? Number(left) : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(Number(right)) ? Number(right) : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight;
}

function compareDate(left, right) {
  const leftTime = left ? new Date(left).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right ? new Date(right).getTime() : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function buildBadges({ ranking, discountRate, rankChange, adultDisplayType, featured }) {
  const badges = [];
  if (ranking && ranking <= 10) badges.push({ kind: 'popular', label: '🔥 人気' });
  if (discountRate !== null && discountRate >= 80) badges.push({ kind: 'cheap', label: '💰 激安' });
  if (rankChange >= 10 || adultDisplayType === 'trending') badges.push({ kind: 'rising', label: '📈 急上昇' });
  if (featured) badges.push({ kind: 'featured', label: '⭐ おすすめ' });
  return badges;
}

function normalizeDisplayType(item, discountRate) {
  const explicit = String(item.adultDisplayType ?? item.displayType ?? '').toLowerCase();
  const text = [item.title, item.summary, ...(item.tags ?? [])].join(' ');
  if (explicit === 'ranking') return 'ranking';
  if (explicit === 'campaign') return 'campaign';
  if (explicit === 'sale') return 'sale';
  if (explicit === 'magazine' || explicit === 'creator_update' || explicit === 'creator-update') return 'magazine';
  if (explicit === 'trending' || explicit === 'article') return 'trending';
  if (/キャンペーン|クーポン|ポイント|還元/i.test(text)) return 'campaign';
  if (discountRate !== null || /セール|割引|OFF/i.test(text)) return 'sale';
  if (item.rank) return 'ranking';
  return 'trending';
}

function inferPrimaryGenre(item) {
  const text = [item.genre, item.title, ...(item.tags ?? []), ...(item.categories ?? []), ...(item.categoryLabels ?? [])].join(' ');
  if (/同人音声|ASMR|ボイス|音声/i.test(text)) return '同人音声';
  if (/AI|生成AI/i.test(text)) return 'AI作品';
  if (/漫画|コミック|book/i.test(text)) return 'エロ漫画';
  if (/ゲーム|RPG|ADV|SLG|ノベル|シミュ/i.test(text)) return '同人ゲーム';
  if (/AV|FANZA|女優|ビデオ/i.test(text)) return 'AV';
  return '業界ニュース';
}

function buildArchiveMap(items) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [item.id, item]));
}

function dedupeHistory(history) {
  const map = new Map();
  for (const entry of history) {
    const key = String(entry?.fetchedAt ?? entry?.capturedAt ?? '') + '::' + String(entry?.rank ?? '');
    if (!key.trim()) continue;
    map.set(key, entry);
  }
  return [...map.values()].sort((left, right) => new Date(right.fetchedAt ?? right.capturedAt ?? 0).getTime() - new Date(left.fetchedAt ?? left.capturedAt ?? 0).getTime());
}

function findPreviousRank(history, ranking) {
  if (!Array.isArray(history) || !history.length || !ranking) return null;
  for (const entry of history) {
    const value = normalizeNullableNumber(entry?.rank);
    if (value && value !== ranking) return value;
  }
  return null;
}

function calculateValueScore({ valueScore, discountRate, ranking, adultHotScore, rankChange, adultDisplayType }) {
  const explicit = normalizeNullableNumber(valueScore);
  if (explicit !== null) return explicit;
  const discountBoost = discountRate ?? 0;
  const rankingBoost = ranking ? Math.max(0, 30 - ranking) : 0;
  const popularityBoost = Math.round(Number(adultHotScore ?? 0) / 4);
  const riseBoost = Math.min(18, Math.max(0, rankChange || 0));
  const saleBoost = adultDisplayType === 'sale' || adultDisplayType === 'campaign' ? 8 : 0;
  return Math.min(100, Math.round(discountBoost + rankingBoost + popularityBoost + riseBoost + saleBoost));
}

function renderSortControls() {
  if (!sortControlsElement) return;
  const sorts = PAGE_CONFIG[pageType]?.sorts ?? [];
  if (!sorts.length) {
    sortControlsElement.innerHTML = '';
    return;
  }
  sortControlsElement.innerHTML = [
    '<label class="adult-sort-label" for="adult-sort-select">ソート</label>',
    '<select class="adult-sort-select" id="adult-sort-select">',
    sorts.map((sort) => `<option value="${escapeHtml(sort.value)}"${sort.value === activeSort ? ' selected' : ''}>${escapeHtml(sort.label)}</option>`).join(''),
    '</select>',
  ].join('');
  const select = document.querySelector('#adult-sort-select');
  if (!select) return;
  select.addEventListener('change', () => {
    activeSort = select.value;
    renderAdultPage();
  });
}

function wireMobileMenu() {
  if (!mobileMenuButton || !mobileNavDrawer) return;
  mobileMenuButton.addEventListener('click', () => {
    const isOpen = mobileMenuButton.getAttribute('aria-expanded') === 'true';
    mobileMenuButton.setAttribute('aria-expanded', String(!isOpen));
    mobileNavDrawer.hidden = isOpen;
  });
  mobileNavDrawer.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mobileMenuButton.setAttribute('aria-expanded', 'false');
      mobileNavDrawer.hidden = true;
    });
  });
}

function payloadItems(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
}

function sourceGroupLabel(key) {
  if (key === 'fanza') return 'FANZA';
  if (key === 'dlsite') return 'DLsite';
  if (key === 'cien') return 'Ci-en';
  if (key === 'campaign') return 'Campaign';
  if (key === 'sale') return 'Sale';
  return 'Source';
}

function normalizeSourceGroupKey(value) {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('fanza') || text.includes('dmm')) return 'fanza';
  if (text.includes('dlsite')) return 'dlsite';
  if (text.includes('ci-en') || text.includes('cien')) return 'cien';
  if (text.includes('campaign')) return 'campaign';
  if (text.includes('sale')) return 'sale';
  return text || 'source';
}

function showRefreshStatus(message) {
  if (!refreshStatusElement) return;
  refreshStatusElement.textContent = message;
  clearTimeout(refreshStatusTimer);
  refreshStatusTimer = window.setTimeout(() => {
    refreshStatusElement.textContent = PAGE_CONFIG[pageType]?.refreshDefault || '';
  }, 2200);
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}

function formatAdultDate(value) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time) || !time) return '日時未取得';
  return new Date(time).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRemainingTime(value) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '残り時間未取得';
  const diff = time - Date.now();
  if (diff <= 0) return '終了済み';
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `残り${days}日`;
  return `残り${hours}時間`;
}

function formatYen(value) {
  return `${Number(value ?? 0).toLocaleString('ja-JP')}円`;
}

function pickCardImageUrl(item) {
  if (!item) return null;
  const candidates = [item.thumbnail, item.thumbnailUrl, item.image, item.imageUrl, item.ogImage, item.twitterImage, item.sourceImage];
  for (const candidate of candidates) {
    const normalized = sanitizeCardImageUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function sanitizeCardImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (isLikelyIconImage(url)) return null;
  return url;
}

function isLikelyIconImage(url) {
  return /(?:^|\/)(?:favicon(?:-\d+x\d+)?|apple-touch-icon|android-chrome-\d+x\d+|mstile-\d+x\d+)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)
    || /\/favicon\.ico(?:$|[?#])/i.test(url)
    || /(?:google|gstatic)\.[^/]+\/.*(?:favicon|logo|icon)/i.test(url);
}

function buildAdultRouteId(item) {
  const raw = [item?.sourceKey, item?.sourceName ?? item?.source, item?.sourceUrl, item?.title, item?.rank].filter(Boolean).join('::');
  return slugifyAdultRoutePart(raw || String(item?.id ?? 'adult-topic'));
}

function slugifyAdultRoutePart(value) {
  return String(value ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/[【】「」『』"'“”]/g, ' ').replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'adult-topic';
}

function extractDiscountFromText(value) {
  const match = String(value ?? '').match(/(\d{1,3})\s*% ?OFF/i);
  return match ? Number(match[1]) : null;
}

function extractPriceFromText(value) {
  const match = String(value ?? '').match(/(\d[\d,]{2,6})\s*円/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

function normalizePriceValue(value) {
  const normalized = normalizeNullableNumber(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function normalizeNullableNumber(value) {
  const digits = String(value ?? '').replace(/[^\d.-]+/g, '').trim();
  if (!digits) return null;
  const normalized = Number(digits);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeDiscountRate(value, price, originalPrice) {
  const normalized = normalizeNullableNumber(value);
  if (normalized !== null && normalized >= 0) return Math.max(0, Math.min(100, Math.round(normalized)));
  if (price !== null && originalPrice !== null && originalPrice > price) {
    return Math.max(0, Math.min(100, Math.round((1 - price / originalPrice) * 100)));
  }
  return null;
}

function normalizeDateValue(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function saveAdultFeatureCache(items) {
  try { sessionStorage.setItem('internet-news-adult-feature-cache', JSON.stringify(items ?? [])); } catch {}
}

function loadAdultFeatureCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem('internet-news-adult-feature-cache') ?? '[]');
    return Array.isArray(cached) ? cached.map(normalizeAdultFeatureItem) : [];
  } catch {
    return [];
  }
}

function saveAdultTrendCache(items) {
  try { sessionStorage.setItem('internet-news-adult-trend-cache', JSON.stringify(items ?? [])); } catch {}
}

function loadAdultTrendCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem('internet-news-adult-trend-cache') ?? '[]');
    return Array.isArray(cached) ? cached.map((item) => normalizeAdultTrendItem(item, item)) : [];
  } catch {
    return [];
  }
}

function saveAdultArchiveCache(items) {
  try { sessionStorage.setItem('internet-news-adult-archive-cache', JSON.stringify(items ?? [])); } catch {}
}

function loadAdultArchiveCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem('internet-news-adult-archive-cache') ?? '[]');
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

async function fetchJsonWithCache({ cacheKey, endpoints, ttlMs }) {
  const cached = readSessionPayload(cacheKey, ttlMs);
  if (cached?.state === 'fresh') return cached.payload;
  const stalePayload = cached?.state === 'stale' ? cached.payload : null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: 'default' });
      if (!response.ok) continue;
      const payload = await response.json();
      writeSessionPayload(cacheKey, payload);
      return payload;
    } catch {}
  }
  if (stalePayload) return stalePayload;
  throw new Error('JSON unavailable');
}

function readSessionPayload(cacheKey, ttlMs) {
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.payload) return null;
    if (!parsed.savedAt) return { state: 'stale', payload: parsed.payload };
    const age = Date.now() - Number(parsed.savedAt);
    return { state: age <= ttlMs ? 'fresh' : 'stale', payload: parsed.payload };
  } catch {
    return null;
  }
}

function writeSessionPayload(cacheKey, payload) {
  try { sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload })); } catch {}
}
