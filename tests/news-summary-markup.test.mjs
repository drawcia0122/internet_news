import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
globalThis.document = { createElement() { return {
  value: '',
  set innerHTML(value) { this.value = value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); },
}; } };
await import('../shared-topic-utils.js');
const { normalizeSummaryMarkup, normalizeTopic, prepareNewsListItems } = globalThis.TopicClientUtils;

test('RSS anchors keep their readable text without literal markup', () => {
  assert.equal(normalizeSummaryMarkup('PS Plus対象を<a target="_blank" href="https://example.com/">発表しました</a>。'), 'PS Plus対象を 発表しました 。');
  assert.equal(normalizeSummaryMarkup('PS Plus対象を&lt;a href=&quot;https://example.com/&quot;&gt;発表&lt;/a&gt;。'), 'PS Plus対象を 発表 。');
  assert.equal(normalizeSummaryMarkup('PS Plus対象を&amp;lt;a href=&amp;quot;https://example.com/&amp;quot;&amp;gt;発表&amp;lt;/a&amp;gt;。'), 'PS Plus対象を 発表 。');
});

test('truncated PS Plus anchor attributes are removed rather than displayed', () => {
  assert.equal(normalizeSummaryMarkup('2026年10月度フリープレイ対象タイトルを<a target="_blank" rel="noopener noreferrer" href="https://blo…'), '2026年10月度フリープレイ対象タイトルを');
});

test('ordinary comparisons and script-free article wording remain intact', () => {
  assert.equal(normalizeSummaryMarkup('価格は 100 < 200、A &amp; B の比較です。'), '価格は 100 < 200、A & B の比較です。');
  assert.equal(normalizeSummaryMarkup('本文<script>alert(1)</script>続き'), '本文 続き');
});

test('both detail normalization and shared home/news lists strip summary markup', () => {
  const item = { title: 'ゲームの無料配布タイトルを公開しました', sourceUrl: 'https://example.com/article/1', summary: '新作ゲームの対象タイトルを&lt;a href=&quot;https://example.com&quot;&gt;正式発表しました&lt;/a&gt;。', category: 'games', categories: ['games'] };
  assert.ok(!normalizeTopic(item).summary.includes('<a'));
  const items = prepareNewsListItems([item]);
  assert.equal(items.length, 1);
  assert.ok(!items[0].summary.includes('<a'));
  assert.equal(item.summary.includes('&lt;a'), true);
});
