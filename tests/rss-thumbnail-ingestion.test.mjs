import assert from 'node:assert/strict';
import test from 'node:test';
import { collectTrendTopics } from '../lib/trend-aggregator.mjs';

const title = '新作ゲームの発売日と最新情報を正式発表';
const articleUrl = 'https://publisher.example/story-123';
const imageUrl = 'https://images.example/news/2026/10/02/feature-1200.jpg';

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

async function collectEntry(markup, { source = 'はてなブックマーク', atom = false } = {}) {
  const xml = atom
    ? `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>${title}</title>${markup}<updated>2026-10-02T00:00:00Z</updated></entry></feed>`
    : `<rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>${title}</title>${markup}<pubDate>Fri, 02 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  const result = await collectTrendTopics({
    fetchImpl: async () => new Response(xml, { status: 200 }),
    feeds: [{ id: 'fixture-feed', source, sourceName: source, url: 'https://feeds.example/feed.xml' }],
    now: new Date('2026-10-02T01:00:00Z'),
    retryDelaysMs: [],
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceSignals.length, 1);
  return result.items[0];
}

for (const [publisher, article, image] of [
  ['NHK', 'https://news.web.nhk/newsweb/na/na-k10014901231000', 'https://imgu.web.nhk/newsweb/na/na-k10014901231000/2026/10/02/feature.jpg'],
  ['Yomiuri', 'https://www.yomiuri.co.jp/national/20261002-OYT1T50001/', 'https://www.yomiuri.co.jp/media/2026/10/20261002-OYT1I50001-1.jpg'],
  ['note', 'https://note.com/writer/n/n123456789', 'https://assets.st-note.com/production/uploads/images/123456789/rectangle_large_type_2_abcdef.jpg'],
]) {
  test(`Hatena keeps the ${publisher} article link when a deeper image URL is in its description`, async () => {
    const item = await collectEntry(`<link>${article}</link><description><![CDATA[<p>${title}</p><img src="${image}">]]></description>`);
    assert.equal(item.sourceSignals[0].url, article);
    assert.equal(item.sourceSignals[0].canonicalUrl, article);
    assert.equal(item.thumbnailUrl, image);
    assert.equal(item.sourceSignals[0].thumbnailUrl, image);
    assert.equal(item.sourceSignals[0].sourceId, 'fixture-feed');
  });
}

test('an explicit article link cannot be replaced by a more article-looking related link', async () => {
  const item = await collectEntry(`<link>${articleUrl}</link><description><![CDATA[<a href="https://other.example/news/2026/10/02/related.html">関連記事</a><img src="${imageUrl}">]]></description>`);
  assert.equal(item.sourceSignals[0].url, articleUrl);
  assert.equal(item.thumbnailUrl, imageUrl);
});

test('XML-escaped description markup provides the real image and decodes URL entities', async () => {
  const image = `${imageUrl}?width=1200&quality=85`;
  const description = escapeXml(`<p>${title}</p><img src="${image.replaceAll('&', '&amp;')}">`);
  const item = await collectEntry(`<link>${articleUrl}</link><description>${description}</description>`);
  assert.equal(item.sourceSignals[0].url, articleUrl);
  assert.equal(item.thumbnailUrl, image);
});

test('content:encoded images are read even when description has no image', async () => {
  const item = await collectEntry(`<link>${articleUrl}</link><description>${title}</description><content:encoded>${escapeXml(`<img src="/images/full-story.jpg">`)}</content:encoded>`);
  assert.equal(item.thumbnailUrl, 'https://publisher.example/images/full-story.jpg');
});

test('a placeholder before the real inline image does not prevent thumbnail ingestion', async () => {
  const item = await collectEntry(`<link>${articleUrl}</link><description>${escapeXml(`<img src="https://images.example/placeholder.png"><img src="${imageUrl}">`)}</description>`);
  assert.equal(item.thumbnailUrl, imageUrl);
});

test('image enclosures accept type before url and skip invalid earlier candidates', async () => {
  const item = await collectEntry(`<link>${articleUrl}</link>
    <enclosure type="audio/mpeg" url="https://images.example/audio.mp3" />
    <enclosure type="image/png" url="https://images.example/placeholder.png" />
    <enclosure length="1234" type='image/jpeg' url='${imageUrl}' />`);
  assert.equal(item.thumbnailUrl, imageUrl);
});

test('media:content accepts reordered attributes and skips invalid candidates', async () => {
  const item = await collectEntry(`<link>${articleUrl}</link>
    <media:content type="video/mp4" url="https://images.example/video.mp4" />
    <media:content type="image/png" url="https://images.example/logo.png" />
    <media:content type="image/jpeg" width="1200" url="${imageUrl}" />`);
  assert.equal(item.thumbnailUrl, imageUrl);
});

test('media:content with medium=image works without a MIME type', async () => {
  const item = await collectEntry(`<link>${articleUrl}</link><media:content medium="image" url="${imageUrl}" />`);
  assert.equal(item.thumbnailUrl, imageUrl);
});

test('media:thumbnail continues past an invalid first image', async () => {
  const item = await collectEntry(`<link>${articleUrl}</link><media:thumbnail url="https://images.example/favicon.ico" /><media:thumbnail height="800" url="${imageUrl}" />`);
  assert.equal(item.thumbnailUrl, imageUrl);
});

test('Atom uses an HTML alternate link instead of an earlier self or enclosure link', async () => {
  const item = await collectEntry(`<link rel="self" href="https://feeds.example/entries/123.atom" />
    <link rel="enclosure" type="image/jpeg" href="${imageUrl}" />
    <link type="application/atom+xml" rel="alternate" href="https://feeds.example/entries/alternate.atom" />
    <link type="text/html" href="${articleUrl}" rel="alternate" />
    <summary type="html">${escapeXml(`<img src="${imageUrl}">`)}</summary>`, { atom: true });
  assert.equal(item.sourceSignals[0].url, articleUrl);
  assert.equal(item.thumbnailUrl, imageUrl);
});

test('Atom links with omitted rel default to alternate, and content supplies an image', async () => {
  const item = await collectEntry(`<link href="${articleUrl}" /><content type="html">${escapeXml(`<img src="${imageUrl}">`)}</content>`, { atom: true });
  assert.equal(item.sourceSignals[0].url, articleUrl);
  assert.equal(item.thumbnailUrl, imageUrl);
});

test('aggregator wrappers keep their identity when a description only has unrelated links', async () => {
  const wrapper = 'https://news.google.com/rss/articles/test-entry';
  const item = await collectEntry(`<link>${wrapper}</link><description><![CDATA[<a href="https://other.example/news/2026/10/02/related.html">別の記事</a><img src="${imageUrl}">]]></description>`, { source: 'Google News' });
  assert.equal(item.sourceSignals[0].url, wrapper);
});

test('an aggregator wrapper can use one explicit publisher anchor matching the entry title', async () => {
  const item = await collectEntry(`<link>https://news.google.com/rss/articles/test-entry</link><description>${escapeXml(`<a href="${articleUrl}">${title}</a><a href="https://other.example/news/related.html">関連記事</a>`)}</description>`, { source: 'Google News' });
  assert.equal(item.sourceSignals[0].url, articleUrl);
});

test('an image anchor cannot become the article URL even when its text matches the title', async () => {
  const wrapper = 'https://b.hatena.ne.jp/entry/s/publisher.example/story-123';
  const item = await collectEntry(`<link>${wrapper}</link><description><![CDATA[<a href="${imageUrl}">${title}</a>]]></description>`);
  assert.equal(item.sourceSignals[0].url, wrapper);
});

test('multiple publisher anchors matching a title do not resolve to an arbitrary article', async () => {
  const wrapper = 'https://news.google.com/rss/articles/test-entry';
  const item = await collectEntry(`<link>${wrapper}</link><description><![CDATA[<a href="${articleUrl}">${title}</a><a href="https://other.example/another-story">${title}</a>]]></description>`, { source: 'Google News' });
  assert.equal(item.sourceSignals[0].url, wrapper);
});

test('an extensionless image anchor cannot replace an aggregator article link', async () => {
  const wrapper = 'https://news.google.com/rss/articles/test-entry';
  const item = await collectEntry(`<link>${wrapper}</link><description><![CDATA[<a href="https://images.example/images/asset123?width=1200">${title}</a>]]></description>`);
  assert.equal(item.sourceSignals[0].url, wrapper);
});

test('Atom paired alternate links are not swallowed by preceding self-closing links', async () => {
  const item = await collectEntry(`<link rel="self" href="https://feeds.example/entries/123.atom" /><link rel="alternate" href="${articleUrl}"></link>`, { atom: true });
  assert.equal(item.sourceSignals[0].url, articleUrl);
});

test('RSS CDATA article links survive link-like body markup and source metadata', async () => {
  const item = await collectEntry(`<description><![CDATA[<link href="https://other.example/related-story">]]></description><link><![CDATA[${articleUrl}?a=1&b=2]]></link><source><link href="https://other.example/source-feed" /></source>`);
  assert.equal(item.sourceSignals[0].url, `${articleUrl}?a=1&b=2`);
});

test('Atom image enclosures supply thumbnails without being used as article links', async () => {
  const item = await collectEntry(`<link href="${imageUrl}" type="image/jpeg" rel="enclosure" /><link rel="alternate" href="${articleUrl}" />`, { atom: true });
  assert.equal(item.sourceSignals[0].url, articleUrl);
  assert.equal(item.thumbnailUrl, imageUrl);
});

test('RSS media images with tiny explicit dimensions are skipped', async () => {
  const item = await collectEntry(`<link>${articleUrl}</link><media:thumbnail url="https://images.example/tracking.jpg" width="1" height="1" /><media:thumbnail url="${imageUrl}" width="1200" height="800" />`);
  assert.equal(item.thumbnailUrl, imageUrl);
});

for (const article of [
  'https://news.yahoo.co.jp/articles/publisher-story-123',
  'https://d.hatena.ne.jp/writer/20261002/story',
]) {
  test(`publisher article identity is retained on ${new URL(article).hostname}`, async () => {
    const item = await collectEntry(`<link>${article}</link><description><![CDATA[<a href="${articleUrl}">${title}</a>]]></description>`);
    assert.equal(item.sourceSignals[0].url, article);
  });
}

test('Hatena explicit original image outranks its tiny scissors preview', async () => {
  const proxy = 'https://cdn-ak-scissors.b.st-hatena.com/image/square/id/backend=imagemagick;height=90;version=1;width=120/https%3A%2F%2Fimages.example%2Fphoto.jpg';
  const item = await collectEntry(`<link>${articleUrl}</link><hatena:imageurl>${imageUrl}</hatena:imageurl><description>${escapeXml(`<img src="${proxy}">`)}</description>`);
  assert.equal(item.sourceSignals[0].url, articleUrl);
  assert.equal(item.thumbnailUrl, imageUrl);
  const missing = await collectEntry(`<link>${articleUrl}</link><description>${escapeXml(`<img src="${proxy}">`)}</description>`);
  assert.equal(missing.thumbnailUrl, null);
});
