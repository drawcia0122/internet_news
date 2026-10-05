import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { collectTrendTopics, repairStoredTopicCategories } from '../lib/trend-aggregator.mjs';
import { restoreArchivedThumbnails } from '../scripts/repair-thumbnails.mjs';

const { getArticleEditorialSectionCategories } = globalThis.ArticleCategoryQuality;
const url = 'https://news.yahoo.co.jp/pickup/6597213?source=rss';
const title = '森保J エクアドルにPK戦の末勝利';
const signal = { sourceId: 'yahoo-sports', title, url, canonicalUrl: url };
const article = (extra = {}) => ({ id: 'keep-original-id', title, sourceUrl: url,
  category: 'general', categories: ['general'], categoryLabel: 'その他', categoryLabels: ['その他'],
  summary: '', publishedAt: '2026-10-01T12:27:39.000Z', sourceSignals: [signal], ...extra });

test('dedicated Yahoo sports, world and business sections restore sparse headline categories', () => {
  for (const [category, headline] of [['sports', title], ['world', 'G7 石油備蓄1億バレル協調放出へ'], ['business', 'プルデンシャルの処分検討 金融庁']]) {
    const input = article({ title: headline, sourceSignals: [{ ...signal, title: headline, sourceId: `yahoo-${category}` }] });
    const fixed = repairStoredTopicCategories(input);
    assert.deepEqual(fixed.categories, [category, 'general']);
    assert.equal(fixed.category, category);
    for (const key of ['id', 'title', 'sourceUrl', 'summary', 'publishedAt', 'sourceSignals']) assert.equal(fixed[key], input[key]);
    assert.deepEqual(input.categories, ['general']);
    assert.equal(repairStoredTopicCategories(fixed), fixed);
  }
});

test('existing article-level categories remain and labels keep their category indexes', () => {
  const input = article({ title: '速報バレー男子 日本vs中国', category: 'world', categories: ['world', 'general'],
    sourceSignals: [{ ...signal, title: '速報バレー男子 日本vs中国' }] });
  const fixed = repairStoredTopicCategories(input);
  assert.deepEqual(fixed.categories, ['world', 'sports', 'general']);
  assert.deepEqual(fixed.categoryLabels, ['国際', 'スポーツ', 'その他']);
  assert.equal(fixed.category, 'world');
});

test('broad publishers, source labels and arbitrary source IDs do not authorize section restoration', () => {
  for (const sourceId of ['yahoo-top', 'yahoo-domestic', 'nhk-top', 'inside-games', 'google-news-sports', '__proto__', 'constructor', undefined]) {
    const input = article({ sourceSignals: [{ ...signal, sourceId, sourceName: 'Yahoo!ニュース / スポーツ', sourceGroup: 'general-sports', categoryHints: ['sports'] }] });
    assert.equal(repairStoredTopicCategories(input), input, String(sourceId));
  }
});

test('wrong host, non-article URL, mismatched title and a secondary article cannot change the primary', () => {
  for (const input of [
    article({ sourceUrl: 'https://elsewhere.example/articles/primary' }),
    article({ sourceUrl: 'https://news.yahoo.co.jp/pickup/1111111' }),
    article({ sourceUrl: 'https://news.yahoo.co.jp.evil.example/pickup/6597213', sourceSignals: [{ ...signal, url: 'https://news.yahoo.co.jp.evil.example/pickup/6597213', canonicalUrl: undefined }] }),
    article({ sourceUrl: 'https://news.yahoo.co.jp/search?p=football', sourceSignals: [{ ...signal, url: 'https://news.yahoo.co.jp/search?p=football', canonicalUrl: undefined }] }),
    article({ sourceSignals: [{ ...signal, title: '別のニュース記事です' }] }),
    article({ sourceSignals: [{ ...signal, sourceId: 'yahoo-top' }, { ...signal, url: 'https://news.yahoo.co.jp/pickup/1111111', canonicalUrl: 'https://news.yahoo.co.jp/pickup/1111111' }] }),
    article({ sourceUrl: undefined, sourceSignals: [{ ...signal, sourceId: 'yahoo-top', url: 'https://news.yahoo.co.jp/pickup/1111111', canonicalUrl: undefined }, signal] }),
  ]) assert.deepEqual(getArticleEditorialSectionCategories(input), []);
});

test('query parameters may differ but title and primary article identity must match', () => {
  assert.deepEqual(getArticleEditorialSectionCategories(article({ sourceUrl: 'http://news.yahoo.co.jp/pickup/6597213#detail' })), ['sports']);
  assert.deepEqual(getArticleEditorialSectionCategories(article({ sourceUrl: undefined })), ['sports']);
  assert.deepEqual(getArticleEditorialSectionCategories(article({ title: '森保Ｊ  エクアドルにPK戦の末勝利' })), ['sports']);
});

test('explicit url, link and primaryLink destinations take precedence over canonical and signal aliases', () => {
  for (const fields of [
    { url: 'https://other.example/match', canonicalUrl: url },
    { link: 'https://other.example/match', canonicalUrl: url },
    { primaryLink: { url: 'https://other.example/match' }, canonicalUrl: url },
    { link: 'https://other.example/match' },
  ]) assert.deepEqual(getArticleEditorialSectionCategories(article({ sourceUrl: undefined, ...fields })), []);
  assert.deepEqual(getArticleEditorialSectionCategories(article({ sourceSignals: [{ ...signal, url: 'https://news.yahoo.co.jp/pickup/1111111' }] })), []);
});

test('fresh RSS restoration keeps the pre-correction stable ID and exact-article thumbnail recovery', async () => {
  const xml = `<rss><channel><item><title>${title}</title><link>${url.replace('&', '&amp;')}</link><pubDate>Thu, 01 Oct 2026 12:27:39 GMT</pubDate></item></channel></rss>`;
  const options = { fetchImpl: async () => new Response(xml), now: new Date('2026-10-02T17:00:00Z'), retryDelaysMs: [] };
  const feed = { id: 'yahoo-sports', source: 'Yahoo!ニュース', sourceName: 'Yahoo!ニュース / スポーツ', sourceGroup: 'general-sports', url: 'https://news.yahoo.co.jp/rss/topics/sports.xml', categoryHints: ['sports'], categoryHint: 'sports' };
  const fresh = (await collectTrendTopics({ ...options, feeds: [feed] })).items[0];
  const before = (await collectTrendTopics({ ...options, feeds: [{ ...feed, id: 'legacy-fixture' }] })).items[0];
  assert.equal(fresh.id, before.id);
  assert.match(fresh.id, /^auto-general-/);
  assert.deepEqual(fresh.categories, ['sports', 'general']);
  const image = 'https://publisher.example/photos/match.jpg';
  const previous = { ...before, thumbnailUrl: image };
  assert.equal(restoreArchivedThumbnails([fresh], [previous]), 1);
  assert.equal(fresh.thumbnailUrl, image);
});

test('Classic list preparation restores cached and generated records without changing count, URL or order', () => {
  const context = vm.createContext({ URL, URLSearchParams }); context.window = context;
  for (const file of ['article-category-quality.js', 'shared-topic-utils.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
  const utils = context.TopicClientUtils;
  const inputs = [article(), article({ id: 'second', title: '別媒体が伝える試合のニュース', sourceUrl: 'https://example.com/match', sourceSignals: [], categories: ['tech'] })];
  const outputs = utils.prepareNewsListItems(inputs);
  assert.equal(outputs.length, inputs.length);
  assert.deepEqual(Array.from(outputs, (item) => item.id), inputs.map((item) => item.id));
  assert.equal(utils.matchesNewsCategory(outputs[0], 'sports'), true);
  assert.equal(utils.matchesNewsCategory(outputs[1], 'sports'), false);
  assert.equal(utils.categoryDisplayLabel(outputs[0]), 'スポーツ / その他');
  assert.equal(outputs[0].sourceUrl, inputs[0].sourceUrl);
  assert.equal(outputs[0].publishedAt, inputs[0].publishedAt);
  for (const key of ['title', 'url', 'canonicalUrl', 'sourceId']) assert.equal(outputs[0].sourceSignals[0][key], inputs[0].sourceSignals[0][key]);
  assert.deepEqual(Array.from(utils.prepareNewsListItems(outputs)[0].categories), ['sports', 'general']);
});

test('both Classic list entry points load the section helper before shared utilities', () => {
  for (const name of ['index.html', 'news.html']) {
    const html = fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    assert.ok(html.indexOf('article-category-quality.js?v=3') < html.indexOf('shared-topic-utils.js?v=17'));
    assert.ok(html.includes('article-category-quality.js?v=3'));
  }
});
