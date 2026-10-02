import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveThumbnail, extractThumbnailCandidatesFromHtml, sanitizeThumbnailUrl, firstSrcsetCandidate } from '../lib/thumbnail-utils.mjs';
import { repairItemThumbnail, restoreArchivedThumbnails, synchronizeThumbnailConsumers } from '../scripts/repair-thumbnails.mjs';

const sourceUrl = 'https://publisher.example/articles/one';
const image = 'https://publisher.example/photos/lead.jpg';
const title = '新しいゲームの発売日が発表されました';

test('metadata extraction accepts any attribute order, whitespace, case and valid later candidates', () => {
  const html = `<META content='/photos/lead.jpg?a=1&#38;b=2' PROPERTY = 'OG:IMAGE'>`;
  assert.equal(extractThumbnailCandidatesFromHtml(html, sourceUrl).ogImage, `${image}?a=1&b=2`);
  assert.equal(extractThumbnailCandidatesFromHtml(`<meta property="og:image" content="/logo.png"><meta content="${image}" property="og:image">`, sourceUrl).ogImage, image);
  assert.equal(extractThumbnailCandidatesFromHtml(`<meta content="${image}" name="twitter:image:src">`, sourceUrl).twitterImage, image);
});

test('responsive and lazy article images use a usable largest variant rather than a placeholder', async () => {
  assert.equal(firstSrcsetCandidate('/photos/small.jpg 100w, /photos/lead.jpg 1200w'), '/photos/lead.jpg');
  for (const html of [
    `<article><img src='/placeholder.png' data-src='/photos/lead.jpg'></article>`,
    `<main><picture><source srcset='/photos/small.jpg?w=80 80w, /photos/lead.jpg 1200w'><img src='/photos/small.jpg?w=80'></picture></main>`,
  ]) assert.equal((await resolveThumbnail({ sourceUrl, pageHtml: html })).thumbnailUrl, image);
});

test('JSON-LD article image wins over body images and organization logos', async () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"Organization","image":"/photos/company.jpg"},{"@type":"NewsArticle","image":["/logo.png",{"contentUrl":"${image}"}]}]}</script><article><img src="/photos/unrelated.jpg"></article>`;
  assert.equal((await resolveThumbnail({ sourceUrl, pageHtml: html })).thumbnailUrl, image);
});

test('does not select unscoped advertising images, encoded arbitrary assets or tiny variants', async () => {
  const html = `<nav><img src="/photos/navigation.jpg"></nav><script>const ad="https://ads.example/banner.jpg";</script><img src="/photos/recommended-story.jpg">`;
  assert.equal((await resolveThumbnail({ sourceUrl, pageHtml: html })).thumbnailUrl, null);
  assert.equal(sanitizeThumbnailUrl(`${image}?w=80`), null);
  for (const url of ['https://publisher.example/logo.png', 'https://publisher.example/articles/one', 'javascript:alert(1)', 'data:image/png;base64,x']) assert.equal(sanitizeThumbnailUrl(url), null);
});

test('keeps a usable existing image if optional page upgrade fails and upgrades if better candidate exists', async () => {
  const small = `${image}?width=240`;
  assert.equal((await resolveThumbnail({ item: { thumbnailUrl: small }, sourceUrl })).thumbnailUrl, small);
  assert.equal((await resolveThumbnail({ item: { thumbnailUrl: small }, sourceUrl, pageHtml: `<meta property="og:image" content="${image}">` })).thumbnailUrl, image);
});

test('repair does not traverse unrelated stories or transfer image to unrelated source signals', async () => {
  const item = { id: 'one', title, sourceUrl, thumbnailUrl: null, sourceSignals: [
    { title, url: sourceUrl, thumbnailUrl: null },
    { title: '別のゲームの発表', url: 'https://publisher.example/articles/two', thumbnailUrl: null },
  ] };
  const requested = [];
  const result = await repairItemThumbnail(item, { fetchHtml: async (url) => {
    requested.push(url);
    return `<title>${title}</title><meta property="og:image" content="${image}">`;
  } });
  assert.equal(result, image);
  assert.equal(item.sourceSignals[0].thumbnailUrl, image);
  assert.equal(item.sourceSignals[1].thumbnailUrl, null);
  assert.deepEqual(requested, [sourceUrl]);
  const noImage = { title, sourceUrl, thumbnailUrl: null };
  const urls = [];
  assert.equal(await repairItemThumbnail(noImage, { fetchHtml: async (url) => { urls.push(url); return `<title>${title}</title><a href="https://other.example/articles/123">関連の記事</a>`; } }), null);
  assert.deepEqual(urls, [sourceUrl]);
});

test('repair rejects a different article title or an image URL saved as an article', async () => {
  const item = { title, sourceUrl, thumbnailUrl: null };
  assert.equal(await repairItemThumbnail(item, { fetchHtml: async () => `<title>全く違う政治経済のニュース</title><meta property="og:image" content="${image}">` }), null);
  assert.equal(await repairItemThumbnail({ title, sourceUrl: image }, { fetchHtml: async () => { throw Error('must not fetch'); } }), null);
});

test('repair sync updates split home data without touching article metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'thumbnail-sync-'));
  try {
    const item = { id: 'one', title, sourceUrl, thumbnailUrl: null, category: 'games', publishedAt: '2026-10-01T12:00:00Z', sourceSignals: [{ url: sourceUrl, thumbnailUrl: null }] };
    const payload = { generatedAt: '2026-10-02T00:00:00Z', totalCount: 42, nextPage: 3, items: [item] };
    const repaired = { ...item, thumbnailUrl: image, sourceSignals: [{ url: sourceUrl, thumbnailUrl: image }] };
    await writeFile(join(directory, 'news-archive.json'), JSON.stringify({ items: [repaired] }));
    for (const file of ['home-news.json', 'home-news-page-2.json']) await writeFile(join(directory, file), JSON.stringify(payload));
    assert.equal(await synchronizeThumbnailConsumers(directory), 2);
    const after = JSON.parse(await readFile(join(directory, 'home-news-page-2.json')));
    assert.deepEqual(after, { ...payload, items: [repaired] });
    assert.equal(await synchronizeThumbnailConsumers(directory), 0);
    await writeFile(join(directory, 'home-news.json'), JSON.stringify({ items: [{ ...item, sourceUrl: 'https://publisher.example/articles/different', sourceSignals: [] }] }));
    assert.equal(await synchronizeThumbnailConsumers(directory), 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

 test('next refresh retains exact-article repairs while keeping newly retrieved images', () => {
  const old = { id: 'one', sourceUrl, thumbnailUrl: image };
  const item = { ...old, thumbnailUrl: null };
  assert.equal(restoreArchivedThumbnails([item], [old]), 1);
  assert.equal(item.thumbnailUrl, image);
  const fresh = { ...old, thumbnailUrl: 'https://publisher.example/photos/new.jpg' };
  assert.equal(restoreArchivedThumbnails([fresh], [old]), 0);
  assert.equal(fresh.thumbnailUrl, 'https://publisher.example/photos/new.jpg');
});

test('failed primary repair never adopts an unrelated grouped story image', async () => {
  const unrelatedUrl = 'https://publisher.example/articles/typhoon';
  const item = { id: 'one', title, sourceUrl, thumbnailUrl: null, sourceSignals: [
    { title, url: sourceUrl }, { title: '台風が北海道に上陸する予報', url: unrelatedUrl },
  ] };
  const requested = [];
  assert.equal(await repairItemThumbnail(item, { fetchHtml: async (url) => {
    requested.push(url);
    return url === unrelatedUrl ? '<title>台風が北海道に上陸する予報</title><meta property="og:image" content="https://publisher.example/photos/typhoon.jpg">' : '';
  } }), null);
  assert.deepEqual(requested, [sourceUrl]);
});

test('shared search links or grouped signals cannot authorize repair propagation', () => {
  const shared = { searchLinks: [{ url: 'https://www.google.com/search?q=news' }], sourceSignals: [{ url: 'https://publisher.example/articles/grouped' }] };
  const old = { ...shared, id: 'one', title, sourceUrl, thumbnailUrl: image };
  const current = { ...shared, id: 'one', title, sourceUrl: 'https://publisher.example/articles/different', thumbnailUrl: null };
  assert.equal(restoreArchivedThumbnails([current], [old]), 0);
  assert.equal(current.thumbnailUrl, null);
});

test('invalid largest srcset candidate falls through to the next valid variant', async () => {
  assert.equal((await resolveThumbnail({ sourceUrl, pageHtml: `<article><img srcset="${image} 640w, /logo.png 1200w"></article>` })).thumbnailUrl, image);
});

test('empty upgrade page keeps an existing metadata-only usable image', async () => {
  const small = `${image}?width=240`;
  assert.equal((await resolveThumbnail({ item: { ogImage: small }, sourceUrl, pageHtml: '<article>no replacement image</article>' })).thumbnailUrl, small);
});

test('raw trend archive can retain an exact title-compatible primary signal repair', () => {
  const raw = { id: 'one', title, thumbnailUrl: null, sourceSignals: [{ title, url: sourceUrl }] };
  assert.equal(restoreArchivedThumbnails([raw], [{ id: 'one', title, sourceUrl, thumbnailUrl: image }]), 1);
  assert.equal(raw.thumbnailUrl, image);
});

test('archive restores low-res and signal-only gaps without changing healthy primary images', () => {
  const old = { id: 'one', title, sourceUrl, thumbnailUrl: image, sourceSignals: [{ title, url: sourceUrl, thumbnailUrl: image }] };
  const low = { ...old, thumbnailUrl: `${image}?width=240`, sourceSignals: [] };
  assert.equal(restoreArchivedThumbnails([low], [old]), 1);
  assert.equal(low.thumbnailUrl, image);
  const item = { ...old, thumbnailUrl: 'https://publisher.example/photos/new.jpg', sourceSignals: [{ title, url: sourceUrl, thumbnailUrl: null }] };
  assert.equal(restoreArchivedThumbnails([item], [old]), 1);
  assert.equal(item.thumbnailUrl, 'https://publisher.example/photos/new.jpg');
  assert.equal(item.sourceSignals[0].thumbnailUrl, image);
});

test('retains scoped publisher lazy attributes and CSS background images', async () => {
  for (const markup of [
    '<img data-url="/photos/lead.jpg">',
    '<img data-thumb="/photos/lead.jpg">',
    '<figure style="background-image:url(\'/photos/lead.jpg\')"></figure>',
    '<div data-background-image="/photos/lead.jpg"></div>',
  ]) assert.equal((await resolveThumbnail({ sourceUrl, pageHtml: `<article>${markup}</article>` })).thumbnailUrl, image);
});
