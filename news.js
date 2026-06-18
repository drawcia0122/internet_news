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
  getPrimarySourceLabel,
  getPrimarySourceUrl,
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

const PAGE_SIZE = 16;
const RENDER_BATCH_SIZE = 4;
const NEWS_ARCHIVE_ENDPOINT = './data/news-archive.json';
const BROWSE_TOPICS_ENDPOINT = './data/trend-topics-browse.json';
const TOPIC_CACHE_KEY = 'internet-news-browse-archive-cache-v3';
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
    const archivePayload = await fetchJson(NEWS_ARCHIVE_ENDPOINT).catch(() => null);
    const preparedArchive = await preparePrimaryArchiveItems(archivePayload?.items ?? []);
    trendItems = preparedArchive.allItems;
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

  saveTopicCache(trendItems);
  updateRangeTabLabels();
  await renderArchive();
  void warmBrowseItems();
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
  countElement.textContent = filtered.length + ' 件';
  updateRangeTabLabels();
  updateSearchButton();

  if (!filtered.length) {
    listElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>該当するニュースはありません</strong><p>期間・カテゴリ・キーワードを変えてもう一度探してみてください。</p></div>';
    renderPagination(0, 0);
    return;
  }

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);
  await renderArchivePageItems(pageItems);
  renderPagination(totalPages, filtered.length);
}

async function preparePrimaryArchiveItems(rawItems) {
  const inputItems = Array.isArray(rawItems) ? rawItems : [];
  const allItems = [];
  const currentItems = [];
  const archiveItems = [];

  for (const item of inputItems) {
    if (!isRenderableArchiveItemRaw(item)) continue;
    allItems.push(item);
    if (isWithinNewsRange(item, RANGE_CONFIG['24h'])) currentItems.push(item);
    else archiveItems.push(item);
  }

  allItems.sort((left, right) => (getNewsRangeTimestamp(right) ?? 0) - (getNewsRangeTimestamp(left) ?? 0));
  currentItems.sort((left, right) => (getNewsRangeTimestamp(right) ?? 0) - (getNewsRangeTimestamp(left) ?? 0));
  archiveItems.sort((left, right) => (getNewsRangeTimestamp(right) ?? 0) - (getNewsRangeTimestamp(left) ?? 0));

  return { allItems, currentItems, archiveItems };
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
  const bodyHtml = '<div><div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(item)) + '</span><time>' + escapeHtml(item.time ?? formatDate(item.capturedAt)) + '</time></div><h3>' + escapeHtml(item.title ?? 'ニュース') + '</h3>' + summaryHtml + insightHtml + footerHtml + '</div>';
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
    const count = getRangeItems(button.dataset.range).length;
    const isDeferredRange = button.dataset.range !== '24h' && !browseItemsLoaded;
    button.textContent = isDeferredRange
      ? range.label + ' (…)'
      : range.label + ' (' + count + ')';
  });
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

function renderPagination(totalPages, totalItems) {
  if (!paginationElement) return;
  if (!totalItems || totalPages <= 1) {
    paginationElement.innerHTML = '';
    return;
  }

  const pages = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  for (let page = start; page <= end; page += 1) {
    pages.push('<button class="pagination-button' + (page === currentPage ? ' active' : '') + '" type="button" data-page="' + page + '">' + page + '</button>');
  }

  paginationElement.innerHTML =
    '<button class="pagination-button" type="button" data-page="' + Math.max(1, currentPage - 1) + '"' + (currentPage === 1 ? ' disabled' : '') + '>前へ</button>' +
    '<span class="pagination-status">' + currentPage + ' / ' + totalPages + ' ページ</span>' +
    pages.join('') +
    '<button class="pagination-button" type="button" data-page="' + Math.min(totalPages, currentPage + 1) + '"' + (currentPage === totalPages ? ' disabled' : '') + '>次へ</button>';

  paginationElement.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      currentPage = Number(button.getAttribute('data-page')) || 1;
      void renderArchive();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

async function fetchJson(endpoint) {
  const response = await fetch(endpoint, { cache: 'default' });
  if (!response.ok) throw new Error('Failed to fetch ' + endpoint);
  return await response.json();
}

function saveTopicCache(topics) {
  try {
    localStorage.setItem(TOPIC_CACHE_KEY, JSON.stringify({
      items: Array.isArray(topics) ? topics : [],
      cachedAt: new Date().toISOString(),
    }));
  } catch {}
}

function readTopicCache() {
  try {
    localStorage.removeItem('internet-news-browse-topic-cache');
    const cached = JSON.parse(localStorage.getItem(TOPIC_CACHE_KEY) ?? 'null');
    return Array.isArray(cached?.items) ? cached.items : [];
  } catch {
    return [];
  }
}

async function warmBrowseItems() {
  await ensureBrowseItemsLoaded({ announce: false });
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
  if (!hasCategory(item, category)) return false;
  if (category !== 'crime') return true;
  return hasMeaningfulCrimeContext(item);
}

function hasMeaningfulCrimeContext(item) {
  const text = [
    item?.title,
    item?.summary,
    item?.briefSummary,
    ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals.flatMap((signal) => [
      signal?.title,
      signal?.summary,
      signal?.sourceName,
    ]) : []),
  ].filter(Boolean).join(' ').toLowerCase();

  const strongCrimePattern = /逮捕|送検|起訴|判決|容疑|家宅捜索|県警|警視庁|詐欺|強盗|殺人|暴行|窃盗|横領|盗撮|放火|覚醒剤|大麻|わいせつ|書類送検|懲役|実刑|不起訴|保釈|死亡事故|特殊詐欺/;
  const falsePositivePattern = /事件簿|裁判ゲーム|裁判もの|魔女裁判|探偵|ミステリーadv|ミステリー|推理|逆転裁判|グランド・セフト・オート|gta|怪盗|名探偵|コナン|金田一/;

  return strongCrimePattern.test(text) && !falsePositivePattern.test(text);
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
