import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
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

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/game-search-source-articles.json', import.meta.url), 'utf8'));

function fixtureResponses() {
  return {
    'trend-topics.json': { generatedAt: NOW, items: [fixtures.kai_trend] },
    'news-archive.json': { generatedAt: NOW, items: [fixtures.inside_original, fixtures.inside_followup, fixtures.kai_archive] },
    'home-news.json': { generatedAt: NOW, items: [] },
    'events.json': { generatedAt: NOW, items: [] },
    'game-sale-offers.json': { generatedAt: NOW, items: [] },
  };
}
async function initializeFixture(h) {
  const responses = fixtureResponses();
  h.c.fetchJson = async ({ endpoints }) => responses[endpoints[0].split('/').pop()];
  await h.c.init();
  return responses;
}

function normalizedFixture(c) {
  return [fixtures.kai_trend, fixtures.inside_original, fixtures.inside_followup, fixtures.kai_archive].map((item) => c.TopicClientUtils.normalizeTopic(item));
}

test('real distinct INSIDE follow-up URLs stay searchable despite unchanged fuzzy dashboard grouping', async () => {
  const h = harness(); await initializeFixture(h);
  const grouped = h.c.TopicClientUtils.dedupeTopics(normalizedFixture(h.c)).filter(h.c.isGameTopic);
  assert.equal(grouped.length, 1, 'the original dashboard grouping is intentionally unchanged');
  assert.equal(h.c.readState().searchItems.length, 3);
  h.submit('本人認証済み');
  assert.equal(resultCount(h.elements), 1);
  const original = h.c.findSearchResults('本人認証済み')[0];
  assert.equal(original.url, fixtures.inside_original.sourceUrl);
  assert.equal(original.title, fixtures.inside_original.title);
  assert.equal(original.sourceLabel, 'INSIDE');
  assert.equal(original.publishedAt, Date.parse(fixtures.inside_original.publishedAt));
  h.submit('締切迫る');
  assert.equal(resultCount(h.elements), 1);
  assert.equal(h.c.findSearchResults('締切迫る')[0].url, fixtures.inside_followup.sourceUrl);
  h.submit('ポケカ インフェルノ');
  assert.equal(resultCount(h.elements), 2);
  assert.match(h.elements.get('#game-search-status').textContent, /2件（2件表示 \/ 読み込んだ3件を検索）/);
});

test('article-owned game evidence survives a same-URL mirror that omits its source summary', async () => {
  const h = harness();
  const current = h.c.TopicClientUtils.normalizeTopic(fixtures.kai_trend);
  const archive = h.c.TopicClientUtils.normalizeTopic(fixtures.kai_archive);
  assert.equal(h.c.isGameTopic(current), true);
  assert.equal(h.c.isGameTopic(archive), false);
  assert.equal(h.c.TopicClientUtils.dedupeTopics([current, archive]).filter(h.c.isGameTopic).length, 0);
  await initializeFixture(h);
  const results = h.c.findSearchResults('X VORDER RUNWAY');
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://kai-you.net/article/96734');
  assert.equal(results[0].sourceLabel, 'KAI-YOU');
  assert.equal(results[0].title, fixtures.kai_trend.title);
});

test('raw search indexing leaves every non-search dashboard field unchanged', async () => {
  const h = harness(); await initializeFixture(h);
  const grouped = h.c.TopicClientUtils.dedupeTopics(normalizedFixture(h.c)).filter(h.c.isGameTopic);
  const baseline = plain(h.c.buildDashboardState(grouped, [], { generatedAt: NOW }));
  const actual = plain(h.c.readState());
  delete baseline.searchItems; delete actual.searchItems;
  assert.deepEqual(actual, baseline);
});

test('same-article tracking mirrors add only their own searchable wording without duplicating the result', () => {
  const h = harness();
  const original = fixtures.inside_original;
  const mirror = { ...original, id: 'mirror-copy', sourceUrl: `${original.sourceUrl}?utm_source=mirror#intro`, summary: '本人確認書類の更新方法も案内しています', publishedAt: '2026-10-05T00:00:00Z' };
  const index = h.c.buildSearchArticles([original, mirror]);
  h.c.setState({ searchItems: index });
  assert.equal(index.length, 1);
  assert.equal(index[0].title, original.title);
  assert.equal(index[0].url, original.sourceUrl);
  assert.equal(index[0].publishedAt, Date.parse(original.publishedAt), 'mirrors do not rewrite display metadata or freshness');
  assert.equal(h.c.findSearchResults('本人確認書類').length, 1);
});

test('sibling source signals cannot create results or donate unrelated search terms or destinations', () => {
  const h = harness();
  const original = { ...fixtures.inside_original, sourceSignals: [
    ...fixtures.inside_original.sourceSignals,
    { title: 'Unrelated Space Adventure', summary: 'sibling-only-keyword', url: 'https://other.example.com/articles/unrelated', sourceName: 'Other publisher' },
  ] };
  const index = h.c.buildSearchArticles([original]); h.c.setState({ searchItems: index });
  assert.equal(index.length, 1);
  assert.equal(index[0].url, fixtures.inside_original.sourceUrl);
  assert.equal(h.c.findSearchResults('sibling-only-keyword').length, 0);
  assert.equal(h.c.findSearchResults('Unrelated Space Adventure').length, 0);
});

test('matching headlines do not collapse meaningful query or case-sensitive path identities', () => {
  const h = harness();
  const urls = ['https://example.com/articles/One?id=a', 'https://example.com/articles/One?id=b', 'https://example.com/articles/one?id=a'];
  const records = urls.map((sourceUrl) => ({ ...fixtures.inside_original, id: 'same-generated-id', sourceUrl, sourceSignals: [] }));
  const index = h.c.buildSearchArticles([...records, { ...records[0], sourceUrl: `${urls[0]}&utm_source=mirror` }]);
  assert.equal(index.length, 3);
  assert.deepEqual(new Set(index.map((row) => row.url)), new Set(urls));
});

test('failed-source recovery adds original articles once and keeps the currently submitted query', async () => {
  const h = harness(); const responses = fixtureResponses(); let archiveFailed = true; const requests = [];
  h.c.fetchJson = async ({ endpoints }) => {
    const file = endpoints[0].split('/').pop(); requests.push(file);
    if (file === 'news-archive.json' && archiveFailed) throw Error('fixture archive unavailable');
    return responses[file];
  };
  await h.c.init(); assert.equal(h.c.readState().searchItems.length, 1);
  h.submit('本人認証済み'); assert.equal(resultCount(h.elements), 0);
  archiveFailed = false; await h.c.retryGameSources();
  assert.deepEqual(requests.slice(5), ['news-archive.json']);
  assert.equal(h.c.readState().searchItems.length, 3);
  assert.equal(new Set(h.c.readState().searchItems.map((row) => row.key)).size, 3);
  assert.equal(h.elements.get('#game-search-input').value, '本人認証済み');
  assert.equal(resultCount(h.elements), 1);
  assert.equal(h.c.findSearchResults('本人認証済み')[0].url, fixtures.inside_original.sourceUrl);
});

test('an explicitly empty raw search pool stays empty, while omitted pools keep helper compatibility', () => {
  const h = harness();
  assert.equal(h.c.buildDashboardState([fixtures.inside_original], [], { generatedAt: NOW, searchTopics: [] }).searchItems.length, 0);
  assert.equal(h.c.buildDashboardState([fixtures.inside_original], [], { generatedAt: NOW }).searchItems.length, 1);
});
