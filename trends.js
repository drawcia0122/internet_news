const {
  archiveTimestamp,
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
  getPrimarySourceUrl,
  hasCategory,
  hasVisibleSummary,
  isWithinRange,
  normalizeTopic,
  shortEventFromTitle,
} = window.TopicClientUtils;

const listElement = document.querySelector('#news-archive-list');
const countElement = document.querySelector('#news-count');
const updatedElement = document.querySelector('#news-updated');
const queryElement = document.querySelector('#news-query');
const searchButtonElement = document.querySelector('.news-search-button');
const paginationElement = document.querySelector('#trend-pagination');
const PAGE_SIZE = 16;
const RANGE_CONFIG = {
  '24h': { minHours: 0, maxHours: 24, label: '24時間以内', searchWindowDays: 1 },
  '24-3d': { minHours: 24, maxHours: 72, label: '24時間〜3日以内', searchWindowDays: 3 },
  '3-7d': { minHours: 72, maxHours: 168, label: '3日〜7日以内', searchWindowDays: 7 },
  '7-14d': { minHours: 168, maxHours: 336, label: '7日〜14日', searchWindowDays: 14 },
};

let trendItems = [];
let currentTrendItems = [];
let archiveTrendItems = [];
let activeCategory = 'all';
let activeRange = '24h';
let currentPage = 1;
let archiveLoaded = false;
let archiveLoadingPromise = null;
let queryDebounceTimer = null;

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
    currentTrendItems = cachedTopics;
    updatedElement.textContent = 'キャッシュを表示中';
    void renderTrendIndex();
  }

  try {
    const currentPayload = await fetchJson('./data/trend-topics.json').catch(() => null);
    currentTrendItems = (currentPayload?.items ?? []).map((topic) => normalizeTopic(topic));
    trendItems = [...currentTrendItems].sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
    updatedElement.textContent = currentPayload?.generatedAt
      ? formatDate(currentPayload.generatedAt) + ' 更新'
      : '更新時刻不明';
  } catch {
    trendItems = [];
    currentTrendItems = [];
    updatedElement.textContent = '読み込み失敗';
  }

  saveTopicCache(trendItems);
  await renderTrendIndex();
}

async function renderTrendIndex() {
  await ensureArchiveLoadedIfNeeded();
  const query = queryElement.value.trim().toLowerCase();
  const range = RANGE_CONFIG[activeRange] || RANGE_CONFIG['24h'];
  const filtered = dedupeTopics(trendItems)
    .filter((item) => isWithinRange(item, range))
    .filter((item) => activeCategory === 'all' || hasCategory(item, activeCategory))
    .filter((item) => {
      if (!query) return true;
      return (String(item.title ?? '') + ' ' + String(item.summary ?? '')).toLowerCase().includes(query);
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  countElement.textContent = filtered.length + ' 件';
  updateSearchButton();

  if (!filtered.length) {
    listElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>該当する話題はありません</strong><p>カテゴリやキーワードを変えてもう一度探してみてください。</p></div>';
    renderPagination(0, 0);
    return;
  }

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);
  listElement.innerHTML = pageItems.map((item) => renderTrendCard(item)).join('');
  renderPagination(totalPages, filtered.length);
}

async function ensureArchiveLoadedIfNeeded() {
  if (activeRange === '24h' || archiveLoaded) return;
  if (archiveLoadingPromise) {
    await archiveLoadingPromise;
    return;
  }

  const previousUpdatedText = updatedElement?.textContent ?? '';
  if (updatedElement) updatedElement.textContent = 'アーカイブを読み込み中…';
  if (listElement && !listElement.children.length) {
    listElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>古い話題を読み込み中です</strong><p>一覧表示のためにアーカイブデータを追加しています。</p></div>';
  }

  archiveLoadingPromise = (async () => {
    const archivePayload = await fetchJson('./data/trend-topics-browse.json').catch(() => null);
    archiveTrendItems = (archivePayload?.items ?? []).map((topic) => normalizeTopic(topic));
    trendItems = [...currentTrendItems, ...archiveTrendItems]
      .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
    archiveLoaded = true;
    saveTopicCache(trendItems);
    if (updatedElement) {
      updatedElement.textContent = archivePayload?.generatedAt
        ? formatDate(archivePayload.generatedAt) + ' 更新'
        : (previousUpdatedText || '更新時刻不明');
    }
  })();

  try {
    await archiveLoadingPromise;
  } finally {
    archiveLoadingPromise = null;
  }
}

function renderTrendCard(item) {
  const hasThumbnail = Boolean(item.thumbnailUrl);
  const sourceUrl = getPrimarySourceUrl(item);
  const sourceLabel = getPrimarySourceLabel(item);
  const thumbnail = hasThumbnail
    ? '<img class="trend-thumb" src="' + escapeHtml(item.thumbnailUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
    : '';
  const summaryHtml = hasVisibleSummary(item.summary) ? '<p>' + escapeHtml(item.summary ?? '') + '</p>' : '';
  const insightHtml = renderInsightList(item);
  const cardClass = 'trend-card trend-card-rich trend-card-link' + (hasThumbnail ? ' has-thumb' : ' trend-card-no-thumb');
  const bodyHtml =
    '<div><div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(item)) + '</span><time>' + escapeHtml(formatTopicDisplayTime(item)) + '</time></div>' +
    '<h3>' + escapeHtml(item.title ?? 'ニュース') + '</h3>' + summaryHtml +
    insightHtml +
    '<div class="trend-footer"><span><strong>' + escapeHtml(String(item.posts ?? 1)) + '</strong> ' + escapeHtml(item.metricLabel ?? 'source') + '</span>' +
    (sourceUrl
      ? '<span class="detail-link">' + escapeHtml(sourceLabel) + ' ↗</span>'
      : '<span class="detail-link">元記事リンクなし</span>') + '</div>' +
    '</div>';

  if (!sourceUrl) {
    return '<article class="' + cardClass + '" aria-disabled="true">' +
      (thumbnail ? '<div class="trend-thumb-wrap">' + thumbnail + '</div>' : '') +
      bodyHtml +
      '</article>';
  }

  return '<a class="' + cardClass + '" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' +
    (thumbnail ? '<div class="trend-thumb-wrap">' + thumbnail + '</div>' : '') +
    bodyHtml +
    '</a>';
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

function updateSearchButton() {
  if (!searchButtonElement) return;
  const text = queryElement.value.trim();
  searchButtonElement.textContent = text
    ? '「' + text + '」でGoogleニュース検索 ↗'
    : (activeCategory === 'all' ? 'Googleニュースで広く探す ↗' : categoryLabelFor(activeCategory) + 'をGoogleニュースで探す ↗');
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
      void renderTrendIndex();
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
    localStorage.setItem('internet-news-browse-topic-cache', JSON.stringify(topics ?? []));
  } catch {}
}

function readTopicCache() {
  try {
    const cached = JSON.parse(localStorage.getItem('internet-news-browse-topic-cache') ?? '[]');
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

document.querySelectorAll('.news-category-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.news-category-tabs button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeCategory = button.dataset.category;
    currentPage = 1;
    void renderTrendIndex();
  });
});

document.querySelectorAll('.news-range-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.news-range-tabs button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeRange = button.dataset.range || '24h';
    currentPage = 1;
    void renderTrendIndex();
  });
});

queryElement.addEventListener('input', () => {
  currentPage = 1;
  clearTimeout(queryDebounceTimer);
  queryDebounceTimer = window.setTimeout(() => {
    void renderTrendIndex();
  }, 180);
});
