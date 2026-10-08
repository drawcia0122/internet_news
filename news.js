const {
  buildCardThumbnail,
  buildArticleTitleLink,
  buildImportantPoint,
  buildGoogleNewsUrl,
  buildTargetAudience,
  buildWhyHotLabel,
  categoryDisplayLabel,
  categoryLabelFor,
  defaultSearchQueryForCategory,
  escapeHtml,
  formatDate,
  formatTopicDisplayTime,
  getPrimarySourceLabel,
  hasVisibleSummary,
  handleCardImageError,
  matchesNewsCategory,
  normalizeTopic,
  pickCardImageUrl,
  prepareNewsListItems,
  getNewsArticleSource,
  groupNewsStories,
  formatNewsStoryCount,
  renderStorySources,
  sanitizeArticleSummaryCollection,
  shortEventFromTitle,
} = window.TopicClientUtils;

const listElement = document.querySelector('#news-archive-list');
const countElement = document.querySelector('#news-count');
const updatedElement = document.querySelector('#news-updated');
const retryElement = document.querySelector('#news-retry');
const queryElement = document.querySelector('#news-query');
const searchButtonElement = document.querySelector('.news-search-button');
const paginationElement = document.querySelector('#trend-pagination');
const archiveActionsElement = document.querySelector('#news-archive-actions');

const PAGE_SIZE = 20;
const RENDER_BATCH_SIZE = 4;
const HOME_NEWS_ENDPOINT = './data/home-news.json';
const TOPIC_CACHE_KEY = 'internet-news-browse-archive-cache-v6';
const MAX_CACHED_HOME_ITEMS = 1500;
const RANGE_CONFIG = {
  all: { minHours: 0, maxHours: Number.POSITIVE_INFINITY, label: '全期間', searchWindowDays: 14 },
  '24h': { minHours: 0, maxHours: 24, label: '24時間以内', searchWindowDays: 1 },
  '24-3d': { minHours: 24, maxHours: 72, label: '24時間〜3日', searchWindowDays: 3 },
  '3-7d': { minHours: 72, maxHours: 168, label: '3日〜7日', searchWindowDays: 7 },
  '7-14d': { minHours: 168, maxHours: 336, label: '7日〜14日', searchWindowDays: 14 },
};

let archiveLoading = false;
let archiveLoadFailed = false;
let trendItems = [];
let dedupedTrendItems = [];
let activeCategory = 'all';
let activeRange = 'all';
let currentPage = 1;
let queryDebounceTimer = null;
let renderPassId = 0;
let latestUpdatedLabel = '更新時刻不明';
const rangeItemsCache = new Map();
const rangeDisplayCountCache = new Map();
const normalizedTopicCache = new Map();

document.addEventListener('error', handleCardImageError, true);

init();

async function init() {
  if (archiveLoading) return;
  archiveLoading = true;
  archiveLoadFailed = false;
  if (retryElement) retryElement.disabled = true;
  const cachedTopics = trendItems.length ? trendItems : readTopicCache();
  if (cachedTopics.length) {
    trendItems = cachedTopics;
    rebuildDerivedItems();
    latestUpdatedLabel = 'キャッシュを表示中';
    updatedElement.textContent = latestUpdatedLabel;
  }
  updatedElement.textContent = cachedTopics.length ? 'ニュースを再読み込み中・キャッシュを表示中' : 'ニュースを読み込み中…';
  void renderArchive();

  try {
    const archivePayload = await fetchJson(HOME_NEWS_ENDPOINT).catch(() => null);
    if (!archivePayload) throw new Error('Failed to fetch general news');
    const completeItems = await loadCompleteHomeNews(archivePayload);
    const preparedArchive = preparePrimaryArchiveItems(completeItems);
    trendItems = preparedArchive;
    rebuildDerivedItems({ prepared: true });
    latestUpdatedLabel = archivePayload?.generatedAt
      ? formatDate(archivePayload.generatedAt) + ' 更新'
      : '更新時刻不明';
    updatedElement.textContent = latestUpdatedLabel;
    saveTopicCache(trendItems, { scope: 'home' });
  } catch {
    archiveLoadFailed = true;
    trendItems = cachedTopics;
    rebuildDerivedItems();
    latestUpdatedLabel = cachedTopics.length ? '読み込み失敗・キャッシュを表示中' : '読み込み失敗';
    updatedElement.textContent = latestUpdatedLabel;
  }

  archiveLoading = false;
  if (retryElement) {
    retryElement.disabled = false;
    retryElement.hidden = !archiveLoadFailed;
  }
  updateRangeTabLabels();
  await renderArchive();
}

async function renderArchive() {
  const passId = ++renderPassId;
  const query = queryElement.value.trim().toLowerCase();
  normalizedTopicCache.clear();
  const filteredArticles = getRangeItems(activeRange)
    .filter((item) => matchesNewsCategory(item, activeCategory))
    .filter((item) => {
      if (!query) return true;
      return (String(item.title ?? '') + ' ' + String(item.summary ?? '')).toLowerCase().includes(query);
    });

  // Filters operate on original articles, so another publisher’s title/date or
  // category remains searchable even when its article was previously collapsed.
  const filtered = groupNewsStories(filteredArticles);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  countElement.textContent = formatNewsStoryCount(filtered);
  updateRangeTabLabels();
  updateSearchButton();

  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (!filtered.length) {
    const unavailable = !dedupedTrendItems.length && (archiveLoading || archiveLoadFailed);
    const title = unavailable
      ? (archiveLoading ? 'ニュースを読み込み中…' : 'ニュースを読み込めませんでした')
      : '該当するニュースはありません';
    const message = unavailable
      ? (archiveLoading ? '読み込みが終わるまでお待ちください。' : '通信状況を確認して「ニュースを再読み込み」を押してください。')
      : '期間・カテゴリ・キーワードを変えてもう一度探してみてください。';
    listElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>' + title + '</strong><p>' + message + '</p></div>';
    renderPagination(0, filtered.length, pageItems.length);
    return;
  }

  await renderArchivePageItems(pageItems, passId);
  if (passId !== renderPassId) return;
  renderPagination(totalPages, filtered.length, pageItems.length);
}

function preparePrimaryArchiveItems(rawItems) {
  return prepareNewsListItems(sanitizeArticleSummaryCollection(Array.isArray(rawItems) ? rawItems : []));
}

async function loadCompleteHomeNews(initialPayload) {
  const items = [...(Array.isArray(initialPayload?.items) ? initialPayload.items : [])];
  const visitedPages = new Set();
  let nextPage = Number(initialPayload?.nextPage ?? 0) || 0;

  while (nextPage && !visitedPages.has(nextPage)) {
    visitedPages.add(nextPage);
    const pagePayload = await fetchJson(`./data/home-news-page-${nextPage}.json`);
    if (Array.isArray(pagePayload?.items)) items.push(...pagePayload.items);
    nextPage = Number(pagePayload?.nextPage ?? 0) || 0;
  }

  return items;
}

async function renderArchivePageItems(items, passId) {
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
  const thumb = thumbnailUrl ? buildCardThumbnail(item) : '';
  const hasThumbnail = Boolean(thumb);
  const sourceUrl = getArchiveSourceUrl(item);
  const sourceLabel = getArchiveSourceLabel(item);
  const summaryHtml = hasVisibleSummary(item.summary) ? '<p>' + escapeHtml(item.summary ?? '') + '</p>' : '';
  const insightHtml = renderInsightList(item);
  const footerHtml = sourceUrl
    ? '<div class="trend-footer"><span><strong>' + escapeHtml(sourceLabel) + '</strong></span><a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer">元記事を見る ↗</a></div>'
    : '<div class="trend-footer"><span><strong>元記事リンクなし</strong></span><span class="detail-link">リンクなし</span></div>';
  const titleHtml = buildArticleTitleLink(item.title ?? 'ニュース', sourceUrl);
  const bodyHtml = '<div><div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(item)) + '</span><time>' + escapeHtml(formatTopicDisplayTime(item)) + '</time></div><h3>' + titleHtml + '</h3>' + summaryHtml + insightHtml + footerHtml + renderStorySources(item) + '</div>';
  const cardClass = 'trend-card trend-card-rich' + (hasThumbnail ? ' has-thumb' : ' trend-card-no-thumb');
  // Keep native details/summary and publisher anchors outside any outer link.
  return '<article class="' + cardClass + '">' + thumb + bodyHtml + '</article>';
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
    button.textContent = range.label + ' (' + count + '話題)';
  });
}

function getRangeDisplayCount(rangeKey) {
  if (!rangeDisplayCountCache.has(rangeKey)) rangeDisplayCountCache.set(rangeKey, groupNewsStories(getRangeItems(rangeKey)).length);
  return rangeDisplayCountCache.get(rangeKey);
}

function rebuildDerivedItems({ prepared = false } = {}) {
  dedupedTrendItems = prepared ? trendItems : prepareNewsListItems(trendItems);
  rangeItemsCache.clear();
  rangeDisplayCountCache.clear();
  normalizedTopicCache.clear();
}

function getRangeItems(rangeKey) {
  const key = RANGE_CONFIG[rangeKey] ? rangeKey : 'all';
  if (rangeItemsCache.has(key)) return rangeItemsCache.get(key);
  const range = RANGE_CONFIG[key];
  const items = key === 'all'
    ? dedupedTrendItems
    : dedupedTrendItems.filter((item) => isWithinNewsRange(item, range));
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

function renderPagination(totalPages, totalItems, visibleCount = totalItems) {
  if (!paginationElement) return;
  if (!totalItems) {
    paginationElement.innerHTML = '';
    if (archiveActionsElement) archiveActionsElement.innerHTML = '';
    return;
  }

  const pages = [];
  if (totalPages > 1) {
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    for (let page = start; page <= end; page += 1) {
      pages.push('<button class="pagination-button' + (page === currentPage ? ' active' : '') + '" type="button" data-page="' + page + '">' + page + '</button>');
    }
  }

  const rangeStart = (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = rangeStart + visibleCount - 1;
  const displayStatusText = rangeStart + '〜' + rangeEnd + ' / ' + totalItems + '話題';

  if (archiveActionsElement) {
    archiveActionsElement.innerHTML = '<div class="pagination-row pagination-row-top"><span class="pagination-status">' + displayStatusText + '</span></div>';
  }

  paginationElement.innerHTML = totalPages > 1
    ? '<button class="pagination-button" type="button" data-page="' + Math.max(1, currentPage - 1) + '"' + (currentPage === 1 ? ' disabled' : '') + '>前へ</button>' +
      '<span class="pagination-status">' + currentPage + ' / ' + totalPages + ' ページ</span>' +
      pages.join('') +
      '<button class="pagination-button" type="button" data-page="' + Math.min(totalPages, currentPage + 1) + '"' + (currentPage === totalPages ? ' disabled' : '') + '>次へ</button>'
    : '<span class="pagination-status">' + displayStatusText + '</span>';

  paginationElement.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      currentPage = Number(button.getAttribute('data-page')) || 1;
      void renderArchive();
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
    localStorage.removeItem('internet-news-browse-archive-cache-v5');
    const cached = JSON.parse(localStorage.getItem(TOPIC_CACHE_KEY) ?? 'null');
    if (cached?.scope !== 'home') return [];
    if (!Array.isArray(cached?.items)) return [];
    return cached.items.slice(0, MAX_CACHED_HOME_ITEMS);
  } catch {
    return [];
  }
}

function getArchiveThumbnailUrl(item) {
  return pickCardImageUrl(item);
}

function getArchiveSourceUrl(item) {
  return getNewsArticleSource(item)?.url ?? null;
}

function getArchiveSourceLabel(item) {
  return getNewsArticleSource(item)?.label ?? '元記事';
}

function getNormalizedTopicForUi(item) {
  const cacheKey = item;
  if (normalizedTopicCache.has(cacheKey)) return normalizedTopicCache.get(cacheKey);
  const normalized = normalizeTopic(item);
  normalizedTopicCache.set(cacheKey, normalized);
  return normalized;
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

document.querySelectorAll('.news-range-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.news-range-tabs button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeRange = button.dataset.range || 'all';
    currentPage = 1;
    void renderArchive();
  });
});

document.querySelectorAll('.news-category-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.news-category-tabs button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeCategory = button.dataset.category;
    currentPage = 1;
    void renderArchive();
  });
});

queryElement.addEventListener('input', () => {
  currentPage = 1;
  clearTimeout(queryDebounceTimer);
  queryDebounceTimer = window.setTimeout(() => {
    void renderArchive();
  }, 180);
});

document.querySelector('#news-show-all')?.addEventListener('click', () => {
  activeRange = 'all';
  activeCategory = 'all';
  currentPage = 1;
  queryElement.value = '';
  clearTimeout(queryDebounceTimer);
  document.querySelectorAll('.news-range-tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.range === 'all');
  });
  document.querySelectorAll('.news-category-tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.category === 'all');
  });
  void renderArchive();
});

retryElement?.addEventListener('click', () => { void init(); });
