import assert from 'node:assert/strict';
import test from 'node:test';
import { repairStoredArticleSource, recoverRetainedSourceArticles } from '../lib/article-source-corrections.mjs';
process.env.TREND_FETCH_SKIP_MAIN_FOR_TESTS = '1';
const { dedupeNearDuplicateItems, normalizeStoredTopic, mergeArchiveItems, buildNewsArchivePayload, buildHomeNewsPayloads } = await import('../scripts/fetch-trend-topics.mjs');

const title = 'TVアニメ『新 美味しんぼ』ティザーPV';
const otherTitle = 'TVアニメ『ビブリア古書堂の事件手帖』本PV第１弾｜2027年4月より放送開始';
const url = 'https://www.youtube.com/watch?v=Hs1AlE91RYQ';
const otherUrl = 'https://www.youtube.com/watch?v=RZwFB0BJCtw';
const publishedAt = '2026-10-01T09:12:36.000Z';
const otherPublishedAt = '2026-10-03T13:24:04.000Z';
const generatedAt = '2026-10-04T14:19:38.724Z';
const thumbnailUrl = 'https://i.ytimg.com/vi/Hs1AlE91RYQ/hqdefault.jpg';
const otherThumbnail = 'https://i.ytimg.com/vi/RZwFB0BJCtw/hqdefault.jpg';
const article = (id, title, url, extra = {}) => ({ id, title, sourceUrl: url, category: 'anime', categories: ['anime'],
  publishedAt, score: 75, sourceSignals: [{ sourceId: 'hatena-hotentry', title, url, canonicalUrl: url, publishedAt }], ...extra });

function corrupted() {
  return article('auto-anime-tvアニメ-新-美味しんぼ-ティザーpv-youtube.com/c/oishinbo', title, otherUrl, {
    thumbnailUrl, capturedAt: '2026-10-01T20:27:32.116Z', summary: 'TVアニメ『新 美味しんぼ』ティザーPVが公開。山岡士郎の声が聞ける新しい映像を紹介しています。',
    categories: ['anime', 'entertainment', 'sns', 'net-culture', 'general', 'books'],
    categoryLabels: ['アニメ', 'エンタメ', 'SNS', 'ネットカルチャー', 'その他', '本'],
    posts: '2', metricLabel: 'sources', scoreSummary: '2サイト掲載 / SNS急上昇',
    hotReasons: ['複数ソースで同じ話題が確認されています。', 'SNSやネット上で反応が広がりやすい話題です。'],
    whyHot: '複数ソースで同じ話題が確認されています。',
    searchLinks: [{ url: `https://www.google.com/search?q=${encodeURIComponent(title)}` }, { url: `https://www.google.com/search?q=${encodeURIComponent(otherTitle)}` }],
    sourceSignals: [{ sourceId: 'hatena-hotentry', sourceName: 'はてなブックマーク人気', title: otherTitle,
      url: otherUrl, canonicalUrl: otherUrl, publishedAt: otherPublishedAt, thumbnailUrl: otherThumbnail,
      summary: 'ビブリア古書堂の事件手帖のテレビアニメは2027年4月より放送開始。' }],
  });
}

test('different watch?v videos survive generation with their own title, date, image and destination', () => {
  const first = article('first', title, url, { thumbnailUrl, score: 76 });
  const second = article('second', otherTitle, otherUrl, { publishedAt: otherPublishedAt, thumbnailUrl: otherThumbnail,
    sourceSignals: [{ title: otherTitle, url: otherUrl, canonicalUrl: otherUrl, publishedAt: otherPublishedAt }] });
  const items = dedupeNearDuplicateItems([first, second]).map((item) => normalizeStoredTopic(item));
  assert.equal(items.length, 2);
  const archive = buildNewsArchivePayload({ archiveItems: items, generatedAt });
  assert.equal(archive.items.length, 2);
  for (const original of [first, second]) {
    const result = archive.items.find((item) => item.id === original.id);
    for (const key of ['title', 'sourceUrl', 'publishedAt', 'thumbnailUrl']) assert.equal(result[key], original[key]);
    assert.equal(result.sourceSignals.length, 1);
    assert.equal(result.sourceSignals[0].title, original.title);
  }
});

test('path case, meaningful query values and ports remain distinct URL identities', () => {
  for (const [left, right] of [
    [url, url.replace('Hs1AlE91RYQ', 'hs1ale91ryq')],
    ['https://publisher.example/articles/AbC', 'https://publisher.example/articles/abc'],
    ['https://publisher.example/article?id=123', 'https://publisher.example/article?id=124'],
    ['https://publisher.example/article?id=AbC', 'https://publisher.example/article?id=abc'],
    ['https://publisher.example:8443/article?id=1', 'https://publisher.example:9443/article?id=1'],
  ]) {
    assert.equal(dedupeNearDuplicateItems([article('a', title, left), article('b', otherTitle, right)]).length, 2, `${left}\n${right}`);
    const normalized = normalizeStoredTopic({ ...article('a', title, left),
      sourceSignals: [...article('a', title, left).sourceSignals, ...article('b', otherTitle, right).sourceSignals] });
    assert.equal(normalized.sourceSignals.length, 2);
  }
});

test('tracking-only variants, parameter ordering and fragments still dedupe at both layers', () => {
  for (const [left, right] of [
    [url, `${url}&utm_source=rss&ref=homepage#player`],
    ['https://publisher.example/article?id=AbC&page=2', 'https://www.publisher.example/article?page=2&UTM_campaign=news&id=AbC&src=feed'],
  ]) {
    const first = article('a', title, left), second = article('b', otherTitle, right);
    assert.equal(dedupeNearDuplicateItems([first, second]).length, 1);
    assert.equal(normalizeStoredTopic({ ...first, sourceSignals: [...first.sourceSignals, ...second.sourceSignals] }).sourceSignals.length, 1);
  }
});

test('verified retained collision recovers both original articles through normal payload builders', () => {
  const input = corrupted(), before = JSON.stringify(input);
  const recovered = recoverRetainedSourceArticles([input]).map((item) => normalizeStoredTopic(item, generatedAt));
  const merged = dedupeNearDuplicateItems(mergeArchiveItems(recovered, []));
  const archive = buildNewsArchivePayload({ archiveItems: merged, generatedAt });
  const home = buildHomeNewsPayloads({ newsArchivePayload: archive, generatedAt }).initial;
  assert.equal(home.items.length, 2);
  assert.equal(home.totalCount, 2);
  const original = home.items.find((item) => item.id === input.id);
  const other = home.items.find((item) => item.title === otherTitle);
  assert.equal(original.sourceUrl, url);
  assert.equal(original.publishedAt, publishedAt);
  assert.equal(original.sourceSignals[0].publishedAt, publishedAt);
  assert.equal(original.sourceSignals[0].title, title);
  assert.equal(original.thumbnailUrl, thumbnailUrl);
  assert.equal(original.summary, input.summary);
  assert.equal(original.capturedAt, input.capturedAt);
  assert.ok(!original.categories.includes('books'));
  assert.equal(original.posts, 1);
  assert.equal(original.metricLabel, 'source');
  assert.doesNotMatch(original.whyHot, /複数ソース/);
  assert.equal(other.sourceUrl, otherUrl);
  assert.equal(other.publishedAt, otherPublishedAt);
  assert.equal(other.sourceSignals[0].title, otherTitle);
  assert.equal(other.thumbnailUrl, otherThumbnail);
  assert.equal(other.summary, input.sourceSignals[0].summary);
  assert.notEqual(other.id, input.id);
  assert.deepEqual(recoverRetainedSourceArticles(recovered), recovered);
  const repaired = repairStoredArticleSource(input);
  assert.equal(repaired.searchLinks.length, 1);
  assert.equal(repaired.scoreSummary, '1サイト掲載 / SNS急上昇');
  assert.deepEqual(repairStoredArticleSource(repaired), repaired);
  assert.equal(JSON.stringify(input), before);
});

test('the repair requires the exact recorded collision, not a matching title or shared channel', () => {
  const baseline = corrupted();
  for (const input of [
    { ...baseline, id: 'other' }, { ...baseline, title: '別の美味しんぼの映像' },
    { ...baseline, publishedAt: otherPublishedAt }, { ...baseline, thumbnailUrl: otherThumbnail },
    { ...baseline, sourceUrl: 'https://www.youtube.com/watch?v=anotherVideo' },
    { ...baseline, sourceSignals: [{ ...baseline.sourceSignals[0], title: '別のニュース' }] },
    { ...baseline, sourceSignals: [{ ...baseline.sourceSignals[0], url }] },
    { ...baseline, sourceSignals: [{ ...baseline.sourceSignals[0], publishedAt }] },
    { ...baseline, sourceSignals: [...baseline.sourceSignals, { title: 'third', url: 'https://example.com/a' }] },
  ]) {
    assert.equal(repairStoredArticleSource(input), input);
    assert.deepEqual(recoverRetainedSourceArticles([input]), [input]);
  }
});

test('recovery does not duplicate an independently retained or fresh article at the same URL', () => {
  const input = corrupted();
  const fresh = article('fresh-biblia-id', otherTitle, otherUrl, { publishedAt: otherPublishedAt,
    sourceSignals: input.sourceSignals, summary: input.sourceSignals[0].summary });
  assert.equal(recoverRetainedSourceArticles([input, fresh]).length, 2);
  assert.equal(recoverRetainedSourceArticles([input, input]).length, 3);
  const normalized = recoverRetainedSourceArticles([input]).map((item) => normalizeStoredTopic(item, generatedAt));
  const merged = mergeArchiveItems(normalized, [fresh]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.title === otherTitle).id, fresh.id);
});


test('retained raw null URLs and known nested source references recover without leaking aliases', () => {
  for (const sourceUrl of [null, undefined, url, otherUrl]) {
    const input = corrupted(); input.sourceUrl = sourceUrl;
    Object.assign(input, { url: otherUrl, canonicalUrl: otherUrl, link: otherUrl,
      primaryLink: { url: otherUrl, title: otherTitle, summary: input.sourceSignals[0].summary, publishedAt: otherPublishedAt, thumbnailUrl: otherThumbnail },
      representativeArticles: [{ title, url: otherUrl, publishedAt: otherPublishedAt, thumbnailUrl: otherThumbnail, summary: input.sourceSignals[0].summary, briefSummary: 'ビブリアの映像です。' }, { title: otherTitle, url: otherUrl }],
    });
    input.sourceSignals[0].thumbnail = otherThumbnail;
    const fixed = repairStoredArticleSource(input);
    for (const field of ['sourceUrl', 'url', 'canonicalUrl', 'link']) assert.equal(fixed[field], url);
    assert.equal(fixed.primaryLink.url, url);
    assert.equal(fixed.primaryLink.title, title);
    assert.equal(fixed.primaryLink.summary, input.summary);
    assert.equal(fixed.primaryLink.publishedAt, publishedAt);
    assert.equal(fixed.primaryLink.thumbnailUrl, thumbnailUrl);
    assert.equal(fixed.representativeArticles.length, 1);
    assert.equal(fixed.representativeArticles[0].url, url);
    assert.equal(fixed.representativeArticles[0].publishedAt, publishedAt);
    assert.equal(fixed.representativeArticles[0].thumbnailUrl, thumbnailUrl);
    assert.equal(fixed.representativeArticles[0].summary, input.summary);
    assert.equal(fixed.representativeArticles[0].briefSummary, '');
    assert.equal(fixed.sourceSignals[0].thumbnail, thumbnailUrl);
    assert.deepEqual(repairStoredArticleSource(fixed), fixed);
  }
});
