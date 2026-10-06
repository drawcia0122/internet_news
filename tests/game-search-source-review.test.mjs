import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/game-search-source-articles.json', import.meta.url), 'utf8'));
const START = Date.parse('2026-10-06T04:00:00Z');
const plain = (value) => JSON.parse(JSON.stringify(value));
const empty = () => ({ items: [], generatedAt: new Date(START).toISOString() });
const payload = (items) => ({ ...empty(), items });
const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function article(id, extra = {}) {
  const title = `『Example Quest』ゲーム開発の詳しい記録 ${id}`;
  const sourceUrl = `https://publisher.example/articles/${id}`;
  return { id: `article-${id}`, title, sourceUrl, categories: ['games'], publishedAt: new Date(START - 3600000).toISOString(),
    sourceSignals: [{ title, url: sourceUrl, sourceName: 'Original publisher', publishedAt: new Date(START - 3600000).toISOString() }], ...extra };
}
function harness(plan = {}, sourceText = SOURCE) {
  const elements = new Map();
  const requests = [];
  const errors = [];
  let now = START;
  const document = { activeElement: null, hidden: false,
    addEventListener() {},
    querySelector(selector) {
      if (!elements.has(selector)) {
        let html = '';
        const node = { value: '', textContent: '', hidden: true, writes: 0, listeners: {},
          addEventListener(type, callback) { this.listeners[type] = callback; },
          focus() { document.activeElement = this; }, scrollIntoView() {}, contains() { return false; },
          setAttribute() {}, insertAdjacentHTML(_position, value) { this.innerHTML += value; },
          querySelector() { return { addEventListener() {}, focus() {} }; },
          querySelectorAll() { return [...html.matchAll(/data-game-result-title/g)].map(() => ({ focus() {}, querySelector() { return { focus() {} }; } })); },
          get innerHTML() { return html; }, set innerHTML(value) { html = value; this.writes++; },
        };
        elements.set(selector, node);
      }
      return elements.get(selector);
    },
    createElement() { return { value: '', textContent: '', set innerHTML(value) { this.value = value; }, get innerHTML() { return escapeHtml(this.textContent || this.value); } }; },
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const c = { document, URL, URLSearchParams, Intl, Date: ClockDate, console: { error: (...args) => errors.push(args) },
    matchMedia: () => ({ matches: true }), addEventListener() {},
    HomeDataUtils: { fetchJsonWithCache({ endpoints }) {
      const file = endpoints[0].split('/').at(-1);
      requests.push(file);
      const response = Object.hasOwn(plan, file) ? plan[file] : empty();
      return typeof response === 'function' ? response() : Promise.resolve(response);
    } },
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(UTILS, c);
  let source = sourceText.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const functions = [...source.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((match) => match[1]);
  source = source.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${functions.join(',')},
    readState: () => dashboardState, readInputs: () => dashboardInputs,
    readReader: () => ({ searchQuery, searchVisibleCount, newsVisibleCount }),
    setState: (value) => { dashboardState = value; },
  });})();`);
  vm.runInContext(source, c);
  return { c, plan, elements, requests, errors,
    el: (selector) => document.querySelector(selector),
    time(value) { now = value; },
    submit(query) { document.querySelector('#game-search-input').value = query; document.querySelector('#game-search-form').listeners.submit({ preventDefault() {} }); },
  };
}
const withoutSearch = ({ searchItems, ...rest }) => plain(rest);
const resultCount = (h) => (h.el('#game-search-results').innerHTML.match(/data-game-result-title/g) || []).length;
const fixturePlan = () => ({
  'trend-topics.json': payload([plain(FIXTURE.kai_trend), plain(FIXTURE.inside_followup)]),
  'news-archive.json': payload([plain(FIXTURE.kai_archive), plain(FIXTURE.inside_original)]),
});

// Exercise the real loader and shared normalization/grouping rather than only
// calling buildSearchArticles on already-prepared records.
test('independent source retention: real follow-up articles and the original eligible KAI-YOU record survive loading', async () => {
  const h = harness(fixturePlan());
  await h.c.init();
  const state = h.c.readState();
  assert.equal(state.searchItems.length, 3);
  for (const name of ['inside_original', 'inside_followup']) {
    const record = FIXTURE[name];
    const found = state.searchItems.find((item) => item.url === record.sourceUrl);
    assert.ok(found, name);
    assert.equal(found.title, record.title);
    assert.equal(found.sourceLabel, record.sourceName);
    assert.equal(found.publishedAt, Date.parse(record.publishedAt));
    assert.equal(found.publishedLabel, h.c.formatArticleTime(record));
  }
  h.submit('本人認証済み');
  assert.equal(resultCount(h), 1);
  assert.match(h.el('#game-search-results').innerHTML, /188688\.html/);
  assert.doesNotMatch(h.el('#game-search-results').innerHTML, /188720\.html/);
  h.submit('VORDER');
  assert.equal(resultCount(h), 1);
  assert.match(h.el('#game-search-results').innerHTML, /96734/);
  assert.equal(h.errors.length, 0);
});

test('independent source retention: adding raw search input changes no grouped dashboard field or rendered action', async () => {
  const h = harness(fixturePlan());
  await h.c.init();
  const inputs = h.c.readInputs();
  const { searchTopics, ...legacyMeta } = inputs.meta;
  const legacyState = h.c.buildDashboardState(inputs.topics, inputs.events, legacyMeta);
  assert.deepEqual(withoutSearch(h.c.readState()), withoutSearch(legacyState));
  assert.ok(searchTopics.length > inputs.topics.length);
  assert.equal(legacyState.searchItems.length, 1, 'fixture reproduces two search losses after topic grouping');
  const selectors = ['#game-hero-brief', '#game-hero-command', '#game-hero-stats', '#important-list', '#game-hub-list', '#free-game-list', '#steam-sale-list', '#steam-story-list', '#news-list'];
  const rendered = selectors.map((selector) => h.el(selector).innerHTML);
  h.c.setState(legacyState);
  h.c.renderDashboard();
  assert.deepEqual(selectors.map((selector) => h.el(selector).innerHTML), rendered);
});

test('independent source retention: exact canonical mirrors merge own words while preserving the first original pairing', () => {
  const { c } = harness();
  const original = article('one', { summary: '手描きアニメーション', sourceUrl: 'https://publisher.example/articles/one?a=1&b=2' });
  original.sourceSignals[0].url = original.sourceUrl;
  const mirror = article('mirror', { title: 'ゲーム独自開発日誌', summary: '音声読み上げ対応', sourceUrl: 'https://www.publisher.example/articles/one?utm_medium=rss&b=2&a=1#details', publishedAt: '2026-10-06T03:30:00Z' });
  mirror.sourceSignals.push({ title: 'GTA6とは別記事', summary: 'SiblingSentinel', url: 'https://other.example/articles/sibling', publishedAt: '2099-01-01T00:00:00Z', sourceName: 'Sibling publisher' });
  const before = plain([original, mirror]);
  const results = c.buildSearchArticles([original, mirror, mirror]);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, original.title);
  assert.equal(results[0].url, original.sourceUrl);
  assert.equal(results[0].sourceLabel, 'Original publisher');
  assert.equal(results[0].publishedAt, Date.parse(original.publishedAt));
  assert.equal(results[0].publishedLabel, c.formatArticleTime(original));
  assert.match(results[0].searchText, /手描きアニメーション/);
  assert.match(results[0].searchText, /音声読み上げ対応/);
  assert.equal(results[0].searchText.split('音声読み上げ対応').length - 1, 1);
  assert.doesNotMatch(results[0].searchText, /siblingsentinel|gta6/);
  assert.deepEqual([original, mirror], before);
});

test('independent source retention: meaningful queries, query case, path case, and ports remain separate through the loader', async () => {
  const urls = [
    'https://publisher.example/article?id=ONE', 'https://publisher.example/article?id=one',
    'https://publisher.example/Article?id=ONE', 'https://publisher.example/article?ID=ONE',
    'https://publisher.example:8443/article?id=ONE', 'https://publisher.example/article?id=TWO',
  ];
  const originals = urls.map((sourceUrl, i) => article('same-generated-id', { sourceUrl, publishedAt: new Date(START - (i + 1) * 3600000).toISOString() }));
  const h = harness({ 'trend-topics.json': payload(originals), 'news-archive.json': payload(originals.map((item) => ({ ...item, sourceUrl: `${item.sourceUrl}&utm_source=mirror#top` }))) });
  await h.c.init();
  assert.deepEqual(plain(h.c.readState().searchItems.map((item) => item.url)), urls);
  assert.equal(new Set(h.c.readState().searchItems.map((item) => item.key)).size, urls.length);
});

test('independent source retention: no new result or searchable keyword is promoted from a neighbouring source signal', async () => {
  const own = article('own');
  own.sourceSignals.unshift({ title: '『Unrelated Sibling』ゲームの続報を紹介', summary: 'SiblingKeywordOnly', url: 'https://other.example/article/sibling', sourceName: 'Sibling publisher', publishedAt: '2099-01-01T00:00:00Z' });
  const h = harness({ 'trend-topics.json': payload([own]), 'news-archive.json': payload([{ ...own, summary: 'OwnMirrorKeywordOnly' }]) });
  await h.c.init();
  assert.equal(h.c.readState().searchItems.length, 1);
  h.submit('SiblingKeywordOnly');
  assert.equal(resultCount(h), 0);
  h.submit('Unrelated Sibling');
  assert.equal(resultCount(h), 0);
  h.submit('OwnMirrorKeywordOnly');
  assert.equal(resultCount(h), 1);
  const html = h.el('#game-search-results').innerHTML;
  assert.match(html, /publisher\.example\/articles\/own/);
  assert.doesNotMatch(html, /other\.example|Sibling publisher|2099/);
});

test('independent source retention: a failed archive retry keeps distinct results, pending search, and page state usable', async () => {
  const plan = fixturePlan();
  const archive = plan['news-archive.json'];
  plan['news-archive.json'] = () => { throw Error('offline'); };
  const h = harness(plan);
  await h.c.init();
  h.submit('本人認証済み');
  assert.equal(resultCount(h), 0);
  h.plan['news-archive.json'] = archive;
  await h.c.retryGameSources();
  assert.equal(resultCount(h), 1);
  assert.equal(h.c.readState().searchItems.length, 3);
  const before = plain(h.c.readState());
  const readerBefore = plain(h.c.readReader());
  const html = h.el('#game-search-results').innerHTML;
  h.plan['news-archive.json'] = { items: [{ title: 42 }] };
  await h.c.loadGameSources(['archive'], { isRetry: true });
  assert.deepEqual(plain(h.c.readState()), before);
  assert.deepEqual(plain(h.c.readReader()), readerBefore);
  assert.equal(h.el('#game-search-results').innerHTML, html);
  assert.equal(h.requests.filter((file) => file !== 'news-archive.json').length, 4, 'retry only touches failed/requested source');
  assert.equal(h.errors.length, 0);
});

test('independent source retention: an article-only retry does not rewrite current prices or other dashboard sections', async () => {
  const h = harness({ 'trend-topics.json': payload([article('first')]), 'news-archive.json': () => { throw Error('offline'); } });
  await h.c.init();
  const before = h.el('#steam-sale-list').innerHTML;
  const writes = h.el('#steam-sale-list').writes;
  h.plan['news-archive.json'] = payload([article('second')]);
  await h.c.retryGameSources();
  assert.equal(h.c.readState().searchItems.length, 2);
  assert.equal(h.el('#steam-sale-list').innerHTML, before);
  assert.equal(h.el('#steam-sale-list').writes, writes);
});

test('independent source retention: time-sensitive lifecycle refresh preserves raw corpus, query, expanded results, and markup', async () => {
  const originals = Array.from({ length: 19 }, (_, i) => article(i));
  const h = harness({ 'trend-topics.json': payload(originals), 'news-archive.json': payload(originals) });
  await h.c.init();
  h.submit('Quest');
  h.el('#game-search-more').listeners.click();
  assert.equal(resultCount(h), 16);
  const results = h.c.readState().searchItems;
  const reader = plain(h.c.readReader());
  const html = h.el('#game-search-results').innerHTML;
  const writes = h.el('#game-search-results').writes;
  const requests = h.requests.length;
  h.time(START + 25 * 3600000);
  h.c.synchronizeOfferLifecycle();
  assert.strictEqual(h.c.readState().searchItems, results);
  assert.deepEqual(plain(h.c.readReader()), reader);
  assert.equal(h.el('#game-search-results').innerHTML, html);
  assert.equal(h.el('#game-search-results').writes, writes);
  assert.equal(h.requests.length, requests);
});

test('independent source retention: events and prices cannot donate article destinations to the search corpus', async () => {
  const h = harness({ 'trend-topics.json': payload([article('own')]), 'events.json': payload([article('event')]), 'game-sale-offers.json': payload([article('price')]) });
  await h.c.init();
  assert.deepEqual(plain(h.c.readState().searchItems.map((item) => item.url)), [article('own').sourceUrl]);
});

test('independent source retention: an explicitly empty raw search corpus is honored without changing dashboard state', () => {
  const { c } = harness();
  const topics = [article('one')];
  const meta = { generatedAt: new Date(START).toISOString() };
  const legacy = c.buildDashboardState(topics, [], meta);
  const state = c.buildDashboardState(topics, [], { ...meta, searchTopics: [] });
  assert.equal(state.searchItems.length, 0);
  assert.equal(legacy.searchItems.length, 1);
  assert.deepEqual(withoutSearch(state), withoutSearch(legacy));
});
