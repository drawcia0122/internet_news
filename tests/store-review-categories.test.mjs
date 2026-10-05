import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { collectTrendTopics, inferCategoriesForCluster, repairStoredTopicCategories } from '../lib/trend-aggregator.mjs';

const headline = '『エースコンバット8』正式発売―Steam日本語レビュー「非常に好評」で好発進。同時接続数は約37,000人に到達する盛り上がり';
const article = (title = headline, extra = {}) => ({ id: 'keep-id', title,
  categories: ['games', 'game-features', 'general'], category: 'games',
  categoryLabels: ['ゲーム', 'ゲーム特集', 'その他'], categoryLabel: 'ゲーム',
  sourceUrl: 'https://www.gamespark.jp/article/2026/10/02/173071.html',
  publishedAt: '2026-10-02T07:00:04.000Z', summary: '',
  sourceSignals: [{ title, url: 'https://www.gamespark.jp/article/2026/10/02/173071.html' }], ...extra });
const infer = (title, description = '') => inferCategoriesForCluster([{ title, description,
  categoryHints: ['games'], categoryHint: 'games', sourceGroup: 'games' }]);

for (const title of [headline, '新作Steamゲームのユーザーレビューが「圧倒的に好評」に到達',
  '新作ゲームが発売、Steamのレビューは高評価', 'Steamゲームの日本語ユーザーレビュー数が1万件を突破']) {
  test(`store/user ratings are game news, not editorial reviews: ${title}`, () => {
    const categories = infer(title);
    assert.ok(categories.includes('games'));
    assert.ok(!categories.includes('game-features'));
    const original = article(title), before = JSON.stringify(original);
    const repaired = repairStoredTopicCategories(original);
    assert.deepEqual(repaired.categories, ['games', 'general']);
    assert.deepEqual(repaired.categoryLabels, ['ゲーム', 'その他']);
    for (const key of ['id', 'title', 'sourceUrl', 'publishedAt', 'summary', 'sourceSignals']) assert.equal(repaired[key], original[key]);
    assert.equal(JSON.stringify(original), before);
    assert.equal(repairStoredTopicCategories(repaired), repaired);
  });
}

test('real editorial reviews, interviews and mixed feature evidence survive', () => {
  for (const title of [
    'Game*Sparkレビュー：Steam新作ゲームの魅力を徹底解説',
    'Steamで好評のゲームをレビュー、発売後の評価を紹介',
    'Steamユーザーレビュー好評のゲーム、開発者インタビュー',
    'Steamレビューを振り返りながら語るゲーム開発秘話',
    'Steam日本語レビュー好評のゲームを先行プレイ',
    '海外レビューハイスコア：Steamの新作ゲーム',
  ]) {
    assert.ok(infer(title).includes('game-features'), title);
    const original = article(title);
    assert.equal(repairStoredTopicCategories(original), original, title);
  }
  const original = article(headline, { summary: '今回は開発者インタビューでSteamの評価とゲーム制作を振り返ります。' });
  assert.equal(repairStoredTopicCategories(original), original);
  const sparse = article('タイトルだけの記録');
  assert.equal(repairStoredTopicCategories(sparse), sparse);
});

test('a feature-only stored label becomes games without dropping other categories', () => {
  const fixed = repairStoredTopicCategories(article(headline, { category: 'game-features', categories: ['game-features', 'tech'] }));
  assert.equal(fixed.category, 'games');
  assert.equal(fixed.categoryLabel, 'ゲーム');
  assert.deepEqual(fixed.categories, ['games', 'tech']);
});

test('fresh RSS corrects categories after preserving the historical generated ID', async () => {
  const title = '新作Steamゲームのユーザーレビューが「圧倒的に好評」に到達';
  const xml = `<rss><channel><item><title>${title}</title><link>https://example.com/articles/game-ratings</link><pubDate>Mon, 05 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const result = await collectTrendTopics({
    feeds: [{ id: 'ratings-test', url: 'https://example.com/feed', sourceName: 'ゲーム媒体' }],
    fetchImpl: async () => new Response(xml), now: new Date('2026-10-05T18:00:00Z'), retryDelaysMs: [],
  });
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.match(item.id, /^auto-game-features-/);
  assert.equal(item.category, 'games');
  assert.deepEqual(item.categories, ['games']);
  assert.equal(item.sourceSignals[0].url, 'https://example.com/articles/game-ratings');
  assert.equal(item.sourceSignals[0].publishedAt, '2026-10-05T12:00:00.000Z');
});

test('Classic preparation repairs current and cached category filters without changing articles', () => {
  const context = vm.createContext({ URL, URLSearchParams }); context.window = context;
  for (const file of ['article-category-quality.js', 'shared-topic-utils.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
  const utils = context.TopicClientUtils;
  const original = article(), before = JSON.stringify(original);
  const prepared = utils.prepareNewsListItems([original]);
  assert.equal(prepared.length, 1);
  assert.equal(utils.matchesNewsCategory(prepared[0], 'games'), true);
  assert.equal(utils.matchesNewsCategory(prepared[0], 'game-features'), false);
  assert.deepEqual([...prepared[0].categoryLabels], ['ゲーム', 'その他']);
  assert.equal(prepared[0].sourceUrl, original.sourceUrl);
  assert.equal(prepared[0].publishedAt, original.publishedAt);
  assert.equal(prepared[0].id, original.id);
  assert.equal(JSON.stringify(original), before);
});
