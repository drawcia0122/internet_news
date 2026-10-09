import assert from 'node:assert/strict';
import test from 'node:test';
import { RSS_FEEDS } from '../config/rss-feeds.mjs';
import { collectTrendTopics } from '../lib/trend-aggregator.mjs';

const feed = RSS_FEEDS.find(({ id }) => id === 'netorabo');
const article = 'https://news.yahoo.co.jp/articles/0123456789abcdef0123456789abcdef01234567';
const image = 'https://newsatcl-pctr.c.yimg.jp/t/amd-img/20261009-10171517-it_nlab-000-1-view.jpg?pri=l&w=450&h=450';
const title = 'コショウの詰め替えで起きた出来事がSNSで話題(ねとらぼ)';
const description = 'コショウを瓶に詰め替えたときの光景がSNSで話題になっています。';
function xml({ includeImage = true, date = 'Fri, 09 Oct 2026 01:15:00 GMT' } = {}) {
  return `<rss version="2.0"><channel><title>ねとらぼ - Yahoo!ニュース</title>
    <pubDate>Fri, 09 Oct 2026 01:29:31 GMT</pubDate>
    <image><url>https://s.yimg.jp/images/news/yjnews_s.gif</url></image>
    <item><title>${title}</title><link>${article}?source=rss</link>
    <pubDate>${date}</pubDate><description>${description}</description>
    ${includeImage ? `<image>${image.replaceAll('&', '&amp;')}</image>` : ''}
    <comments>${article}/comments</comments></item></channel></rss>`;
}
async function collect(body = xml(), feeds = [feed]) {
  return collectTrendTopics({ feeds, fetchImpl: async () => new Response(body), now: new Date('2026-10-09T01:30:00Z'), retryDelaysMs: [] });
}

test('Netorabo uses fresh official Yahoo syndication with explicit distributor attribution', () => {
  assert.equal(feed.url, 'https://news.yahoo.co.jp/rss/media/it_nlab/all.xml');
  assert.equal(feed.source, 'ねとらぼ');
  assert.equal(feed.sourceName, 'ねとらぼ / Yahoo!ニュース');
  assert.equal(feed.id, 'netorabo');
  assert.deepEqual(feed.categoryHints, ['sns', 'net-culture', 'entertainment']);
  assert.equal(RSS_FEEDS.length, 51);
  for (const id of ['famitsu', 'comic-natalie', 'animatetimes', 'pokemon-official', 'realdgame', 'collabo-cafe']) {
    assert.ok(RSS_FEEDS.some((source) => source.id === id), `${id} remains configured`);
  }
});

test('syndicated entry retains article link, timestamp, summary and publisher', async () => {
  const result = await collect();
  const signal = result.items[0].sourceSignals[0];
  assert.equal(signal.sourceId, 'netorabo');
  assert.equal(signal.source, 'ねとらぼ');
  assert.equal(signal.sourceName, 'ねとらぼ / Yahoo!ニュース');
  assert.ok(signal.url.startsWith(article));
  assert.equal(signal.canonicalUrl, signal.url);
  assert.equal(signal.publishedAt, '2026-10-09T01:15:00.000Z');
  assert.equal(signal.summary, description);
  // Existing thumbnail policy rejects Yahoo proxy images; no policy weakening.
  assert.equal(signal.thumbnailUrl, null);
  assert.equal(result.items[0].thumbnailUrl, null);
});

test('channel branding never becomes an article thumbnail', async () => {
  const result = await collect(xml({ includeImage: false }));
  assert.equal(result.items[0].thumbnailUrl, null);
  assert.equal(result.items[0].sourceSignals[0].thumbnailUrl, null);
});

test('current channel timestamp cannot make an old article appear freshly published', async () => {
  const result = await collect(xml({ date: 'Mon, 26 May 2025 14:50:00 +0900' }));
  assert.equal(result.items[0].sourceSignals[0].publishedAt, '2025-05-26T05:50:00.000Z');
});

test('an article shared by Yahoo topic and publisher feeds is not duplicated', async () => {
  const yahoo = RSS_FEEDS.find(({ id }) => id === 'yahoo-top');
  const result = await collect(xml(), [feed, yahoo]);
  assert.equal(result.collectionSummary.fetchedCount, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceSignals.length, 1);
});
