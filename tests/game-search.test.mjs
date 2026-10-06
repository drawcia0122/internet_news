import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../game.html', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const NOW = '2026-10-06T04:00:00Z';
const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function harness() {
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return new NativeDate(NOW).getTime(); }
  }
  const elements = new Map();
  let focused = null;
  const element = (selector) => ({
    value: '', innerHTML: '', textContent: '', hidden: selector === '#game-search-section', listeners: {}, scrolled: null,
    addEventListener(type, callback) { this.listeners[type] = callback; },
    focus() { focused = selector; },
    scrollIntoView(options) { this.scrolled = options; },
    insertAdjacentHTML(position, html) { this.innerHTML += html; },
    querySelector() { return { addEventListener() {}, focus() { focused = `${selector}:more`; } }; },
    querySelectorAll() {
      const count = (this.innerHTML.match(/data-game-result-title/g) || []).length;
      return Array.from({ length: count }, (_, index) => ({
        querySelector() { return { focus() { focused = `${selector}:title:${index}:link`; } }; },
        focus() { focused = `${selector}:title:${index}`; },
      }));
    },
  });
  const context = { console, URL, Intl, Date: FixedDate, document: {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element(selector));
      return elements.get(selector);
    },
    createElement() { return {
      set innerHTML(value) { this.value = value; }, get innerHTML() { return escapeHtml(this.textContent ?? this.value); }, value: '',
    }; },
  } };
  context.window = context;
  context.open = () => { throw Error('Local article search must not open an external window'); };
  context.matchMedia = () => ({ matches: true });
  context.HomeDataUtils = { fetchJsonWithCache: (...args) => context.fetchJson(...args) };
  vm.createContext(context);
  vm.runInContext(UTILS, context);
  let script = SOURCE.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const names = [...script.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((match) => match[1]);
  script = script.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${names.join(',')}, setState: (state) => { dashboardState = state; }, readState: () => dashboardState });})();`);
  vm.runInContext(script, context);
  const submit = (query) => {
    elements.get('#game-search-input').value = query;
    let prevented = false;
    elements.get('#game-search-form').listeners.submit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  };
  return { c: context, elements, submit, focused: () => focused };
}

function topic(number, extra = {}) {
  const title = `『Example Quest ${number}』ゲームの追加情報とSteamの対応状況`;
  const sourceUrl = `https://example.com/article/${number}`;
  return {
    id: `article-${number}`, title, sourceUrl, categories: ['games'],
    publishedAt: '2026-10-06T02:00:00Z',
    sourceSignals: [{ title, url: sourceUrl, sourceName: 'ゲーム媒体', publishedAt: '2026-10-06T02:00:00Z' }],
    ...extra,
  };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(c, topics) {
  const dashboard = c.buildDashboardState(topics, [], { generatedAt: NOW });
  c.setState(dashboard);
  c.bindInteractions();
  return dashboard;
}
const resultCount = (elements) => (elements.get('#game-search-results').innerHTML.match(/data-game-result-title/g) || []).length;

test('search indexes all retained game articles before hub exclusions and display caps', () => {
  const { c, elements, submit } = harness();
  const articles = Array.from({ length: 27 }, (_, number) => topic(number));
  const state = load(c, articles);
  assert.equal(state.searchItems.length, 27);
  assert.ok(state.newsItems.length < state.searchItems.length, 'the fixture includes articles represented only by hubs');
  submit('Example Quest');
  assert.equal(resultCount(elements), 8);
  assert.match(elements.get('#game-search-status').textContent, /27件（8件表示 \/ 読み込んだ27件を検索）/);
  submit('Quest 26');
  assert.equal(resultCount(elements), 1);
  assert.match(elements.get('#game-search-results').innerHTML, /article\/26/);
});

test('search normalizes fullwidth characters, casing and spaces, and AND-matches multiple terms', () => {
  const { c, submit, elements } = harness();
  load(c, [topic(1), topic(2, { summary: 'PC向け、完全日本語対応' })]);
  submit('  ＥＸＡＭＰＬＥ　Ｑｕｅｓｔ　１  ');
  assert.equal(resultCount(elements), 1);
  assert.match(elements.get('#game-search-results').innerHTML, /article\/1/);
  submit('日本語 STEAM');
  assert.equal(resultCount(elements), 1);
  assert.match(elements.get('#game-search-results').innerHTML, /article\/2/);
  assert.equal(c.findSearchResults('  ').length, 0);
});

test('displayed whatHappened summaries remain searchable too', () => {
  const { c, submit, elements } = harness();
  load(c, [topic(1, { whatHappened: '画面分割の協力プレイに対応します' })]);
  submit('画面分割');
  assert.equal(resultCount(elements), 1);
  assert.match(elements.get('#game-search-results').innerHTML, /画面分割/);
});

test('search preserves exact article URLs, headings and source labels when a cluster has other stories', () => {
  const { c, elements, submit } = harness();
  const a = topic(1);
  a.sourceSignals.unshift({ title: '別の記事の見出し', url: 'https://unrelated.example.com/article/2', sourceName: '別の媒体' });
  load(c, [a]);
  submit('Quest');
  const html = elements.get('#game-search-results').innerHTML;
  assert.match(html, /href="https:\/\/example.com\/article\/1"/);
  assert.match(html, /ゲーム媒体/);
  assert.ok(html.includes(a.title));
  assert.doesNotMatch(html, /unrelated\.example|別の媒体/);
});

test('one canonical article appears once, while meaningful query identities stay distinct', () => {
  const { c } = harness();
  const a = topic(1);
  const items = c.buildSearchArticles([
    a, { ...a, id: 'duplicate', sourceUrl: `${a.sourceUrl}?utm_source=feed#heading` },
    topic(2, { sourceUrl: 'https://example.com/article?id=one' }),
    topic(3, { sourceUrl: 'https://example.com/article?id=two' }),
  ]);
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map((item) => item.key)).size, 3);
});

test('no-match search stays on the page and explains the loaded-corpus scope', () => {
  const { c, elements, submit, focused } = harness();
  load(c, [topic(1)]);
  submit('存在しないゲーム');
  assert.equal(elements.get('#game-search-section').hidden, false);
  assert.equal(resultCount(elements), 0);
  assert.match(elements.get('#game-search-status').textContent, /0件（0件表示 \/ 読み込んだ1件を検索）/);
  assert.match(elements.get('#game-search-results').innerHTML, /別の表記|現在読み込んだ記事/);
  assert.equal(elements.get('#game-search-more').hidden, true);
  assert.equal(focused(), '#game-search-heading');
  assert.equal(elements.get('#game-search-section').scrolled.behavior, 'auto', 'reduced motion is respected');
  assert.doesNotMatch(SOURCE, /window\.open\(/);
});

test('load more exposes every match exactly once and advances keyboard focus', () => {
  const { c, elements, submit, focused } = harness();
  load(c, Array.from({ length: 19 }, (_, number) => topic(number)));
  submit('Quest');
  const more = elements.get('#game-search-more');
  assert.match(more.textContent, /次の8件.*残り11件/);
  more.listeners.click();
  assert.equal(resultCount(elements), 16);
  assert.equal(focused(), '#game-search-results:title:8:link');
  assert.match(more.textContent, /次の3件.*残り3件/);
  more.listeners.click();
  assert.equal(resultCount(elements), 19);
  assert.equal(more.hidden, true);
  assert.equal(focused(), '#game-search-results:title:16:link');
  const urls = [...elements.get('#game-search-results').innerHTML.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(urls).size, 19);
  submit('Quest');
  assert.equal(resultCount(elements), 8, 'repeat searches reset only the results pagination');
});

test('clear, native clear and whitespace submit remove stale results without rerendering the dashboard', () => {
  const { c, elements, submit, focused } = harness();
  const state = load(c, [topic(1), topic(2)]);
  const baseline = plain(state);
  elements.get('#news-list').innerHTML = '<p>previously expanded news stays intact</p>';
  submit('Quest');
  elements.get('#game-search-clear').listeners.click();
  assert.equal(elements.get('#game-search-input').value, '');
  assert.equal(elements.get('#game-search-section').hidden, true);
  assert.equal(focused(), '#game-search-input');
  assert.match(elements.get('#game-search-status').textContent, /読み込んだゲーム記事 2件/);
  submit('Quest');
  elements.get('#game-search-input').value = '';
  elements.get('#game-search-input').listeners.input();
  assert.equal(elements.get('#game-search-section').hidden, true);
  assert.equal(resultCount(elements), 0);
  submit('Quest');
  submit('   ');
  assert.equal(elements.get('#game-search-section').hidden, true);
  assert.equal(elements.get('#news-list').innerHTML, '<p>previously expanded news stays intact</p>');
  assert.deepEqual(plain(c.readState()), baseline);
});

test('the source date orders matches newest first and missing dates sort last', () => {
  const { c } = harness();
  const items = c.buildSearchArticles([
    topic(1, { publishedAt: '2026-10-01T02:00:00Z' }),
    topic(2, { publishedAt: null, sourceSignals: [] }),
    topic(3, { publishedAt: '2026-10-05T02:00:00Z' }),
  ]);
  assert.deepEqual(plain(items.map((item) => item.url)), ['https://example.com/article/3', 'https://example.com/article/1', 'https://example.com/article/2']);
  assert.equal(items[2].publishedLabel, '公開日時不明');
});

test('unsafe or mismatched destinations do not become search links, while the headline stays readable', () => {
  const { c, elements, submit } = harness();
  load(c, [topic(1, {
    sourceUrl: 'javascript:alert(1)',
    sourceSignals: [{ title: '他の記事の見出し', url: 'https://unrelated.example.com/article/2' }],
  })]);
  submit('Quest');
  assert.equal(resultCount(elements), 1);
  assert.match(elements.get('#game-search-results').innerHTML, /記事リンク未確認/);
  assert.doesNotMatch(elements.get('#game-search-results').innerHTML, /href=|javascript:|unrelated/);
});

test('query and article markup are escaped rather than interpreted as HTML', () => {
  const { c, elements, submit } = harness();
  load(c, [topic(1, { title: 'ゲーム <img src=x onerror=alert(1)>', summary: '<script>alert(1)</script>' })]);
  submit('<img');
  const html = elements.get('#game-search-results').innerHTML;
  assert.equal(resultCount(elements), 1);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(elements.get('#game-search-heading').textContent, /「<img」/);
});

test('submitting before the feed resolves waits and uses only the latest query', async () => {
  const { c, elements, submit } = harness();
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  c.fetchJson = () => response;
  const initialized = c.init();
  submit('wrong');
  submit('Quest 2');
  assert.match(elements.get('#game-search-status').textContent, /完了後に検索/);
  resolve({ items: [topic(1), topic(2)], generatedAt: NOW });
  await initialized;
  assert.equal(resultCount(elements), 1);
  assert.match(elements.get('#game-search-results').innerHTML, /article\/2/);
  assert.doesNotMatch(elements.get('#game-search-results').innerHTML, /article\/1/);
});

test('clearing a pending query prevents results appearing after loading', async () => {
  const { c, elements, submit } = harness();
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  c.fetchJson = () => response;
  const initialized = c.init();
  submit('Quest');
  elements.get('#game-search-input').value = '';
  elements.get('#game-search-input').listeners.input();
  resolve({ items: [topic(1)], generatedAt: NOW });
  await initialized;
  assert.equal(elements.get('#game-search-section').hidden, true);
  assert.equal(resultCount(elements), 0);
  assert.match(elements.get('#game-search-status').textContent, /読み込んだゲーム記事 1件/);
});

test('failed loads keep an actionable failure status during further submits and clears', () => {
  const { c, elements, submit } = harness();
  c.bindInteractions();
  c.renderFailure();
  submit('Quest');
  assert.match(elements.get('#game-search-status').textContent, /再読み込み/);
  assert.doesNotMatch(elements.get('#game-search-status').textContent, /完了後/);
  submit('');
  assert.match(elements.get('#game-search-status').textContent, /再読み込み/);
});

test('HTML offers a labelled local search, live counts, keyboard targets and actually hidden empty results', () => {
  assert.match(HTML, /id="game-search-input"[^>]*aria-describedby="game-search-status"[^>]*aria-controls="game-search-section"/);
  assert.match(HTML, /id="game-search-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(HTML, /id="game-search-section"[^>]*aria-labelledby="game-search-heading"[^>]*hidden/);
  assert.match(HTML, /id="game-search-heading" tabindex="-1"/);
  assert.match(HTML, /id="game-search-clear"/);
  assert.match(HTML, /id="game-search-more" hidden/);
  assert.doesNotMatch(HTML, /探す ↗/);
  assert.match(CSS, /\.game-home-page \.game-search-section\[hidden\],[\s\S]*?display: none;/);
  assert.match(CSS, /\.game-search-form input:focus-visible,[\s\S]*?outline: 3px solid/);
});


test('search results override the legacy three-column grid with readable full-width article rows', () => {
  assert.match(CSS, /\.game-search-section \.game-news-list\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
});
