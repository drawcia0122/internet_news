import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const script = await readFile(new URL('../news.js', import.meta.url), 'utf8');
const CACHE_KEY = 'internet-news-browse-archive-cache-v6';
const cachedArticle = {
  id: 'saved-news',
  title: '保存済みのニュース',
  sourceUrl: 'https://example.com/news/saved',
  publishedAt: new Date().toISOString(),
};

async function startArchive({ cached = [cachedArticle], fetchImpl, requestAnimationFrameImpl } = {}) {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML: '', textContent: '', value: '',
      listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; }, querySelectorAll() { return []; },
      insertAdjacentHTML(_position, html) { this.innerHTML += html; },
    });
    return elements.get(selector);
  };
  const originalCache = JSON.stringify({ scope: 'home', items: cached, cachedAt: '2026-09-30T00:00:00Z' });
  const storage = new Map(cached.length ? [[CACHE_KEY, originalCache]] : []);
  const writes = [];
  let preparationCalls = 0;
  const utils = {
    buildImportantPoint: () => '', buildGoogleNewsUrl: () => 'https://news.google.com/',
    buildTargetAudience: () => [], buildWhyHotLabel: () => '',
    categoryDisplayLabel: () => 'ニュース', categoryLabelFor: () => 'ニュース',
    defaultSearchQueryForCategory: () => '', escapeHtml: (value) => String(value ?? ''),
    formatDate: (value) => value, formatTopicDisplayTime: () => '',
    getPrimarySourceLabel: () => '出典', hasVisibleSummary: () => false,
    matchesNewsCategory: () => true, normalizeTopic: (item) => item,
    pickCardImageUrl: () => null, prepareNewsListItems: (items) => { preparationCalls += 1; return items; },
    sanitizeArticleSummaryCollection: (items) => items, shortEventFromTitle: () => '',
  };
  const context = vm.createContext({
    URL, Date, console, setTimeout, clearTimeout,
    window: { TopicClientUtils: utils, setTimeout },
    document: { querySelector: element, querySelectorAll: () => [], addEventListener() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { writes.push(key); storage.set(key, value); },
      removeItem: (key) => storage.delete(key),
    },
    fetch: fetchImpl ?? (async () => { throw new TypeError('Network unavailable'); }),
    requestAnimationFrame: requestAnimationFrameImpl ?? ((callback) => callback()),
  });
  vm.runInContext(script, context, { filename: 'news.js' });
  // init() starts automatically; these fixtures render one batch synchronously.
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, storage, writes, originalCache, context, preparationCalls };
}

test('network failure keeps saved articles visible and preserves the cache timestamp', async () => {
  const result = await startArchive();
  assert.match(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
  assert.equal(result.elements.get('#news-count').textContent, '1 件');
  assert.equal(result.elements.get('#news-updated').textContent, '読み込み失敗・キャッシュを表示中');
  assert.equal(result.storage.get(CACHE_KEY), result.originalCache);
  assert.deepEqual(result.writes, []);
});

test('a later page failure also retains the previous complete cached collection', async () => {
  const result = await startArchive({ fetchImpl: async (url) => {
    if (url.includes('page-2')) throw new TypeError('Connection interrupted');
    return { ok: true, json: async () => ({ items: [], nextPage: 2 }) };
  } });
  assert.match(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
  assert.equal(result.storage.get(CACHE_KEY), result.originalCache);
});

test('failure without a cache reports failure without creating an empty cache', async () => {
  const result = await startArchive({ cached: [] });
  assert.equal(result.elements.get('#news-updated').textContent, '読み込み失敗');
  assert.equal(result.elements.get('#news-count').textContent, '0 件');
  assert.equal(result.storage.has(CACHE_KEY), false);
});

test('successful refresh replaces saved articles and persists the fresh collection', async () => {
  const fresh = { ...cachedArticle, id: 'fresh-news', title: '新しいニュース' };
  const result = await startArchive({ fetchImpl: async () => ({
    ok: true, json: async () => ({ items: [fresh], generatedAt: '2026-10-01T16:00:00Z' }),
  }) });
  assert.match(result.elements.get('#news-archive-list').innerHTML, /新しいニュース/);
  assert.doesNotMatch(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
  assert.deepEqual(JSON.parse(result.storage.get(CACHE_KEY)).items, [fresh]);
  assert.equal(result.elements.get('#news-updated').textContent, '2026-10-01T16:00:00Z 更新');
});


test('all-period default includes dated historical articles and articles without dates', async () => {
  const oldArticle = { ...cachedArticle, id: 'old', title: '過去のニュース', publishedAt: new Date(Date.now() - 10 * 86400000).toISOString() };
  const unknownDate = { ...cachedArticle, id: 'undated', title: '日付不明のニュース', publishedAt: null };
  const result = await startArchive({ cached: [cachedArticle, oldArticle, unknownDate] });
  assert.equal(result.elements.get('#news-count').textContent, '3 件');
  assert.match(result.elements.get('#news-archive-list').innerHTML, /過去のニュース/);
  assert.match(result.elements.get('#news-archive-list').innerHTML, /日付不明のニュース/);
  await vm.runInContext("activeRange = '7-14d'; renderArchive()", result.context);
  assert.equal(result.elements.get('#news-count').textContent, '1 件');
});

test('show-all resets search, category, period and pagination together', async () => {
  const result = await startArchive();
  await vm.runInContext("activeRange = '7-14d'; activeCategory = 'tech'; currentPage = 3; queryElement.value = 'no-match'; renderArchive()", result.context);
  assert.equal(result.elements.get('#news-count').textContent, '0 件');
  result.elements.get('#news-show-all').listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.elements.get('#news-count').textContent, '1 件');
  assert.equal(result.elements.get('#news-query').value, '');
  assert.equal(vm.runInContext('activeRange', result.context), 'all');
  assert.equal(vm.runInContext('activeCategory', result.context), 'all');
  assert.equal(vm.runInContext('currentPage', result.context), 1);
});

test('an empty filter cancels pending batches and stale pagination', async () => {
  const frames = [];
  const articles = Array.from({ length: 25 }, (_, i) => ({ ...cachedArticle, id: `saved-${i}`, title: `ニュース ${i}` }));
  const result = await startArchive({ cached: articles, requestAnimationFrameImpl: (callback) => frames.push(callback) });
  await vm.runInContext("queryElement.value = 'no-match'; renderArchive()", result.context);
  while (frames.length) {
    frames.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(result.elements.get('#news-count').textContent, '0 件');
  assert.doesNotMatch(result.elements.get('#news-archive-list').innerHTML, /trend-card-rich/);
  assert.equal(result.elements.get('#trend-pagination').innerHTML, '');
});

test('a fresh version of a cached article replaces stale normalized card content', async () => {
  const result = await startArchive({ fetchImpl: async () => ({
    ok: true, json: async () => ({ items: [{ ...cachedArticle, title: '修正後のニュース' }] }),
  }) });
  assert.match(result.elements.get('#news-archive-list').innerHTML, /修正後のニュース/);
  assert.doesNotMatch(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
});

test('published dates take precedence over new capture times and invalid dates fall back safely', async () => {
  const result = await startArchive();
  const published = Date.now() - 2 * 86400000;
  result.context.fixture = {
    publishedAt: new Date(published).toISOString(), capturedAt: new Date().toISOString(),
    sourceSignals: [{ publishedAt: 'invalid-date' }],
  };
  assert.equal(vm.runInContext('getNewsRangeTimestamp(fixture)', result.context), published);
  assert.equal(vm.runInContext("isWithinNewsRange(fixture, RANGE_CONFIG['24h'])", result.context), false);
  assert.equal(vm.runInContext("isWithinNewsRange(fixture, RANGE_CONFIG['24-3d'])", result.context), true);
  result.context.fixture = { publishedAt: 'invalid', capturedAt: null };
  assert.equal(vm.runInContext('getNewsRangeTimestamp(fixture)', result.context), null);
  assert.equal(vm.runInContext("isWithinNewsRange(fixture, RANGE_CONFIG['24h'])", result.context), false);
});


test('a successful uncached load prepares the full collection only once', async () => {
  const result = await startArchive({ cached: [], fetchImpl: async () => ({
    ok: true, json: async () => ({ items: [cachedArticle] }),
  }) });
  assert.equal(result.preparationCalls, 1);
  assert.equal(result.elements.get('#news-count').textContent, '1 件');
});
