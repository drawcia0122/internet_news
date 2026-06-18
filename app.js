const {
  categoryDisplayLabel,
  categoryLabelFor,
  decodeHtmlEntities,
  dedupeTopics,
  escapeHtml,
  getPrimarySourceLabel,
  getPrimarySourceUrl,
  hasCategory,
  hasVisibleSummary,
  isWeakThumbnailUrl,
  pickCardImageUrl,
} = window.TopicClientUtils;
const {
  normalizeEventDateValue,
  calculateEventScore,
  calculateClosingSoonScore,
  buildEventRecommendationReasons,
  eventStatusLabel,
  formatEventPeriod,
  getEventItemsForTab: getEventItemsForTabFromList,
  getTodayDate,
  isEventOngoing,
  isEventClosingSoon,
  isLongRunningEvent,
  isCurrentMonthLimited,
  getEventDaysUntilEnd,
} = window.HomeEventUtils;
const {
  setLatestTrendGeneratedAt,
  prepareVisibleTrendTopics,
  selectPersonalNews,
  selectInternetNews,
  selectCategoryTopics,
  calculatePersonalFit,
  isAiTopic,
  isDealsTopic,
  isSnsOrNetTopic,
  isWorldTopic,
  buildTrendInsights,
  shortEventFromTitle,
  buildWhyHotLabel,
  buildImportantPoint,
  buildTargetAudience,
  hotTopicScore,
  trimMetaText,
  categoryShowcaseScore,
  isAdultContentTopic,
  isDoujinEventOnlyTopic,
  isLowPriorityTopic,
  topicRecencyScore,
  isTrendTopicFresh,
  isTrendTopicWithinDays,
  topicTimestamp,
  topicText,
  personalSourceAffinityScore,
} = window.HomeTopicSelectionUtils;
const {
  selectTodayNews,
  isAdultBriefItem,
  todayNewsRank,
  briefItemText,
  briefPublishedAt,
  formatBriefTimelineTime,
  formatRelativeTime,
  sanitizeBriefSummaryText,
} = window.HomeBriefUtils;
const {
  buildTrendCardThumb,
  renderTrendReasonList,
  renderTopicClusterCard: renderTopicClusterCardHtml,
  renderBriefCard,
  renderPriorityCard,
} = window.HomeRenderUtils;
const {
  createStorageArrayCache,
  fetchJsonWithCache,
} = window.HomeDataUtils;

let trendTopics = [];
let archiveTopics = [];
let archiveTotalTopicCount = 0;
let archiveHasMorePages = false;
let archiveNextPage = 0;
let archivePageLoadPromise = null;
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

const TREND_TOPUP_DAYS = 3;
const TREND_MIN_ITEMS = 8;
const TREND_HOME_LIMIT = 20;
const TREND_LOAD_MORE_STEP = 10;
const PERSONAL_NEWS_LIMIT = 10;
const MUST_READ_LIMIT = 10;
const TODAY_NEWS_LIMIT = 10;
const TOPIC_WORKING_SET_LIMIT = 96;
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const ADULT_HOME_LIMIT = 20;
const EVENT_TAB_DEFINITIONS = [
  { key: 'closingSoon', label: '🔥もうすぐ終了', emptyTitle: '終了間近のイベントを整理中です', emptyText: '終了まで14日以内の開催中イベントをここに表示します。' },
  { key: 'ongoing', label: '開催中', emptyTitle: '開催中のイベントを整理中です', emptyText: '今行けるイベントが入り次第ここに表示します。' },
  { key: 'thisMonth', label: '今月', emptyTitle: '今月のイベントを整理中です', emptyText: '今月中に行けるイベントを整理しています。' },
  { key: 'nextMonth', label: '来月', emptyTitle: '来月のイベントを整理中です', emptyText: '来月開催のイベントを収集中です。' },
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
const renderHelperDeps = {
  escapeHtml,
  isWeakThumbnailUrl,
  shortEventFromTitle,
  buildWhyHotLabel,
  getPrimarySourceUrl,
  getPrimarySourceLabel,
  categoryDisplayLabel,
  hotTopicScore,
  buildImportantPoint,
  trimMetaText,
  formatBriefTimelineTime,
  sanitizeBriefSummaryText,
};
const homeTopicCacheStore = createStorageArrayCache({
  storage: localStorage,
  key: 'internet-news-home-topic-cache-v2',
  normalize: normalizeTrendTopic,
});
const briefCacheStore = createStorageArrayCache({
  storage: sessionStorage,
  key: 'internet-news-daily-brief-cache-v2',
  normalize: (item) => item,
});
const eventCacheStore = createStorageArrayCache({
  storage: sessionStorage,
  key: 'internet-news-event-cache-v2',
  normalize: normalizeEventItem,
});
const adultTrendCacheStore = createStorageArrayCache({
  storage: sessionStorage,
  key: 'internet-news-adult-trend-cache-v2',
  normalize: normalizeAdultTrendItem,
});

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
trendTopics = homeTopicCacheStore.load();
visibleTrendTopics = prepareVisibleTrendTopics(trendTopics);
setLatestTrendGeneratedAt(latestTrendGeneratedAt);
dailyBriefItems = briefCacheStore.load();
eventItems = eventCacheStore.load();
renderDailyBrief();
renderFeaturedEvents();
renderDiscoverySections();
deferredTrendRendered = true;
renderTrends(activeTrendFilter);
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

  const tasks = [loadTrendTopics(), loadDailyBrief(), loadEventItems(), loadNewsArchive()];
  const shouldRefreshArchive = true;
  if (hasAdultTrendSection) {
    tasks.push(loadAdultTrends());
  }
  const results = await Promise.all(tasks);
  const trendStatus = results[0];
  const briefStatus = results[1];
  const eventStatus = results[2];
  const archiveStatus = shouldRefreshArchive
    ? results[3]
    : { ok: true, count: archiveTopics.length, error: null };
  const adultStatus = hasAdultTrendSection
    ? results[shouldRefreshArchive ? 4 : 3]
    : { ok: true, count: 0, error: null };
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
    const shouldSupplementTopics = currentTopics.length === 0;
    const supplementalPayload = shouldSupplementTopics
      ? await fetchTrendTopicsPayload().catch(() => null)
      : null;
    console.timeEnd('home:fetch-topics');
    const supplementalTopics = Array.isArray(supplementalPayload?.items) ? supplementalPayload.items : [];
    latestTrendGeneratedAt = currentPayload?.generatedAt ?? supplementalPayload?.generatedAt ?? null;
    setLatestTrendGeneratedAt(latestTrendGeneratedAt);
    const mergedTopics = dedupeTopics([
      ...currentTopics.map(normalizeTrendTopic),
      ...supplementalTopics.map(normalizeTrendTopic),
    ]);
    trendTopics = sanitizeTopicCollectionThumbnails(mergedTopics)
      .sort((left, right) => hotTopicScore(right) - hotTopicScore(left) || topicTimestamp(right) - topicTimestamp(left));
  } catch (error) {
    errorMessage = error?.message || '取得エラー';
    latestTrendGeneratedAt = null;
    setLatestTrendGeneratedAt(latestTrendGeneratedAt);
    trendTopics = [];
  }

  homeTopicCacheStore.save(trendTopics);
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

  briefCacheStore.save(dailyBriefItems);
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
    const payload = await fetchHomeNewsInitialPayload();
    applyArchivePayload(payload, { append: false });
  } catch (error) {
    errorMessage = error?.message || '取得エラー';
    archiveTopics = [];
    archiveTotalTopicCount = 0;
    archiveHasMorePages = false;
    archiveNextPage = 0;
  }

  renderDiscoverySections();
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

  eventCacheStore.save(eventItems);
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

  adultTrendCacheStore.save(adultTrendItems);
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
    onFetchMetric: (metric) => perfMetrics.fetches.push(metric),
  });
}

async function fetchTrendTopicsPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'trend-topics-full',
    endpoints: ['./data/trend-topics.json'],
    onFetchMetric: (metric) => perfMetrics.fetches.push(metric),
  });
}

async function fetchHomeNewsInitialPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'home-news-initial',
    endpoints: ['./data/home-news.json', './data/news-archive.json'],
    onFetchMetric: (metric) => perfMetrics.fetches.push(metric),
  });
}

async function fetchHomeNewsPagePayload(pageNumber) {
  return await fetchJsonWithCache({
    cacheKey: `home-news-page-${pageNumber}`,
    endpoints: [`./data/home-news-page-${pageNumber}.json`],
    onFetchMetric: (metric) => perfMetrics.fetches.push(metric),
  });
}

function applyArchivePayload(payload, { append = false } = {}) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const normalizedItems = rawItems.map(normalizeTrendTopic);
  const nextItems = append ? dedupeTopics([...archiveTopics, ...normalizedItems]) : dedupeTopics(normalizedItems);
  archiveTopics = sanitizeTopicCollectionThumbnails(nextItems)
    .sort((left, right) => topicTimestamp(right) - topicTimestamp(left) || hotTopicScore(right) - hotTopicScore(left));
  archiveTotalTopicCount = Math.max(
    archiveTopics.length,
    Number(payload?.totalCount ?? payload?.maxItems ?? rawItems.length ?? 0),
  );
  archiveNextPage = Number(payload?.nextPage ?? 0) || 0;
  archiveHasMorePages = Boolean(payload?.hasMore) || archiveNextPage > 0;
}

async function loadMoreArchiveTopicsIfNeeded(minFilteredCount = trendVisibleCount + TREND_LOAD_MORE_STEP) {
  while (archiveHasMorePages) {
    const currentFilteredCount = getFilteredTrendItems(activeTrendFilter).length;
    if (currentFilteredCount >= minFilteredCount) break;
    if (archivePageLoadPromise) {
      await archivePageLoadPromise;
      continue;
    }
    const pageNumber = archiveNextPage;
    if (!pageNumber) {
      archiveHasMorePages = false;
      break;
    }
    archivePageLoadPromise = (async () => {
      try {
        const payload = await fetchHomeNewsPagePayload(pageNumber);
        applyArchivePayload(payload, { append: true });
      } catch {
        archiveHasMorePages = false;
        archiveNextPage = 0;
      }
    })();
    try {
      await archivePageLoadPromise;
    } finally {
      archivePageLoadPromise = null;
    }
  }
}

async function fetchDailyBriefPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'daily-brief',
    endpoints: ['./data/daily-brief.json'],
    onFetchMetric: (metric) => perfMetrics.fetches.push(metric),
  });
}

async function fetchEventsPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'featured-events',
    endpoints: ['./data/events.json'],
    onFetchMetric: (metric) => perfMetrics.fetches.push(metric),
  });
}

async function fetchAdultTrendsPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'adult-trends',
    endpoints: ['./data/adult-trends.json'],
    onFetchMetric: (metric) => perfMetrics.fetches.push(metric),
  });
}

function normalizeTrendTopic(topic) {
  const decodedSourceSignals = Array.isArray(topic.sourceSignals)
    ? topic.sourceSignals.map((signal) => ({
      ...signal,
      title: decodeHtmlEntities(signal?.title ?? ''),
      summary: decodeHtmlEntities(signal?.summary ?? ''),
      sourceName: decodeHtmlEntities(signal?.sourceName ?? ''),
      source: decodeHtmlEntities(signal?.source ?? ''),
    }))
    : [];
  const categories = normalizeCategories(topic.categories, topic.category);
  const normalizedCategories = categories.map(normalizeLegacyCategory);
  const uniqueCategories = [...new Set(normalizedCategories)];
  const category = uniqueCategories[0] ?? 'general';
  const labelSource = topic.categoryLabels;
  const hasLegacyLabel = Array.isArray(labelSource) && labelSource.some((label) => label === 'ネタ');
  return enrichTrendTopic({
    ...topic,
    title: decodeHtmlEntities(topic.title ?? ''),
    summary: decodeHtmlEntities(topic.summary ?? ''),
    briefSummary: decodeHtmlEntities(topic.briefSummary ?? ''),
    category,
    categories: uniqueCategories,
    categoryLabel: decodeHtmlEntities(normalizeLegacyCategoryLabel(topic.categoryLabel, category)),
    categoryLabels: Array.isArray(labelSource) && labelSource.length
      ? (hasLegacyLabel ? labelSource.filter((label) => label !== 'ネタ') : labelSource).map((label) => decodeHtmlEntities(label))
      : uniqueCategories.map(categoryLabelFor),
    metricLabel: topic.metricLabel ?? 'source',
    thumbnailUrl: pickCardImageUrl(topic),
    searchLinks: Array.isArray(topic.searchLinks) ? topic.searchLinks : [],
    sourceSignals: decodedSourceSignals,
  });
}

function enrichTrendTopic(topic) {
  const personal = calculatePersonalFit(topic);
  const insights = buildTrendInsights(topic, personal);
  return {
    ...topic,
    personalScore: Number(topic.personalScore ?? personal.score),
    personalReasons: Array.isArray(topic.personalReasons) && topic.personalReasons.length ? topic.personalReasons : personal.reasons,
    whatHappened: decodeHtmlEntities(topic.whatHappened ?? insights.whatHappened),
    whyHot: decodeHtmlEntities(topic.whyHot ?? insights.whyHot),
    importantPoint: decodeHtmlEntities(topic.importantPoint ?? insights.importantPoint),
    futureOutlook: decodeHtmlEntities(topic.futureOutlook ?? insights.futureOutlook),
    targetAudience: (Array.isArray(topic.targetAudience) && topic.targetAudience.length ? topic.targetAudience : insights.targetAudience).map((value) => decodeHtmlEntities(value)),
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

  const filtered = getFilteredTrendItems(filter);

  if (!filtered.length) {
    if (archiveHasMorePages && archiveTopics.length) {
      void loadMoreArchiveTopicsIfNeeded(1).then(() => renderTrends(filter, { preserveCount: true }));
    }
    const freshnessLabel = latestTrendGeneratedAt ? '最終生成: ' + formatAbsoluteDate(latestTrendGeneratedAt) : 'まだ最新データを取得できていません';
    trendListElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>最近話題のトピックを収集中です</strong><p>' + escapeHtml(freshnessLabel) + '</p></div>';
    updateTrendLoadMoreButtons(0, 0);
    console.timeEnd('home:render-trends');
    return;
  }

  const limited = filtered.slice(0, trendVisibleCount);
  const cards = limited.map((trend, index) => {
    const sourceUrl = getPrimarySourceUrl(trend);
    const sourceLabel = getPrimarySourceLabel(trend);
    const hasThumbnail = Boolean(trend.thumbnailUrl);
    const thumb = hasThumbnail ? buildTrendCardThumb(trend.thumbnailUrl, renderHelperDeps) : '';
    const scoreSummary = trend.scoreSummary ? '<div class="trend-score-summary">' + escapeHtml(trend.scoreSummary) + '</div>' : '';
    const summaryHtml = hasVisibleSummary(trend.summary) ? '<p>' + escapeHtml(trend.summary ?? '') + '</p>' : '';
    const insightHtml = renderTrendReasonList(trend, renderHelperDeps);
    return '<article class="' + escapeHtml('trend-card trend-card-rich ' + (hasThumbnail ? 'has-thumb' : 'trend-card-no-thumb')) + '" style="animation-delay:' + (index * 70) + 'ms">' +
      thumb +
      '<div><div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(trend)) + '</span><time>' + escapeHtml(trend.time ?? '直近') + '</time></div>' +
      '<h3>' + escapeHtml(trend.title ?? 'ニュース') + '</h3>' +
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

function getTrendListItems() {
  const sourceItems = archiveTopics.length ? archiveTopics : trendTopics;
  return sourceItems.filter((topic) => isTrendListEligibleTopic(topic));
}

function getFilteredTrendItems(filter = activeTrendFilter) {
  return getTrendListItems()
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
}

function updateTrendLoadMoreButtons(visibleCount, totalCount) {
  const hasMore = totalCount > visibleCount || archiveHasMorePages;
  if (trendLoadMoreBottomButton) {
    trendLoadMoreBottomButton.hidden = !hasMore;
    trendLoadMoreBottomButton.disabled = !hasMore;
    trendLoadMoreBottomButton.textContent = hasMore
      ? (archiveHasMorePages ? `もっと表示 (${visibleCount}件表示中)` : `もっと表示 (${visibleCount}/${totalCount})`)
      : 'すべて表示中';
  }
  if (trendLoadMoreTopButton) {
    trendLoadMoreTopButton.hidden = false;
    trendLoadMoreTopButton.disabled = false;
    trendLoadMoreTopButton.textContent = '一覧ページへ';
  }
}

function renderDiscoverySections() {
  console.time('home:render-discovery');
  const topics = archiveTopics.length
    ? dedupeTopics([...trendTopics, ...archiveTopics])
    : visibleTrendTopics;
  const internetNews = selectInternetNews(topics);
  const personalNews = selectPersonalNews(topics, { excludedIds: new Set(internetNews.map((topic) => topic.id)), limit: PERSONAL_NEWS_LIMIT });
  pickedTopicIds = new Set([...internetNews, ...personalNews].map((topic) => topic.id).filter(Boolean));
  const todayNewsFallback = buildTodayNewsFallbackItems(topics);
  const todayNews = selectTodayNews([...dailyBriefItems, ...todayNewsFallback], { limit: TODAY_NEWS_LIMIT });
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

function buildTodayNewsFallbackItems(topics) {
  return topics
    .filter((topic) => isTrendListEligibleTopic(topic))
    .filter((topic) => ['crime', 'politics', 'business', 'world', 'sports', 'entertainment', 'general'].some((category) => hasCategory(topic, category)))
    .filter((topic) => {
      const text = topicText(topic);
      if (/(ポケモン|pokemon|任天堂|nintendo|switch|steam|漫画|マンガ|アニメ|ゲーム|セール|炎上|ミーム|ネット文化|同人|はてブ|togetter|xで話題|itmedia|nature|インフルエンサー|配信者|youtube|sns)/i.test(text)) return false;
      if (hasCategory(topic, 'sns') || hasCategory(topic, 'net-culture') || hasCategory(topic, 'matome') || hasCategory(topic, 'tech')) return false;
      return /(事件|事故|逮捕|起訴|判決|地震|台風|大雨|避難|火災|クマ|通行止め|交通|スポーツ|芸能|結婚|出産|受賞|開業|再開|制度|行政|生活|健康|国際|経済|物価|株価|金利|銀行|免許|カード)/.test(text);
    })
    .slice(0, 120)
    .map((topic) => ({
      id: `topic-fallback-${topic.id ?? topic.title ?? Math.random()}`,
      title: topic.title ?? 'ニュース',
      categoryLabel: categoryDisplayLabel(topic),
      publishedAt: topic.sourceSignals?.[0]?.publishedAt ?? topic.publishedAt ?? topic.capturedAt ?? '',
      publishedLabel: topic.time ?? '',
      thumbnailUrl: topic.thumbnailUrl ?? '',
      thirtySecondSummary: topic.summary ?? topic.whatHappened ?? '',
      watchpoints: topic.importantPoint ?? '',
      primaryLink: {
        url: getPrimarySourceUrl(topic),
        label: getPrimarySourceLabel(topic),
      },
    }));
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
  return getEventItemsForTabFromList(eventItems, tabKey);
}

function buildClosingSoonBadge(item) {
  const remainingDays = getEventDaysUntilEnd(item);
  if (remainingDays == null || remainingDays < 0 || remainingDays > 14 || !isEventOngoing(item, getTodayDate())) return '';
  const label = remainingDays === 0 ? '今日終了' : `あと${remainingDays}日`;
  return '<span class="event-closing-badge">' + escapeHtml(label) + '</span>';
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


function renderBriefCardList(element, items, options = {}) {
  if (!element) return;
  if (!items.length) {
    element.innerHTML = '<article class="topic-cluster-card topic-cluster-card-empty"><strong>' + escapeHtml(options.emptyTitle ?? 'ニュースを整理中です') + '</strong><p>' + escapeHtml(options.emptyText ?? '最新データを確認しています。') + '</p></article>';
    return;
  }

  replaceChildrenFromHtml(element, items.map((item, index) => renderBriefCard(item, index, options, renderHelperDeps)));
}

function renderPriorityList(element, topics, options) {
  if (!element) return;
  if (!topics.length) {
    element.innerHTML = '<article class="priority-card priority-card-empty"><strong>' + escapeHtml(options.emptyTitle) + '</strong><p>' + escapeHtml(options.emptyText) + '</p></article>';
    return;
  }

  const cards = topics.map((topic, index) => renderPriorityCard(topic, index, options, renderHelperDeps));
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
  return renderTopicClusterCardHtml(topic, options, renderHelperDeps);
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
    const thumbnail = item.thumbnailUrl ? buildTrendCardThumb(item.thumbnailUrl, renderHelperDeps) : '';
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
    trendListElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>通常ニュースを整理中です</strong><p>保存済みニュースから表示対象を読み込んでいます。</p></div>';
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
  void (async () => {
    if (!archiveTopics.length) {
      await loadNewsArchive();
    }
    renderTrends(activeTrendFilter);
    recordPerfCount('after-trends');
  })();
}

function revealDeferredTopicChannels() {
  if (deferredTopicChannelsRendered) return;
  deferredTopicChannelsRendered = true;
  renderTopicChannels(visibleTrendTopics.length ? visibleTrendTopics : trendTopics);
  recordPerfCount('after-topic-channels');
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
  return /読み込み失敗|リンクなし|整理中です|&#x[0-9a-f]+;|&#\d+;|&amp;#/.test(String(topic.title ?? '') + ' ' + String(topic.summary ?? '') + ' ' + text);
}

function isSpamTopic(topic) {
  const host = topicSourceHost(topic);
  return /(pr times|共同通信prワイヤー|valuepress|＠press|atpress|dream news|ドリームニュース|newscast|プレスリリース|スポンサー|タイアップ|広告|中古品)/i.test(topicText(topic))
    || /\.(?:org|xyz|top|site)$/i.test(host)
    || /cfecgc-orange\.org|mercari|ラクマ|paypayフリマ/i.test(host + ' ' + topicText(topic));
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
  if (/bbc\.com$|bbc\.co\.uk$|cnn\.com$|reuters\.com$|telegram\.org$/.test(host)) return true;

  const text = `${topic.title ?? ''} ${topic.summary ?? ''} ${topic.briefSummary ?? ''}`.replace(/\s+/g, '');
  const japaneseCount = (text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  return Boolean(text) && (japaneseCount < Math.max(8, Math.floor(latinCount * 0.35)) || (latinCount >= 24 && japaneseCount <= 4));
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

function sanitizeTopicCollectionThumbnails(topics) {
  return topics.map((topic) => {
    const thumbnailUrl = String(topic?.thumbnailUrl ?? '').trim();
    const shouldDropThumbnail = isWeakThumbnailUrl(thumbnailUrl);
    if (!shouldDropThumbnail) return topic;
    return {
      ...topic,
      thumbnailUrl: null,
      thumbnail: null,
      sourceSignals: Array.isArray(topic.sourceSignals)
        ? topic.sourceSignals.map((signal) => ({
          ...signal,
          thumbnailUrl: signal?.thumbnailUrl ?? null,
          thumbnail: signal?.thumbnail ?? null,
        }))
        : [],
    };
  });
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
  trendLoadMoreBottomButton.addEventListener('click', async () => {
    await loadMoreArchiveTopicsIfNeeded(trendVisibleCount + TREND_LOAD_MORE_STEP);
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
