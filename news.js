const {
  buildImportantPoint,
  buildGoogleNewsUrl,
  buildTargetAudience,
  buildWhyHotLabel,
  categoryDisplayLabel,
  categoryLabelFor,
  dedupeTopics,
  defaultSearchQueryForCategory,
  escapeHtml,
  formatDate,
  formatTopicDisplayTime,
  getPrimarySourceLabel,
  hasCategory,
  hasVisibleSummary,
  normalizeTopic,
  pickCardImageUrl,
  shortEventFromTitle,
} = window.TopicClientUtils;

const listElement = document.querySelector('#news-archive-list');
const countElement = document.querySelector('#news-count');
const updatedElement = document.querySelector('#news-updated');
const queryElement = document.querySelector('#news-query');
const searchButtonElement = document.querySelector('.news-search-button');
const paginationElement = document.querySelector('#trend-pagination');
const archiveActionsElement = document.querySelector('#news-archive-actions');

const PAGE_SIZE = 20;
const RENDER_BATCH_SIZE = 4;
const HOME_NEWS_ENDPOINT = './data/home-news.json';
const NEWS_ARCHIVE_ENDPOINT = './data/news-archive.json';
const BROWSE_TOPICS_ENDPOINT = './data/trend-topics-browse.json';
const TOPIC_CACHE_KEY = 'internet-news-browse-archive-cache-v5';
const MAX_CACHED_HOME_ITEMS = 80;
const RANGE_CONFIG = {
  '24h': { minHours: 0, maxHours: 24, label: '24時間以内', searchWindowDays: 1 },
  '24-3d': { minHours: 24, maxHours: 72, label: '24時間〜3日', searchWindowDays: 3 },
  '3-7d': { minHours: 72, maxHours: 168, label: '3日〜7日', searchWindowDays: 7 },
};

let trendItems = [];
let dedupedTrendItems = [];
let activeCategory = 'all';
let activeRange = '24h';
let currentPage = 1;
let queryDebounceTimer = null;
let renderPassId = 0;
let latestUpdatedLabel = '更新時刻不明';
let browseItemsLoaded = false;
let browseItemsPromise = null;
let fullArchiveLoaded = false;
let fullArchivePromise = null;
let showAllResults = false;
let homeNewsTotalCount = null;
let homeNewsCategoryCounts = {};
const rangeItemsCache = new Map();
const normalizedTopicCache = new Map();

document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (!image.classList.contains('trend-thumb')) return;
  const wrapper = image.closest('.trend-thumb-wrap');
  if (wrapper) {
    const card = wrapper.closest('.trend-card');
    if (card) card.classList.add('trend-card-no-thumb');
    wrapper.remove();
  }
}, true);

init();

async function init() {
  const cachedTopics = readTopicCache();
  if (cachedTopics.length) {
    trendItems = cachedTopics;
    rebuildDerivedItems();
    latestUpdatedLabel = 'キャッシュを表示中';
    updatedElement.textContent = latestUpdatedLabel;
    void renderArchive();
  }

  try {
    updatedElement.textContent = 'ニュースを読み込み中…';
    const archivePayload = await fetchJson(HOME_NEWS_ENDPOINT).catch(() => null);
    const preparedArchive = await preparePrimaryArchiveItems(archivePayload?.items ?? []);
    trendItems = preparedArchive;
    homeNewsTotalCount = Number.isFinite(Number(archivePayload?.totalCount)) ? Number(archivePayload.totalCount) : preparedArchive.length;
    homeNewsCategoryCounts = archivePayload?.categoryCounts && typeof archivePayload.categoryCounts === 'object'
      ? archivePayload.categoryCounts
      : {};
    rebuildDerivedItems();
    latestUpdatedLabel = archivePayload?.generatedAt
      ? formatDate(archivePayload.generatedAt) + ' 更新'
      : '更新時刻不明';
    updatedElement.textContent = latestUpdatedLabel;
  } catch {
    trendItems = [];
    rebuildDerivedItems();
    latestUpdatedLabel = '読み込み失敗';
    updatedElement.textContent = latestUpdatedLabel;
  }

  saveTopicCache(trendItems, { scope: 'home' });
  updateRangeTabLabels();
  await renderArchive();
}

async function renderArchive() {
  if (activeRange !== '24h') {
    await ensureBrowseItemsLoaded({ announce: true });
  }

  const query = queryElement.value.trim().toLowerCase();
  const filtered = getRangeItems(activeRange)
    .filter((item) => activeCategory === 'all' || matchesArchiveCategory(item, activeCategory))
    .filter((item) => {
      if (!query) return true;
      return (String(item.title ?? '') + ' ' + String(item.summary ?? '')).toLowerCase().includes(query);
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const displayTotalCount = getDisplayTotalForCurrentState(filtered.length);
  countElement.textContent = displayTotalCount + ' 件';
  updateRangeTabLabels();
  updateSearchButton();

  const pageItems = showAllResults
    ? filtered
    : filtered.slice((currentPage - 1) * PAGE_SIZE, (currentPage - 1) * PAGE_SIZE + PAGE_SIZE);

  if (!filtered.length) {
    const emptyMessage = displayTotalCount > 0 && !fullArchiveLoaded && activeRange === '24h' && !query
      ? '<div class="empty-tweets trend-empty"><strong>この条件の記事は全体にはあります</strong><p>初期表示20件には含まれていないため、必要なら全件表示で続きを読み込んでください。</p></div>'
      : '<div class="empty-tweets trend-empty"><strong>該当するニュースはありません</strong><p>期間・カテゴリ・キーワードを変えてもう一度探してみてください。</p></div>';
    listElement.innerHTML = emptyMessage;
    renderPagination(0, filtered.length, pageItems.length, displayTotalCount);
    return;
  }

  await renderArchivePageItems(pageItems);
  renderPagination(totalPages, filtered.length, pageItems.length, displayTotalCount);
}

async function preparePrimaryArchiveItems(rawItems) {
  const inputItems = Array.isArray(rawItems) ? rawItems : [];
  const allItems = [];

  for (const item of inputItems) {
    if (!isRenderableArchiveItemRaw(item)) continue;
    allItems.push(item);
  }

  allItems.sort((left, right) => (getNewsRangeTimestamp(right) ?? 0) - (getNewsRangeTimestamp(left) ?? 0));
  return allItems;
}

async function normalizeTopicsInBatches(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .filter((item) => isRenderableArchiveItemRaw(item))
    .sort((left, right) => (getNewsRangeTimestamp(right) ?? 0) - (getNewsRangeTimestamp(left) ?? 0));
}

async function renderArchivePageItems(items) {
  const passId = ++renderPassId;
  listElement.innerHTML = '';

  for (let index = 0; index < items.length; index += RENDER_BATCH_SIZE) {
    if (passId !== renderPassId) return;
    const chunkHtml = items
      .slice(index, index + RENDER_BATCH_SIZE)
      .map((item) => getNormalizedTopicForUi(item))
      .filter((item) => isRenderableArchiveItem(item))
      .map((item) => renderArchiveCard(item))
      .join('');
    listElement.insertAdjacentHTML('beforeend', chunkHtml);
    if (index + RENDER_BATCH_SIZE < items.length) {
      await waitForNextPaint();
    }
  }
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function renderArchiveCard(item) {
  const thumbnailUrl = getArchiveThumbnailUrl(item);
  const hasThumbnail = Boolean(thumbnailUrl);
  const sourceUrl = getArchiveSourceUrl(item);
  const sourceLabel = getArchiveSourceLabel(item);
  const thumb = hasThumbnail ? '<div class="trend-thumb-wrap"><img class="trend-thumb" src="' + escapeHtml(thumbnailUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>' : '';
  const summaryHtml = hasVisibleSummary(item.summary) ? '<p>' + escapeHtml(item.summary ?? '') + '</p>' : '';
  const insightHtml = renderInsightList(item);
  const footerHtml = sourceUrl
    ? '<div class="trend-footer"><span><strong>' + escapeHtml(sourceLabel) + '</strong></span><span class="detail-link">元記事を見る ↗</span></div>'
    : '<div class="trend-footer"><span><strong>元記事リンクなし</strong></span><span class="detail-link">リンクなし</span></div>';
  const bodyHtml = '<div><div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(item)) + '</span><time>' + escapeHtml(formatTopicDisplayTime(item)) + '</time></div><h3>' + escapeHtml(item.title ?? 'ニュース') + '</h3>' + summaryHtml + insightHtml + footerHtml + '</div>';
  const cardClass = 'trend-card trend-card-rich trend-card-link' + (hasThumbnail ? ' has-thumb' : ' trend-card-no-thumb');

  if (!sourceUrl) {
    return '<article class="' + cardClass + '" aria-disabled="true">' + thumb + bodyHtml + '</article>';
  }

  return '<a class="' + cardClass + '" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + thumb + bodyHtml + '</a>';
}

function renderInsightList(item) {
  const audience = buildTargetAudience(item).join(' / ') || '関連分野を追う人';
  return '<dl class="trend-reason-list">' +
    '<div><dt>何が起きた？</dt><dd>' + escapeHtml(item.whatHappened ?? shortEventFromTitle(item.title)) + '</dd></div>' +
    '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(item.whyHot ?? buildWhyHotLabel(item)) + '</dd></div>' +
    '<div><dt>なぜ重要？</dt><dd>' + escapeHtml(item.importantPoint ?? buildImportantPoint(item)) + '</dd></div>' +
    '<div><dt>誰向け？</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
  '</dl>';
}

function updateRangeTabLabels() {
  document.querySelectorAll('.news-range-tabs button').forEach((button) => {
    const range = RANGE_CONFIG[button.dataset.range];
    if (!range) return;
    const count = getRangeDisplayCount(button.dataset.range);
    const isDeferredRange = button.dataset.range !== '24h' && !browseItemsLoaded;
    button.textContent = isDeferredRange
      ? range.label + ' (…)'
      : range.label + ' (' + count + ')';
  });
}

function getDisplayTotalForCurrentState(fallbackCount) {
  if (
    activeRange === '24h'
    && !queryElement.value.trim()
    && !fullArchiveLoaded
  ) {
    const categoryTotal = getHomeNewsCategoryCount(activeCategory);
    if (categoryTotal != null) return categoryTotal;
  }
  return fallbackCount;
}

function getRangeDisplayCount(rangeKey) {
  if (
    rangeKey === '24h'
    && !fullArchiveLoaded
  ) {
    const categoryTotal = getHomeNewsCategoryCount('all');
    if (categoryTotal != null) return categoryTotal;
  }
  return getRangeItems(rangeKey).length;
}

function getHomeNewsCategoryCount(category) {
  const key = category || 'all';
  const value = key === 'all'
    ? (homeNewsCategoryCounts?.all ?? homeNewsTotalCount)
    : homeNewsCategoryCounts?.[key];
  if (!Number.isFinite(Number(value))) return null;
  return Number(value);
}

function rebuildDerivedItems() {
  dedupedTrendItems = dedupeTopics(trendItems)
    .sort((left, right) => (getNewsRangeTimestamp(right) ?? 0) - (getNewsRangeTimestamp(left) ?? 0));
  rangeItemsCache.clear();
}

function getRangeItems(rangeKey) {
  const key = RANGE_CONFIG[rangeKey] ? rangeKey : '24h';
  if (rangeItemsCache.has(key)) return rangeItemsCache.get(key);
  const range = RANGE_CONFIG[key];
  const items = dedupedTrendItems.filter((item) => isWithinNewsRange(item, range));
  rangeItemsCache.set(key, items);
  return items;
}

function getNewsRangeTimestamp(item) {
  const publishedCandidates = [
    ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals.map((signal) => signal?.publishedAt) : []),
    item?.publishedAt,
  ]
    .map(parseNewsTimestamp)
    .filter((value) => value != null);

  if (publishedCandidates.length) return Math.max(...publishedCandidates);

  const fallbackCandidates = [item?.capturedAt, item?.generatedAt]
    .map(parseNewsTimestamp)
    .filter((value) => value != null);

  return fallbackCandidates.length ? Math.max(...fallbackCandidates) : null;
}

function parseNewsTimestamp(value) {
  if (value == null || value === '') return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time <= 0) return null;
  return time;
}

function isWithinNewsRange(item, range) {
  if (!range) return true;
  const timestamp = getNewsRangeTimestamp(item);
  if (timestamp == null) return false;

  const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
  if (!Number.isFinite(ageHours)) return false;

  const minHours = Number(range.minHours ?? 0);
  const maxHours = Number(range.maxHours ?? Number.POSITIVE_INFINITY);

  if (ageHours < 0) return minHours === 0;
  if (minHours === 0) return ageHours <= maxHours;
  return ageHours > minHours && ageHours <= maxHours;
}

function updateSearchButton() {
  if (!searchButtonElement) return;
  const text = queryElement.value.trim();
  searchButtonElement.textContent = text ? '「' + text + '」でGoogleニュース検索 ↗' : (activeCategory === 'all' ? 'Googleニュースで広く探す ↗' : categoryLabelFor(activeCategory) + 'をGoogleニュースで探す ↗');
  searchButtonElement.href = buildGoogleNewsUrl(text || defaultSearchQueryForCategory(activeCategory), {
    rangeDays: RANGE_CONFIG[activeRange]?.searchWindowDays || 1,
  });
}

function renderPagination(totalPages, totalItems, visibleCount = totalItems, displayTotalCount = totalItems) {
  if (!paginationElement) return;
  const effectiveTotalCount = Math.max(displayTotalCount, totalItems, 0);
  if (!effectiveTotalCount) {
    paginationElement.innerHTML = '';
    if (archiveActionsElement) archiveActionsElement.innerHTML = '';
    return;
  }

  const showPager = !showAllResults && totalPages > 1;

  const pages = [];
  if (showPager) {
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    for (let page = start; page <= end; page += 1) {
      pages.push('<button class="pagination-button' + (page === currentPage ? ' active' : '') + '" type="button" data-page="' + page + '">' + page + '</button>');
    }
  }

  const canExpandToFullArchive = !fullArchiveLoaded && activeRange === '24h';
  const canShowAllToggle = showAllResults || effectiveTotalCount > visibleCount || (canExpandToFullArchive && effectiveTotalCount > 0);
  const allToggle = canShowAllToggle
    ? '<button class="pagination-button pagination-button-wide" type="button" data-toggle-all="true">' + (showAllResults ? '20件表示に戻す' : '全件表示') + '</button>'
    : '';
  const displayStatusText = showAllResults
    ? effectiveTotalCount + '/' + effectiveTotalCount + '件表示中'
    : visibleCount + '/' + effectiveTotalCount + '件表示中';

  if (archiveActionsElement) {
    archiveActionsElement.innerHTML = allToggle
      ? '<div class="pagination-row pagination-row-top"><span class="pagination-status">' + displayStatusText + '</span>' + allToggle + '</div>'
      : '<div class="pagination-row pagination-row-top"><span class="pagination-status">' + displayStatusText + '</span></div>';
  }

  paginationElement.innerHTML = showPager
    ? '<button class="pagination-button" type="button" data-page="' + Math.max(1, currentPage - 1) + '"' + (currentPage === 1 ? ' disabled' : '') + '>前へ</button>' +
      '<span class="pagination-status">' + currentPage + ' / ' + totalPages + ' ページ</span>' +
      pages.join('') +
      '<button class="pagination-button" type="button" data-page="' + Math.min(totalPages, currentPage + 1) + '"' + (currentPage === totalPages ? ' disabled' : '') + '>次へ</button>' +
      allToggle
    : '<span class="pagination-status">' + displayStatusText + '</span>' + allToggle;

  paginationElement.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      showAllResults = false;
      currentPage = Number(button.getAttribute('data-page')) || 1;
      void renderArchive();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  paginationElement.querySelectorAll('[data-toggle-all]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!fullArchiveLoaded) {
        await ensureFullArchiveLoaded({ announce: true });
      }
      showAllResults = !showAllResults;
      currentPage = 1;
      void renderArchive();
    });
  });

  archiveActionsElement?.querySelectorAll('[data-toggle-all]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!fullArchiveLoaded) {
        await ensureFullArchiveLoaded({ announce: true });
      }
      showAllResults = !showAllResults;
      currentPage = 1;
      void renderArchive();
    });
  });
}

async function fetchJson(endpoint) {
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch ' + endpoint);
  return await response.json();
}

function saveTopicCache(topics, { scope = 'home' } = {}) {
  try {
    const items = Array.isArray(topics) ? topics.slice(0, MAX_CACHED_HOME_ITEMS) : [];
    localStorage.setItem(TOPIC_CACHE_KEY, JSON.stringify({
      scope,
      items,
      cachedAt: new Date().toISOString(),
    }));
  } catch {}
}

function readTopicCache() {
  try {
    localStorage.removeItem('internet-news-browse-topic-cache');
    localStorage.removeItem('internet-news-browse-archive-cache-v4');
    const cached = JSON.parse(localStorage.getItem(TOPIC_CACHE_KEY) ?? 'null');
    if (cached?.scope !== 'home') return [];
    if (!Array.isArray(cached?.items)) return [];
    return cached.items.slice(0, MAX_CACHED_HOME_ITEMS);
  } catch {
    return [];
  }
}

async function ensureFullArchiveLoaded({ announce = false } = {}) {
  if (fullArchiveLoaded) return;
  if (!fullArchivePromise) {
    fullArchivePromise = (async () => {
      const archivePayload = await fetchJson(NEWS_ARCHIVE_ENDPOINT).catch(() => null);
      const fullItems = await preparePrimaryArchiveItems(archivePayload?.items ?? []);
      if (fullItems.length) {
        trendItems = fullItems;
        fullArchiveLoaded = true;
        latestUpdatedLabel = archivePayload?.generatedAt
          ? formatDate(archivePayload.generatedAt) + ' 更新'
          : latestUpdatedLabel;
        rebuildDerivedItems();
      }
    })().finally(() => {
      fullArchivePromise = null;
    });
  }

  if (announce) {
    updatedElement.textContent = 'ニュース一覧を拡張中…';
  }
  await fullArchivePromise;
  if (announce) {
    updatedElement.textContent = latestUpdatedLabel;
  }
  if (fullArchiveLoaded) {
    await renderArchive();
  }
}

async function ensureBrowseItemsLoaded({ announce = false } = {}) {
  if (browseItemsLoaded) return;
  if (!browseItemsPromise) {
    browseItemsPromise = (async () => {
      const browsePayload = await fetchJson(BROWSE_TOPICS_ENDPOINT).catch(() => null);
      const browseItems = await normalizeTopicsInBatches(browsePayload?.items ?? []);
      if (!browseItems.length) {
        browseItemsLoaded = true;
        return;
      }

      trendItems = [...trendItems, ...browseItems]
        .sort((left, right) => (getNewsRangeTimestamp(right) ?? 0) - (getNewsRangeTimestamp(left) ?? 0));
      browseItemsLoaded = true;
      rebuildDerivedItems();
      updateRangeTabLabels();
    })().finally(() => {
      browseItemsPromise = null;
    });
  }

  if (announce) {
    updatedElement.textContent = '古いニュースを読み込み中…';
  }
  await browseItemsPromise;
  if (announce) {
    updatedElement.textContent = latestUpdatedLabel;
  }
}

function getArchiveThumbnailUrl(item) {
  return pickCardImageUrl(item);
}

function getArchiveSourceUrl(item) {
  const candidates = [
    item?.sourceUrl,
    item?.url,
    item?.link,
    item?.sourceSignals?.[0]?.canonicalUrl,
    item?.sourceSignals?.[0]?.url,
    item?.sourceSignals?.[1]?.canonicalUrl,
    item?.sourceSignals?.[1]?.url,
    item?.relatedArticles?.[0]?.url,
  ];

  const ranked = candidates
    .map((candidate) => ({
      url: sanitizeArchiveSourceUrl(candidate),
      score: scoreArchiveSourceUrl(candidate),
    }))
    .filter((candidate) => candidate.url)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.url ?? null;
}

function sanitizeArchiveSourceUrl(value) {
  const url = String(value ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (isLikelyHomepageArchiveUrl(url)) return null;
  return url;
}

function scoreArchiveSourceUrl(value) {
  const url = String(value ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return -1000;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    let score = 0;
    if (isLikelyHomepageArchiveUrl(url)) score -= 100;
    else score += 40;
    if (parsed.hostname.toLowerCase() === 'news.google.com') score -= 120;
    if (path.split('/').filter(Boolean).length >= 2) score += 16;
    if (/\d{4}\/\d{2}\/\d{2}|\/article\/|\/articles\/|\/news\/|\/entry\/|\/story\/|\/topics?\//i.test(path)) score += 16;
    if (/\.(?:html?|amp)$/i.test(path)) score += 8;
    if (parsed.search) score += 3;
    return score;
  } catch {
    return -1000;
  }
}

function isLikelyHomepageArchiveUrl(value) {
  try {
    const parsed = new URL(String(value ?? '').trim());
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return (path === '/' || /^\/(?:index\.(?:html?|php)|home)?$/i.test(path)) && !parsed.search;
  } catch {
    return false;
  }
}

function getArchiveSourceLabel(item) {
  return item?.sourceName
    ?? item?.source
    ?? item?.sourceSignals?.[0]?.sourceName
    ?? item?.sourceSignals?.[0]?.source
    ?? getPrimarySourceLabel(item)
    ?? '元記事';
}

function matchesArchiveCategory(item, category) {
  if (!category || category === 'all') return true;
  if (category === 'general') return String(item?.category ?? '') === 'general';
  if (!hasCategory(item, category)) return false;
  if (category === 'adult') return true;
  return hasMeaningfulCategoryContext(item, category);
}

function getCategoryContextText(item) {
  return [
    item?.title,
    item?.summary,
    item?.briefSummary,
    item?.sourceName,
    item?.source,
    item?.sourceSignals?.[0]?.sourceName,
    item?.sourceSignals?.[0]?.source,
  ].filter(Boolean).join(' ').toLowerCase();
}

function hasMeaningfulCategoryContext(item, category) {
  if (!category || category === 'all') return true;
  const text = getCategoryContextText(item);
  switch (category) {
    case 'crime':
      return hasMeaningfulCrimeContext(text);
    case 'politics':
      return hasMeaningfulPoliticsContext(text);
    case 'business':
      return hasMeaningfulBusinessContext(text);
    case 'anime':
      return hasMeaningfulAnimeContext(text);
    case 'game-features':
      return /(インタビュー|開発秘話|制作裏話|コラム|特集|プレイレポート|レビュー|技術解説|先行プレイ|ハンズオン)/.test(text)
        && /(ゲーム|任天堂|nintendo|switch|playstation|ps5|xbox|steam)/.test(text);
    case 'world':
      return hasMeaningfulWorldContext(text);
    case 'sports':
      return hasMeaningfulSportsContext(text);
    default:
      return true;
  }
}

function hasMeaningfulCrimeContext(text) {
  const value = String(text || '').toLowerCase();
  const strongCrimePattern = /逮捕|送検|起訴|判決|容疑|家宅捜索|県警|警視庁|詐欺|強盗|殺人|暴行|窃盗|横領|盗撮|放火|覚醒剤|大麻|わいせつ|書類送検|懲役|実刑|不起訴|保釈|死亡事故|特殊詐欺/;
  const falsePositivePattern = /事件簿|裁判ゲーム|裁判もの|魔女裁判|探偵|ミステリーadv|ミステリー|推理|逆転裁判|グランド・セフト・オート|gta|怪盗|名探偵|コナン|金田一/;

  return strongCrimePattern.test(value) && !falsePositivePattern.test(value);
}

function hasMeaningfulPoliticsContext(text) {
  const value = String(text || '').toLowerCase();
  const strongPoliticsPattern = /政治|首相|政権|国会|選挙|与党|野党|議員|大統領|党派|官房長官|知事|憲法|法案|閣議|自民|立憲|維新|共産|公明|れいわ|国民民主|参院選|衆院選/;
  const falsePositivePattern = /タカ派の大統領|選挙シム|総選挙シミュレーション|大統領シム/;
  return strongPoliticsPattern.test(value) && !falsePositivePattern.test(value);
}

function hasMeaningfulBusinessContext(text) {
  const value = String(text || '').toLowerCase();
  const strongBusinessPattern = /株価|株式|日経平均|ダウ平均|株主総会|決算|企業|日銀|金利|経済|市場|投資|ipo|上場|円安|円高|物価|生産|業界|工場|売上|利益|為替|インフレ|関税|景気|賃上げ|買収|合併/;
  const falsePositivePattern = /経済思想|ゲーム経済|book\s*1位|写真集|アニメ映画|ゲーム内経済/;
  return strongBusinessPattern.test(value) && !falsePositivePattern.test(value);
}

function hasMeaningfulWorldContext(text) {
  const value = String(text || '').toLowerCase();
  const strongWorldPattern = /中国|米国|アメリカ|ウクライナ|ロシア|イラン|イスラエル|中東|外交|国際|米軍|戦況|フィリピン|カンボジア|トランプ|中央軍|nato|eu|国連|首脳会談|停戦|外相会談|大使館|領事館/;
  const falsePositivePattern = /海外メジャー|海外男子|海外版|海外配信|海外アニメイベント|国際アニメ|世界観|ワールドプレミア|グローバルアプリ|国際建設・測量展/;
  return strongWorldPattern.test(value) && !falsePositivePattern.test(value);
}

function hasMeaningfulSportsContext(text) {
  const value = String(text || '').toLowerCase();
  const strongSportsPattern = /野球|サッカー|フットサル|フットボール|jリーグ|w杯|ワールドカップ|日本代表|メジャーリーグ|mlb|npb|ドジャース|大谷|久保建英|三笘|阪神タイガース|巨人軍|巨人入り|読売ジャイアンツ|ジャイアンツ|バドミントン|テニス|ゴルフ|ラグビー|バレーボール|フィギュアスケート|柔道|剣道|相撲|高校野球|都市対抗|自転車ロードレース|自転車道路競走|ロードレース|甲子園|fifa|uefa|チャンピオンズリーグ|プレミアリーグ|リーガ|セリエa|nba|bリーグ|nhl|f1|motogp|箱根駅伝|マラソン|駅伝|soccer|dazn/;
  const falsePositivePattern = /進撃の巨人|監督官|花火大会|献血運動推進全国大会|作品展|展示会|内覧会|同人イベント|アニメイベント|上映会|発売記念|コラボカフェ|写真集|グラビア|コスプレ/;

  return strongSportsPattern.test(value) && !falsePositivePattern.test(value);
}

function hasMeaningfulAnimeContext(text) {
  const value = String(text || '').toLowerCase();
  const strongAnimePattern = /アニメ|アニメ化|劇場版|テレビアニメ|tvアニメ|放送開始|放送日決定|続編制作決定|pv公開|キービジュアル|キャスト発表|スタッフ発表|配信サービス|主題歌|声優|anime/;
  const falsePositivePattern = /アニメーション技術|アニメーション制作ソフト|ゲーム内アニメ|アニメ調グラフィック/;
  return strongAnimePattern.test(value) && !falsePositivePattern.test(value);
}

function getNormalizedTopicForUi(item) {
  const cacheKey = topicCacheKey(item);
  if (normalizedTopicCache.has(cacheKey)) return normalizedTopicCache.get(cacheKey);
  const normalized = normalizeTopic(item);
  normalizedTopicCache.set(cacheKey, normalized);
  return normalized;
}

function topicCacheKey(item) {
  return item?.id
    ?? [
      item?.title ?? '',
      item?.publishedAt ?? '',
      item?.capturedAt ?? '',
      item?.sourceUrl ?? '',
      item?.sourceSignals?.[0]?.url ?? '',
    ].join('::');
}

function isRenderableArchiveItem(item) {
  const topic = getNormalizedTopicForUi(item);
  const title = String(topic?.title ?? '').trim();
  if (!title) return false;

  const sourceLabel = String(
    topic?.sourceName
      ?? topic?.source
      ?? topic?.sourceSignals?.[0]?.sourceName
      ?? topic?.sourceSignals?.[0]?.source
      ?? ''
  ).toLowerCase();
  const text = `${title} ${String(topic?.summary ?? '')} ${String(topic?.briefSummary ?? '')}`.toLowerCase();
  const thumbnailUrl = String(topic?.thumbnailUrl ?? topic?.thumbnail ?? '');

  if (/japanese-tech-writing\/skill|\/skill\.md\b|\/readme\b/.test(text)) return false;
  if (sourceLabel.includes('はてな') && /githubassets\.com\/assets\/gist-og-image|anond\.hatelabo\.jp\/assets\//.test(thumbnailUrl)) return false;

  return true;
}

function isRenderableArchiveItemRaw(item) {
  const title = String(item?.title ?? '').trim();
  if (!title) return false;

  const sourceLabel = String(
    item?.sourceName
      ?? item?.source
      ?? item?.sourceSignals?.[0]?.sourceName
      ?? item?.sourceSignals?.[0]?.source
      ?? ''
  ).toLowerCase();
  const text = `${title} ${String(item?.summary ?? '')} ${String(item?.briefSummary ?? '')}`.toLowerCase();
  const thumbnailUrl = String(item?.thumbnailUrl ?? item?.thumbnail ?? '');

  if (/japanese-tech-writing\/skill|\/skill\.md\b|\/readme\b/.test(text)) return false;
  if (sourceLabel.includes('はてな') && /githubassets\.com\/assets\/gist-og-image|anond\.hatelabo\.jp\/assets\//.test(thumbnailUrl)) return false;

  return true;
}

document.querySelectorAll('.news-range-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.news-range-tabs button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeRange = button.dataset.range || '24h';
    currentPage = 1;
    showAllResults = false;
    void renderArchive();
  });
});

document.querySelectorAll('.news-category-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.news-category-tabs button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeCategory = button.dataset.category;
    currentPage = 1;
    showAllResults = false;
    void renderArchive();
  });
});

queryElement.addEventListener('input', () => {
  currentPage = 1;
  showAllResults = false;
  clearTimeout(queryDebounceTimer);
  queryDebounceTimer = window.setTimeout(() => {
    void renderArchive();
  }, 180);
});
