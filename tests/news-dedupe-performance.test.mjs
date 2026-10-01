import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function client() {
  let urlParses = 0;
  class CountedURL extends URL {
    constructor(...args) { super(...args); urlParses += 1; }
  }
  const context = { URL: CountedURL, URLSearchParams };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8'), context);
  return { utils: context.TopicClientUtils, parses: () => urlParses };
}
function item(id, title, url, score = 1, categories = ['games']) {
  return { id, title, score, categories, category: categories[0], sourceSignals: [{ url, publishedAt: '2026-10-01T00:00:00Z' }] };
}

test('fuzzy comparison URL parsing scales with inputs, not comparison pairs', () => {
  const { utils, parses } = client();
  const topics = Array.from({ length: 500 }, (_, index) => item(`id-${index}`, `独立記事${String(index).padStart(4, '0')}タイトル`, `https://example.com/articles/${index}`));
  const result = utils.dedupeTopics(topics);
  assert.equal(result.length, topics.length);
  assert.ok(parses() <= topics.length * 3, `URL canonicalization ran ${parses()} times for ${topics.length} topics`);
});

test('merged titles are re-indexed before comparing later candidates', () => {
  const { utils } = client();
  const topics = [
    item('first', '最初に公開された旧タイトル', 'https://example.com/article/a', 1),
    item('replacement', '改訂された新しいゲーム記事の正式タイトル', 'https://example.com/article/a', 2),
    item('third', '改訂された新しいゲーム記事の正式タイトル', 'https://example.net/article/b', 3),
  ];
  const result = utils.dedupeTopics(topics);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'third');
  assert.equal(result[0].sourceSignals.length, 2);
  assert.equal(result[0].posts, '2');
});

test('comparison cache does not persist across calls or miss changed article fields', () => {
  const { utils } = client();
  const first = item('first', '全く異なる最初の記事タイトル', 'https://example.com/article/a');
  const second = item('second', '別のニュースについて詳しく伝える記事', 'https://example.net/article/b');
  assert.equal(utils.dedupeTopics([first, second]).length, 2);
  second.title = first.title;
  assert.equal(utils.dedupeTopics([first, second]).length, 1);
});

test('publication-window and cross-category duplicate behavior is retained', () => {
  const { utils } = client();
  const first = item('first', '今日開催されたイベントについての詳報', 'https://example.com/article/a', 1, ['games']);
  const second = item('second', first.title, 'https://example.net/article/b', 2, ['anime']);
  assert.equal(utils.dedupeTopics([first, second]).length, 1);
  second.sourceSignals[0].publishedAt = '2026-10-05T00:00:00Z';
  assert.equal(utils.dedupeTopics([first, second]).length, 2);
});
