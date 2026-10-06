import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const utils = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const articles = JSON.parse(fs.readFileSync(new URL('./fixtures/game-action-articles.json', import.meta.url), 'utf8'));

function harness() {
  const elements = new Map();
  let focused = null;
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        value: '', textContent: '', innerHTML: '', hidden: true, listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        focus() { focused = selector; }, scrollIntoView() {},
        insertAdjacentHTML(_position, value) { this.innerHTML += value; },
        querySelector() { return { addEventListener() {} }; },
        querySelectorAll() {
          return [...this.innerHTML.matchAll(/<h3[^>]*data-game-result-title[^>]*>([\s\S]*?)<\/h3>/g)].map((match, index) => ({
            focus() { focused = `${selector}:${index}:heading`; },
            querySelector() { return /<a\b/.test(match[1]) ? { focus() { focused = `${selector}:${index}:link`; } } : null; },
          }));
        },
      });
      return elements.get(selector);
    },
    createElement() { return { textContent: '', value: '', set innerHTML(value) { this.value = value; }, get innerHTML() { return this.textContent || this.value; } }; },
  };
  const c = { document, console, URL, Intl, Date, HomeDataUtils: { fetchJsonWithCache: () => Promise.reject(new Error('offline')) } };
  c.window = c;
  c.matchMedia = () => ({ matches: false });
  c.open = () => assert.fail('Article search cannot navigate externally');
  vm.createContext(c);
  vm.runInContext(utils, c);
  const stripped = source.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  vm.runInContext(stripped.replace(/\}\)\(\);\s*$/, 'Object.assign(window, { buildSearchArticles, findSearchResults, bindInteractions, renderFailure, clearGameSearch, setSearchStatus, setState: (value) => { dashboardState = value; } });})();'), c);
  c.bindInteractions();
  function load(topics) { c.setState({ searchItems: c.buildSearchArticles(topics) }); }
  function submit(query) { elements.get('#game-search-input').value = query; elements.get('#game-search-form').listeners.submit({ preventDefault() {} }); }
  return { c, elements, load, submit, focused: () => focused };
}

function article(id, extra = {}) {
  const title = `『Example Quest ${id}』ゲームの続報を公開`;
  return { id: `id-${id}`, title, categories: ['games'], sourceUrl: `https://example.com/news/${id}`, publishedAt: '2026-10-05T00:00:00Z', sourceSignals: [{ title, url: `https://example.com/news/${id}`, sourceName: 'Example', publishedAt: '2026-10-05T00:00:00Z' }], ...extra };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('review: all retained real-world roundup, offer, adaptation and merchandise fixtures are searchable', () => {
  const { c, load } = harness();
  load(articles);
  const results = c.findSearchResults('');
  assert.equal(results.length, 0);
  for (const input of articles) {
    assert.ok(c.findSearchResults(input.title).some((result) => result.title === input.title), input.title);
  }
});

test('review: same generated ID or same headline cannot collapse distinct source URLs', () => {
  const { c } = harness();
  const title = '『Example Quest』ゲーム新情報を公開';
  const inputs = [article(1, { id: 'same', title }), article(2, { id: 'same', title }), article(3, { id: 'same', title })];
  assert.equal(c.buildSearchArticles(inputs).length, 3);
});

test('review: source query case and meaningful query values retain separate article identities', () => {
  const { c } = harness();
  const inputs = ['https://example.com/article?id=AAA', 'https://example.com/article?id=aaa', 'https://example.com/Article?id=AAA'].map((sourceUrl, i) => article(i, { sourceUrl }));
  assert.equal(c.buildSearchArticles(inputs).length, 3);
});

test('review: original whatHappened words displayed to readers can be searched', () => {
  const { c, load } = harness();
  load([article(1, { whatHappened: '自動翻訳と色覚補助機能の詳細を紹介' })]);
  assert.equal(c.findSearchResults('色覚補助機能').length, 1);
});

test('review: an unrelated cluster article cannot donate a game name to the search index', () => {
  const { c, load } = harness();
  const input = article(1);
  input.sourceSignals.push({ title: 'GTA6、Steamゲーム情報を公開', summary: 'GTA6の最新ニュース', url: 'https://other.example/news/gta6' });
  load([input]);
  assert.equal(c.findSearchResults('GTA6').length, 0);
  assert.equal(c.findSearchResults('Example Quest').length, 1);
});

test('review: sorting and labels never use an unrelated source timestamp', () => {
  const { c } = harness();
  const input = article(1, { publishedAt: null, sourceSignals: [{ title: '別の記事の内容', url: 'https://other.example/news/other', publishedAt: '2099-01-01T00:00:00Z' }] });
  const [result] = c.buildSearchArticles([input]);
  assert.equal(result.publishedAt, 0);
  assert.equal(result.publishedLabel, '公開日時不明');
});

test('review: pagination focuses the first new unlinked headline when no safe source URL exists', () => {
  const { load, elements, submit, focused } = harness();
  load(Array.from({ length: 9 }, (_, i) => article(i, { sourceUrl: 'javascript:alert(1)', sourceSignals: [] })));
  submit('Quest');
  elements.get('#game-search-more').listeners.click();
  assert.equal(focused(), '#game-search-results:8:heading');
  assert.equal(elements.get('#game-search-more').hidden, true);
});

test('review: building and querying the index leaves all input article data unchanged', () => {
  const { c, load } = harness();
  const inputs = articles.map((value) => plain(value));
  const before = plain(inputs);
  load(inputs);
  c.findSearchResults('Steam');
  c.findSearchResults('無料');
  assert.deepEqual(inputs, before);
});

test('review: failed load stays actionable after submit and native clear', () => {
  const { c, elements, submit } = harness();
  c.renderFailure();
  submit('Quest');
  assert.match(elements.get('#game-search-status').textContent, /再試行/);
  elements.get('#game-search-input').value = '';
  elements.get('#game-search-input').listeners.input();
  assert.match(elements.get('#game-search-status').textContent, /再試行/);
});
