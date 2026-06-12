let trendTopics = [];
let latestTrendGeneratedAt = null;
let dailyBriefItems = [];
let adultTrendItems = [];
let lastRefreshStartedAt = 0;
let visibleTrendTopics = [];
let deferredTopicChannelsRendered = false;

const hotPrimaryElement = document.querySelector('#hot-battle-keywords');
const hotCategoryElement = document.querySelector('#hot-general-keywords');
const rankingPrimaryElement = document.querySelector('#ranking-battle-list');
const rankingCategoryElement = document.querySelector('#ranking-general-list');
const trendListElement = document.querySelector('#trend-list');
const hotSectionElement = document.querySelector('#hot-network');
const trendSectionElement = document.querySelector('#trends');
const personalNewsListElement = document.querySelector('#personal-news-list');
const mustReadNewsListElement = document.querySelector('#must-read-news-list');
const topicChannelPrimaryListElement = document.querySelector('#topic-channel-primary-list');
const topicChannelDeferredListElement = document.querySelector('#topic-channel-deferred-list');
const topicChannelsSectionElement = document.querySelector('#topic-channels');
const dailyBriefListElement = document.querySelector('#daily-brief-list');
const mobileMenuButton = document.querySelector('#mobile-menu-button');
const mobileNavDrawer = document.querySelector('#mobile-nav-drawer');
const dailyBriefToggleButton = document.querySelector('#daily-brief-toggle');
const dailyBriefBody = document.querySelector('#daily-brief-body');
const trendSectionToggleButton = document.querySelector('#trend-section-toggle');
const trendSectionBody = document.querySelector('#trend-section-body');
const adultTrendListElement = document.querySelector('#adult-trend-list');
const adultFilterPillsElement = document.querySelector('#adult-filter-pills');
const hasAdultTrendSection = Boolean(adultTrendListElement);

const TREND_FRESHNESS_HOURS = 24;
const TREND_TOPUP_DAYS = 3;
const TREND_MIN_ITEMS = 8;
const TREND_HOME_LIMIT = 10;
const PERSONAL_NEWS_LIMIT = 10;
const MUST_READ_LIMIT = 6;
const TOPIC_WORKING_SET_LIMIT = 48;
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const HOME_TOPIC_CACHE_TTL_MS = 90 * 1000;
const ARCHIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const DAILY_BRIEF_CACHE_TTL_MS = 90 * 1000;
const ADULT_TREND_CACHE_TTL_MS = 90 * 1000;
const ADULT_HOME_LIMIT = 20;
const GENERIC_TOPIC_TOKENS = new Set(['速報', '公開', '発表', '開始', '決定', '話題', '最新', '本日', 'きょう', '今日', '判明', '疑惑', '意見']);
const PERSONAL_INTEREST_RULES = [
  { label: 'ポケモン関連', pattern: /ポケモン|pokemon|ポケカ|pokémon/i, score: 26 },
  { label: 'ゲーム関連', pattern: /ゲーム|任天堂|nintendo|switch|steam|ps5|xbox|モンハン|マリオ|ゼルダ/i, score: 22 },
  { label: 'AI関連', pattern: /ai|生成ai|chatgpt|openai|claude|gemini|llm/i, score: 24 },
  { label: 'ガジェット関連', pattern: /iphone|android|スマホ|ガジェット|pc|gpu|nvidia|apple|google/i, score: 18 },
  { label: 'セール情報', pattern: /セール|割引|キャンペーン|クーポン|ポイント還元|steamセール|fanza|dlsite/i, score: 22 },
  { label: 'ネット文化', pattern: /sns|xで話題|twitter|炎上|バズ|ミーム|ネット文化|reddit|bluesky/i, score: 18 },
  { label: '漫画・アニメ', pattern: /漫画|マンガ|アニメ|ジャンプ|コミック|声優|映画化|アニメ化/i, score: 16 },
  { label: '個人開発・収益化', pattern: /個人開発|副業|収益化|アフィリエイト|広告収入|saas|開発者/i, score: 20 },
];
let activeTrendFilter = 'all';
let activeAdultFilter = 'all';
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
renderDailyBrief();
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

  const tasks = [loadTrendTopics(), loadDailyBrief()];
  if (hasAdultTrendSection) {
    tasks.push(loadAdultTrends());
  }
  const results = await Promise.all(tasks);
  const trendStatus = results[0];
  const briefStatus = results[1];
  const adultStatus = hasAdultTrendSection ? results[2] : { ok: true, count: 0, error: null };
  if (silent) return;

  if (!trendStatus.ok && !briefStatus.ok && !adultStatus.ok) {
    if (isFileProtocol) {
      showRefreshStatus('取得失敗: file:// では起動すると JSON が読めません。必ず http://localhost:8000 で開いてください');
      return;
    }
    const reason = `${trendStatus.error ?? 'trend'} / ${briefStatus.error ?? 'brief'}${hasAdultTrendSection ? ` / ${adultStatus.error ?? 'adult'}` : ''}`;
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
    console.timeEnd('home:fetch-topics');
    const currentTopics = Array.isArray(currentPayload?.items) ? currentPayload.items : [];
    latestTrendGeneratedAt = currentPayload?.generatedAt ?? null;
    trendTopics = selectTopTrendTopics(currentTopics.map(normalizeTrendTopic));
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

async function loadAdultTrends() {
  let errorMessage = null;
  try {
    const payload = await fetchAdultTrendsPayload();
    adultTrendItems = Array.isArray(payload?.items) ? payload.items.map(normalizeAdultTrendItem) : [];
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

async function fetchTrendArchivePayload() {
  return await fetchJsonWithCache({
    cacheKey: 'trend-topics-archive',
    endpoints: ['./data/trend-topics-archive.json', './data/trend-topics.json'],
    ttlMs: ARCHIVE_CACHE_TTL_MS,
  });
}

async function fetchDailyBriefPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'daily-brief',
    endpoints: ['./data/daily-brief.json'],
    ttlMs: DAILY_BRIEF_CACHE_TTL_MS,
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

function categoryLabelFor(category) {
  if (category === 'general') return 'その他';
  if (category === 'tech') return 'テック';
  if (category === 'business') return '経済';
  if (category === 'politics') return '政治';
  if (category === 'entertainment') return 'エンタメ';
  if (category === 'games') return 'ゲーム';
  if (category === 'manga') return '漫画';
  if (category === 'books') return '本';
  if (category === 'sports') return 'スポーツ';
  if (category === 'sns') return 'SNS';
  if (category === 'net-culture') return 'ネットカルチャー';
  if (category === 'matome') return '2chまとめ系';
  if (category === 'crime') return '犯罪・事件';
  if (category === 'adult') return 'アダルト系';
  if (category === 'world') return '国際';
  return '総合';
}

function normalizeAdultTrendItem(item) {
  const categories = Array.isArray(item.categories) && item.categories.length ? item.categories : [item.category ?? 'industry'];
  return {
    ...item,
    routeId: buildAdultRouteId(item),
    categories: [...new Set(categories.filter(Boolean))],
    categoryLabels: Array.isArray(item.categoryLabels) && item.categoryLabels.length ? item.categoryLabels : categories.map(adultCategoryLabelFor),
    sourceName: item.sourceName ?? item.source ?? 'Source',
    adultHotScore: Number(item.adultHotScore ?? item.score ?? 0),
    thumbnailUrl: pickCardImageUrl(item),
    trendReasons: Array.isArray(item.trendReasons) ? item.trendReasons : [],
    tags: Array.isArray(item.tags) ? item.tags : [],
    relatedWorks: Array.isArray(item.relatedWorks) ? item.relatedWorks : [],
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

function renderTrends(filter = 'all') {
  console.time('home:render-trends');
  activeTrendFilter = filter;
  if (!trendListElement) return;
  const filtered = visibleTrendTopics
    .filter((trend) => filter === 'all' || hasCategory(trend, filter))
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));

  if (!filtered.length) {
    const freshnessLabel = latestTrendGeneratedAt ? '最終生成: ' + formatAbsoluteDate(latestTrendGeneratedAt) : 'まだ最新データを取得できていません';
    trendListElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>最近話題のトピックを収集中です</strong><p>' + escapeHtml(freshnessLabel) + '</p></div>';
    console.timeEnd('home:render-trends');
    return;
  }

  const limited = filtered.slice(0, TREND_HOME_LIMIT);
  const cards = limited.map((trend, index) => {
    const href = getTrendPrimaryUrl(trend, index);
    const target = /^https?:/i.test(href) ? ' target="_blank" rel="noreferrer"' : '';
    const hasThumbnail = Boolean(trend.thumbnailUrl);
    const thumb = hasThumbnail ? buildTrendCardThumb(trend.thumbnailUrl) : '';
    const scoreSummary = trend.scoreSummary ? '<div class="trend-score-summary">' + escapeHtml(trend.scoreSummary) + '</div>' : '';
    const summaryHtml = hasVisibleSummary(trend.summary) ? '<p>' + escapeHtml(trend.summary ?? '') + '</p>' : '';
    const insightHtml = renderTrendReasonList(trend);
    return '<a class="' + escapeHtml('trend-card trend-card-rich trend-card-link ' + (hasThumbnail ? 'has-thumb' : 'trend-card-no-thumb')) + '" href="' + escapeHtml(href) + '"' + target + ' style="animation-delay:' + (index * 70) + 'ms">' +
      thumb +
      '<div><div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(trend)) + '</span><time>' + escapeHtml(trend.time ?? '直近') + '</time></div>' +
      '<h3>' + escapeHtml(trend.title ?? 'ニュース') + '</h3>' +
      summaryHtml +
      insightHtml +
      scoreSummary +
      '<div class="trend-footer"><span><strong>' + escapeHtml(String(trend.posts ?? 1)) + '</strong> ' + escapeHtml(trend.metricLabel ?? 'source') + '</span>' +
      '<span class="detail-link">記事を開く ↗</span></div></div></a>';
  });
  replaceChildrenFromHtml(trendListElement, cards);
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

function buildTrendCardThumb(thumbnailUrl) {
  if (!thumbnailUrl) return '';
  return '<div class="trend-thumb-wrap"><img class="trend-thumb" src="' + escapeHtml(thumbnailUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>';
}

function renderDiscoverySections() {
  console.time('home:render-discovery');
  const topics = visibleTrendTopics;
  renderTopicClusterList(mustReadNewsListElement, selectMustReadNews(topics).slice(0, 5), {
    emptyTitle: '見逃したくない話題を整理中です',
    emptyText: '直近24時間の重要トピックを確認しています。',
    badge: "DON'T MISS",
    scoreMode: 'hot',
    featured: true,
  });
  renderTopicChannels(topics, { deferred: false });
  renderPriorityList(personalNewsListElement, selectPersonalNews(topics), {
    emptyTitle: '自分向けニュースを整理中です',
    emptyText: 'ゲーム、AI、セール、ネット文化などの話題を探しています。',
    badge: 'FOR YOU',
  });
  console.timeEnd('home:render-discovery');
}

function prepareVisibleTrendTopics(topics) {
  return [...topics]
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .slice(0, TOPIC_WORKING_SET_LIMIT);
}

function selectPersonalNews(topics) {
  return [...topics]
    .filter((topic) => Number(topic.personalScore ?? 0) >= 18)
    .sort((left, right) => Number(right.personalScore ?? 0) - Number(left.personalScore ?? 0) || hotTopicScore(right) - hotTopicScore(left))
    .slice(0, PERSONAL_NEWS_LIMIT);
}

function selectMustReadNews(topics) {
  return [...topics]
    .filter((topic) => isTrendTopicFresh(topic))
    .filter((topic) => !isLowPriorityTopic(topic))
    .filter((topic) => hotTopicScore(topic) >= 45 || Number(topic.personalScore ?? 0) >= 35 || Number(topic.posts ?? 1) >= 2)
    .sort((left, right) => mustReadScore(right) - mustReadScore(left))
    .slice(0, MUST_READ_LIMIT);
}

function mustReadScore(topic) {
  const sourceBonus = Number(topic.posts ?? 1) >= 2 ? 18 : 0;
  const importanceBonus = isHighImportanceTopic(topic) ? 28 : 0;
  const penalty = isLowPriorityTopic(topic) ? 40 : 0;
  return hotTopicScore(topic) + Number(topic.personalScore ?? 0) + sourceBonus + topicRecencyScore(topic) + importanceBonus - penalty;
}

function renderPriorityList(element, topics, options) {
  if (!element) return;
  if (!topics.length) {
    element.innerHTML = '<article class="priority-card priority-card-empty"><strong>' + escapeHtml(options.emptyTitle) + '</strong><p>' + escapeHtml(options.emptyText) + '</p></article>';
    return;
  }

  const cards = topics.map((topic, index) => {
    const href = './topic.html?id=' + encodeURIComponent(topic.id ?? '');
    const reasons = (topic.personalReasons ?? topic.hotReasons ?? []).slice(0, 3);
    const audience = Array.isArray(topic.targetAudience) && topic.targetAudience.length ? topic.targetAudience.slice(0, 3).join(' / ') : '関心のある人';
    return '<a class="priority-card" href="' + escapeHtml(href) + '" style="animation-delay:' + (index * 55) + 'ms">' +
      '<div class="priority-card-top"><span>' + escapeHtml(options.badge) + '</span><strong>' + escapeHtml(String(Math.round(Number(topic.personalScore ?? hotTopicScore(topic) ?? 0)))) + '</strong></div>' +
      '<h3>' + escapeHtml(topic.title ?? 'ニュース') + '</h3>' +
      '<p>' + escapeHtml(topic.whatHappened ?? shortEventFromTitle(topic.title)) + '</p>' +
      '<dl class="trend-reason-list priority-reasons">' +
      '<div><dt>なぜ見る？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
      '<div><dt>関係ある人</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
      '</dl>' +
      '<div class="priority-chip-row">' + reasons.map((reason) => '<span>' + escapeHtml(reason) + '</span>').join('') + '</div>' +
      '</a>';
  });
  replaceChildrenFromHtml(element, cards);
}

function renderTopicChannels(topics, { deferred = false } = {}) {
  const definitions = buildTopicChannelDefinitions(topics);
  const targetElement = deferred ? topicChannelDeferredListElement : topicChannelPrimaryListElement;
  const selectedSections = definitions.filter((section) => section.deferred === deferred);
  if (!targetElement) return;

  if (!selectedSections.length) {
    targetElement.innerHTML = '';
    if (deferred) targetElement.hidden = true;
    return;
  }

  if (deferred) targetElement.hidden = false;
  replaceChildrenFromHtml(targetElement, selectedSections.map((section) => renderTopicChannelPanel(section)));
}

function buildTopicChannelDefinitions(topics) {
  return [
    {
      key: 'games',
      icon: '🎮',
      title: 'ゲーム',
      description: '予約、抽選、発売、アップデートなど、ゲーム周辺の大きな動きを先に整理します。',
      items: selectCategoryTopics(topics, (topic) => hasCategory(topic, 'games')),
      deferred: false,
    },
    {
      key: 'ai',
      icon: '🤖',
      title: 'AI',
      description: '生成AI、主要モデル、企業発表、利用条件変更などを Topic 単位でまとめます。',
      items: selectCategoryTopics(topics, (topic) => isAiTopic(topic)),
      deferred: false,
    },
    {
      key: 'deals',
      icon: '💰',
      title: 'お得情報',
      description: 'セール、割引、キャンペーン、ポイント還元系を、後追いしやすい形でまとめます。',
      items: selectCategoryTopics(topics, (topic) => isDealsTopic(topic)),
      deferred: true,
    },
    {
      key: 'sns-net',
      icon: '📱',
      title: 'SNS・ネット',
      description: 'SNS、ネットカルチャー、2chまとめ系を残したまま、話題単位で横断整理します。',
      items: selectCategoryTopics(topics, (topic) => isSnsOrNetTopic(topic)),
      deferred: true,
    },
    {
      key: 'adult',
      icon: '🔞',
      title: 'アダルト',
      description: '一般ニュース一覧とは切り分けつつ、ホームでも主要トレンドだけ把握できるようにします。',
      items: selectCategoryTopics(topics, (topic) => hasCategory(topic, 'adult')),
      deferred: true,
    },
    {
      key: 'world',
      icon: '🌎',
      title: '世の中',
      description: '政治、経済、国際、事件など、生活や判断に関わる Topic をまとめます。',
      items: selectCategoryTopics(topics, (topic) => isWorldTopic(topic)),
      deferred: true,
    },
  ];
}

function renderTopicChannelPanel(section) {
  const body = section.items.length
    ? '<div class="topic-topic-card-grid">' + section.items.map((topic) => renderTopicClusterCard(topic, {
      badge: section.icon + ' ' + section.title,
      scoreMode: 'hot',
      compact: true,
    })).join('') + '</div>'
    : '<article class="topic-cluster-card topic-cluster-card-empty"><strong>' + escapeHtml(section.title) + 'の話題を整理中です</strong><p>最新の Topic Cluster がまとまり次第ここに表示します。</p></article>';

  return '<section class="topic-channel-panel">' +
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
    'topic-cluster-link',
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
      '</article>';
  }

  if (isCompact) {
    return '<a class="' + escapeHtml(cardClasses) + '" href="' + escapeHtml(href) + '">' +
      thumbnail +
      '<div class="topic-cluster-body topic-cluster-body-channel">' +
        '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'TOPIC') + '</span><strong>' + escapeHtml(String(scoreValue)) + '</strong></div>' +
        '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(topic.time ?? '直近') + '</time></div>' +
        '<h3>' + escapeHtml(topic.title ?? '話題') + '</h3>' +
        '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
        '<dl class="trend-reason-list trend-reason-list-compact">' +
          '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
          '<div><dt>代表トピック</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
        '</dl>' +
        '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span><span class="detail-link">もっと見る →</span></div>' +
      '</div>' +
    '</a>';
  }

  return '<a class="' + escapeHtml(cardClasses) + '" href="' + escapeHtml(href) + '">' +
    thumbnail +
    '<div class="topic-cluster-body">' +
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
      '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span><span class="detail-link">もっと見る →</span></div>' +
    '</div>' +
  '</a>';
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

function selectCategoryTopics(topics, predicate, limit = 3) {
  return [...topics]
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

  if (Number(topic.posts ?? 1) >= 2) score += 8;
  if (isTrendTopicFresh(topic)) score += 8;
  if (hotTopicScore(topic) >= 55) score += 8;

  return {
    score: Math.min(100, score),
    reasons: [...new Set(reasons)].slice(0, 4),
  };
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
    ...(topic.sourceSignals ?? []).flatMap((signal) => [signal.title, signal.summary, signal.sourceName]),
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
  if (/株|投資|決算|金利|物価/.test(text)) values.push('投資家');
  if (!values.length && personal.reasons.length) values.push(...personal.reasons.map((reason) => reason.replace(/関連|情報/g, '')));
  return [...new Set(values)].slice(0, 4);
}

function renderDailyBrief() {
  console.time('home:render-brief');
  if (!dailyBriefListElement) return;

  if (!dailyBriefItems.length) {
    dailyBriefListElement.innerHTML = '<article class="brief-card brief-card-empty"><strong>重要ニュースを整理中です</strong><p>要約データの生成が終わり次第ここに表示されます。</p></article>';
    console.timeEnd('home:render-brief');
    return;
  }

  const cards = dailyBriefItems.slice(0, 5).map((item, index) => {
    const thumbnailUrl = pickCardImageUrl(item);
    const thumb = thumbnailUrl ? buildTrendCardThumb(thumbnailUrl) : '';
    const primaryLink = item.primaryLink?.url
      ? '<a class="brief-primary-link" href="' + escapeHtml(item.primaryLink.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(item.primaryLink.label ?? '元記事') + ' ↗</a>'
      : '';
    const relatedLinks = Array.isArray(item.relatedLinks) && item.relatedLinks.length
      ? '<div class="brief-related-links">' + item.relatedLinks.map((link) => '<a href="' + escapeHtml(link.url ?? '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(link.label ?? '関連記事') + ' ↗</a>').join('') + '</div>'
      : '<div class="brief-related-links brief-related-empty"><span>関連記事リンクなし</span></div>';

    return '<article class="' + escapeHtml('brief-card ' + (thumbnailUrl ? 'has-thumb' : 'trend-card-no-thumb')) + '" style="animation-delay:' + (index * 80) + 'ms">' +
      thumb +
      '<div>' +
      '<div class="brief-card-top"><span class="brief-tone">' + escapeHtml(item.tone ?? '注目ニュース') + '</span></div>' +
      '<div class="brief-meta"><span>' + escapeHtml(item.categoryLabel ?? 'その他') + '</span><time>' + escapeHtml(item.publishedLabel ?? '時刻不明') + '</time></div>' +
      '<h3>' + escapeHtml(item.title ?? 'ニュース') + '</h3>' +
      '<dl class="brief-points">' +
      renderBriefPoint('30秒要約', item.thirtySecondSummary) +
      renderBriefPoint('今後の注目点', item.watchpoints) +
      '</dl>' +
      '<div class="brief-links">' +
      primaryLink +
      relatedLinks +
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

  const filtered = adultTrendItems
    .filter((item) => filter === 'all' || item.categories?.includes(filter))
    .sort((left, right) => Number(right.adultHotScore ?? 0) - Number(left.adultHotScore ?? 0))
    .slice(0, ADULT_HOME_LIMIT);

  if (!filtered.length) {
    adultTrendListElement.innerHTML = '<article class="adult-card adult-card-empty"><strong>アダルトトレンドを整理中です</strong><p>adult-trends.json の生成後にランキング、急上昇、セール情報を表示します。</p></article>';
    return;
  }

  adultTrendListElement.innerHTML = filtered.map((item, index) => {
    const href = './adult-topic.html?id=' + encodeURIComponent(item.routeId ?? item.id ?? '');
    const thumb = item.thumbnailUrl ? '<div class="adult-thumb-wrap"><img class="adult-thumb" src="' + escapeHtml(item.thumbnailUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>' : '';
    const reason = item.trendReasons?.[0] ?? item.reason ?? 'トレンド候補';
    const labels = (item.categoryLabels ?? item.categories?.map(adultCategoryLabelFor) ?? []).slice(0, 3);
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
  renderTopicChannels(visibleTrendTopics.length ? visibleTrendTopics : trendTopics, { deferred: true });
  recordPerfCount('after-topic-channels');
}

function renderBriefPoint(label, value) {
  const normalized = label === '30秒要約'
    ? sanitizeBriefSummaryText(value ?? '情報を整理中です。')
    : (value ?? '情報を整理中です。');
  return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(normalized) + '</dd></div>';
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
    briefCards: document.querySelectorAll('.brief-card').length,
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

function hasVisibleSummary(summary) {
  const text = String(summary ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return !/に関する話題。?$|が明らかになり、?話題になっている。?$|がきょうの注目話題として取り上げられている。?$|を伝える話題。?$/.test(text);
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
  return ['general', 'tech', 'business', 'politics', 'entertainment', 'games', 'manga', 'books', 'sports', 'sns', 'net-culture', 'matome', 'crime', 'adult', 'world']
    .map((category) => {
      const candidates = topics
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
  const importanceBonus = isHighImportanceTopic(topic) ? 18 : 0;
  const penalty = isLowPriorityTopic(topic) ? 36 : 0;
  return baseScore + freshnessBonus + sourceBonus + importanceBonus - penalty;
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

function shouldLoadArchiveTopics(currentTopics) {
  return currentTopics.length < TREND_MIN_ITEMS;
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

function selectTopTrendTopics(topics) {
  const sorted = [...topics].sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const freshItems = sorted.filter((topic) => isTrendTopicFresh(topic));
  if (freshItems.length >= TREND_MIN_ITEMS) return freshItems;
  const fallbackItems = sorted.filter((topic) => isTrendTopicWithinDays(topic, TREND_TOPUP_DAYS));
  return [...new Map([...freshItems, ...fallbackItems].map((topic) => [topic.id, topic])).values()].slice(0, TREND_MIN_ITEMS);
}

function mergeReports(...reportGroups) {
  const reports = reportGroups.flat();
  return [...new Map(reports.map((report) => [report.id, report])).values()];
}

function dedupeTopics(topics) {
  const map = new Map();

  for (const topic of topics) {
    const key = canonicalTopicKey(topic);
    const current = map.get(key);
    if (!current) {
      map.set(key, topic);
      continue;
    }

    const nextSignals = [...new Map([...(current.sourceSignals ?? []), ...(topic.sourceSignals ?? [])].map((signal) => [signal.url, signal])).values()];
    if (Number(topic.score ?? 0) >= Number(current.score ?? 0)) {
      const categories = normalizeCategories(mergeCategories(current.categories, topic.categories), topic.category ?? current.category);
      map.set(key, {
        ...current,
        ...topic,
        category: topic.category ?? current.category,
        categories,
        categoryLabels: categories.map(categoryLabelFor),
        sourceSignals: nextSignals,
        posts: String(Math.max(Number(current.posts ?? 1), Number(topic.posts ?? 1), nextSignals.length || 1)),
        metricLabel: nextSignals.length > 1 ? 'sources' : (topic.metricLabel ?? current.metricLabel ?? 'source'),
        thumbnailUrl: topic.thumbnailUrl ?? current.thumbnailUrl ?? nextSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
      });
    } else {
      const categories = normalizeCategories(mergeCategories(current.categories, topic.categories), current.category ?? topic.category);
      map.set(key, {
        ...current,
        categories,
        categoryLabels: categories.map(categoryLabelFor),
        sourceSignals: nextSignals,
        posts: String(Math.max(Number(current.posts ?? 1), Number(topic.posts ?? 1), nextSignals.length || 1)),
        metricLabel: nextSignals.length > 1 ? 'sources' : (current.metricLabel ?? 'source'),
        thumbnailUrl: current.thumbnailUrl ?? topic.thumbnailUrl ?? nextSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
      });
    }
  }

  return dedupeTopicsFuzzy([...map.values()]);
}

function canonicalTopicKey(topic) {
  const urlSignature = canonicalTopicSourceSignature(topic);
  const titleSignature = normalizeTopicFingerprint(topic.title ?? '');
  return `${titleSignature}::${urlSignature}`;
}

function canonicalTopicSourceSignature(topic) {
  const firstSignalUrl = Array.isArray(topic.sourceSignals) ? topic.sourceSignals[0]?.url : null;
  const fromSearchLinks = Array.isArray(topic.searchLinks) ? topic.searchLinks[0]?.url : null;
  const normalizedUrl = canonicalUrlForDedup(firstSignalUrl || fromSearchLinks);
  return normalizedUrl ? `url:${normalizedUrl}` : '';
}

function canonicalUrlForDedup(rawUrl) {
  const value = String(rawUrl ?? '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const params = new URLSearchParams(parsed.search);
    const keysToDrop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'ref', 'src', 'from'];
    keysToDrop.forEach((key) => params.delete(key));
    parsed.search = params.toString();
    return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.toLowerCase()}`.replace(/\/$/, '');
  } catch {
    return value.toLowerCase().replace(/^https?:\/\//, '').replace(/[#?].*$/i, '');
  }
}

function normalizeTopicFingerprint(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b(速報|動画|写真|news|ニュース)\b/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/[【】「」『』]/g, ' ')
    .replace(/（[^）]*?新聞[^）]*?）/g, ' ')
    .replace(/（[^）]*?ニュース[^）]*?）/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[a-z0-9]{8,}\b/g, ' ')
    .replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCategories(categories, fallbackCategory) {
  const values = Array.isArray(categories) ? categories : [];
  const merged = [...new Set([fallbackCategory, ...values].filter(Boolean))];
  return merged.length ? merged : ['general'];
}

function mergeCategories(...groups) {
  return [...new Set(groups.flatMap((group) => Array.isArray(group) ? group : [group]).filter(Boolean))];
}

function hasCategory(topic, category) {
  return normalizeCategories(topic.categories, topic.category).includes(category);
}

function categoryDisplayLabel(topic) {
  const labels = Array.isArray(topic.categoryLabels) && topic.categoryLabels.length
    ? topic.categoryLabels
    : normalizeCategories(topic.categories, topic.category).map(categoryLabelFor);
  return labels.slice(0, 2).join(' / ');
}

function dedupeTopicsFuzzy(topics) {
  const kept = [];
  for (const topic of topics) {
    const currentKey = canonicalTopicKey(topic);
    const duplicateIndex = kept.findIndex((item) => isNearDuplicateTopic(item, topic, currentKey));
    if (duplicateIndex === -1) {
      kept.push(topic);
      continue;
    }
    kept[duplicateIndex] = mergeDuplicateTopics(kept[duplicateIndex], topic);
  }
  return kept;
}

function isNearDuplicateTopic(current, next, nextKey = canonicalTopicKey(next)) {
  if (!current || !next) return false;
  const currentUrl = canonicalTopicSourceSignature(current);
  const nextUrl = canonicalTopicSourceSignature(next);
  if (currentUrl && nextUrl && currentUrl === nextUrl) return true;
  if (isLikelySameStory(current, next)) return true;
  if (!shareAnyCategory(current, next)) return false;
  const currentKey = canonicalTopicKey(current);
  if (!currentKey || !nextKey) return false;

  if (currentKey.includes(nextKey) || nextKey.includes(currentKey)) {
    return Math.min(currentKey.length, nextKey.length) >= 18;
  }

  const currentTokens = distinctiveTokens(currentKey);
  const nextTokens = distinctiveTokens(nextKey);
  if (currentTokens.length < 3 || nextTokens.length < 3) return false;
  const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
  return overlap >= 3 && overlap / Math.min(currentTokens.length, nextTokens.length) >= 0.78;
}

function distinctiveTokens(value) {
  return [...new Set(String(value ?? '').split(' ').filter((token) => token.length >= 2 && !GENERIC_TOPIC_TOKENS.has(token)))];
}

function shareAnyCategory(left, right) {
  const leftCategories = normalizeCategories(left.categories, left.category);
  const rightCategories = normalizeCategories(right.categories, right.category);
  return leftCategories.some((category) => rightCategories.includes(category));
}

function isLikelySameStory(current, next) {
  if (!current || !next) return false;

  const currentTitle = normalizeTopicFingerprint(current.title ?? "");
  const nextTitle = normalizeTopicFingerprint(next.title ?? "");
  if (!currentTitle || !nextTitle) return false;

  const sameTitle = currentTitle === nextTitle || currentTitle.includes(nextTitle) || nextTitle.includes(currentTitle);
  const currentPublishedAt = topicPublishedAt(current);
  const nextPublishedAt = topicPublishedAt(next);
  if (sameTitle) {
    if (currentPublishedAt == null || nextPublishedAt == null) return true;
    return Math.abs(currentPublishedAt - nextPublishedAt) <= 36 * 60 * 60 * 1000;
  }

  const currentTokens = distinctiveTokens(currentTitle);
  const nextTokens = distinctiveTokens(nextTitle);
  if (currentTokens.length < 4 || nextTokens.length < 4) return false;
  if (!currentPublishedAt || !nextPublishedAt) return false;
  const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
  const overlapRatio = overlap / Math.min(currentTokens.length, nextTokens.length);
  return overlap >= 3 && overlapRatio >= 0.8 && Math.abs(currentPublishedAt - nextPublishedAt) <= 36 * 60 * 60 * 1000;
}

function topicPublishedAt(topic) {
  const value = topic?.sourceSignals?.[0]?.publishedAt ?? topic?.publishedAt ?? topic?.capturedAt ?? topic?.generatedAt;
  const time = new Date(value ?? "").getTime();
  return Number.isNaN(time) ? null : time;
}

function mergeDuplicateTopics(current, next) {
  const currentSignals = Array.isArray(current.sourceSignals) ? current.sourceSignals : [];
  const nextSignals = Array.isArray(next.sourceSignals) ? next.sourceSignals : [];
  const mergedSignals = [...new Map([...currentSignals, ...nextSignals].map((signal) => [signal.url, signal])).values()];
  const winner = Number(next.score ?? 0) >= Number(current.score ?? 0) ? next : current;
  const loser = winner === next ? current : next;
  const categories = normalizeCategories(mergeCategories(current.categories, next.categories), winner.category ?? loser.category);
  return {
    ...loser,
    ...winner,
    category: winner.category ?? loser.category,
    categories,
    categoryLabels: categories.map(categoryLabelFor),
    sourceSignals: mergedSignals,
    posts: String(Math.max(Number(current.posts ?? 1), Number(next.posts ?? 1), mergedSignals.length || 1)),
    metricLabel: mergedSignals.length > 1 ? 'sources' : (winner.metricLabel ?? loser.metricLabel ?? 'source'),
    thumbnailUrl: winner.thumbnailUrl ?? loser.thumbnailUrl ?? mergedSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
  };
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

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}

function pickCardImageUrl(item) {
  const candidates = [
    item?.thumbnailUrl,
    item?.thumbnail,
    item?.imageUrl,
    item?.image,
    item?.ogImage,
    item?.twitterImage,
    item?.sourceImage,
    ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals.flatMap((signal) => [
      signal?.thumbnailUrl,
      signal?.thumbnail,
      signal?.imageUrl,
      signal?.image,
      signal?.ogImage,
      signal?.twitterImage,
      signal?.sourceImage,
    ]) : []),
  ];
  for (const candidate of candidates) {
    const normalized = sanitizeCardImageUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function sanitizeCardImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (/(?:^|\/)(?:favicon(?:-\d+x\d+)?|apple-touch-icon|android-chrome-\d+x\d+|mstile-\d+x\d+)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)) return null;
  if (/\/favicon\.ico(?:$|[?#])/i.test(url)) return null;
  if (/(?:google|gstatic)\.[^/]+\/.*(?:favicon|logo|icon)/i.test(url)) return null;
  return url;
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

if (adultFilterPillsElement) {
  adultFilterPillsElement.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      adultFilterPillsElement.querySelectorAll('button').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      renderAdultTrends(button.dataset.adultFilter);
    });
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
