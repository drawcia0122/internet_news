import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectPriorYahooPhotos, findYahooArticlePhoto, repairYahooArticleThumbnails } from '../scripts/repair-yahoo-article-thumbnails.mjs';
import { inspectDataset } from '../lib/refresh-health.mjs';
import { sanitizeThumbnailUrl } from '../lib/thumbnail-utils.mjs';

const pickup = 'https://news.yahoo.co.jp/pickup/1234567';
const direct = 'https://news.yahoo.co.jp/articles/' + 'a'.repeat(40);
const other = 'https://news.yahoo.co.jp/articles/' + 'b'.repeat(40);
const title = 'ヤフー記事の写真を安全に復旧するテスト';
const pickupTitle = '記事の写真を安全に復旧';
const image = 'https://newsatcl-pctr.c.yimg.jp/t/amd-img/20261119-12345678-source-000-1-view.jpg?exp=10800';
const id = 'news-1';
const quiet = { log() {} };
const page = ({ headline = title, canonical = direct, photo = image, width = 640, body = '' } = {}) => `<!DOCTYPE html><html><head><meta content="${headline}" property="og:title">
<link href="${canonical}" rel="canonical"><meta property="og:url" content="${canonical}">
<meta content="${photo}" property="og:image"><meta property="og:image:width" content="${width}"><meta property="og:image:height" content="480"></head><body>${body}</body></html>`;
const pickupPage = ({ value = '1234567', url = pickup, headline = pickupTitle, article = direct } = {}) =>
  `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ topicsDetail: {
    id: value, url, title: headline, article: { url: article, title },
  } })};</script>`;
const newDirect = (overrides) => ({ id, title, sourceUrl: direct + '?source=rss', thumbnailUrl: null, ...overrides });
const newPickup = () => ({ id: 'lead', title: pickupTitle, primaryLink: { url: pickup + '?source=rss' }, thumbnailUrl: null });
const { getYahooThumbnailOwner, getArticleThumbnail } = globalThis.VerifiedArticleThumbnail;

test('verifies a direct Yahoo article without reopening the generic proxy allowlist', async () => {
  const row = newDirect();
  const photo = await findYahooArticlePhoto(getYahooThumbnailOwner(row), {
    fetchHtml: async (url) => { assert.equal(url, direct); return page(); },
  });
  assert.equal(photo.kind, 'yahoo-direct-article-og');
  assert.equal(getArticleThumbnail({ ...row, articleThumbnail: photo }).imageUrl, image);
  assert.equal(sanitizeThumbnailUrl(image), null);
  assert.equal(getArticleThumbnail({ ...row, sourceUrl: other, articleThumbnail: photo }), null);
  assert.equal(getArticleThumbnail({ ...row, canonicalUrl: other, articleThumbnail: photo }), null);
  assert.equal(getArticleThumbnail({ ...row, title: '別記事のタイトル', articleThumbnail: photo }), null);
  assert.equal(getArticleThumbnail({ ...row, articleThumbnail: { ...photo, width: 32 } }), null);
  assert.equal(getArticleThumbnail({ ...row, articleThumbnail: { ...photo, imageUrl: image.replace('exp', 'redirect') } }), null);
});

test('uses the linked pickup primary article, not wrapper media or an unrelated recommendation', async () => {
  const row = newPickup();
  const owner = getYahooThumbnailOwner(row);
  const urls = [];
  const photo = await findYahooArticlePhoto(owner, { fetchHtml: async (url) => {
    urls.push(url);
    return url === pickup ? pickupPage() : page();
  } });
  assert.deepEqual(urls, [pickup, direct]);
  assert.equal(photo.kind, 'yahoo-main-article-og');
  assert.equal(getArticleThumbnail({ ...row, articleThumbnail: photo }).imageUrl, image);
  for (const broken of [
    pickupPage({ value: '2345678' }),
    pickupPage({ article: 'https://www.example.org/article' }),
    pickupPage({ headline: '無関係な記事の見出し' }),
  ]) {
    const result = await findYahooArticlePhoto(owner, { fetchHtml: async (url) => {
      assert.equal(url, pickup);
      return broken + '<a href="' + direct + '">fake recommendation</a>';
    } });
    assert.equal(result, null);
  }
});

test('rejects mismatched article identities, incorrect headings, tiny photos and placeholders', async () => {
  const owner = getYahooThumbnailOwner(newDirect());
  for (const html of [
    page({ canonical: other }),
    page({ headline: '無関係な記事の見出し' }),
    page({ width: 42 }),
    page({ photo: image.replace(/\/\d{8}-.+?\?/, '/default.jpg?') }),
    page().replace('</head>', '<meta property="og:image" content="https://example.org/other.jpg"></head>'),
    page().replace(/<head>[\s\S]*?<\/head>/, '<head></head>'),
  ]) assert.equal(await findYahooArticlePhoto(owner, { fetchHtml: async () => html }), null);
});

test('covers the three consumer formats, preserves original images, and reuses only exact-owner cached records', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'verified-yahoo-images-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const generatedAt = '2026-11-20T00:00:00Z';
  const first = newDirect();
  const healthy = newDirect({ id: 'existing', thumbnailUrl: 'https://example.org/file.jpg' });
  const selectedTopic = { id: 'today', title, sourceSignals: [{ title, url: direct + '?source=other', canonicalUrl: direct }] };
  const runnerUps = [{ id: 'wrong', title, sourceSignals: [{ title, url: direct }, { title, url: other }] }];
  const payloads = {
    'daily-brief.json': { generatedAt, items: [newPickup()] },
    'today-internet.json': { generatedAt, selectedTopic, runnerUps },
    'home-news.json': { generatedAt, items: [first, healthy], totalCount: 3, nextPage: 2 },
    'home-news-page-2.json': { generatedAt, items: [{ ...first, id: 'next' }] },
  };
  const reset = () => Promise.all(Object.entries(payloads).map(([file, payload]) => writeFile(join(directory, file), JSON.stringify(payload))));
  const load = async (file) => JSON.parse(await readFile(join(directory, file), 'utf8'));
  await reset();
  const seen = [];
  const fetchHtml = async (url) => { seen.push(url); return url === pickup ? pickupPage() : page(); };
  assert.deepEqual(await repairYahooArticleThumbnails({ directory, fetchHtml, logger: quiet }), { repaired: 4, restored: 0, attempted: 2 });
  assert.equal(seen.filter((url) => url === direct).length, 2);
  assert.equal(getArticleThumbnail((await load('daily-brief.json')).items[0]).imageUrl, image);
  const today = await load('today-internet.json');
  assert.equal(getArticleThumbnail(today.selectedTopic).imageUrl, image);
  assert.equal(getArticleThumbnail(today.runnerUps[0]), null);
  const news = await load('home-news.json');
  assert.equal(news.nextPage, 2);
  assert.equal(news.items[1].thumbnailUrl, healthy.thumbnailUrl);
  assert.equal(news.items[1].articleThumbnail, undefined);
  assert.equal(getArticleThumbnail((await load('home-news-page-2.json')).items[0]).imageUrl, image);
  assert.equal(inspectDataset('home-news.json', news, { now: new Date(generatedAt) }).thumbnailCount, 2);
  const previous = await collectPriorYahooPhotos(directory);
  await reset();
  assert.deepEqual(await repairYahooArticleThumbnails({ directory, previous, maxLookups: 0, logger: quiet }),
    { repaired: 0, restored: 4, attempted: 0 });
  assert.equal(getArticleThumbnail((await load('today-internet.json')).selectedTopic).imageUrl, image);
});
