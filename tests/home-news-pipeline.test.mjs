import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TREND_FETCH_SKIP_MAIN_FOR_TESTS = '1';
const {
  buildHomeNewsPayloads,
  buildNewsArchivePayload,
  mergeArchiveItems,
  writeHomeNewsPayloads,
} = await import('../scripts/fetch-trend-topics.mjs');

const generatedAt = '2026-10-01T12:00:00.000Z';
const article = (index, overrides = {}) => ({
  id: `news-${index}`,
  title: `ニュース ${index}`,
  sourceUrl: `https://example.co.jp/articles/${index}`,
  sourceSignals: [],
  category: 'general',
  categories: ['general'],
  publishedAt: generatedAt,
  capturedAt: generatedAt,
  ...overrides,
});
const allItems = (payloads) => [
  ...payloads.initial.items,
  ...payloads.pages.flatMap((page) => page.payload.items),
];

test('home news retains the existing archive population beyond the former 200-item cap', () => {
  const items = Array.from({ length: 1500 }, (_, index) => article(index));
  const payloads = buildHomeNewsPayloads({ newsArchivePayload: { items }, generatedAt });
  assert.equal(payloads.initial.totalCount, 1500);
  assert.equal(payloads.initial.items.length, 20);
  assert.equal(payloads.pages.length, 15);
  assert.deepEqual(allItems(payloads).map((item) => item.id), items.map((item) => item.id));
  assert.equal(payloads.initial.generatedAt, generatedAt);
  assert.equal(payloads.initial.categoryCounts.all, 1500);
  assert.equal(payloads.initial.nextPage, 2);
  for (const [index, page] of payloads.pages.entries()) {
    assert.equal(page.page, index + 2);
    assert.ok(page.payload.items.length <= 100);
    assert.equal(page.payload.totalCount, 1500);
    assert.equal(page.payload.generatedAt, generatedAt);
    const hasMore = index < payloads.pages.length - 1;
    assert.equal(page.payload.hasMore, hasMore);
    assert.equal(page.payload.nextPage, hasMore ? page.page + 1 : 0);
  }
});

test('home news remains bounded by 1500 and preserves featured-article exclusions', () => {
  const items = Array.from({ length: 1520 }, (_, index) => article(index));
  const payloads = buildHomeNewsPayloads({
    newsArchivePayload: { items },
    currentItems: [items[0]],
    homeTopicsPayload: { items: [items[1]] },
    dailyBriefPayload: { items: [items[2]] },
    generatedAt,
  });
  assert.equal(allItems(payloads).length, 1500);
  assert.deepEqual(allItems(payloads).map((item) => item.id), items.slice(3, 1503).map((item) => item.id));
});

test('small home-news payloads do not create dangling page links', () => {
  for (const count of [0, 1, 20]) {
    const payloads = buildHomeNewsPayloads({
      newsArchivePayload: { items: Array.from({ length: count }, (_, index) => article(index)) },
      generatedAt,
    });
    assert.equal(payloads.initial.totalCount, count);
    assert.equal(payloads.initial.hasMore, false);
    assert.equal(payloads.initial.nextPage, 0);
    assert.deepEqual(payloads.pages, []);
  }
});

test('historical publication timestamps survive home-news generation unchanged', () => {
  const dates = [generatedAt, '2026-09-29T12:00:00.000Z', '2026-09-26T12:00:00.000Z'];
  const items = dates.map((publishedAt, index) => article(index, {
    publishedAt,
    sourceSignals: [{ title: `ニュース ${index}`, url: `https://example.co.jp/articles/${index}`, publishedAt }],
  }));
  const payloads = buildHomeNewsPayloads({ newsArchivePayload: { items }, generatedAt });
  assert.deepEqual(allItems(payloads).map((item) => item.publishedAt), dates);
  assert.deepEqual(allItems(payloads).map((item) => item.sourceSignals[0].publishedAt), dates);
  assert.deepEqual(allItems(payloads).map((item) => item.capturedAt), items.map((item) => item.capturedAt));
});

test('domestic archive builder retains eligible history without inventing dates', () => {
  const items = [
    article(0, { publishedAt: '2026-09-29T12:00:00.000Z' }),
    article(1, { publishedAt: '2026-09-26T12:00:00.000Z' }),
    article(2, { publishedAt: '2026-09-15T12:00:00.000Z' }),
    article(3, { publishedAt: null, capturedAt: '2026-09-28T12:00:00.000Z' }),
  ];
  const payload = buildNewsArchivePayload({ archiveItems: items, generatedAt });
  assert.deepEqual(payload.items.map((item) => item.id), ['news-0', 'news-3', 'news-1']);
  assert.equal(payload.items.find((item) => item.id === 'news-3').publishedAt, null);
  assert.equal(payload.items.find((item) => item.id === 'news-3').capturedAt, items[3].capturedAt);
});

test('re-fetching the same undated article preserves its original age fallback', () => {
  const oldItem = article(0, { publishedAt: null, capturedAt: '2026-09-26T12:00:00.000Z' });
  const refreshedItem = article(0, { publishedAt: null, capturedAt: generatedAt, score: 90 });
  const merged = mergeArchiveItems([oldItem], [refreshedItem]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].capturedAt, oldItem.capturedAt);
  assert.equal(merged[0].publishedAt, null);
  assert.equal(merged[0].score, 90);
  assert.equal(refreshedItem.capturedAt, generatedAt);
});

test('known publication dates retain their precedence and existing capture semantics', () => {
  const oldItem = article(0, { capturedAt: '2026-09-26T12:00:00.000Z' });
  const refreshedItem = article(0);
  const merged = mergeArchiveItems([oldItem], [refreshedItem]);
  assert.equal(merged[0].publishedAt, generatedAt);
  assert.equal(merged[0].capturedAt, generatedAt);
});

test('undated recapture ignores invalid capture timestamps', () => {
  const oldItem = article(0, { publishedAt: null, capturedAt: 'invalid' });
  const refreshedItem = article(0, { publishedAt: null });
  const merged = mergeArchiveItems([oldItem], [refreshedItem]);
  assert.equal(merged[0].capturedAt, generatedAt);
});

test('production home-news writer writes chained payloads and removes only obsolete pages', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'internet-news-home-'));
  try {
    await writeFile(join(dataDirectory, 'home-news-page-99.json'), '{}');
    await writeFile(join(dataDirectory, 'news-archive.json'), '{"untouched":true}');
    const payloads = buildHomeNewsPayloads({
      newsArchivePayload: { items: Array.from({ length: 221 }, (_, index) => article(index)) },
      generatedAt,
    });
    await writeHomeNewsPayloads(payloads, { dataDirectory });
    const initial = JSON.parse(await readFile(join(dataDirectory, 'home-news.json'), 'utf8'));
    assert.deepEqual(initial, payloads.initial);
    const files = await readdir(dataDirectory);
    assert.ok(!files.includes('home-news-page-99.json'));
    for (const page of payloads.pages) {
      assert.deepEqual(JSON.parse(await readFile(join(dataDirectory, `home-news-page-${page.page}.json`), 'utf8')), page.payload);
    }
    assert.equal(await readFile(join(dataDirectory, 'news-archive.json'), 'utf8'), '{"untouched":true}');
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('recovered publication dates replace a newer capture-time fallback', () => {
  const captured = article(0, { publishedAt: null });
  const publishedAt = '2026-09-28T12:00:00.000Z';
  const recovered = article(0, {
    publishedAt: null,
    score: 91,
    sourceSignals: [{ title: captured.title, url: captured.sourceUrl, publishedAt }],
  });
  const merged = mergeArchiveItems([captured], [recovered]);
  assert.equal(merged[0].publishedAt, publishedAt);
  assert.equal(merged[0].sourceSignals[0].publishedAt, publishedAt);
  assert.equal(merged[0].score, 91);
});

test('later undated fetches retain known publication dates and update current content', () => {
  for (const signalOnly of [false, true]) {
    const publishedAt = '2026-09-28T12:00:00.000Z';
    const previous = article(0, {
      publishedAt: signalOnly ? null : publishedAt,
      sourceSignals: signalOnly ? [{ title: 'ニュース 0', url: 'https://example.co.jp/articles/0', publishedAt }] : [],
    });
    const incoming = article(0, { publishedAt: null, score: 99 });
    const merged = mergeArchiveItems([previous], [incoming]);
    assert.equal(merged[0].publishedAt, publishedAt);
    assert.equal(merged[0].score, 99);
    assert.equal(merged[0].capturedAt, generatedAt);
    const archive = buildNewsArchivePayload({ archiveItems: merged, generatedAt });
    assert.equal(archive.items[0].publishedAt, publishedAt);
  }
});

test('offline home-news generation repairs stored categories before counting them', () => {
  const item = article(0, {
    title: '【夏アニメ】感動した作品を紹介',
    summary: 'アニメの名場面を振り返ります。',
    category: 'sports',
    categories: ['sports', 'anime', 'entertainment', 'general'],
    categoryLabel: 'スポーツ',
    categoryLabels: ['スポーツ', 'アニメ', 'エンタメ'],
  });
  const payload = buildHomeNewsPayloads({ newsArchivePayload: { items: [item] }, generatedAt }).initial;
  assert.equal(payload.items[0].category, 'anime');
  assert.equal(payload.items[0].categoryLabel, 'アニメ');
  assert.ok(!payload.items[0].categories.includes('sports'));
  assert.ok(!payload.items[0].categoryLabels.includes('スポーツ'));
  assert.equal(payload.categoryCounts.sports, 0);
  assert.equal(payload.categoryCounts.anime, 1);
  assert.equal(payload.items[0].publishedAt, item.publishedAt);
  assert.equal(item.category, 'sports');
});

test('an invalid source date does not hide a valid historical publication date', () => {
  const publishedAt = '2026-09-26T12:00:00.000Z';
  const item = article(0, {
    publishedAt,
    sourceSignals: [{ title: 'ニュース 0', url: 'https://example.co.jp/articles/0', publishedAt: 'invalid' }],
  });
  const payload = buildNewsArchivePayload({ archiveItems: [item, article(1)], generatedAt });
  assert.deepEqual(payload.items.map((value) => value.id), ['news-1', 'news-0']);
  assert.equal(payload.items[1].publishedAt, publishedAt);
});
