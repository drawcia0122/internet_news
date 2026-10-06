import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractThumbnailCandidatesFromHtml, resolveThumbnail, sanitizeThumbnailUrl } from '../lib/thumbnail-utils.mjs';
import { restoreArchivedThumbnails } from '../scripts/repair-thumbnails.mjs';
import { inspectDataset } from '../lib/refresh-health.mjs';

globalThis.window = globalThis;
await import('../shared-topic-utils.js');
const { buildCardThumbnail, getCardImageCandidates, pickCardImageUrl } = globalThis.TopicClientUtils;
const placeholder = 'https://s.yimg.jp/images/news-web/versions/20261006-e1b1f69/all/images/jsonld_image_1244x700.png';
const sourceUrl = 'https://news.yahoo.co.jp/pickup/6597804?source=rss';
const image = 'https://publisher.example/photos/article.jpg';

test('collection and display reject the verified Yahoo site-wide JSON-LD image across versions', () => {
  for (const url of [placeholder, placeholder.replace('20261006-e1b1f69', '20261005-aa557b8'),
    placeholder.replace('https:', 'http:'), `${placeholder}?v=2#preview`]) {
    assert.equal(sanitizeThumbnailUrl(url), null, url);
    assert.equal(pickCardImageUrl({ sourceUrl, thumbnailUrl: url }), null, url);
    assert.equal(buildCardThumbnail({ sourceUrl, thumbnailUrl: url }), '', url);
  }
});

test('the rejection is host/path specific and preserves genuine article assets', () => {
  for (const url of [image, 'https://s.yimg.jp/images/news-web/photos/20261006/article.jpg',
    placeholder.replace('s.yimg.jp', 'publisher.example'),
    placeholder.replace('all/images/jsonld_image_', 'article/photos/jsonld_image_')]) {
    assert.equal(sanitizeThumbnailUrl(url), url, url);
    assert.equal(pickCardImageUrl({ sourceUrl, thumbnailUrl: url }), url, url);
  }
});

test('metadata skips the Yahoo logo and keeps a later actual article image', async () => {
  const html = `<meta property="og:image" content="${placeholder}"><meta property="og:image" content="${image}">`;
  assert.equal(extractThumbnailCandidatesFromHtml(html, sourceUrl).ogImage, image);
  assert.equal((await resolveThumbnail({ item: { thumbnailUrl: placeholder }, sourceUrl, pageHtml: html })).thumbnailUrl, image);
  const jsonLd = `<script type="application/ld+json">{"@type":"NewsArticle","image":["${placeholder}","${image}"]}</script>`;
  assert.equal((await resolveThumbnail({ sourceUrl, pageHtml: jsonLd })).thumbnailUrl, image);
  assert.equal((await resolveThumbnail({ sourceUrl, pageHtml: `<meta property="og:image" content="${placeholder}">` })).thumbnailUrl, null);
});

test('cached cards retain a real owned alternative and same-article fallbacks without mutation', () => {
  const item = { sourceUrl, thumbnailUrl: placeholder, imageUrl: image, sourceSignals: [
    { url: 'https://news.yahoo.co.jp/pickup/1111111', thumbnailUrl: 'https://publisher.example/photos/other.jpg' },
    { url: sourceUrl, thumbnailUrl: image },
  ] };
  const before = structuredClone(item);
  assert.deepEqual(getCardImageCandidates(item), [image]);
  assert.equal(pickCardImageUrl(item), image);
  assert.deepEqual(item, before);
});

test('archive carryover cannot restore the logo but can replace it with an exact-article photo', () => {
  const item = { id: 'one', sourceUrl, thumbnailUrl: null };
  assert.equal(restoreArchivedThumbnails([item], [{ ...item, thumbnailUrl: placeholder }]), 0);
  assert.equal(item.thumbnailUrl, null);
  item.thumbnailUrl = placeholder;
  assert.equal(restoreArchivedThumbnails([item], [{ ...item, thumbnailUrl: image }]), 1);
  assert.equal(item.thumbnailUrl, image);
});

test('refresh health does not count the Yahoo logo as usable coverage', () => {
  const report = inspectDataset('home-news.json', { generatedAt: '2026-10-06T16:12:59Z', items: [
    { title: 'Logo only', thumbnailUrl: placeholder }, { title: 'Real image', thumbnailUrl: image },
  ] }, { now: new Date('2026-10-06T18:00:00Z') });
  assert.equal(report.itemCount, 2);
  assert.equal(report.thumbnailCount, 1);
  assert.equal(report.thumbnailCoverage, 0.5);
});

test('all existing shared thumbnail consumers receive the updated browser cache key', () => {
  for (const name of ['index.html', 'news.html', 'game.html', 'topic.html']) {
    const html = fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    assert.match(html, /shared-topic-utils\.js\?v=18/);
  }
});

test('desktop news cards without a usable image do not inherit the narrow image column', () => {
  const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const desktopRule = css.indexOf('.news-page .trend-card {');
  const noImageRule = css.indexOf('.news-page .trend-card.trend-card-no-thumb {');
  assert.ok(noImageRule > desktopRule, 'the scoped no-image override follows the desktop card rule');
  assert.match(css.slice(noImageRule), /^\.news-page \.trend-card\.trend-card-no-thumb\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);\s*\}/);
  assert.match(fs.readFileSync(new URL('../news.html', import.meta.url), 'utf8'), /styles\.css\?v=62/);
});
