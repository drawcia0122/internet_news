const {
  categoryDisplayLabel,
  categoryLabelFor,
  dedupeTopics,
  escapeHtml,
  getPrimarySourceLabel,
  getPrimarySourceUrl,
  hasCategory,
  hasVisibleSummary,
  isWeakThumbnailUrl,
  mergeReports,
  pickCardImageUrl,
} = window.TopicClientUtils;

let trendTopics = [];
let archiveTopics = [];
let latestTrendGeneratedAt = null;
let dailyBriefItems = [];
let eventItems = [];
let adultTrendItems = [];
let lastRefreshStartedAt = 0;
let visibleTrendTopics = [];
let pickedTopicIds = new Set();
let deferredTopicChannelsRendered = false;
let activeTopicChannelKey = null;
let activeEventTab = 'closingSoon';

const hotPrimaryElement = document.querySelector('#hot-battle-keywords');
const hotCategoryElement = document.querySelector('#hot-general-keywords');
const rankingPrimaryElement = document.querySelector('#ranking-battle-list');
const rankingCategoryElement = document.querySelector('#ranking-general-list');
const trendListElement = document.querySelector('#trend-list');
const hotSectionElement = document.querySelector('#hot-network');
const trendSectionElement = document.querySelector('#trends');
const personalNewsListElement = document.querySelector('#personal-news-list');
const mustReadNewsListElement = document.querySelector('#must-read-news-list');
const featuredEventTabsElement = document.querySelector('#featured-event-tabs');
const featuredEventListElement = document.querySelector('#featured-event-list');
const todayNewsListElement = document.querySelector('#today-news-list');
const topicChannelTabsElement = document.querySelector('#topic-channel-tabs');
const topicChannelStageElement = document.querySelector('#topic-channel-stage');
const topicChannelsSectionElement = document.querySelector('#topic-channels');
const dailyBriefListElement = document.querySelector('#daily-brief-list');
const mobileMenuButton = document.querySelector('#mobile-menu-button');
const mobileNavDrawer = document.querySelector('#mobile-nav-drawer');
const dailyBriefToggleButton = document.querySelector('#daily-brief-toggle');
const dailyBriefBody = document.querySelector('#daily-brief-body');
const trendSectionToggleButton = document.querySelector('#trend-section-toggle');
const trendSectionBody = document.querySelector('#trend-section-body');
const trendLoadMoreTopButton = document.querySelector('#trend-load-more-top');
const trendLoadMoreBottomButton = document.querySelector('#trend-load-more-bottom');
const adultTrendListElement = document.querySelector('#adult-trend-list');
const hasAdultTrendSection = Boolean(adultTrendListElement);

const TREND_FRESHNESS_HOURS = 24;
const TREND_TOPUP_DAYS = 3;
const TREND_MIN_ITEMS = 8;
const TREND_HOME_LIMIT = 10;
const TREND_LOAD_MORE_STEP = 10;
const PERSONAL_NEWS_LIMIT = 10;
const MUST_READ_LIMIT = 10;
const TODAY_NEWS_LIMIT = 10;
const TOPIC_WORKING_SET_LIMIT = 96;
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const HOME_TOPIC_CACHE_TTL_MS = 90 * 1000;
const DAILY_BRIEF_CACHE_TTL_MS = 90 * 1000;
const EVENT_CACHE_TTL_MS = 90 * 1000;
const ADULT_TREND_CACHE_TTL_MS = 90 * 1000;
const ADULT_HOME_LIMIT = 20;
const EVENT_TAB_DEFINITIONS = [
  { key: 'closingSoon', label: '🔥もうすぐ終了', emptyTitle: '終了間近のイベントを整理中です', emptyText: '終了まで14日以内の開催中イベントをここに表示します。' },
  { key: 'ongoing', label: '開催中', emptyTitle: '開催中のイベントを整理中です', emptyText: '今行けるイベントが入り次第ここに表示します。' },
  { key: 'thisMonth', label: '今月', emptyTitle: '今月のイベントを整理中です', emptyText: '今月中に行けるイベントを整理しています。' },
  { key: 'nextMonth', label: '来月', emptyTitle: '来月のイベントを整理中です', emptyText: '来月開催のイベントを収集中です。' },
];
const ADULT_CONTENT_PATTERN = /dlsite|fanza|dmm|同人音声|エロ漫画|\bav\b|成人向け|18禁|r-?18|adult[-\s]?trend|adult[-\s]?feature/i;
const PERSONAL_INTEREST_RULES = [
  { label: 'ポケモン', pattern: /ポケモン|pokemon|pokémon|ポケカ|pokemon go|pokémon home/i, score: 60 },
  { label: 'ゲーム', pattern: /ゲーム|モンハン|マリオ|ゼルダ|スプラトゥーン|apex|valorant|eスポーツ/i, score: 45 },
  { label: 'Nintendo / Switch', pattern: /任天堂|nintendo|switch\s?2?|switch/i, score: 40 },
  { label: 'Steam', pattern: /steam|steam deck/i, score: 35 },
  { label: '漫画・アニメ', pattern: /漫画|マンガ|コミック|アニメ|声優|映画化|アニメ化|pv公開/i, score: 35 },
  { label: 'ネット文化', pattern: /sns|xで話題|twitter|bluesky|reddit|炎上|バズ|ミーム|ネット文化|togetter|はてブ|バズり|トレンド入り/i, score: 34 },
  { label: 'セール', pattern: /セール|割引|キャンペーン|クーポン|ポイント還元|無料配布|期間限定/i, score: 30 },
  { label: '脱出・謎解き', pattern: /脱出ゲーム|リアル脱出ゲーム|scrap|謎解き|謎解きイベント/i, score: 42 },
  { label: 'イマーシブ体験', pattern: /イマーシブ|イマーシブフォート|イマーシブシアター|イマーシブイベント|没入型/i, score: 40 },
  { label: '体験型イベント', pattern: /体験型|体験施設|常設体験施設|東京近郊イベント|展示会|ポップアップイベント|ポップアップ|コラボカフェ/i, score: 36 },
  { label: 'オタク系イベント', pattern: /イベント|展示会|即売会|コミケ|ポップアップ|ライブイベント|配布会|コラボカフェ/i, score: 25 },
  { label: '同人', pattern: /同人|dlsite|メロンブックス|booth/i, score: 25 },
];
const PERSONAL_NEGATIVE_RULES = [
  { pattern: /スポーツ|野球|サッカー|mlb|jリーグ|試合|移籍/i, score: 80 },
  { pattern: /政治|国会|首相|与党|野党|選挙/i, score: 50 },
  { pattern: /経済|株価|投資|決算|日銀|金利|市況/i, score: 50 },
  { pattern: /国際|外交|戦況|米軍|中東|ウクライナ|ロシア/i, score: 50 },
  { pattern: /事件|逮捕|送検|起訴|判決|強盗|詐欺/i, score: 50 },
  { pattern: /地方ニュース|県内|市内|町内|観光協会|地域おこし/i, score: 40 },
  { pattern: /ai|生成ai|chatgpt|openai|claude|gemini|llm/i, score: 50 },
  { pattern: /ガジェット|スマホ|iphone|android|gpu|pcパーツ|nvidia/i, score: 40 },
  { pattern: /ビジネス|副業|収益化|個人開発|アフィリエイト|saas/i, score: 40 },
  { pattern: /芸能|熱愛|ゴシップ|スキャンダル/i, score: 30 },
];
let activeTrendFilter = 'all';
let activeAdultFilter = 'all';
let trendVisibleCount = TREND_HOME_LIMIT;
let refreshStatusTimer;
const isFileProtocol = window.location.protocol === 'file:';
let deferredHotRendered = false;
let deferredTrendRendered = false;
const perfMetrics = {
  marks: {},
  counts: {},
  fetches: [],
};

document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (!image.classList.contains('trend-thumb') && !image.classList.contains('adult-thumb')) return;
  const wrapper = image.closest('.trend-thumb-wrap, .adult-thumb-wrap');
  if (wrapper) {
    const card = wrapper.closest('.trend-card, .adult-card');
    if (card) card.classList.add(card.classList.contains('adult-card') ? 'adult-card-no-thumb' : 'trend-card-no-thumb');
    wrapper.remove();
  }
}, true);

console.time('home:init');
trendTopics = loadHomeTopicCache();
visibleTrendTopics = prepareVisibleTrendTopics(trendTopics);
dailyBriefItems = loadBriefCache();
eventItems = loadEventCache();
renderDailyBrief();
renderFeaturedEvents();
renderDiscoverySections();
renderDeferredPlaceholders();
setupDeferredRenderObservers();
recordPerfCount('initial');
console.timeEnd('home:init');
window.setTimeout(() => refreshLiveData({ silent: true }), 250);
window.setInterval(() => {
  if (document.hidden) return;
  if (Date.now() - lastRefreshStartedAt < REFRESH_INTERVAL_MS - 5000) return;
  refreshLiveData({ silent: false });
}, REFRESH_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (Date.now() - lastRefreshStartedAt >= REFRESH_INTERVAL_MS) {
    refreshLiveData({ silent: true });
  }
});

async function refreshLiveData({ silent = false } = {}) {
  lastRefreshStartedAt = Date.now();
  if (!silent) {
    showRefreshStatus('ニュース情報を取得中...');
  }

  const tasks = [loadTrendTopics(), loadNewsArchive(), loadDailyBrief(), loadEventItems()];
  if (hasAdultTrendSection) {
    tasks.push(loadAdultTrends());
  }
  const results = await Promise.all(tasks);
  const trendStatus = results[0];
  const archiveStatus = results[1];
  const briefStatus = results[2];
  const eventStatus = results[3];
  const adultStatus = hasAdultTrendSection ? results[4] : { ok: true, count: 0, error: null };
  if (silent) return;

  if (!trendStatus.ok && !archiveStatus.ok && !briefStatus.ok && !eventStatus.ok && !adultStatus.ok) {
    if (isFileProtocol) {
      showRefreshStatus('取得失敗: file:// では起動すると JSON が読めません。必ず http://localhost:8000 で開いてください');
      return;
    }
    const reason = `${trendStatus.error ?? 'trend'} / ${archiveStatus.error ?? 'archive'} / ${briefStatus.error ?? 'brief'} / ${eventStatus.error ?? 'events'}${hasAdultTrendSection ? ` / ${adultStatus.error ?? 'adult'}` : ''}`;
    showRefreshStatus(`取得失敗: ${reason}`);
    return;
  }

  showRefreshStatus('更新を確認: ' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
}

async function loadTrendTopics() {
  let errorMessage = null;
  try {
    console.time('home:fetch-topics');
    const currentPayload = await fetchHomeTopicsPayload().catch(() => null);
    const currentTopics = Array.isArray(currentPayload?.items) ? currentPayload.items : [];
    const shouldSupplementTopics = currentTopics.length < TOPIC_WORKING_SET_LIMIT;
    const supplementalPayload = shouldSupplementTopics
      ? await fetchTrendTopicsPayload().catch(() => null)
      : null;
    console.timeEnd('home:fetch-topics');
    const supplementalTopics = Array.isArray(supplementalPayload?.items) ? supplementalPayload.items : [];
    latestTrendGeneratedAt = currentPayload?.generatedAt ?? supplementalPayload?.generatedAt ?? null;
    const mergedTopics = dedupeTopics([
      ...currentTopics.map(normalizeTrendTopic),
      ...supplementalTopics.map(normalizeTrendTopic),
    ]);
    trendTopics = mergedTopics.sort((left, right) => hotTopicScore(right) - hotTopicScore(left) || topicTimestamp(right) - topicTimestamp(left));
  } catch (error) {
    errorMessage = error?.message || '取得エラー';
    latestTrendGeneratedAt = null;
    trendTopics = [];
  }

  saveHomeTopicCache(trendTopics);
  visibleTrendTopics = prepareVisibleTrendTopics(trendTopics);
  if (deferredTrendRendered) renderTrends(activeTrendFilter);
  if (deferredHotRendered) renderTrendSideStats(visibleTrendTopics.length ? visibleTrendTopics : trendTopics);
  renderDiscoverySections();
  recordPerfCount('after-topics');

  return {
    ok: trendTopics.length > 0,
    count: trendTopics.length,
    error: errorMessage,
  };
}

async function loadDailyBrief() {
  let errorMessage = null;
  try {
    console.time('home:fetch-brief');
    const payload = await fetchDailyBriefPayload();
    console.timeEnd('home:fetch-brief');
    dailyBriefItems = Array.isArray(payload?.items) ? payload.items : [];
  } catch (error) {
    errorMessage = error?.message || '取得エラー';
    dailyBriefItems = [];
  }

  saveBriefCache(dailyBriefItems);
  renderDailyBrief();
  recordPerfCount('after-brief');

  return {
    ok: dailyBriefItems.length > 0,
    count: dailyBriefItems.length,
    error: errorMessage,
  };
}

async function loadNewsArchive() {
  let errorMessage = null;
  try {
    const payload = await fetchNewsArchivePayload();
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    archiveTopics = dedupeTopics(rawItems.map(normalizeTrendTopic))
      .sort((left, right) => topicTimestamp(right) - topicTimestamp(left) || hotTopicScore(right) - hotTopicScore(left));
  } catch (error) {
    errorMessage = error?.message || '取得エラー';
    archiveTopics = [];
  }

  if (deferredTrendRendered) renderTrends(activeTrendFilter, { preserveCount: true });

  return {
    ok: archiveTopics.length > 0,
    count: archiveTopics.length,
    error: errorMessage,
  };
}

async function loadEventItems() {
  let errorMessage = null;
  try {
    const payload = await fetchEventsPayload();
    eventItems = Array.isArray(payload?.items) ? payload.items.map(normalizeEventItem) : [];
  } catch (error) {
    errorMessage = error?.message || '取得エラー';
    eventItems = [];
  }

  saveEventCache(eventItems);
  renderFeaturedEvents();

  return {
    ok: eventItems.length > 0,
    count: eventItems.length,
    error: errorMessage,
  };
}

async function loadAdultTrends() {
  let errorMessage = null;
  try {
    const payload = await fetchAdultTrendsPayload();
    const rawItems = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items) ? payload.items : [];
    adultTrendItems = rawItems.map(normalizeAdultTrendItem);
  } catch (error) {
    errorMessage = error?.message || '取得エラー';
    adultTrendItems = [];
  }

  saveAdultTrendCache(adultTrendItems);
  renderAdultTrends(activeAdultFilter);

  return {
    ok: adultTrendItems.length > 0,
    count: adultTrendItems.length,
    error: errorMessage,
  };
}

async function fetchHomeTopicsPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'home-topics-current',
    endpoints: ['./data/home-topics.json', './data/trend-topics.json'],
    ttlMs: HOME_TOPIC_CACHE_TTL_MS,
  });
}

async function fetchTrendTopicsPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'trend-topics-full',
    endpoints: ['./data/trend-topics.json'],
    ttlMs: HOME_TOPIC_CACHE_TTL_MS,
  });
}

async function fetchNewsArchivePayload() {
  return await fetchJsonWithCache({
    cacheKey: 'news-archive-current',
    endpoints: ['./data/news-archive.json'],
    ttlMs: HOME_TOPIC_CACHE_TTL_MS,
  });
}

async function fetchDailyBriefPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'daily-brief',
    endpoints: ['./data/daily-brief.json'],
    ttlMs: DAILY_BRIEF_CACHE_TTL_MS,
  });
}

async function fetchEventsPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'featured-events',
    endpoints: ['./data/events.json'],
    ttlMs: EVENT_CACHE_TTL_MS,
  });
}

async function fetchAdultTrendsPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'adult-trends',
    endpoints: ['./data/adult-trends.json'],
    ttlMs: ADULT_TREND_CACHE_TTL_MS,
  });
}

function normalizeTrendTopic(topic) {
  const categories = normalizeCategories(topic.categories, topic.category);
  const normalizedCategories = categories.map(normalizeLegacyCategory);
  const uniqueCategories = [...new Set(normalizedCategories)];
  const category = uniqueCategories[0] ?? 'general';
  const labelSource = topic.categoryLabels;
  const hasLegacyLabel = Array.isArray(labelSource) && labelSource.some((label) => label === 'ネタ');
  return enrichTrendTopic({
    ...topic,
    category,
    categories: uniqueCategories,
    categoryLabel: normalizeLegacyCategoryLabel(topic.categoryLabel, category),
    categoryLabels: Array.isArray(labelSource) && labelSource.length
      ? hasLegacyLabel ? labelSource.filter((label) => label !== 'ネタ') : labelSource
      : uniqueCategories.map(categoryLabelFor),
    metricLabel: topic.metricLabel ?? 'source',
    thumbnailUrl: pickCardImageUrl(topic),
    searchLinks: Array.isArray(topic.searchLinks) ? topic.searchLinks : [],
    sourceSignals: Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [],
  });
}

function enrichTrendTopic(topic) {
  const personal = calculatePersonalFit(topic);
  const insights = buildTrendInsights(topic, personal);
  return {
    ...topic,
    personalScore: Number(topic.personalScore ?? personal.score),
    personalReasons: Array.isArray(topic.personalReasons) && topic.personalReasons.length ? topic.personalReasons : personal.reasons,
    whatHappened: topic.whatHappened ?? insights.whatHappened,
    whyHot: topic.whyHot ?? insights.whyHot,
    importantPoint: topic.importantPoint ?? insights.importantPoint,
    futureOutlook: topic.futureOutlook ?? insights.futureOutlook,
    targetAudience: Array.isArray(topic.targetAudience) && topic.targetAudience.length ? topic.targetAudience : insights.targetAudience,
  };
}

function normalizeLegacyCategory(category) {
  return category === 'fun' ? 'general' : category;
}

function normalizeLegacyCategoryLabel(value, fallbackCategory) {
  if (value === 'ネタ') return categoryLabelFor(fallbackCategory ?? 'general');
  return value ?? categoryLabelFor(fallbackCategory ?? 'general');
}

function normalizeAdultTrendItem(item) {
  const categories = Array.isArray(item.categories) && item.categories.length ? item.categories : [item.category ?? 'industry'];
  const categoryLabels = Array.isArray(item.categoryLabels) && item.categoryLabels.length ? item.categoryLabels : categories.map(adultCategoryLabelFor);
  const sourceName = item.sourceName ?? item.source ?? 'Source';
  const thumbnailUrl = pickCardImageUrl(item);
  const trendReasons = Array.isArray(item.trendReasons) && item.trendReasons.length
    ? item.trendReasons
    : Array.isArray(item.hotReasons) ? item.hotReasons : [];
  const ranking = Number(item.ranking ?? item.rank ?? 0) || null;
  const adultPrimaryGenre = item.adultPrimaryGenre ?? item.genre ?? '';
  return {
    ...item,
    routeId: buildAdultRouteId(item),
    categories: [...new Set(categories.filter(Boolean))],
    categoryLabels,
    source: sourceName,
    sourceName,
    adultHotScore: Number(item.adultHotScore ?? item.score ?? 0),
    thumbnail: thumbnailUrl,
    thumbnailUrl,
    hotReasons: trendReasons,
    trendReasons,
    genre: adultPrimaryGenre,
    adultPrimaryGenre,
    rank: ranking,
    ranking,
    rankLabel: ranking ? `${ranking}位` : (item.rankLabel ?? '注目候補'),
    tags: Array.isArray(item.tags) ? item.tags : [],
    relatedWorks: Array.isArray(item.relatedWorks) ? item.relatedWorks : [],
  };
}

function normalizeEventItem(item) {
  const normalized = {
    ...item,
    id: item.id ?? slugifyAdultRoutePart(item.title ?? 'event'),
    title: item.title ?? 'イベント',
    startDate: normalizeEventDateValue(item.startDate),
    endDate: normalizeEventDateValue(item.endDate),
    venue: item.venue ?? '会場未定',
    location: item.location ?? item.venue ?? '開催場所未定',
    category: item.category ?? 'イベント',
    description: item.description ?? 'イベント情報を整理中です。',
    detailUrl: item.detailUrl ?? item.officialUrl ?? '',
    officialUrl: item.officialUrl ?? item.detailUrl ?? '',
    sourceName: item.sourceName ?? '公式サイト',
    sourceUrl: item.sourceUrl ?? item.officialUrl ?? item.detailUrl ?? '',
    thumbnailUrl: item.thumbnailUrl ?? '',
    tags: Array.isArray(item.tags) ? [...new Set(item.tags.filter(Boolean).map((value) => String(value).toLowerCase()))] : [],
    recommendationReasons: Array.isArray(item.recommendationReasons) ? item.recommendationReasons.filter(Boolean) : [],
    manualBoost: Number(item.manualBoost ?? 0),
    manualPenalty: Number(item.manualPenalty ?? 0),
  };

  return {
    ...normalized,
    eventScore: Number(item.eventScore ?? calculateEventScore(normalized)),
    closingSoonScore: Number(item.closingSoonScore ?? calculateClosingSoonScore(normalized)),
  };
}

function adultCategoryLabelFor(category) {
  if (category === 'av') return 'AV';
  if (category === 'doujin') return '同人';
  if (category === 'voice') return '音声';
  if (category === 'ai') return 'AI作品';
  if (category === 'manga') return 'エロ漫画';
  if (category === 'sale') return 'セール';
  if (category === 'industry') return '業界';
  return 'その他';
}

function renderTrends(filter = 'all', { preserveCount = false } = {}) {
  console.time('home:render-trends');
  activeTrendFilter = filter;
  if (!trendListElement) return;
  if (!preserveCount) {
    trendVisibleCount = TREND_HOME_LIMIT;
  }

  const filtered = getTrendListItems()
    .filter((trend) => {
      if (filter === 'all') return true;
      if (filter === 'adult') return hasCategory(trend, 'adult') && !isDoujinEventOnlyTopic(trend);
      return hasCategory(trend, filter);
    })
    .sort((left, right) =>
      topicTimestamp(right) - topicTimestamp(left)
      || Number(pickedTopicIds.has(left.id ?? '')) - Number(pickedTopicIds.has(right.id ?? ''))
      || hotTopicScore(right) - hotTopicScore(left)
    );

  if (!filtered.length) {
    const freshnessLabel = latestTrendGeneratedAt ? '最終生成: ' + formatAbsoluteDate(latestTrendGeneratedAt) : 'まだ最新データを取得できていません';
    trendListElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>最近話題のトピックを収集中です</strong><p>' + escapeHtml(freshnessLabel) + '</p></div>';
    updateTrendLoadMoreButtons(0, 0);
    console.timeEnd('home:render-trends');
    return;
  }

  const limited = filtered.slice(0, trendVisibleCount);
  const cards = limited.map((trend, index) => {
    const href = getTrendPrimaryUrl(trend, index);
    const sourceUrl = getPrimarySourceUrl(trend);
    const sourceLabel = getPrimarySourceLabel(trend);
    const hasThumbnail = Boolean(trend.thumbnailUrl);
    const thumb = hasThumbnail ? buildTrendCardThumb(trend.thumbnailUrl) : '';
    const scoreSummary = trend.scoreSummary ? '<div class="trend-score-summary">' + escapeHtml(trend.scoreSummary) + '</div>' : '';
    const summaryHtml = hasVisibleSummary(trend.summary) ? '<p>' + escapeHtml(trend.summary ?? '') + '</p>' : '';
    const insightHtml = renderTrendReasonList(trend);
    return '<article class="' + escapeHtml('trend-card trend-card-rich ' + (hasThumbnail ? 'has-thumb' : 'trend-card-no-thumb')) + '" style="animation-delay:' + (index * 70) + 'ms">' +
      thumb +
      '<div><div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(trend)) + '</span><time>' + escapeHtml(trend.time ?? '直近') + '</time></div>' +
      '<h3><a class="topic-card-primary-link" href="' + escapeHtml(href) + '">' + escapeHtml(trend.title ?? 'ニュース') + '</a></h3>' +
      summaryHtml +
      insightHtml +
      scoreSummary +
      '<div class="trend-footer"><span><strong>' + escapeHtml(String(trend.posts ?? 1)) + '</strong> ' + escapeHtml(trend.metricLabel ?? 'source') + '</span>' +
      (sourceUrl ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a>' : '<span class="detail-link">元記事なし</span>') + '</div></div></article>';
  });
  replaceChildrenFromHtml(trendListElement, cards);
  updateTrendLoadMoreButtons(limited.length, filtered.length);
  console.timeEnd('home:render-trends');
}

function renderTrendReasonList(trend) {
  const audience = Array.isArray(trend.targetAudience) && trend.targetAudience.length ? trend.targetAudience.slice(0, 3).join(' / ') : '関心のある人';
  return '<dl class="trend-reason-list">' +
    '<div><dt>何が起きた？</dt><dd>' + escapeHtml(trend.whatHappened ?? shortEventFromTitle(trend.title)) + '</dd></div>' +
    '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(trend.whyHot ?? buildWhyHotLabel(trend)) + '</dd></div>' +
    '<div><dt>誰に関係ある？</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
  '</dl>';
}

function getTrendListItems() {
  const sourceItems = archiveTopics.length ? archiveTopics : trendTopics;
  return sourceItems.filter((topic) => isTrendListEligibleTopic(topic));
}

function updateTrendLoadMoreButtons(visibleCount, totalCount) {
  const hasMore = totalCount > visibleCount;
  if (trendLoadMoreBottomButton) {
    trendLoadMoreBottomButton.hidden = !hasMore;
    trendLoadMoreBottomButton.disabled = !hasMore;
    trendLoadMoreBottomButton.textContent = hasMore ? `もっと表示 (${visibleCount}/${totalCount})` : 'すべて表示中';
  }
  if (trendLoadMoreTopButton) {
    trendLoadMoreTopButton.hidden = false;
    trendLoadMoreTopButton.disabled = false;
    trendLoadMoreTopButton.textContent = '一覧ページへ';
  }
}

function buildTrendCardThumb(thumbnailUrl) {
  if (!thumbnailUrl || isWeakThumbnailUrl(thumbnailUrl)) return '';
  return '<div class="trend-thumb-wrap"><img class="trend-thumb" src="' + escapeHtml(thumbnailUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>';
}

function renderDiscoverySections() {
  console.time('home:render-discovery');
  const topics = visibleTrendTopics;
  const internetNews = selectInternetNews(topics);
  const personalNews = selectPersonalNews(topics, { excludedIds: new Set(internetNews.map((topic) => topic.id)) });
  pickedTopicIds = new Set([...internetNews, ...personalNews].map((topic) => topic.id).filter(Boolean));
  const todayNews = selectTodayNews(dailyBriefItems);
  renderMustReadNews(internetNews);
  renderPriorityList(personalNewsListElement, personalNews, {
    emptyTitle: '自分向けニュースを整理中です',
    emptyText: 'ゲーム、ポケモン、漫画・アニメ、セール、ネット文化系の話題を探しています。',
    badge: 'FOR YOU',
  });
  renderBriefCardList(todayNewsListElement, todayNews, {
    emptyTitle: '今日のニュースを整理中です',
    emptyText: '事件、政治、経済、スポーツ、災害などの時事ニュースをまとめています。',
    badge: 'TODAY',
  });
  if (deferredTrendRendered) renderTrends(activeTrendFilter, { preserveCount: true });
  console.timeEnd('home:render-discovery');
}

function renderFeaturedEvents() {
  if (!featuredEventListElement || !featuredEventTabsElement) return;
  const availableKeys = new Set(EVENT_TAB_DEFINITIONS.map((tab) => tab.key));
  if (!availableKeys.has(activeEventTab)) activeEventTab = 'closingSoon';

  replaceChildrenFromHtml(featuredEventTabsElement, EVENT_TAB_DEFINITIONS.map((tab) => {
    const count = getEventItemsForTab(tab.key).length;
    return '<button class="' + escapeHtml(tab.key === activeEventTab ? 'active' : '') + '" type="button" data-event-tab="' + escapeHtml(tab.key) + '" role="tab" aria-selected="' + escapeHtml(String(tab.key === activeEventTab)) + '">' +
      escapeHtml(tab.label) +
      '<strong>' + escapeHtml(String(count)) + '</strong>' +
    '</button>';
  }));

  const activeDefinition = EVENT_TAB_DEFINITIONS.find((tab) => tab.key === activeEventTab) ?? EVENT_TAB_DEFINITIONS[0];
  const visibleItems = getEventItemsForTab(activeDefinition.key);

  if (!visibleItems.length) {
    featuredEventListElement.innerHTML = '<article class="event-card event-card-empty"><strong>' + escapeHtml(activeDefinition.emptyTitle) + '</strong><p>' + escapeHtml(activeDefinition.emptyText) + '</p></article>';
    return;
  }

  replaceChildrenFromHtml(featuredEventListElement, visibleItems.map((item, index) => renderEventCard(item, index)));
}

function renderEventCard(item, index) {
  const thumbnail = item.thumbnailUrl
    ? '<div class="event-thumb-wrap"><img class="event-thumb" src="' + escapeHtml(item.thumbnailUrl) + '" alt="" loading="lazy" /></div>'
    : '';
  const reasons = buildEventRecommendationReasons(item).slice(0, 4);
  const officialHost = item.sourceName ?? '公式サイト';
  const closingSoonBadge = buildClosingSoonBadge(item);
  const detailLink = item.detailUrl
    ? '<a class="detail-link" href="' + escapeHtml(item.detailUrl) + '" target="_blank" rel="noreferrer">詳細ページ ↗</a>'
    : '<span class="detail-link detail-link-muted">詳細準備中</span>';
  const officialLink = item.officialUrl
    ? '<a class="event-sub-link" href="' + escapeHtml(item.officialUrl) + '" target="_blank" rel="noreferrer">公式サイト ↗</a>'
    : '<span class="event-sub-link event-sub-link-muted">公式サイト準備中</span>';
  return '<article class="event-card" style="animation-delay:' + (index * 55) + 'ms">' +
    thumbnail +
    '<div class="event-card-top"><div class="event-card-top-badges"><span>' + escapeHtml(eventStatusLabel(item)) + '</span>' + closingSoonBadge + '</div><strong>' + escapeHtml(String(item.eventScore ?? 0)) + '</strong></div>' +
    '<div class="trend-meta"><span>' + escapeHtml(item.category) + '</span><time>' + escapeHtml(officialHost) + '</time></div>' +
    '<h3>' + escapeHtml(item.title) + '</h3>' +
    '<p>' + escapeHtml(item.description) + '</p>' +
    '<dl class="event-fact-list">' +
      '<div><dt>開催期間</dt><dd>' + escapeHtml(formatEventPeriod(item)) + '</dd></div>' +
      '<div><dt>開催場所</dt><dd>' + escapeHtml(item.venue) + ' / ' + escapeHtml(item.location) + '</dd></div>' +
      '<div><dt>おすすめ理由</dt><dd>' + escapeHtml(reasons.join(' / ')) + '</dd></div>' +
    '</dl>' +
    '<div class="priority-chip-row event-chip-row">' + reasons.map((reason) => '<span>' + escapeHtml(reason) + '</span>').join('') + '</div>' +
    '<div class="event-link-row">' + detailLink + officialLink + '</div>' +
  '</article>';
}

function getEventItemsForTab(tabKey) {
  const now = getTodayDate();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return [...eventItems]
    .filter((item) => {
      if (tabKey === 'ongoing') return isEventOngoing(item, now);
      if (tabKey === 'closingSoon') return isEventClosingSoon(item, now);
      if (tabKey === 'thisMonth') return eventIntersectsMonth(item, monthStart);
      if (tabKey === 'nextMonth') return eventStartsInMonth(item, nextMonthStart) || (item.tags ?? []).includes('next-month');
      return false;
    })
    .sort((left, right) => eventSortScore(right, tabKey, now) - eventSortScore(left, tabKey, now));
}

function eventSortScore(item, tabKey, today) {
  const start = parseEventDate(item.startDate);
  const recencyBoost = start ? Math.max(0, 18 - Math.abs(daysBetween(today, start))) : 0;
  const ongoingBoost = isEventOngoing(item, today) ? 18 : 0;
  const nextBoost = tabKey === 'nextMonth' && start && start.getMonth() === new Date(today.getFullYear(), today.getMonth() + 1, 1).getMonth() ? 8 : 0;
  const closingBoost = tabKey === 'closingSoon' ? Number(item.closingSoonScore ?? 0) * 2 : 0;
  return Number(item.eventScore ?? 0) + Number(item.closingSoonScore ?? 0) + recencyBoost + ongoingBoost + nextBoost + closingBoost;
}

function calculateEventScore(item) {
  const text = [
    item.title,
    item.category,
    item.description,
    item.location,
    item.venue,
    ...(item.tags ?? []),
    ...(item.recommendationReasons ?? []),
  ].filter(Boolean).join(' ').toLowerCase();

  let score = 18;
  if (/pokemon|ポケモン/.test(text)) score += 20;
  if (/nintendo|switch|steam|ゲーム/.test(text)) score += 14;
  if (/漫画|マンガ|アニメ|声優/.test(text)) score += 12;
  if (/脱出ゲーム|リアル脱出ゲーム|謎解き|scrap/.test(text)) score += 16;
  if (/イマーシブ|没入/.test(text)) score += 14;
  if (/コラボカフェ|gratte|カフェ/.test(text)) score += 12;
  if (/ポップアップ|オンリーショップ|期間限定ショップ/.test(text)) score += 8;
  if (/sns-buzz|snsで話題|周年|記念|summer carnival/.test(text)) score += 10;
  if ((item.tags ?? []).includes('large-scale')) score += 8;
  if ((item.tags ?? []).includes('collaboration')) score += 6;
  if (/東京|東京都|秋葉原|池袋|渋谷|新宿|稲城市|千代田区|豊島区/.test(text)) score += 8;
  if (isEventOngoing(item, getTodayDate())) score += 10;
  if (!item.description || String(item.description).length < 28) score -= 12;
  if (!item.endDate && !isLongRunningEvent(item)) score -= 10;
  if ((item.tags ?? []).includes('local-only')) score -= 16;
  if ((item.tags ?? []).includes('small-scale')) score -= 10;
  score += Number(item.manualBoost ?? 0);
  score -= Number(item.manualPenalty ?? 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateClosingSoonScore(item) {
  const today = getTodayDate();
  if (!isEventOngoing(item, today)) return 0;
  const end = parseEventDate(item.endDate);
  if (!end) return 0;
  const remainingDays = daysBetween(end, today);
  if (remainingDays < 0 || remainingDays > 14) return 0;
  if (remainingDays === 0) return 100;
  if (remainingDays <= 3) return 88 - (remainingDays - 1) * 6;
  if (remainingDays <= 7) return 68 - (remainingDays - 4) * 4;
  return 48 - (remainingDays - 8) * 3;
}

function buildEventRecommendationReasons(item) {
  const reasons = [...(item.recommendationReasons ?? [])];
  const text = [item.title, item.category, ...(item.tags ?? [])].join(' ').toLowerCase();
  if (/pokemon|ポケモン/.test(text)) reasons.push('ポケモン好き向け');
  if (/脱出ゲーム|リアル脱出ゲーム|謎解き/.test(text)) reasons.push('脱出ゲーム好き向け');
  if (/anime|アニメ|漫画|マンガ/.test(text)) reasons.push('アニメ・漫画好き向け');
  if (/sns-buzz/.test(text)) reasons.push('SNSで話題');
  if (/東京|東京都|秋葉原|池袋|渋谷|新宿|稲城市|千代田区|豊島区/.test(item.location + ' ' + item.venue)) reasons.push('東京開催');
  if (isEventOngoing(item, getTodayDate())) reasons.push('開催中');
  if (isCurrentMonthLimited(item)) reasons.push('今月限定');
  return [...new Set(reasons)].slice(0, 4);
}

function eventStatusLabel(item) {
  if (isEventClosingSoon(item, getTodayDate())) return '終了間近';
  if (isEventOngoing(item, getTodayDate())) return '開催中';
  const start = parseEventDate(item.startDate);
  if (!start) return '日程確認';
  const now = getTodayDate();
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (start >= nextMonthStart) return '来月';
  return '今月';
}

function formatEventPeriod(item) {
  const start = parseEventDate(item.startDate);
  const end = parseEventDate(item.endDate);
  if (!start && !end) return '開催日程は詳細ページで確認';
  if (start && end) return `${formatMonthDay(start)}〜${formatMonthDay(end)}`;
  if (start && !end) return isLongRunningEvent(item) ? `${formatMonthDay(start)}〜` : `${formatMonthDay(start)}〜日程確認`;
  return `〜${formatMonthDay(end)}`;
}

function normalizeEventDateValue(value) {
  if (!value) return null;
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseEventDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getTodayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isEventOngoing(item, today = getTodayDate()) {
  const start = parseEventDate(item.startDate);
  const end = parseEventDate(item.endDate);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return Boolean(start) && (!end || end >= today);
}

function isEventClosingSoon(item, today = getTodayDate()) {
  if (!isEventOngoing(item, today)) return false;
  const end = parseEventDate(item.endDate);
  if (!end) return false;
  const remainingDays = daysBetween(end, today);
  return remainingDays >= 0 && remainingDays <= 14;
}

function isLongRunningEvent(item) {
  return (item.tags ?? []).some((tag) => ['ongoing', 'large-scale', 'summer'].includes(tag));
}

function isCurrentMonthLimited(item) {
  const today = getTodayDate();
  const start = parseEventDate(item.startDate);
  const end = parseEventDate(item.endDate);
  if (!start || !end) return false;
  return start.getFullYear() === today.getFullYear()
    && end.getFullYear() === today.getFullYear()
    && start.getMonth() === today.getMonth()
    && end.getMonth() === today.getMonth();
}

function eventIntersectsMonth(item, monthStart) {
  const start = parseEventDate(item.startDate);
  if (!start) return false;
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const end = parseEventDate(item.endDate) ?? (isLongRunningEvent(item) ? new Date(2999, 11, 31) : start);
  return start <= monthEnd && end >= monthStart;
}

function eventStartsInMonth(item, monthStart) {
  const start = parseEventDate(item.startDate);
  return Boolean(start)
    && start.getFullYear() === monthStart.getFullYear()
    && start.getMonth() === monthStart.getMonth();
}

function daysBetween(left, right) {
  return Math.round((left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24));
}

function getEventDaysUntilEnd(item, today = getTodayDate()) {
  const end = parseEventDate(item.endDate);
  if (!end) return null;
  return daysBetween(end, today);
}

function buildClosingSoonBadge(item) {
  const remainingDays = getEventDaysUntilEnd(item);
  if (remainingDays == null || remainingDays < 0 || remainingDays > 14 || !isEventOngoing(item, getTodayDate())) return '';
  const label = remainingDays === 0 ? '今日終了' : `あと${remainingDays}日`;
  return '<span class="event-closing-badge">' + escapeHtml(label) + '</span>';
}

function formatMonthDay(date) {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date);
}

function renderMustReadNews(items = []) {
  if (!mustReadNewsListElement) return;
  if (!items.length) {
    mustReadNewsListElement.innerHTML = '<article class="topic-cluster-card topic-cluster-card-empty"><strong>今日のインターネットを整理中です</strong><p>直近24時間のネット話題を確認しています。</p></article>';
    return;
  }

  replaceChildrenFromHtml(mustReadNewsListElement, items.map((topic) => renderTopicClusterCard(topic, {
    badge: 'INTERNET',
    scoreMode: 'hot',
    featured: true,
  })));
}

function prepareVisibleTrendTopics(topics) {
  return [...topics]
    .filter((topic) => !isAdultContentTopic(topic))
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .slice(0, TOPIC_WORKING_SET_LIMIT);
}

function selectPersonalNews(topics, { excludedIds = new Set(), overlapLimit = 2 } = {}) {
  const baseCandidates = [...topics]
    .filter((topic) => !isAdultContentTopic(topic))
    .filter((topic) => hasPersonalInterestSignal(topic))
    .filter((topic) => Number(topic.personalScore ?? 0) >= 18)
    .filter((topic) => !isPersonalExcludedTopic(topic) || isStrongOtakuTopic(topic))
    .sort((left, right) => personalTopicRank(right) - personalTopicRank(left) || hotTopicScore(right) - hotTopicScore(left));

  const primary = baseCandidates.filter((topic) => !excludedIds.has(topic.id)).slice(0, PERSONAL_NEWS_LIMIT);
  if (primary.length >= PERSONAL_NEWS_LIMIT) return primary;

  const overlap = baseCandidates
    .filter((topic) => excludedIds.has(topic.id))
    .slice(0, overlapLimit);

  const fallback = [...topics]
    .filter((topic) => !isAdultContentTopic(topic))
    .filter((topic) => !excludedIds.has(topic.id))
    .filter((topic) => hasCategory(topic, 'games') || hasCategory(topic, 'manga') || hasCategory(topic, 'entertainment'))
    .filter((topic) => !isPersonalExcludedTopic(topic) || isStrongOtakuTopic(topic))
    .sort((left, right) => personalTopicRank(right) - personalTopicRank(left) || hotTopicScore(right) - hotTopicScore(left));

  return [...new Map([...primary, ...overlap, ...fallback].map((topic) => [topic.id, topic])).values()].slice(0, PERSONAL_NEWS_LIMIT);
}

function selectInternetNews(topics) {
  const preferred = [...topics]
    .filter((topic) => !isAdultContentTopic(topic))
    .filter((topic) => isInternetMainTopic(topic))
    .sort((left, right) => internetTopicRank(right) - internetTopicRank(left));

  if (preferred.length >= MUST_READ_LIMIT) {
    return preferred.slice(0, MUST_READ_LIMIT);
  }

  const fallback = [...topics]
    .filter((topic) => !isAdultContentTopic(topic))
    .filter((topic) => !isLowPriorityTopic(topic))
    .sort((left, right) => internetTopicRank(right) - internetTopicRank(left));

  return [...new Map([...preferred, ...fallback].map((topic) => [topic.id, topic])).values()].slice(0, MUST_READ_LIMIT);
}

function renderBriefCardList(element, items, options = {}) {
  if (!element) return;
  if (!items.length) {
    element.innerHTML = '<article class="topic-cluster-card topic-cluster-card-empty"><strong>' + escapeHtml(options.emptyTitle ?? 'ニュースを整理中です') + '</strong><p>' + escapeHtml(options.emptyText ?? '最新データを確認しています。') + '</p></article>';
    return;
  }

  replaceChildrenFromHtml(element, items.map((item, index) => {
    const thumbnail = item.thumbnailUrl ? buildTrendCardThumb(item.thumbnailUrl) : '';
    const sourceUrl = item.primaryLink?.url ?? '';
    const sourceLabel = item.primaryLink?.label ?? item.categoryLabel ?? '元記事';
    const summary = sanitizeBriefSummaryText(item.thirtySecondSummary ?? item.watchpoints ?? '重要ニュースを整理中です。');
    return '<article class="must-read-card-shell" style="animation-delay:' + (index * 60) + 'ms">' +
      thumbnail +
      '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'NEWS') + '</span><strong>' + escapeHtml(item.categoryLabel ?? 'その他') + '</strong></div>' +
      '<div class="trend-meta"><span>' + escapeHtml(item.categoryLabel ?? 'その他') + '</span><time>' + escapeHtml(item.publishedLabel ?? formatBriefTimelineTime(item.publishedAt)) + '</time></div>' +
      '<h3>' + escapeHtml(item.title ?? 'ニュース') + '</h3>' +
      '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
      '<div class="trend-footer"><span><strong>' + escapeHtml(sourceLabel) + '</strong></span>' + (sourceUrl ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">元記事を見る ↗</a>' : '<span class="detail-link">リンクなし</span>') + '</div>' +
    '</article>';
  }));
}

function renderPriorityList(element, topics, options) {
  if (!element) return;
  if (!topics.length) {
    element.innerHTML = '<article class="priority-card priority-card-empty"><strong>' + escapeHtml(options.emptyTitle) + '</strong><p>' + escapeHtml(options.emptyText) + '</p></article>';
    return;
  }

  const cards = topics.map((topic, index) => {
    const href = './topic.html?id=' + encodeURIComponent(topic.id ?? '');
    const sourceUrl = getPrimarySourceUrl(topic);
    const sourceLabel = getPrimarySourceLabel(topic);
    const reasons = (topic.personalReasons ?? topic.hotReasons ?? []).slice(0, 3);
    const audience = Array.isArray(topic.targetAudience) && topic.targetAudience.length ? topic.targetAudience.slice(0, 3).join(' / ') : '関心のある人';
    const thumb = topic.thumbnailUrl ? buildTrendCardThumb(topic.thumbnailUrl) : '';
    return '<article class="priority-card" style="animation-delay:' + (index * 55) + 'ms">' +
      thumb +
      '<div class="priority-card-top"><span>' + escapeHtml(options.badge) + '</span><strong>' + escapeHtml(String(Math.round(Number(topic.personalScore ?? hotTopicScore(topic) ?? 0)))) + '</strong></div>' +
      '<h3><a class="topic-card-primary-link" href="' + escapeHtml(href) + '">' + escapeHtml(topic.title ?? 'ニュース') + '</a></h3>' +
      '<p>' + escapeHtml(topic.whatHappened ?? shortEventFromTitle(topic.title)) + '</p>' +
      '<dl class="trend-reason-list priority-reasons">' +
      '<div><dt>なぜ見る？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
      '<div><dt>関係ある人</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
      '</dl>' +
      '<div class="priority-chip-row">' + (sourceUrl ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a>' : '<a class="detail-link" href="' + escapeHtml(href) + '">詳しく見る →</a>') + '</div>' +
      '<div class="priority-chip-row">' + reasons.map((reason) => '<span>' + escapeHtml(reason) + '</span>').join('') + '</div>' +
      '</article>';
  });
  replaceChildrenFromHtml(element, cards);
}

function renderTopicChannels(topics) {
  if (!topicChannelTabsElement || !topicChannelStageElement) return;
  const definitions = buildTopicChannelDefinitions(topics);
  const availableSections = definitions.filter((section) => section.items.length);
  const sections = availableSections.length ? availableSections : definitions;
  if (!sections.length) {
    topicChannelTabsElement.innerHTML = '';
    topicChannelStageElement.innerHTML = '';
    return;
  }

  const sectionKeys = new Set(sections.map((section) => section.key));
  if (!activeTopicChannelKey || !sectionKeys.has(activeTopicChannelKey)) {
    activeTopicChannelKey = selectDefaultTopicChannelKey(sections);
  }

  const activeSection = sections.find((section) => section.key === activeTopicChannelKey) ?? sections[0];
  replaceChildrenFromHtml(topicChannelTabsElement, sections.map((section) => renderTopicChannelTab(section, section.key === activeSection.key)));
  topicChannelStageElement.innerHTML = renderTopicChannelPanel(activeSection);
}

function buildTopicChannelDefinitions(topics) {
  return [
    {
      key: 'games',
      icon: '🎮',
      title: 'ゲーム',
      description: '予約、抽選、発売、アップデートなど、ゲーム周辺の大きな動きを先に整理します。',
      items: selectCategoryTopics(topics, (topic) => hasCategory(topic, 'games')),
    },
    {
      key: 'ai',
      icon: '🤖',
      title: 'AI',
      description: '生成AI、主要モデル、企業発表、利用条件変更などを Topic 単位でまとめます。',
      items: selectCategoryTopics(topics, (topic) => isAiTopic(topic)),
    },
    {
      key: 'deals',
      icon: '💰',
      title: 'お得情報',
      description: 'セール、割引、キャンペーン、ポイント還元系を、後追いしやすい形でまとめます。',
      items: selectCategoryTopics(topics, (topic) => isDealsTopic(topic)),
    },
    {
      key: 'sns-net',
      icon: '📱',
      title: 'SNS・ネット',
      description: 'SNS、ネットカルチャー、2chまとめ系を残したまま、話題単位で横断整理します。',
      items: selectCategoryTopics(topics, (topic) => isSnsOrNetTopic(topic)),
    },
    {
      key: 'world',
      icon: '🌎',
      title: '世の中',
      description: '政治、経済、国際、事件など、生活や判断に関わる Topic をまとめます。',
      items: selectCategoryTopics(topics, (topic) => isWorldTopic(topic)),
    },
  ];
}

function selectDefaultTopicChannelKey(sections) {
  const preferredOrder = ['games', 'ai', 'deals', 'sns-net', 'world'];
  const available = new Map(sections.map((section) => [section.key, section]));
  const preferred = preferredOrder
    .map((key) => available.get(key))
    .filter(Boolean)
    .sort((left, right) => right.items.length - left.items.length);
  return preferred[0]?.key ?? sections.sort((left, right) => right.items.length - left.items.length)[0]?.key ?? sections[0]?.key ?? null;
}

function renderTopicChannelTab(section, isActive) {
  return '<button class="' + escapeHtml('topic-tab-button' + (isActive ? ' active' : '')) + '" type="button" role="tab" aria-selected="' + escapeHtml(String(isActive)) + '" data-topic-tab="' + escapeHtml(section.key) + '">' +
    '<span>' + escapeHtml(section.icon + ' ' + section.title) + '</span>' +
    '<strong>' + escapeHtml(String(section.items.length)) + '</strong>' +
  '</button>';
}

function renderTopicChannelPanel(section) {
  const body = section.items.length
    ? '<div class="topic-channel-carousel">' + section.items.map((topic) => renderTopicClusterCard(topic, {
      badge: section.icon + ' ' + section.title,
      scoreMode: 'hot',
      featured: true,
    })).join('') + '</div>'
    : '<article class="topic-cluster-card topic-cluster-card-empty"><strong>' + escapeHtml(section.title) + 'の話題を整理中です</strong><p>最新の Topic Cluster がまとまり次第ここに表示します。</p></article>';

  return '<section class="topic-channel-panel topic-channel-panel-active">' +
    '<div class="topic-channel-head"><div><p class="section-kicker">' + escapeHtml(section.key.toUpperCase()) + '</p><h3>' + escapeHtml(section.icon + ' ' + section.title) + '</h3></div><p>' + escapeHtml(section.description) + '</p></div>' +
    body +
  '</section>';
}

function renderTopicClusterList(element, topics, options = {}) {
  if (!element) return;
  if (!topics.length) {
    element.innerHTML = '<article class="topic-cluster-card topic-cluster-card-empty"><strong>' + escapeHtml(options.emptyTitle ?? '話題を整理中です') + '</strong><p>' + escapeHtml(options.emptyText ?? '最新データを確認しています。') + '</p></article>';
    return;
  }
  replaceChildrenFromHtml(element, topics.map((topic) => renderTopicClusterCard(topic, options)));
}

function renderTopicClusterCard(topic, options = {}) {
  const href = './topic.html?id=' + encodeURIComponent(topic.id ?? '');
  const sourceUrl = getPrimarySourceUrl(topic);
  const sourceLabel = getPrimarySourceLabel(topic);
  const thumbnail = topic.thumbnailUrl ? buildTrendCardThumb(topic.thumbnailUrl) : '';
  const audience = Array.isArray(topic.targetAudience) && topic.targetAudience.length ? topic.targetAudience.slice(0, 3).join(' / ') : '関連分野を追う人';
  const summary = buildTopicCardSummary(topic);
  const relatedSignals = collectRelatedSignals(topic, 3);
  const isCompact = Boolean(options.compact);
  const relatedHtml = relatedSignals.length
    ? '<div class="topic-related-strip"><div class="topic-related-head"><strong>参照記事</strong></div><div class="topic-related-row">' + relatedSignals.map(renderTopicRelatedLink).join('') + '</div></div>'
    : '<div class="topic-related-strip topic-related-strip-empty"><strong>参照記事</strong><span>参照元の整理中です</span></div>';
  const scoreValue = options.scoreMode === 'hot'
    ? Math.round(hotTopicScore(topic))
    : Math.round(Number(topic.personalScore ?? hotTopicScore(topic) ?? 0));
  const cardClasses = [
    'topic-cluster-card',
    'topic-cluster-shell',
    isCompact ? 'topic-cluster-card-compact topic-cluster-card-channel' : '',
    options.featured ? 'topic-cluster-card-featured' : '',
    topic.thumbnailUrl ? 'has-thumb' : 'trend-card-no-thumb',
  ].filter(Boolean).join(' ');

  if (options.featured) {
    return '<article class="must-read-card-shell">' +
        thumbnail +
        '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'TOPIC') + '</span><strong>' + escapeHtml(String(scoreValue)) + '</strong></div>' +
        '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(topic.time ?? '直近') + '</time></div>' +
        '<h3>' + escapeHtml(topic.title ?? '話題') + '</h3>' +
        '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
        '<dl class="trend-reason-list">' +
          '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
          '<div><dt>なぜ重要？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
          '<div><dt>誰に関係ある？</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
        '</dl>' +
        relatedHtml +
        '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span><a class="detail-link" href="' + escapeHtml(href) + '">もっと見る →</a></div>' +
        (sourceUrl ? '<div class="trend-footer"><span></span><a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a></div>' : '') +
      '</article>';
  }

  if (isCompact) {
    return '<article class="' + escapeHtml(cardClasses) + '">' +
      thumbnail +
      '<div class="topic-cluster-body topic-cluster-body-channel">' +
        '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'TOPIC') + '</span><strong>' + escapeHtml(String(scoreValue)) + '</strong></div>' +
        '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(topic.time ?? '直近') + '</time></div>' +
        '<h3><a class="topic-card-primary-link" href="' + escapeHtml(href) + '">' + escapeHtml(topic.title ?? '話題') + '</a></h3>' +
        '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
        '<dl class="trend-reason-list trend-reason-list-compact">' +
          '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
          '<div><dt>代表トピック</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
        '</dl>' +
        '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span><a class="detail-link" href="' + escapeHtml(href) + '">もっと見る →</a></div>' +
        (sourceUrl ? '<div class="trend-footer"><span></span><a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a></div>' : '') +
      '</div>' +
    '</article>';
  }

  return '<article class="' + escapeHtml(cardClasses) + '">' +
    thumbnail +
    '<div class="topic-cluster-body">' +
      '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'TOPIC') + '</span><strong>' + escapeHtml(String(scoreValue)) + '</strong></div>' +
      '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(topic.time ?? '直近') + '</time></div>' +
      '<h3><a class="topic-card-primary-link" href="' + escapeHtml(href) + '">' + escapeHtml(topic.title ?? '話題') + '</a></h3>' +
      '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
      '<dl class="trend-reason-list">' +
        '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
        '<div><dt>なぜ重要？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
        '<div><dt>誰に関係ある？</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
      '</dl>' +
      relatedHtml +
      '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span><a class="detail-link" href="' + escapeHtml(href) + '">もっと見る →</a></div>' +
      (sourceUrl ? '<div class="trend-footer"><span></span><a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a></div>' : '') +
    '</div>' +
  '</article>';
}

function buildTopicCardSummary(topic) {
  const summarySource = topic.summary || topic.briefSummary || topic.whatHappened || shortEventFromTitle(topic.title);
  const text = String(summarySource ?? '').replace(/\s+/g, ' ').trim();
  return trimMetaText(text || '最新の動きを整理しています。', 88);
}

function collectRelatedSignals(topic, limit = 3) {
  const signals = Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [];
  return signals
    .filter((signal) => signal?.url)
    .slice(0, limit);
}

function renderTopicRelatedLink(signal) {
  return '<a class="topic-related-link" href="' + escapeHtml(signal.url ?? '#') + '" target="_blank" rel="noreferrer">' +
    '<div><strong>' + escapeHtml(signal.sourceName ?? signal.source ?? 'Source') + '</strong><span>' + escapeHtml(trimMetaText(signal.title ?? '関連記事', 42)) + '</span></div>' +
  '</a>';
}

function selectCategoryTopics(topics, predicate, limit = 6) {
  return [...topics]
    .filter((topic) => !isAdultContentTopic(topic))
    .filter((topic) => predicate(topic))
    .filter((topic) => !isLowPriorityTopic(topic))
    .sort((left, right) => categoryShowcaseScore(right) - categoryShowcaseScore(left))
    .slice(0, limit);
}

function isAiTopic(topic) {
  return isAiText(topicText(topic));
}

function isDealsTopic(topic) {
  return /セール|割引|キャンペーン|クーポン|ポイント還元|無料配布|期間限定/i.test(topicText(topic));
}

function isSnsOrNetTopic(topic) {
  return hasCategory(topic, 'sns') || hasCategory(topic, 'net-culture') || hasCategory(topic, 'matome');
}

function isWorldTopic(topic) {
  return ['politics', 'business', 'world', 'crime'].some((category) => hasCategory(topic, category));
}

function calculatePersonalFit(topic) {
  const text = topicText(topic);
  const reasons = [];
  let score = 0;

  for (const rule of PERSONAL_INTEREST_RULES) {
    if (!rule.pattern.test(text)) continue;
    score += rule.score;
    reasons.push(rule.label);
  }

  for (const rule of PERSONAL_NEGATIVE_RULES) {
    if (!rule.pattern.test(text)) continue;
    score -= rule.score;
  }

  score += personalSourceAffinityScore(topic);
  if (topic.thumbnailUrl) score += 8;
  if (Number(topic.posts ?? 1) >= 2) score += 8;
  if (isTrendTopicFresh(topic)) score += 8;
  if (hotTopicScore(topic) >= 55) score += 8;

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: [...new Set(reasons)].slice(0, 4),
  };
}

function hasPersonalInterestSignal(topic) {
  const text = topicText(topic);
  return PERSONAL_INTEREST_RULES.some((rule) => rule.pattern.test(text)) || personalSourceAffinityScore(topic) >= 10;
}

function isPersonalExcludedTopic(topic) {
  const text = topicText(topic);
  return PERSONAL_NEGATIVE_RULES.some((rule) => rule.pattern.test(text));
}

function isStrongOtakuTopic(topic) {
  const text = topicText(topic);
  const matchedRules = PERSONAL_INTEREST_RULES.filter((rule) => rule.pattern.test(text));
  return matchedRules.length >= 2 || matchedRules.some((rule) => rule.score >= 40);
}

function isInternetMainTopic(topic) {
  if (!topic || isAdultContentTopic(topic) || isLowPriorityTopic(topic)) return false;
  const text = topicText(topic);
  const hot = hotTopicScore(topic);
  const primaryCategory = topic.category ?? topic.categories?.[0] ?? 'general';
  const preferredCategory = ['games', 'manga', 'entertainment', 'sns', 'net-culture', 'matome'].includes(primaryCategory);
  const preferredKeywords = /ポケモン|pokemon|任天堂|nintendo|switch|steam|ゲーム|漫画|マンガ|アニメ|同人|コミケ|コラボカフェ|炎上|バズ|ミーム|トレンド入り|togetter|はてブ|セール|割引|無料配布|オタク|声優|配信者/.test(text);
  const networkBuzz = /sns|xで話題|twitter|bluesky|reddit|炎上|バズ|ミーム|まとめ|ネットの反応|話題/.test(text)
    || (Array.isArray(topic.hotReasons) && topic.hotReasons.some((reason) => /話題|拡散|複数媒体|専門媒体/.test(reason)));
  const secondaryCategory = ['sports', 'crime', 'general'].includes(primaryCategory);
  const lowPriorityDomain = /(政治|国会|選挙|与党|野党|経済|株価|決算|金利|国際|外交|戦況|ai|生成ai|openai|claude|gemini|個人開発|副業|収益化)/i.test(text);

  if ((preferredCategory || preferredKeywords) && !lowPriorityDomain) return true;
  if (networkBuzz && hot >= 54 && !lowPriorityDomain) return true;
  if (secondaryCategory && networkBuzz && hot >= 60) return true;
  return hot >= 90 && !/(地域おこし|観光協会|セミナー|説明会)/.test(text);
}

function internetTopicRank(topic) {
  const text = topicText(topic);
  let score = hotTopicScore(topic) + topicRecencyScore(topic);
  if (['sns', 'net-culture', 'matome'].includes(topic.category)) score += 28;
  if (['games', 'manga', 'entertainment'].includes(topic.category)) score += 20;
  if (/ポケモン|pokemon|任天堂|nintendo|switch|steam|ゲーム|漫画|マンガ|アニメ|同人/.test(text)) score += 18;
  if (/炎上|バズ|ミーム|xで話題|トレンド入り|togetter|はてブ|ネットの反応/.test(text)) score += 22;
  if (/セール|割引|無料配布|キャンペーン/.test(text)) score += 12;
  if (/(政治|国会|選挙|経済|株価|金利|国際|外交|ai|生成ai|副業|個人開発|収益化)/i.test(text)) score -= 26;
  if (Number(topic.posts ?? 1) >= 2) score += 10;
  return score;
}

function personalSourceAffinityScore(topic) {
  const signals = Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [];
  let score = 0;

  for (const signal of signals.slice(0, 4)) {
    const priority = Number(signal?.sourcePriority ?? 0);
    score = Math.max(score, Math.max(0, Math.round((priority - 40) / 5)));

    if (signal?.forPersonal) score += 4;
    if (signal?.specialist) score += 6;
    if (signal?.official) score += 4;

    const sourceGroup = String(signal?.sourceGroup ?? '');
    if (/games|anime|net-culture|sales|steam|events|pokemon/.test(sourceGroup)) score += 6;
    if (sourceGroup === 'google-news') score -= 6;
  }

  return Math.max(-8, Math.min(22, score));
}

function personalTopicRank(topic) {
  return Number(topic.personalScore ?? 0) + personalSourceAffinityScore(topic) + topicRecencyScore(topic);
}

function buildTrendInsights(topic, personal = calculatePersonalFit(topic)) {
  return {
    whatHappened: shortEventFromTitle(topic.title),
    whyHot: buildWhyHotLabel(topic),
    importantPoint: buildImportantPoint(topic),
    futureOutlook: buildFutureOutlook(topic),
    targetAudience: buildTargetAudience(topic, personal),
  };
}

function topicText(topic) {
  return [
    topic.title,
    topic.summary,
    topic.categoryLabel,
    ...(topic.categoryLabels ?? []),
    ...(topic.hotReasons ?? []),
    ...(topic.relatedKeywords ?? []),
    ...(topic.sourceSignals ?? []).flatMap((signal) => [
      signal.title,
      signal.summary,
      signal.sourceName,
      signal.sourceGroup,
      ...(Array.isArray(signal.sourceTags) ? signal.sourceTags : []),
    ]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function shortEventFromTitle(title = '') {
  const value = String(title ?? '').replace(/^【[^】]+】\s*/u, '').trim();
  if (!value) return '新しい動きが出ています。';
  return trimMetaText(value.replace(/[。！？!?].*$/u, ''), 42);
}

function buildWhyHotLabel(topic) {
  const reasons = Array.isArray(topic.hotReasons) ? topic.hotReasons : [];
  if (reasons.length) return trimMetaText(reasons[0], 44);
  if (Number(topic.posts ?? 1) >= 2) return '複数媒体で同じ話題が扱われています。';
  if (isTrendTopicFresh(topic)) return '直近の新しい話題です。';
  if (Number(topic.personalScore ?? 0) >= 35) return '自分の関心分野に近い話題です。';
  return '関連分野の流れを追う判断材料になります。';
}

function buildImportantPoint(topic) {
  const text = topicText(topic);
  if (/セール|割引|キャンペーン|クーポン|ポイント還元/.test(text)) return '終了前に条件を確認すると損を避けやすい情報です。';
  if (/脱出ゲーム|リアル脱出ゲーム|scrap|謎解き|イマーシブ|展示会|コラボカフェ|ポップアップ/.test(text)) return '開催期間、会場、予約条件を早めに押さえる価値が高い話題です。';
  if (/ポケモン|pokemon|任天堂|switch|steam|ゲーム/.test(text)) return '遊ぶ予定や購入判断、予約・抽選の判断に関係します。';
  if (/ai|chatgpt|openai|claude|gemini|生成ai/.test(text)) return '仕事や制作環境の選択に影響する可能性があります。';
  if (/炎上|sns|xで話題|バズ|拡散/.test(text)) return 'ネット上の空気や評判の変化を早めに掴めます。';
  if (/逮捕|事件|事故|判決|政治|選挙|物価|株価/.test(text)) return '生活や社会の判断材料として優先度が高い話題です。';
  return '後で追うべきかを短時間で判断する材料になります。';
}

function buildFutureOutlook(topic) {
  const text = topicText(topic);
  if (/セール|キャンペーン|クーポン/.test(text)) return '対象範囲、終了日時、追加キャンペーンの有無。';
  if (/予約|抽選|発売|配信|公開/.test(text)) return '次回受付、在庫、配信日、公式発表の更新。';
  if (/ai|chatgpt|openai|claude|gemini/.test(text)) return '利用条件、料金、競合サービスの追随。';
  if (/逮捕|事件|事故|裁判/.test(text)) return '捜査や発表、関係者コメントの続報。';
  return '追加発表、関連ニュース、SNS上の反応の広がり。';
}

function buildTargetAudience(topic, personal) {
  const text = topicText(topic);
  const values = [];
  if (/ポケモン|pokemon|ポケカ/.test(text)) values.push('ポケモンユーザー');
  if (/ゲーム|任天堂|switch|steam|ps5/.test(text)) values.push('ゲームユーザー');
  if (/ai|chatgpt|openai|claude|gemini/.test(text)) values.push('AI利用者');
  if (/iphone|android|ガジェット|スマホ|nvidia|gpu/.test(text)) values.push('ガジェット好き');
  if (/セール|割引|キャンペーン|クーポン|fanza|dlsite/.test(text)) values.push('セール好き');
  if (/漫画|マンガ|アニメ|声優/.test(text)) values.push('漫画・アニメ好き');
  if (/sns|炎上|バズ|ミーム|ネット文化/.test(text)) values.push('ネット文化を追う人');
  if (/脱出ゲーム|リアル脱出ゲーム|scrap|謎解き|イマーシブ|展示会|コラボカフェ|ポップアップ|体験型/.test(text)) values.push('体験型イベント好き');
  if (/株|投資|決算|金利|物価/.test(text)) values.push('投資家');
  if (!values.length && personal.reasons.length) values.push(...personal.reasons.map((reason) => reason.replace(/関連|情報/g, '')));
  return [...new Set(values)].slice(0, 4);
}

function renderDailyBrief() {
  console.time('home:render-brief');
  if (!dailyBriefListElement) return;

  if (!dailyBriefItems.length) {
    dailyBriefListElement.innerHTML = '<article class="brief-timeline-item brief-timeline-item-empty"><strong>重要ニュースを整理中です</strong><p>要約データの生成が終わり次第ここに表示されます。</p></article>';
    console.timeEnd('home:render-brief');
    return;
  }

  const items = [...dailyBriefItems]
    .slice(0, 10)
    .sort((left, right) => briefPublishedAt(left) - briefPublishedAt(right));

  const cards = items.map((item, index) => {
    const thumbnail = item.thumbnailUrl ? buildTrendCardThumb(item.thumbnailUrl) : '';
    const primaryLink = item.primaryLink?.url
      ? '<a class="brief-primary-link" href="' + escapeHtml(item.primaryLink.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(item.primaryLink.label ?? '元記事') + ' ↗</a>'
      : '<span class="brief-primary-link brief-primary-link-muted">リンクなし</span>';
    const summary = sanitizeBriefSummaryText(item.thirtySecondSummary ?? item.watchpoints ?? '情報を整理中です。');
    const timeLabel = item.publishedLabel ?? formatBriefTimelineTime(item.publishedAt);
    const relativeLabel = formatRelativeTime(item.publishedAt);
    const sourceLabel = item.primaryLink?.label ?? item.categoryLabel ?? 'ニュース';

    return '<article class="brief-timeline-item" style="animation-delay:' + (index * 70) + 'ms">' +
      '<div class="brief-timeline-dot" aria-hidden="true"></div>' +
      '<div class="brief-timeline-content">' +
      '<div class="brief-timeline-layout">' +
      '<div class="brief-timeline-time"><time>' + escapeHtml(timeLabel || '時刻不明') + '</time><span>' + escapeHtml(item.categoryLabel ?? 'その他') + '</span></div>' +
      thumbnail +
      '<div class="brief-timeline-body">' +
      '<h3>' + escapeHtml(item.title ?? 'ニュース') + '</h3>' +
      '<p class="brief-timeline-summary">' + escapeHtml(summary) + '</p>' +
      '<div class="brief-meta brief-meta-timeline"><span>' + escapeHtml(sourceLabel) + ' ・ ' + escapeHtml(relativeLabel) + '</span>' + primaryLink + '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
    '</article>';
  });
  replaceChildrenFromHtml(dailyBriefListElement, cards);
  console.timeEnd('home:render-brief');
}

function selectTodayNews(items) {
  const preferred = [...items]
    .filter((item) => isTodayNewsItem(item))
    .sort((left, right) => todayNewsRank(right) - todayNewsRank(left) || briefPublishedAt(right) - briefPublishedAt(left));

  if (preferred.length >= TODAY_NEWS_LIMIT) {
    return preferred.slice(0, TODAY_NEWS_LIMIT);
  }

  const fallback = [...items]
    .filter((item) => !isInternetOrOtakuBrief(item))
    .sort((left, right) => todayNewsRank(right) - todayNewsRank(left) || briefPublishedAt(right) - briefPublishedAt(left));

  return [...new Map([...preferred, ...fallback].map((item) => [item.id, item])).values()].slice(0, TODAY_NEWS_LIMIT);
}

function isTodayNewsItem(item) {
  const text = briefItemText(item);
  if (isInternetOrOtakuBrief(item) || isAdultBriefItem(item)) return false;
  if (/事件|事故|逮捕|起訴|判決|災害|地震|大雨|台風|避難|政治|首相|国会|選挙|経済|株価|金利|物価|国際|外交|戦況|芸能|スポーツ|生活|値上げ|制度|交通/.test(text)) return true;
  return ['政治', '経済', '国際', 'スポーツ', 'エンタメ', 'その他'].includes(String(item.categoryLabel ?? ''));
}

function isInternetOrOtakuBrief(item) {
  const text = briefItemText(item);
  return /ポケモン|pokemon|ゲーム|任天堂|nintendo|switch|steam|漫画|マンガ|アニメ|アダルト|同人|セール|ミーム|炎上|ネット文化/.test(text);
}

function isAdultBriefItem(item) {
  return ADULT_CONTENT_PATTERN.test(briefItemText(item));
}

function todayNewsRank(item) {
  const text = briefItemText(item);
  let score = briefPublishedAt(item);
  if (/事件|事故|逮捕|起訴|判決|災害|地震|大雨|台風|避難/.test(text)) score += 40;
  if (/政治|首相|国会|選挙|経済|株価|金利|物価|国際|外交|戦況/.test(text)) score += 24;
  if (/芸能|スポーツ/.test(text)) score += 12;
  return score;
}

function briefItemText(item) {
  return [
    item?.title,
    item?.categoryLabel,
    item?.thirtySecondSummary,
    item?.watchpoints,
    item?.primaryLink?.label,
  ].filter(Boolean).join(' ').toLowerCase();
}

function briefPublishedAt(item) {
  const timestamp = new Date(item?.publishedAt ?? 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatBriefTimelineTime(value) {
  const date = new Date(value ?? '');
  if (Number.isNaN(date.getTime())) return '時刻不明';
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatRelativeTime(value) {
  const timestamp = new Date(value ?? '').getTime();
  if (Number.isNaN(timestamp)) return '時刻不明';
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / (1000 * 60)));
  if (diffMinutes < 60) return diffMinutes + '分前';
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return diffHours + '時間前';
  const diffDays = Math.floor(diffHours / 24);
  return diffDays + '日前';
}

function renderAdultTrends(filter = 'all') {
  if (!adultTrendListElement) return;
  activeAdultFilter = filter;
  const isAdultPortalPage = Boolean(document.body?.dataset?.adultPage);
  const visibleLimit = isAdultPortalPage ? ADULT_HOME_LIMIT : 6;

  const filtered = adultTrendItems
    .filter((item) => filter === 'all' || item.categories?.includes(filter))
    .sort((left, right) => Number(right.adultHotScore ?? 0) - Number(left.adultHotScore ?? 0))
    .slice(0, visibleLimit);

  if (!filtered.length) {
    adultTrendListElement.innerHTML = '<article class="adult-card adult-card-empty"><strong>アダルトトレンドを整理中です</strong><p>adult-trends.json の生成後にランキング、急上昇、セール情報を表示します。</p></article>';
    return;
  }

  adultTrendListElement.innerHTML = filtered.map((item, index) => {
    const href = './adult-topic.html?id=' + encodeURIComponent(item.routeId ?? item.id ?? '');
    const thumb = item.thumbnailUrl ? '<div class="adult-thumb-wrap"><img class="adult-thumb" src="' + escapeHtml(item.thumbnailUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>' : '';
    const reason = item.trendReasons?.[0] ?? item.reason ?? 'トレンド候補';
    const typeLabels = buildAdultDisplayLabels(item);
    const labels = [...typeLabels, ...(item.categoryLabels ?? item.categories?.map(adultCategoryLabelFor) ?? [])].slice(0, 5);
    return '<a class="' + escapeHtml('adult-card adult-card-link ' + (item.thumbnailUrl ? 'has-thumb' : 'adult-card-no-thumb')) + '" href="' + escapeHtml(href) + '" style="animation-delay:' + (index * 45) + 'ms">' +
      thumb +
      '<div class="adult-card-body">' +
      '<div class="adult-card-meta"><span>' + escapeHtml(item.sourceName) + '</span><strong>' + escapeHtml(String(item.adultHotScore ?? 0)) + '</strong></div>' +
      '<h3>' + escapeHtml(item.title ?? 'アダルトトレンド') + '</h3>' +
      '<p>' + escapeHtml(item.summary ?? 'ランキングやセール情報を整理中です。') + '</p>' +
      '<div class="adult-chip-row">' + labels.map((label) => '<span>' + escapeHtml(label) + '</span>').join('') + '</div>' +
      '<div class="adult-card-footer"><small>' + escapeHtml(reason) + '</small><span>詳細を見る →</span></div>' +
      '</div>' +
    '</a>';
  }).join('');
}

function buildAdultDisplayLabels(item) {
  const labels = [];
  if (item.trendType === 'ranking' || item.ranking) labels.push('ランキング');
  if (item.trendType === 'trending' || Number(item.rankChange ?? 0) > 0) labels.push('急上昇');
  if (item.discountRate || /セール|割引/.test(String(item.summary ?? ''))) labels.push('セール');
  if (item.publishedAt && Date.now() - new Date(item.publishedAt).getTime() <= 24 * 60 * 60 * 1000) labels.push('新着');
  if ((item.tags ?? []).length >= 3) labels.push('関連作品');
  return [...new Set(labels)];
}

function renderDeferredPlaceholders() {
  if (trendListElement && !trendListElement.children.length) {
    trendListElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>スクロール時に話題一覧を読み込みます</strong><p>初回表示を軽くするため、下のセクションは後から描画します。</p></div>';
  }
}

function setupDeferredRenderObservers() {
  if (!('IntersectionObserver' in window)) {
    revealHotSections();
    revealTrendSection();
    return;
  }

  if (hotSectionElement) {
    const hotObserver = new IntersectionObserver((entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      revealHotSections();
      observer.disconnect();
    }, { rootMargin: '240px 0px' });
    hotObserver.observe(hotSectionElement);
  }

  if (topicChannelsSectionElement) {
    const topicChannelObserver = new IntersectionObserver((entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      revealDeferredTopicChannels();
      observer.disconnect();
    }, { rootMargin: '220px 0px' });
    topicChannelObserver.observe(topicChannelsSectionElement);
  }

  if (trendSectionElement) {
    const trendObserver = new IntersectionObserver((entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      revealTrendSection();
      observer.disconnect();
    }, { rootMargin: '320px 0px' });
    trendObserver.observe(trendSectionElement);
  }
}

function revealHotSections() {
  if (deferredHotRendered) return;
  deferredHotRendered = true;
  renderTrendSideStats(visibleTrendTopics.length ? visibleTrendTopics : trendTopics);
  recordPerfCount('after-hot');
}

function revealTrendSection() {
  if (deferredTrendRendered) return;
  deferredTrendRendered = true;
  renderTrends(activeTrendFilter);
  recordPerfCount('after-trends');
}

function revealDeferredTopicChannels() {
  if (deferredTopicChannelsRendered) return;
  deferredTopicChannelsRendered = true;
  renderTopicChannels(visibleTrendTopics.length ? visibleTrendTopics : trendTopics);
  recordPerfCount('after-topic-channels');
}

function sanitizeBriefSummaryText(value) {
  const text = String(value ?? "").trim();
  if (!text) return '';

  const sanitized = text
    .replace(/複数媒体(?:が|で)同一テーマを扱っており、情報の更新が早い。?/gu, "")
    .replace(/複数媒体が同じテーマを追っており、継続報道の局面に入っている。?/gu, "")
    .replace(/^\s*[,、\s]+|[,、\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!sanitized) return '情報を整理中です。';
  return sanitized;
}

function replaceChildrenFromHtml(element, htmlItems) {
  if (!element) return;
  const fragment = document.createDocumentFragment();
  const template = document.createElement('template');
  const values = Array.isArray(htmlItems) ? htmlItems : [htmlItems];
  for (const html of values) {
    template.innerHTML = String(html ?? '').trim();
    while (template.content.firstChild) {
      fragment.appendChild(template.content.firstChild);
    }
  }
  element.replaceChildren(fragment);
}

function recordPerfCount(label) {
  perfMetrics.counts[label] = {
    priorityCards: document.querySelectorAll('.priority-card').length,
    eventCards: document.querySelectorAll('.event-card').length,
    briefTimelineItems: document.querySelectorAll('.brief-timeline-item').length,
    trendCards: document.querySelectorAll('.trend-card').length,
    rankingItems: document.querySelectorAll('#ranking-battle-list li, #ranking-general-list li').length,
    hotItems: document.querySelectorAll('#hot-battle-keywords li, #hot-general-keywords li').length,
    images: document.images.length,
  };
  window.__INTERNET_NEWS_PERF = perfMetrics;
}

function renderTrendSideStats(topics) {
  if (!topics.length) {
    const empty = '<li class="side-empty"><span><strong>収集中</strong><small>最近のトピック生成を待っています</small></span></li>';
    hotPrimaryElement.innerHTML = empty;
    hotCategoryElement.innerHTML = empty;
    rankingPrimaryElement.innerHTML = '<li class="side-empty"><span>--</span><span>データ待ち</span><small>24h</small></li>';
    rankingCategoryElement.innerHTML = '<li class="side-empty"><span>--</span><span>データ待ち</span><small>24h</small></li>';
    return;
  }

  const rankedTopics = [...topics].sort((left, right) => hotTopicScore(right) - hotTopicScore(left));
  const primaryTopics = pickPrimaryHotTopics(rankedTopics, 3);
  const categoryTopics = pickCategoryShowcaseTopics(topics);

  replaceChildrenFromHtml(hotPrimaryElement, renderHotKeywordGroup(primaryTopics, 'primary'));
  replaceChildrenFromHtml(hotCategoryElement, renderHotKeywordGroup(categoryTopics.slice(0, 3), 'category'));
  replaceChildrenFromHtml(rankingPrimaryElement, renderRankingGroup(rankedTopics.slice(0, 5)));
  replaceChildrenFromHtml(rankingCategoryElement, renderRankingGroup(categoryTopics.slice(0, 5)));
}

function renderHotKeywordGroup(topics, mode = 'primary') {
  if (!topics.length) {
    return ['<li class="side-empty"><span><strong>話題なし</strong><small>24時間以内の話題を待っています</small></span></li>'];
  }
  return topics.map((topic, index) => {
    const meta = mode === 'primary'
      ? buildPrimaryHotMeta(topic)
      : buildCategoryHotMeta(topic);
    return '<li><a class="hot-link" href="./topic.html?id=' + encodeURIComponent(topic.id ?? '') + '"><span class="hot-rank">0' + (index + 1) + '</span><span><strong>' + escapeHtml(topic.title) + '</strong><small>' + escapeHtml(meta) + '</small></span><span class="hot-change">' + escapeHtml(topic.time ?? '直近') + '</span></a></li>';
  });
}

function renderRankingGroup(topics) {
  if (!topics.length) {
    return ['<li class="side-empty"><span>--</span><span>話題なし</span><small>24h</small></li>'];
  }
  return topics.map((topic, index) => '<li><a class="ranking-link" href="./topic.html?id=' + encodeURIComponent(topic.id ?? '') + '"><span>0' + (index + 1) + '</span><span>' + escapeHtml(topic.title) + '</span><small>' + escapeHtml(topic.time ?? '直近') + '</small></a></li>');
}

function hotTopicScore(topic) {
  return Number(topic.hotScore ?? topic.score ?? 0);
}

function getTrendPrimaryUrl(trend, index) {
  return './topic.html?id=' + encodeURIComponent(trend.id ?? (trend.category + '-' + index));
}

function pickPrimaryHotTopics(topics, limit = 3) {
  const picked = [];
  const seenPrimaryCategories = new Set();

  for (const topic of topics) {
    const mainCategory = normalizeCategories(topic.categories, topic.category)[0] ?? topic.category ?? 'general';
    if (!seenPrimaryCategories.has(mainCategory)) {
      picked.push(topic);
      seenPrimaryCategories.add(mainCategory);
    }
    if (picked.length >= limit) return picked;
  }

  for (const topic of topics) {
    if (picked.includes(topic)) continue;
    picked.push(topic);
    if (picked.length >= limit) break;
  }

  return picked;
}

function pickCategoryShowcaseTopics(topics) {
  return ['general', 'tech', 'business', 'politics', 'entertainment', 'games', 'manga', 'books', 'sports', 'sns', 'net-culture', 'matome', 'crime', 'world']
    .map((category) => {
      const candidates = topics
        .filter((topic) => !isAdultContentTopic(topic))
        .filter((topic) => hasCategory(topic, category))
        .sort((left, right) => categoryShowcaseScore(right) - categoryShowcaseScore(left));
      return candidates[0] ?? null;
    })
    .filter(Boolean)
    .sort((left, right) => categoryShowcaseScore(right) - categoryShowcaseScore(left));
}

function buildPrimaryHotMeta(topic) {
  const reason = Array.isArray(topic.hotReasons) && topic.hotReasons.length ? topic.hotReasons[0] : '';
  if (reason) return trimMetaText(reason, 34);
  return `${topic.posts ?? 1}${topic.metricLabel ?? 'source'} / ${topic.categoryLabel ?? '総合'}`;
}

function buildCategoryHotMeta(topic) {
  const category = categoryDisplayLabel(topic);
  const freshness = isTrendTopicFresh(topic) ? '新着寄り' : '重要トピック';
  return `${category} / ${freshness}`;
}

function trimMetaText(value, limit = 34) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function categoryShowcaseScore(topic) {
  const freshnessBonus = topicRecencyScore(topic);
  const sourceBonus = Math.min(8, Number(topic.posts ?? 1) * 2);
  const baseScore = Number(topic.score ?? 0);
  const personalSourceBonus = Math.max(0, personalSourceAffinityScore(topic));
  const importanceBonus = isHighImportanceTopic(topic) ? 18 : 0;
  const penalty = isLowPriorityTopic(topic) ? 36 : 0;
  return baseScore + freshnessBonus + sourceBonus + personalSourceBonus + importanceBonus - penalty;
}

function isAdultContentTopic(topic) {
  if (!topic) return false;
  if (hasCategory(topic, 'adult')) return true;
  const text = topicText(topic);
  if (ADULT_CONTENT_PATTERN.test(text)) return true;
  const sourceSignals = Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [];
  return sourceSignals.some((signal) => ADULT_CONTENT_PATTERN.test([
    signal?.sourceName,
    signal?.sourceGroup,
    signal?.url,
    signal?.canonicalUrl,
  ].filter(Boolean).join(' ')));
}

function isDoujinEventOnlyTopic(topic) {
  if (!topic) return false;
  const text = topicText(topic);
  if (!/同人/.test(text)) return false;
  if (!/イベント|即売会|サークル|展示|特集/.test(text)) return false;
  return !/(fanza|dlsite|dmm|同人音声|エロ漫画|アダルト|成人向け|18禁|r-?18|av女優|セクシー女優|グラビア|写真集|ランジェリー)/i.test(text);
}

function isHighImportanceTopic(topic) {
  const text = topicText(topic);
  if (['crime', 'politics', 'business', 'world'].some((category) => hasCategory(topic, category))) return true;
  return /(地震|大雨|台風|避難|事故|火災|殺人|逮捕|起訴|判決|法案|制度|選挙|関税|物価|株価|決算|iphone|switch|ps5|steam|任天堂|openai|chatgpt|claude|gemini|nvidia|microsoft|google|apple|セール|クーポン|大型アップデート|抽選)/.test(text);
}

function isLowPriorityTopic(topic) {
  const text = topicText(topic);
  return /(pr times|共同通信prワイヤー|valuepress|＠press|atpress|dream news|ドリームニュース|newscast|プレスリリース|スポンサー|タイアップ|広告)/i.test(text)
    || /(地域対応|エリア対応|正式スタート|サービス開始|提供開始|販売開始|導入開始|参加者募集|受講者募集|開催のお知らせ|来場者募集|観光イベント|ワークショップ|講習会|地域おこし|セミナー|講演会|説明会|体験会|初級クラス)/.test(text)
    || /(地元の魅力をアピール|観光pr|地域pr|やってみた|首長と○○やってみた)/.test(text)
    || /(トークセッションを開催|対談しました|本学の学生|meijo-u\.ac\.jp|大学公式サイト)/i.test(text)
    || (/(累計動画|累計導入|導入実績|掲載実績|利用者数|満足度|受賞歴|フォロワー数)/.test(text) && !/(逮捕|事件|決算|法案|選挙|抽選|値上げ|事故)/.test(text));
}

function isTrendListEligibleTopic(topic) {
  if (!topic || isAdultListBlockedTopic(topic)) return false;
  if (!String(topic.title ?? '').trim()) return false;
  if (isBrokenTopic(topic)) return false;
  if (isSpamTopic(topic)) return false;
  if (isForeignTopic(topic)) return false;
  return true;
}

function isAdultListBlockedTopic(topic) {
  if (!topic) return false;
  const text = topicText(topic);
  if (/(dlsite|fanza|dmm|同人音声|エロ漫画|\bav\b|成人向け|18禁|r-?18)/i.test(text)) return true;
  const signals = Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [];
  return signals.some((signal) => /(dlsite|fanza|dmm|adult|r-?18|同人)/i.test([
    signal?.sourceName,
    signal?.sourceGroup,
    signal?.url,
    signal?.canonicalUrl,
  ].filter(Boolean).join(' ')));
}

function isBrokenTopic(topic) {
  const sourceUrl = getPrimarySourceUrl(topic);
  const text = topicText(topic);
  if (!sourceUrl) return true;
  if (!String(topic.title ?? '').trim()) return true;
  return /読み込み失敗|リンクなし|整理中です/.test(text);
}

function isSpamTopic(topic) {
  return /(pr times|共同通信prワイヤー|valuepress|＠press|atpress|dream news|ドリームニュース|newscast|プレスリリース|スポンサー|タイアップ|広告)/i.test(topicText(topic));
}

function isForeignTopic(topic) {
  const locale = String(
    topic?.language
      ?? topic?.lang
      ?? topic?.locale
      ?? topic?.sourceSignals?.[0]?.language
      ?? topic?.sourceSignals?.[0]?.locale
      ?? ''
  ).toLowerCase();
  if (locale && !/(^ja\b|japan|ja-jp)/.test(locale)) return true;

  const host = topicSourceHost(topic);
  if (/bbc\.com$|bbc\.co\.uk$|cnn\.com$|reuters\.com$/.test(host)) return true;

  const text = `${topic.title ?? ''} ${topic.summary ?? ''} ${topic.briefSummary ?? ''}`.replace(/\s+/g, '');
  const japaneseCount = (text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  return Boolean(text) && japaneseCount < Math.max(8, Math.floor(latinCount * 0.35));
}

function topicSourceHost(topic) {
  const candidates = [
    getPrimarySourceUrl(topic),
    ...(Array.isArray(topic?.sourceSignals) ? topic.sourceSignals.map((signal) => signal?.url) : []),
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (!value) continue;
    try {
      return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    } catch {}
  }
  return '';
}

function isAiText(value) {
  return /(?:^|[^a-z])ai(?:[^a-z]|$)|生成ai|chatgpt|openai|claude|gemini|llm/i.test(value);
}

function topicRecencyScore(topic) {
  const dateValue = topic.sourceSignals?.[0]?.publishedAt ?? topic.publishedAt ?? topic.capturedAt ?? latestTrendGeneratedAt;
  if (!dateValue) return 0;
  const time = new Date(dateValue).getTime();
  if (Number.isNaN(time)) return 0;
  const ageHours = Math.max(0, (Date.now() - time) / (1000 * 60 * 60));
  if (ageHours <= 2) return 18;
  if (ageHours <= 6) return 14;
  if (ageHours <= 12) return 10;
  if (ageHours <= 24) return 6;
  return 0;
}

function isTrendTopicFresh(topic) {
  const dateValue = topic.sourceSignals?.[0]?.publishedAt ?? topic.publishedAt ?? topic.capturedAt ?? latestTrendGeneratedAt;
  if (!dateValue) return true;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() <= TREND_FRESHNESS_HOURS * 60 * 60 * 1000;
}

function isTrendTopicWithinDays(topic, days) {
  const dateValue = topic.sourceSignals?.[0]?.publishedAt ?? topic.publishedAt ?? topic.capturedAt ?? latestTrendGeneratedAt;
  if (!dateValue) return true;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function topicTimestamp(topic) {
  const dateValue = topic.sourceSignals?.[0]?.publishedAt ?? topic.publishedAt ?? topic.capturedAt ?? latestTrendGeneratedAt;
  const timestamp = new Date(dateValue ?? '').getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function selectTopTrendTopics(topics) {
  const sorted = [...topics].sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const freshItems = sorted.filter((topic) => isTrendTopicFresh(topic));
  if (freshItems.length >= TREND_MIN_ITEMS) return freshItems;
  const fallbackItems = sorted.filter((topic) => isTrendTopicWithinDays(topic, TREND_TOPUP_DAYS));
  return [...new Map([...freshItems, ...fallbackItems].map((topic) => [topic.id, topic])).values()].slice(0, TREND_MIN_ITEMS);
}

function normalizeCategories(categories, fallbackCategory) {
  const values = Array.isArray(categories) ? categories : [];
  const merged = [...new Set([fallbackCategory, ...values].filter(Boolean))];
  return merged.length ? merged : ['general'];
}

function showRefreshStatus(message) {
  const element = document.querySelector('#refresh-status');
  if (!element) return;
  element.textContent = message;
  clearTimeout(refreshStatusTimer);
  refreshStatusTimer = window.setTimeout(() => {
    element.textContent = '最新データを自動で確認中';
  }, 2200);
}

function formatAbsoluteDate(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '不明';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function buildAdultRouteId(item) {
  const raw = [
    item?.sourceKey,
    item?.sourceName ?? item?.source,
    item?.sourceUrl,
    item?.title,
    item?.rank,
  ].filter(Boolean).join('::');
  return slugifyAdultRoutePart(raw || String(item?.id ?? 'adult-topic'));
}

function slugifyAdultRoutePart(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[【】「」『』"'“”]/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'adult-topic';
}

function saveHomeTopicCache(topics) {
  try {
    localStorage.setItem('internet-news-home-topic-cache-v1', JSON.stringify(topics ?? []));
  } catch {}
}

function loadHomeTopicCache() {
  try {
    const cached = JSON.parse(localStorage.getItem('internet-news-home-topic-cache-v1') ?? '[]');
    return Array.isArray(cached) ? cached.map(normalizeTrendTopic) : [];
  } catch {
    return [];
  }
}

function saveBriefCache(items) {
  try {
    sessionStorage.setItem('internet-news-daily-brief-cache', JSON.stringify(items ?? []));
  } catch {}
}

function loadBriefCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem('internet-news-daily-brief-cache') ?? '[]');
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

function saveEventCache(items) {
  try {
    sessionStorage.setItem('internet-news-event-cache', JSON.stringify(items ?? []));
  } catch {}
}

function loadEventCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem('internet-news-event-cache') ?? '[]');
    return Array.isArray(cached) ? cached.map(normalizeEventItem) : [];
  } catch {
    return [];
  }
}

function saveAdultTrendCache(items) {
  try {
    sessionStorage.setItem('internet-news-adult-trend-cache', JSON.stringify(items ?? []));
  } catch {}
}

function loadAdultTrendCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem('internet-news-adult-trend-cache') ?? '[]');
    return Array.isArray(cached) ? cached.map(normalizeAdultTrendItem) : [];
  } catch {
    return [];
  }
}

async function fetchJsonWithCache({ cacheKey, endpoints, ttlMs }) {
  const cached = readSessionPayload(cacheKey, ttlMs);
  if (cached?.state === 'fresh') {
    perfMetrics.fetches.push({ cacheKey, source: 'session:fresh', bytes: JSON.stringify(cached.payload).length });
    return cached.payload;
  }
  const stalePayload = cached?.state === 'stale' ? cached.payload : null;

  for (const endpoint of endpoints) {
    try {
      const fetchStartedAt = performance.now();
      const response = await fetch(endpoint, { cache: 'default' });
      if (!response.ok) continue;
      const payload = await response.json();
      perfMetrics.fetches.push({
        cacheKey,
        source: endpoint,
        durationMs: performance.now() - fetchStartedAt,
        bytes: JSON.stringify(payload).length,
      });
      writeSessionPayload(cacheKey, payload);
      return payload;
    } catch {
      continue;
    }
  }

  if (stalePayload) {
    perfMetrics.fetches.push({ cacheKey, source: 'session:stale', bytes: JSON.stringify(stalePayload).length });
    return stalePayload;
  }
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
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {}
}

document.querySelectorAll('.filter-pills button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter-pills button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    renderTrends(button.dataset.filter);
  });
});

if (trendLoadMoreTopButton) {
  trendLoadMoreTopButton.addEventListener('click', () => {
    window.location.href = './news.html';
  });
}

if (trendLoadMoreBottomButton) {
  trendLoadMoreBottomButton.addEventListener('click', () => {
    trendVisibleCount += TREND_LOAD_MORE_STEP;
    renderTrends(activeTrendFilter, { preserveCount: true });
  });
}

if (featuredEventTabsElement) {
  featuredEventTabsElement.addEventListener('click', (event) => {
    const button = event.target.closest('[data-event-tab]');
    if (!(button instanceof HTMLButtonElement)) return;
    const nextTab = button.dataset.eventTab;
    if (!nextTab || nextTab === activeEventTab) return;
    activeEventTab = nextTab;
    renderFeaturedEvents();
  });
}

if (topicChannelTabsElement) {
  topicChannelTabsElement.addEventListener('click', (event) => {
    const button = event.target.closest('[data-topic-tab]');
    if (!(button instanceof HTMLButtonElement)) return;
    const nextKey = button.dataset.topicTab;
    if (!nextKey || nextKey === activeTopicChannelKey) return;
    activeTopicChannelKey = nextKey;
    renderTopicChannels(visibleTrendTopics.length ? visibleTrendTopics : trendTopics);
  });
}

if (trendSectionToggleButton && trendSectionBody) {
  trendSectionToggleButton.addEventListener('click', () => {
    const isExpanded = trendSectionToggleButton.getAttribute('aria-expanded') !== 'false';
    trendSectionToggleButton.setAttribute('aria-expanded', String(!isExpanded));
    trendSectionToggleButton.textContent = isExpanded ? '開く' : '畳む';
    trendSectionBody.hidden = isExpanded;
  });
}

if (dailyBriefToggleButton && dailyBriefBody) {
  dailyBriefToggleButton.addEventListener('click', () => {
    const isExpanded = dailyBriefToggleButton.getAttribute('aria-expanded') !== 'false';
    dailyBriefToggleButton.setAttribute('aria-expanded', String(!isExpanded));
    dailyBriefToggleButton.textContent = isExpanded ? '開く' : '畳む';
    dailyBriefBody.hidden = isExpanded;
  });
}

if (mobileMenuButton && mobileNavDrawer) {
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
