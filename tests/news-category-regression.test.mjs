import assert from 'node:assert/strict';
import test from 'node:test';
import { collectTrendTopics, inferCategoriesForCluster, repairStoredTopicCategories } from '../lib/trend-aggregator.mjs';

function categories(title, description = '', hints = ['anime', 'manga']) {
  return inferCategoriesForCluster([{ title, description, categoryHints: hints, sourceGroup: hints[0] }]);
}

test('HTML image hashes and linked URLs do not add sports to anime or game stories', () => {
  for (const description of [
    '<img src="https://example.com/a1f1c0.jpg">感動のアニメ作品を振り返ります。',
    '詳細 https://example.com/f1/racing アニメ作品のレビューです。',
    '<a href="https://example.com/nba/">感動した作品</a>',
  ]) {
    assert.ok(!categories('【夏アニメ】感動した3作品を紹介', description).includes('sports'));
  }
  assert.ok(!categories('ゲームソフトを修復するCozy Game Restoration', '<img src="https://example.com/af1c.jpg">', ['games']).includes('sports'));
});

test('genuine Formula 1 and basketball coverage retain sports', () => {
  assert.ok(categories('F1日本GPの決勝結果、優勝ドライバーが決定', '', ['sports']).includes('sports'));
  assert.ok(categories('NBAファイナルの試合結果を発表', '', ['sports']).includes('sports'));
});

test('character popularity elections are not political elections', () => {
  const result = categories('『キン肉マン』スマホゲーム復活、「超人総選挙2026」のキャラも参戦', '', ['games']);
  assert.ok(!result.includes('politics'));
  assert.ok(!result.includes('tech'));
  assert.equal(result[0], 'games');
  assert.ok(categories('衆院総選挙で与党が勝利、首相が会見', '', ['politics']).includes('politics'));
  assert.ok(categories('政治とアイドル総選挙を首相が比較、国会で議論', '', ['politics']).includes('politics'));
});

test('stored false positives are repaired without modifying article identity or content', () => {
  const item = { id: 'keep-id', title: '【夏アニメ】感動した作品を紹介', summary: 'アニメの名場面を振り返ります。', category: 'sports', categories: ['sports', 'anime', 'entertainment', 'manga', 'general'], categoryLabel: 'スポーツ', sourceUrl: 'https://example.com/article/1' };
  const fixed = repairStoredTopicCategories(item);
  assert.equal(fixed.category, 'anime');
  assert.equal(fixed.categoryLabel, 'アニメ');
  assert.ok(!fixed.categories.includes('sports'));
  assert.ok(!fixed.categoryLabels.includes('スポーツ'));
  for (const key of ['id', 'title', 'summary', 'sourceUrl']) assert.equal(fixed[key], item[key]);
  assert.equal(item.category, 'sports');
  assert.equal(repairStoredTopicCategories(fixed), fixed);
});

test('stored sparse news and legitimate sports or tech coverage are preserved', () => {
  const sparse = { title: '接戦の末に勝利', category: 'sports', categories: ['sports'] };
  assert.equal(repairStoredTopicCategories(sparse), sparse);
  const sport = { title: 'サッカー日本代表の試合をゲームで再現', category: 'sports', categories: ['sports', 'games'] };
  assert.equal(repairStoredTopicCategories(sport), sport);
  const tech = { title: 'Androidスマホ向けゲームでGPUの性能比較', category: 'tech', categories: ['tech', 'games'] };
  assert.equal(repairStoredTopicCategories(tech), tech);
});

test('stored smartphone games lose accidental tech and popularity-vote politics labels', () => {
  const item = { title: '『キン肉マン』スマホゲームが復活、「超人総選挙2026」の上位キャラも参戦', category: 'tech', categories: ['tech', 'games', 'politics', 'general'] };
  const result = repairStoredTopicCategories(item);
  assert.deepEqual(result.categories, ['games', 'general']);
  assert.equal(result.categoryLabel, 'ゲーム');
});

test('RDF dc:date is retained as publication time rather than refresh time', async () => {
  const xml = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><item><title>ゲームの大型アップデート内容を正式発表</title><link>https://example.com/articles/update</link><description>ゲームの新しいステージと追加コンテンツを公開しました。</description><dc:date>2026-09-29T09:30:00+09:00</dc:date></item></rdf:RDF>`;
  const result = await collectTrendTopics({
    feeds: [{ id: 'rdf-test', url: 'https://example.com/feed.rdf', source: 'ゲーム媒体', sourceName: 'ゲーム媒体', categoryHint: 'games' }],
    fetchImpl: async () => new Response(xml, { status: 200 }),
    now: new Date('2026-10-01T17:00:00Z'),
    retryDelaysMs: [],
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceSignals[0].publishedAt, '2026-09-29T00:30:00.000Z');
});

test('character merchandise does not inherit games or manga from publisher feeds', () => {
  for (const title of [
    '「ちいかわ」キラキラシール付きカップスープ2種が期間限定発売',
    'しまむらで「ミッフィー」グッズが発売！ルームウェアやタオルに寝具類も',
    '「リラックマ」「すみっコぐらし」のスクイーズが発売',
    'ミッフィーのぬいぐるみキーホルダーが新登場',
  ]) {
    const inferred = categories(title, '', ['games', 'manga']);
    assert.equal(inferred[0], 'entertainment');
    assert.ok(!inferred.includes('games'));
    assert.ok(!inferred.includes('manga'));
    const item = { id: 'keep-id', title, category: 'games', categories: ['games', 'manga', 'general'], sourceUrl: 'https://www.inside-games.jp/article/1', sourceSignals: [{ sourceGroup: 'games', sourceTags: ['games', 'pokemon'], title }] };
    const repaired = repairStoredTopicCategories(item);
    assert.deepEqual(repaired.categories, ['entertainment', 'general']);
    assert.equal(repaired.categoryLabel, 'エンタメ');
    assert.equal(repaired.id, item.id);
    assert.equal(repaired.sourceUrl, item.sourceUrl);
    assert.equal(repaired.sourceSignals, item.sourceSignals);
    assert.equal(item.category, 'games');
    assert.equal(repairStoredTopicCategories(repaired), repaired);
  }
});

test('anime-only coverage does not inherit manga without article evidence', () => {
  const title = '秋アニメの放送開始日とキャスト発表';
  assert.ok(!categories(title).includes('manga'));
  assert.ok(categories(title).includes('anime'));
  const repaired = repairStoredTopicCategories({ title, categories: ['anime', 'manga', 'general'] });
  assert.deepEqual(repaired.categories, ['anime', 'general']);
  assert.ok(categories(title, '人気漫画を原作としたアニメ化作品です。').includes('manga'));
  assert.ok(categories('漫画「ちいかわ」単行本の新刊にグッズが付属').includes('manga'));
  assert.ok(categories('声優がジャンプショップで買ったグッズを紹介').includes('manga'));
});

test('merchandise guard preserves real games, in-game goods and sparse specialist titles', () => {
  for (const title of [
    'ちいかわのゲームが発売、限定グッズも登場',
    'ミッフィーのSwitch向け新作とぬいぐるみセットを発売',
    'リラックマのゲーム内アクセサリーを追加するDLCが登場',
    'すみっコぐらしアプリのマスコットがログイン報酬に登場',
    '謎の新作タイトルの続報が公開',
  ]) {
    assert.ok(categories(title, '', ['games']).includes('games'), title);
    const item = { title, category: 'games', categories: ['games', 'general'] };
    assert.equal(repairStoredTopicCategories(item), item);
  }
  assert.ok(categories('ポケモンのぬいぐるみ付きSwitchソフトが発売', '', ['games']).includes('games'));
});

test('merchandise repair preserves explicit anime and manga categories', () => {
  const anime = repairStoredTopicCategories({ title: 'ちいかわのカップスープ発売', briefSummary: 'アニメ「ちいかわ」の限定デザイン', categories: ['games', 'general'] });
  assert.deepEqual(anime.categories, ['anime', 'general']);
  const manga = repairStoredTopicCategories({ title: '漫画「ちいかわ」の新刊とグッズを発売', categories: ['games', 'manga', 'books', 'general'] });
  assert.deepEqual(manga.categories, ['manga', 'books', 'general']);
});
