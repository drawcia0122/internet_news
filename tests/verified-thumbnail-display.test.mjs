import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

globalThis.window = globalThis;
await import('../verified-article-thumbnail.js');
await import('../shared-topic-utils.js');
await import('../home-render-utils.js');

const u = globalThis.TopicClientUtils;
const h = globalThis.HomeRenderUtils;
const url = 'https://news.yahoo.co.jp/articles/' + 'a'.repeat(40);
const pickup = 'https://news.yahoo.co.jp/pickup/1234567';
const image = 'https://newsatcl-pctr.c.yimg.jp/t/amd-img/20261120-123-topic.jpg?exp=10800';
const direct = { title: '元記事', sourceUrl: url, articleThumbnail: {
  kind: 'yahoo-direct-article-og', ownerTitle: '元記事', articleUrl: url,
  articleTitle: '元記事', imageUrl: image, width: 640, height: 480,
} };
const brief = { title: '一覧見出し', primaryLink: { url: pickup, label: '配信元' }, articleThumbnail: {
  ...direct.articleThumbnail, kind: 'yahoo-main-article-og', pickupUrl: pickup, pickupTitle: '一覧見出し',
} };
const deps = { ...u, escapeHtml: String, formatBriefTimelineTime: () => '', sanitizeBriefSummaryText: (s) => s,
  hotTopicScore: () => 0, trimMetaText: (s) => s };

test('daily brief displays an article photo even with no raw thumbnail URL', () => {
  const html = h.renderBriefCard(brief, 0, { badge: 'TODAY' }, deps);
  assert.ok(html.includes(image));
  assert.ok(html.includes(pickup));
  assert.match(html, /loading="lazy" referrerpolicy="no-referrer"/);
});

test('featured cluster and regular-news image renderer display provenance-bound direct photos', () => {
  const topic = { title: direct.title, sourceSignals: [{ url, title: direct.title }], articleThumbnail: direct.articleThumbnail };
  const featured = h.renderTopicClusterCard(topic, { featured: true, scoreMode: 'buzz' }, deps);
  assert.ok(featured.includes(image));
  assert.match(featured, /trend-thumb-wrap/);
  assert.equal(u.pickCardImageUrl(direct), image);
  assert.deepEqual(u.getCardImageCandidates(direct), [image]);
  assert.ok(u.buildCardThumbnail(direct).includes(image));
});

test('rejects a naked proxy URL, another article identity, and a leftover generic image', () => {
  assert.equal(u.buildCardThumbnail({ ...direct, thumbnailUrl: image, articleThumbnail: null }), '');
  assert.equal(u.buildCardThumbnail({ ...direct, sourceUrl: url.replace(/a{40}$/, 'b'.repeat(40)) }), '');
  assert.equal(u.buildCardThumbnail({ ...direct, articleThumbnail: { ...direct.articleThumbnail,
    imageUrl: 'https://newsatcl-pctr.c.yimg.jp/t/news-topics/default.jpg' } }), '');
  const own = 'https://example.com/photos/saved.jpg';
  assert.equal(u.pickCardImageUrl({ ...direct, thumbnailUrl: own }), own);
});

test('live Classic entry points load the proof checker before versioned shared utilities', async () => {
  for (const file of ['index.html', 'news.html']) {
    const s = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(s, /verified-article-thumbnail\.js\?v=1/);
    assert.match(s, /shared-topic-utils\.js\?v=21/);
    assert.ok(s.indexOf('verified-article-thumbnail.js') < s.indexOf('shared-topic-utils.js'), file);
  }
});
