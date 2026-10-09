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
    buildArticleTitleLink: (title) => title,
    groupNewsStories: (items) => items,
    formatNewsStoryCount: (items) => items.length + ' 話題',
    renderStorySources: () => '',
    getNewsArticleSource: (item) => ({ url: item.sourceUrl, label: '出典' }),
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
  assert.equal(result.elements.get('#news-count').textContent, '1 話題');
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
  assert.equal(result.elements.get('#news-count').textContent, '0 話題');
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
  assert.equal(result.elements.get('#news-count').textContent, '3 話題');
  assert.match(result.elements.get('#news-archive-list').innerHTML, /過去のニュース/);
  assert.match(result.elements.get('#news-archive-list').innerHTML, /日付不明のニュース/);
  await vm.runInContext("activeRange = '7-14d'; renderArchive()", result.context);
  assert.equal(result.elements.get('#news-count').textContent, '1 話題');
});

test('show-all resets search, category, period and pagination together', async () => {
  const result = await startArchive();
  await vm.runInContext("activeRange = '7-14d'; activeCategory = 'tech'; currentPage = 3; queryElement.value = 'no-match'; renderArchive()", result.context);
  assert.equal(result.elements.get('#news-count').textContent, '0 話題');
  result.elements.get('#news-show-all').listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.elements.get('#news-count').textContent, '1 話題');
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
  assert.equal(result.elements.get('#news-count').textContent, '0 話題');
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
  assert.equal(result.elements.get('#news-count').textContent, '1 話題');
});

test('a failed uncached load explains the retrieval error instead of an empty search', async () => {
  const result = await startArchive({ cached: [] });
  assert.match(result.elements.get('#news-archive-list').innerHTML, /ニュースを読み込めませんでした/);
  assert.doesNotMatch(result.elements.get('#news-archive-list').innerHTML, /該当するニュースはありません/);
  assert.equal(result.elements.get('#news-retry').hidden, false);
});

test('retry recovers without clearing filters and repeated clicks share one load', async () => {
  let calls = 0;
  let release;
  const result = await startArchive({ cached: [], fetchImpl: async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, json: async () => ({ items: [cachedArticle] }) };
  } });
  result.elements.get('#news-query').value = '保存済み';
  await vm.runInContext("activeRange = '24h'; activeCategory = 'tech'; renderArchive()", result.context);
  result.elements.get('#news-retry').listeners.click();
  result.elements.get('#news-retry').listeners.click();
  assert.equal(calls, 2);
  assert.equal(result.elements.get('#news-retry').disabled, true);
  assert.match(result.elements.get('#news-archive-list').innerHTML, /ニュースを読み込み中/);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.elements.get('#news-retry').hidden, true);
  assert.equal(result.elements.get('#news-retry').disabled, false);
  assert.equal(result.elements.get('#news-query').value, '保存済み');
  assert.equal(vm.runInContext('activeRange', result.context), '24h');
  assert.equal(vm.runInContext('activeCategory', result.context), 'tech');
  assert.match(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
});

test('a successful empty response remains a genuine empty result without retry', async () => {
  const result = await startArchive({ cached: [], fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }) });
  assert.match(result.elements.get('#news-archive-list').innerHTML, /該当するニュースはありません/);
  assert.equal(result.elements.get('#news-retry').hidden, true);
});

test('failed cached retries keep readable articles even when persistent storage disappears', async () => {
  const result = await startArchive();
  result.storage.clear();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result.elements.get('#news-retry').listeners.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
    assert.equal(result.elements.get('#news-retry').hidden, false);
    assert.equal(result.elements.get('#news-retry').disabled, false);
    assert.deepEqual(result.writes, []);
  }
});

test('a retry continuation failure preserves the complete previous cache', async () => {
  let retry = false;
  const result = await startArchive({ fetchImpl: async (url) => {
    if (!retry || url.includes('page-2')) throw new Error('offline');
    return { ok: true, json: async () => ({ items: [{ ...cachedArticle, title: '未完成の新しい一覧' }], nextPage: 2 }) };
  } });
  retry = true;
  result.elements.get('#news-retry').listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
  assert.doesNotMatch(result.elements.get('#news-archive-list').innerHTML, /未完成の新しい一覧/);
  assert.equal(result.storage.get(CACHE_KEY), result.originalCache);
  assert.equal(result.elements.get('#news-retry').hidden, false);
});

function deferredPage() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const response = (items, nextPage = 0) => ({ ok: true, json: async () => ({ items, nextPage }) });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('cold visits display first-payload cards before the archive finishes without claiming complete counts', async () => {
  const pending = deferredPage();
  const requests = [];
  const first = { ...cachedArticle, title: '先頭の記事' };
  const last = { ...cachedArticle, id: 'last', title: '最後の記事' };
  const result = await startArchive({ cached: [], fetchImpl: async (url) => {
    requests.push(url);
    return url.includes('page-2') ? pending.promise : response([first], 2);
  } });
  assert.match(result.elements.get('#news-archive-list').innerHTML, /先頭の記事/);
  assert.match(result.elements.get('#news-count').textContent, /読み込み済み・全記事を読み込み中/);
  assert.match(result.elements.get('#news-archive-actions').innerHTML, /読み込み完了後に全記事/);
  assert.equal(result.elements.get('#trend-pagination').innerHTML, '');
  assert.deepEqual(result.writes, []);
  pending.resolve(response([last]));
  await settle();
  assert.equal(result.elements.get('#news-count').textContent, '2 話題');
  assert.match(result.elements.get('#news-archive-list').innerHTML, /先頭の記事/);
  assert.match(result.elements.get('#news-archive-list').innerHTML, /最後の記事/);
  assert.equal((result.elements.get('#news-archive-list').innerHTML.match(/<article /g) ?? []).length, 2);
  assert.equal(JSON.parse(result.storage.get(CACHE_KEY)).items.length, 2);
  assert.equal(requests.length, 2);
});

test('filters changed during preview find later articles without a premature no-results message', async () => {
  const pending = deferredPage();
  const result = await startArchive({ cached: [], fetchImpl: async (url) => url.includes('page-2')
    ? pending.promise : response([cachedArticle], 2) });
  await vm.runInContext("activeCategory = 'tech'; activeRange = '7-14d'; queryElement.value = '後半'; renderArchive()", result.context);
  assert.match(result.elements.get('#news-archive-list').innerHTML, /ニュースを読み込み中/);
  assert.doesNotMatch(result.elements.get('#news-archive-list').innerHTML, /該当するニュースはありません/);
  assert.match(result.elements.get('#news-count').textContent, /0 話題（読み込み済み/);
  pending.resolve(response([{ ...cachedArticle, id: 'later', title: '後半の記事', publishedAt: new Date(Date.now() - 10 * 86400000).toISOString() }]));
  await settle();
  assert.equal(result.elements.get('#news-count').textContent, '1 話題');
  assert.match(result.elements.get('#news-archive-list').innerHTML, /後半の記事/);
  assert.equal(vm.runInContext('activeCategory', result.context), 'tech');
  assert.equal(vm.runInContext('activeRange', result.context), '7-14d');
});

test('a complete cache is not downgraded to the first payload while remaining pages load', async () => {
  const pending = deferredPage();
  const result = await startArchive({ fetchImpl: async (url) => url.includes('page-2')
    ? pending.promise : response([{ ...cachedArticle, title: '未完成の新一覧' }], 2) });
  assert.match(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
  assert.doesNotMatch(result.elements.get('#news-archive-list').innerHTML, /未完成の新一覧/);
  assert.equal(result.elements.get('#news-count').textContent, '1 話題');
  pending.reject(new Error('offline'));
  await settle();
  assert.equal(result.storage.get(CACHE_KEY), result.originalCache);
});

test('background failure retains uncached preview with explicit incomplete status and coalesced retry', async () => {
  let attempts = 0;
  let recovering = false;
  const pending = deferredPage();
  const result = await startArchive({ cached: [], fetchImpl: async (url) => {
    attempts += 1;
    if (!url.includes('page-2')) return response([cachedArticle], 2);
    if (!recovering) throw new Error('offline');
    return pending.promise;
  } });
  assert.match(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
  assert.match(result.elements.get('#news-count').textContent, /一部のみ・読み込み未完了/);
  assert.match(result.elements.get('#news-updated').textContent, /全記事の読み込み失敗/);
  assert.equal(result.elements.get('#news-retry').hidden, false);
  assert.deepEqual(result.writes, []);
  recovering = true;
  result.elements.get('#news-retry').listeners.click();
  result.elements.get('#news-retry').listeners.click();
  await settle();
  assert.equal(attempts, 4);
  assert.match(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
  pending.resolve(response([{ ...cachedArticle, id: 'second', title: '復旧後の記事' }]));
  await settle();
  assert.equal(result.elements.get('#news-count').textContent, '2 話題');
  assert.equal(result.elements.get('#news-retry').hidden, true);
  assert.equal(result.writes.length, 1);
});

test('new empty filter and show-all cancel stale preview render batches', async () => {
  const frames = [];
  const pending = deferredPage();
  const items = Array.from({ length: 20 }, (_, index) => ({ ...cachedArticle, id: `preview-${index}`, title: `先頭記事 ${index}` }));
  const result = await startArchive({ cached: [], requestAnimationFrameImpl: (callback) => frames.push(callback),
    fetchImpl: async (url) => url.includes('page-2') ? pending.promise : response(items, 2) });
  await vm.runInContext("queryElement.value = 'none'; renderArchive()", result.context);
  result.elements.get('#news-show-all').listeners.click();
  pending.resolve(response([{ ...cachedArticle, id: 'last', title: '最後の記事' }]));
  await settle();
  while (frames.length) { frames.shift()(); await settle(); }
  const html = result.elements.get('#news-archive-list').innerHTML;
  assert.equal((html.match(/<article /g) ?? []).length, 20);
  assert.equal((html.match(/先頭記事 0</g) ?? []).length, 1);
  assert.equal(result.elements.get('#news-count').textContent, '21 話題');
  assert.match(result.elements.get('#trend-pagination').innerHTML, /2 ページ/);
});

for (const badPage of [{ items: null }, { items: [], nextPage: 2 }, { items: [], nextPage: -1 }, { items: [], nextPage: 'invalid' }, { items: [], hasMore: true, nextPage: 0 }]) {
  test(`invalid continuation does not promote preview to a complete cached archive: ${JSON.stringify(badPage)}`, async () => {
    const result = await startArchive({ cached: [], fetchImpl: async (url) => url.includes('page-2')
      ? { ok: true, json: async () => badPage } : response([cachedArticle], 2) });
    assert.match(result.elements.get('#news-count').textContent, /一部のみ・読み込み未完了/);
    assert.equal(result.elements.get('#news-retry').hidden, false);
    assert.match(result.elements.get('#news-archive-list').innerHTML, /保存済みのニュース/);
    assert.deepEqual(result.writes, []);
  });
}
