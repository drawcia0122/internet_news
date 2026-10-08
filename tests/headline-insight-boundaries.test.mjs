import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
process.env.TREND_FETCH_SKIP_MAIN_FOR_TESTS = '1';
const { normalizeStoredTopic, buildNewsArchivePayload, buildHomeNewsPayloads } = await import('../scripts/fetch-trend-topics.mjs');
const { firstHeadlineSentence, buildHeadlineInsight, repairHeadlineInsight, sanitizeArticleSummaryFields } = globalThis.NewsSummaryIntegrity;

for (const [title, expected] of [
  ['M!LK、新曲を発表。来月発売', 'M!LK、新曲を発表'],
  ['Yahoo!ニュースが新機能を公開。利用方法を紹介', 'Yahoo!ニュースが新機能を公開'],
  ['【全話無料】『毎度! 浦安鉄筋家族』が期間限定で無料公開。続報', '『毎度! 浦安鉄筋家族』が期間限定で無料公開'],
  ['『超かぐや姫！』劇場特典を発表！来週から配布', '『超かぐや姫！』劇場特典を発表'],
  ['秋アニメ「超巡！超条先輩」最強(？)バディが登場！続報', '秋アニメ「超巡！超条先輩」最強(？)バディが登場'],
  ['「新作『本当？』が登場！」と発表。続報', '「新作『本当？』が登場！」と発表'],
  ['“Is it real?”の新作が発売！続報', '“Is it real?”の新作が発売'],
  ['アニメ"生徒会にも穴はある！"の新曲が公開。続報', 'アニメ"生徒会にも穴はある！"の新曲が公開'],
  ['iPhone 17!新モデル発表', 'iPhone 17'],
  ['価格は100!詳細は明日', '価格は100'],
  ['Windows 11?新製品の噂', 'Windows 11'],
  ['New game?Details tomorrow', 'New game'],
  ['Y!mobileの新端末を発表。続報', 'Y!mobileの新端末を発表'],
  ['新作を発表。来月発売', '新作を発表'],
  ['新作を発表！来月発売', '新作を発表'],
  ['New game announced! More details', 'New game announced'],
  ['新作を発表？続報を待つ', '新作を発表'],
  ['開いた「見出し。次の文', '開いた「見出し'],
]) test(`headline boundary: ${title}`, () => assert.equal(firstHeadlineSentence(title), expected));

test('empty headlines and length limits retain existing behavior', () => {
  assert.equal(buildHeadlineInsight(''), '新しい動きが出ています。');
  assert.equal(buildHeadlineInsight('あ'.repeat(50)), `${'あ'.repeat(46)}…`);
});

test('repair only exact legacy-derived insights and preserve authored summaries', () => {
  const title = 'M!LK、新曲を発表。来月発売';
  assert.equal(repairHeadlineInsight(title, 'M'), 'M!LK、新曲を発表');
  for (const value of ['新曲は来月発売予定', '', undefined, null]) assert.equal(repairHeadlineInsight(title, value), value);
  assert.equal(repairHeadlineInsight('別の記事の見出し', 'M'), 'M');
  assert.equal(repairHeadlineInsight(title, repairHeadlineInsight(title, 'M')), 'M!LK、新曲を発表');
  const item = { title, whatHappened: 'M', summary: '', briefSummary: '', sourceUrl: 'https://example.com/story', category: 'entertainment' };
  const fixed = sanitizeArticleSummaryFields(item);
  assert.deepEqual({ ...fixed, whatHappened: 'M' }, { ...item, sourceSignals: undefined });
  assert.equal(fixed.whatHappened, 'M!LK、新曲を発表');
});

test('current published article survives generator normalization and home consumers', async () => {
  const data = JSON.parse(await readFile(new URL('./fixtures/headline-punctuation-source.json', import.meta.url)));
  const source = data.items.find(item => item.title.includes('毎度! 浦安鉄筋家族'));
  assert.ok(source);
  const repaired = normalizeStoredTopic(source);
  assert.match(repaired.whatHappened, /^『毎度! 浦安鉄筋家族』が72時間限定で無料公開中/);
  for (const key of ['id', 'title', 'publishedAt', 'capturedAt', 'summary', 'briefSummary', 'thumbnailUrl', 'categories']) assert.deepEqual(repaired[key], source[key]);
  const archive = buildNewsArchivePayload({ archiveItems: [repaired], generatedAt: data.generatedAt });
  const consumers = buildHomeNewsPayloads({ newsArchivePayload: archive, generatedAt: data.generatedAt });
  assert.ok(JSON.stringify(consumers).includes(repaired.whatHappened));
  assert.equal(sanitizeArticleSummaryFields(source).whatHappened, repaired.whatHappened);
});

 test('browser consumers load integrity before shared headline fallback', async () => {
  for (const file of ['index.html', 'news.html', 'game.html', 'topic.html']) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const integrity = html.indexOf('news-summary-integrity.js?v=3');
    assert.ok(integrity >= 0 && integrity < html.indexOf('shared-topic-utils.js?v=20'), file);
  }
  globalThis.window = globalThis;
  await import('../shared-topic-utils.js');
  assert.equal(globalThis.TopicClientUtils.shortEventFromTitle('M!LK、新曲を発表。続報'), 'M!LK、新曲を発表');
});
