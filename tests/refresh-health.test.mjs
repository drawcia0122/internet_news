import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareDatasets, inspectDataset, runGuardedRefresh, REFRESH_STAGE_FILES } from '../lib/refresh-health.mjs';
import { collectTrendTopics } from '../lib/trend-aggregator.mjs';
import { synchronizeThumbnailConsumers } from '../scripts/repair-thumbnails.mjs';

const oldTime = '2026-10-02T00:00:00.000Z';
const freshTime = '2026-10-02T00:30:00.000Z';
const now = () => new Date(freshTime);
const logger = { log() {}, warn() {}, error() {} };
const item = (index, image = true) => ({
  id: `story-${index}`, title: `ニュース ${index}`, sourceUrl: `https://publisher.example/story/${index}`,
  thumbnailUrl: image ? `https://images.example/articles/photo-${index}.jpg` : null,
});
const payload = (count, generatedAt = oldTime, image = true) => ({ generatedAt, items: Array.from({ length: count }, (_, i) => item(i, image)) });
const codes = (value) => value.issues.map((entry) => entry.code);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'refresh-health-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const write = (directory, file, data) => writeFile(join(directory, file), JSON.stringify(data));
const read = async (directory, file) => JSON.parse(await readFile(join(directory, file), 'utf8'));
async function trendFixture(directory, generatedAt = oldTime) {
  for (const file of REFRESH_STAGE_FILES.trend) await write(directory, file, payload(40, generatedAt));
}

test('count decline warnings and catastrophic rejection use conservative sample thresholds', () => {
  const warning = compareDatasets('trend-topics.json', payload(100), payload(50, freshTime), { now: now() });
  assert.equal(warning.valid, true);
  assert.ok(codes(warning).includes('item_count_drop'));
  const blocked = compareDatasets('trend-topics.json', payload(100), payload(10, freshTime), { now: now() });
  assert.equal(blocked.valid, false);
  assert.equal(compareDatasets('adult-news.json', payload(3), payload(0, freshTime), { now: now() }).valid, true);
  assert.equal(compareDatasets('news-archive.json', payload(100, '2026-09-01T00:00:00Z'), payload(1, freshTime), { now: now() }).valid, true);
});

test('raw collection collapse is detected even when curated item count is unchanged', () => {
  const before = { ...payload(180), collectionSummary: { fetchedCount: 1200 } };
  const after = { ...payload(180, freshTime), collectionSummary: { fetchedCount: 90 } };
  const checked = compareDatasets('trend-topics.json', before, after, { now: now() });
  assert.equal(checked.valid, false);
  assert.ok(codes(checked).includes('fetched_count_drop'));
  assert.ok(!codes(checked).includes('item_count_drop'));
});

test('event expiry at the Japan day boundary is excluded from count and image comparisons', () => {
  const before = payload(40);
  before.items.forEach((entry, i) => Object.assign(entry, { startDate: '2026-09-20', endDate: i < 35 ? '2026-10-02' : '2026-10-10', location: '東京都' }));
  const after = { generatedAt: '2026-10-02T15:05:00Z', items: before.items.slice(35) };
  const checked = compareDatasets('events.json', before, after, { now: new Date('2026-10-02T15:05:00Z') });
  assert.equal(checked.valid, true);
  assert.equal(checked.activeItemCount, 5);
  assert.ok(!codes(checked).includes('item_count_drop'));
  const allExpired = { ...before, items: before.items.slice(0, 35) };
  assert.equal(compareDatasets('events.json', allExpired, { ...after, items: [] }, { now: new Date('2026-10-02T15:05:00Z') }).valid, true);
});

test('staleness uses generated data time and rejects timestamp regressions or malformed output', () => {
  const stale = inspectDataset('home-news.json', { ...payload(30), checkedAt: '2026-10-02T08:00:00Z' }, { now: new Date('2026-10-02T08:00:00Z') });
  assert.equal(stale.stale, true);
  assert.ok(codes(stale).includes('stale_data'));
  assert.equal(inspectDataset('home-news.json', { generatedAt: freshTime, items: [{}] }, { now: now() }).valid, false);
  assert.equal(inspectDataset('home-news.json', payload(5, 'not-a-date'), { now: now() }).valid, false);
  assert.equal(inspectDataset('home-news.json', payload(5, '2026-11-01'), { now: now() }).valid, false);
  assert.ok(codes(compareDatasets('home-news.json', payload(5, freshTime), payload(5), { now: now() })).includes('timestamp_regressed'));
});

test('image coverage loss is detected, while tiny sections do not raise noise', () => {
  const checked = compareDatasets('home-topics.json', payload(40), payload(40, freshTime, false), { now: now() });
  assert.ok(codes(checked).includes('thumbnail_loss'));
  assert.equal(checked.valid, true);
  assert.ok(!codes(compareDatasets('daily-brief.json', payload(10), payload(10, freshTime, false), { now: now() })).includes('thumbnail_loss'));
});

test('failed generation restores partial writes, deleted pages and removes new pages, then continues with usable data', async (t) => {
  const directory = await fixture(t);
  await trendFixture(directory);
  await write(directory, 'home-news-page-2.json', payload(30));
  const original = await readFile(join(directory, 'news-archive.json'), 'utf8');
  const calls = [];
  const result = await runGuardedRefresh([
    { name: 'trend', run: async () => {
      calls.push('trend');
      await write(directory, 'news-archive.json', payload(0, freshTime));
      await rm(join(directory, 'home-news-page-2.json'));
      await write(directory, 'home-news-page-9.json', payload(30, freshTime));
      throw new Error('fixture write failure');
    } },
    { name: 'events', run: async () => { calls.push('events'); await write(directory, 'events.json', payload(30, freshTime)); } },
  ], { dataDirectory: directory, now, logger });
  assert.deepEqual(calls, ['trend', 'events']);
  assert.equal(result.status, 'warning');
  assert.equal(result.stages[0].status, 'retained');
  assert.equal(await readFile(join(directory, 'news-archive.json'), 'utf8'), original);
  assert.equal((await read(directory, 'home-news-page-2.json')).generatedAt, oldTime);
  await assert.rejects(readFile(join(directory, 'home-news-page-9.json')), { code: 'ENOENT' });
  assert.equal(result.datasets['news-archive.json'].retained, true);
  assert.equal((await read(directory, 'refresh-status.json')).status, 'warning');
});

test('catastrophic output keeps the previous dataset and original timestamp', async (t) => {
  const directory = await fixture(t);
  await write(directory, 'events.json', payload(40));
  const result = await runGuardedRefresh([{ name: 'events', run: () => write(directory, 'events.json', payload(2, freshTime)) }], { dataDirectory: directory, now, logger });
  assert.equal((await read(directory, 'events.json')).generatedAt, oldTime);
  assert.equal(result.datasets['events.json'].itemCount, 40);
  assert.equal(result.datasets['events.json'].retained, true);
  assert.ok(codes(result).includes('item_count_drop'));
});

test('existing full-failure no-write fallback continues sequentially without claiming fresh data', async (t) => {
  const directory = await fixture(t);
  await trendFixture(directory);
  const calls = [];
  const result = await runGuardedRefresh([
    { name: 'trend', run: async () => { calls.push('trend start'); await Promise.resolve(); calls.push('trend end'); } },
    { name: 'events', run: async () => { calls.push('events'); await write(directory, 'events.json', payload(40, freshTime)); } },
  ], { dataDirectory: directory, now, logger });
  assert.deepEqual(calls, ['trend start', 'trend end', 'events']);
  assert.equal(result.datasets['home-news.json'].generatedAt, oldTime);
  assert.equal(result.datasets['home-news.json'].retained, true);
  assert.equal(result.datasets['events.json'].retained, false);
});

test('missing initial snapshot fails closed, removes partial output, writes status and stops later stages', async (t) => {
  const directory = await fixture(t);
  let laterRan = false;
  await assert.rejects(runGuardedRefresh([
    { name: 'events', run: async () => { await writeFile(join(directory, 'events.json'), '{broken'); } },
    { name: 'adult', run: () => { laterRan = true; } },
  ], { dataDirectory: directory, now, logger }), /no complete usable previous snapshot/);
  assert.equal(laterRan, false);
  await assert.rejects(readFile(join(directory, 'events.json')), { code: 'ENOENT' });
  const report = await read(directory, 'refresh-status.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.stages[0].status, 'failed');
});

test('broken pagination cannot replace the usable linked group', async (t) => {
  const directory = await fixture(t);
  await trendFixture(directory);
  await write(directory, 'home-news.json', { ...payload(20), hasMore: true, nextPage: 2 });
  await write(directory, 'home-news-page-2.json', payload(20));
  const result = await runGuardedRefresh([{ name: 'trend', run: async () => {
    await trendFixture(directory, freshTime);
    await write(directory, 'home-news.json', { ...payload(20, freshTime), hasMore: true, nextPage: 2 });
    await rm(join(directory, 'home-news-page-2.json'));
  } }], { dataDirectory: directory, now, logger });
  assert.equal(result.stages[0].status, 'retained');
  assert.ok(codes(result).includes('broken_pagination'));
  assert.equal((await read(directory, 'home-news-page-2.json')).generatedAt, oldTime);
});

test('existing article-identity helper restores lost images but never copies them to another article', async (t) => {
  const directory = await fixture(t);
  await trendFixture(directory);
  const result = await runGuardedRefresh([{ name: 'trend', run: async () => {
    await trendFixture(directory, freshTime);
    const next = payload(40, freshTime, false);
    next.items[0].sourceUrl = 'https://publisher.example/different-story';
    await write(directory, 'news-archive.json', next);
  } }], { dataDirectory: directory, now, logger });
  const archive = await read(directory, 'news-archive.json');
  assert.equal(archive.items[0].thumbnailUrl, null);
  assert.equal(archive.items[1].thumbnailUrl, item(1).thumbnailUrl);
  assert.equal(archive.generatedAt, freshTime);
  assert.ok(codes(result).includes('thumbnails_restored'));
});

test('thumbnail stage keeps fallback retention metadata and can safely update consumers', async (t) => {
  const directory = await fixture(t);
  await trendFixture(directory);
  const result = await runGuardedRefresh([
    { name: 'trend', run: async () => {} },
    { name: 'thumbnail-repair', run: async () => {
      const home = await read(directory, 'home-news.json');
      home.items[0].thumbnailUrl = 'https://images.example/articles/repaired.jpg';
      await write(directory, 'home-news.json', home);
    } },
  ], { dataDirectory: directory, now, logger });
  assert.equal(result.datasets['home-news.json'].retained, true);
  assert.equal((await read(directory, 'home-news.json')).items[0].thumbnailUrl, 'https://images.example/articles/repaired.jpg');
  assert.equal(result.stages[1].status, 'ok');
});

test('Actions annotations and summary include useful timestamps and count details', async (t) => {
  const directory = await fixture(t);
  const logs = [];
  const summaryPath = join(directory, 'summary.md');
  await write(directory, 'events.json', payload(100));
  const result = await runGuardedRefresh([{ name: 'events', run: () => write(directory, 'events.json', payload(50, freshTime)) }], {
    dataDirectory: directory, now, summaryPath, logger: { ...logger, warn: (value) => logs.push(value) },
  });
  assert.equal(result.status, 'warning');
  assert.match(logs.join('\n'), /::warning::.*100 -> 50/);
  assert.match(await readFile(summaryPath, 'utf8'), /2026-10-02T00:30:00.000Z/);
  assert.equal((await read(directory, 'events.json')).items.length, 50);
});

test('RSS payload records fetched counts and partial source failures without changing fallback error', async () => {
  const feed = `<rss><channel><item><title>新作ゲームの発売日を正式発表</title><link>https://publisher.example/article</link><pubDate>Fri, 02 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  const result = await collectTrendTopics({ now: now(), retryDelaysMs: [],
    feeds: [{ id: 'ok', url: 'https://feed.example/ok' }, { id: 'failed', url: 'https://feed.example/failed' }],
    fetchImpl: async (url) => new Response(url.endsWith('ok') ? feed : '', { status: url.endsWith('ok') ? 200 : 404 }),
  });
  assert.deepEqual(result.collectionSummary, { fetchedCount: 1, topicCount: 1, totalSources: 2, successfulSources: 1, failedSources: 1 });
  await assert.rejects(collectTrendTopics({ feeds: [{ id: 'failed', url: 'https://feed.example/failed' }], retryDelaysMs: [], fetchImpl: async () => new Response('', { status: 404 }) }), { code: 'ERR_NO_RSS_ENTRIES' });
});


test('article images survive moving between split pages through final archive consumer synchronization', async (t) => {
  const directory = await fixture(t);
  await trendFixture(directory);
  const first = payload(40).items.slice(0, 20);
  const second = payload(40).items.slice(20);
  await write(directory, 'home-news.json', { generatedAt: oldTime, items: first, hasMore: true, nextPage: 2 });
  await write(directory, 'home-news-page-2.json', { generatedAt: oldTime, items: second, hasMore: false, nextPage: 0 });
  const withoutImage = (items) => items.map((entry) => ({ ...entry, thumbnailUrl: null }));
  const result = await runGuardedRefresh([
    { name: 'trend', run: async () => {
      await trendFixture(directory, freshTime);
      await write(directory, 'news-archive.json', payload(40, freshTime, false));
      await write(directory, 'home-news.json', { generatedAt: freshTime, items: withoutImage(second), hasMore: true, nextPage: 2 });
      await write(directory, 'home-news-page-2.json', { generatedAt: freshTime, items: withoutImage(first), hasMore: false, nextPage: 0 });
    } },
    { name: 'thumbnail-repair', run: () => synchronizeThumbnailConsumers(directory) },
  ], { dataDirectory: directory, now, logger });
  for (const file of ['home-news.json', 'home-news-page-2.json']) {
    const saved = await read(directory, file);
    assert.equal(saved.generatedAt, freshTime);
    assert.ok(saved.items.every((entry) => entry.thumbnailUrl));
    assert.equal(result.datasets[file].thumbnailCoverage, 1);
    assert.equal(result.datasets[file].retained, false);
  }
  assert.equal((await read(directory, 'home-news.json')).items[0].id, 'story-20');
});

test('empty initial adult collection is a failure, not a successful blank dataset', async (t) => {
  const directory = await fixture(t);
  await assert.rejects(runGuardedRefresh([{ name: 'adult', run: async () => {
    for (const file of REFRESH_STAGE_FILES.adult) await write(directory, file, file === 'adult-rank-history.json' ? {} : []);
  } }], { dataDirectory: directory, now, logger }), /no complete usable previous snapshot/);
  assert.ok(codes(await read(directory, 'refresh-status.json')).includes('empty_collection'));
});
