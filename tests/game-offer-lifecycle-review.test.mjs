import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const START = Date.parse('2026-10-06T04:00:00Z');
const HOUR = 3600000;
const ARTICLE_URL = 'https://example.com/sale';
const TITLE = '『Example Quest』Steamで50%オフの1,000円';
const plain = (value) => JSON.parse(JSON.stringify(value));
const article = () => ({ id: 'review-sale', title: TITLE, sourceUrl: ARTICLE_URL, categories: ['games'], publishedAt: '2026-10-06T01:00:00Z',
  sourceSignals: [{ title: TITLE, url: ARTICLE_URL, publishedAt: '2026-10-06T01:00:00Z' }] });
const iso = (milliseconds) => new Date(milliseconds).toISOString();
const offer = (extra = {}) => ({ appId: 123, title: 'Example Quest', store: 'Steam', country: 'JP', currency: 'JPY', edition: 'base-game',
  regularPrice: 2000, salePrice: 1000, discountPercent: 50, storeUrl: 'https://store.steampowered.com/app/123/',
  priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp' },
  articleUrls: [ARTICLE_URL], checkedAt: iso(START - HOUR), freshUntil: iso(START + 5 * HOUR), priceValidUntil: iso(START + 23 * HOUR), status: 'verified', ...extra });

function harness({ wall = START, monotonic = 1000, performance = true } = {}) {
  let wallNow = wall;
  let monotonicNow = monotonic;
  let nextTimer = 0;
  const timers = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const elements = new Map();
  const document = { hidden: false, activeElement: null,
    addEventListener(type, callback) { const listeners = documentListeners.get(type) || []; listeners.push(callback); documentListeners.set(type, listeners); },
    querySelector(selector) {
      if (!elements.has(selector)) {
        let html = '';
        const element = { writes: 0, value: '', hidden: false, listeners: {},
          get innerHTML() { return html; }, set innerHTML(value) { html = value; this.writes++; },
          textContent: '', addEventListener(type, callback) { this.listeners[type] = callback; },
          querySelectorAll() { return []; }, querySelector() { return null; }, contains() { return false; },
          insertAdjacentHTML(_position, value) { html += value; }, focus() { document.activeElement = this; }, scrollIntoView() {},
        };
        elements.set(selector, element);
      }
      return elements.get(selector);
    },
    createElement() { return { textContent: '', value: '', set innerHTML(value) { this.value = value; }, get innerHTML() { return this.textContent || this.value; } }; },
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [wallNow])); }
    static now() { return wallNow; }
  }
  const c = { console, URL, Intl, Date: ClockDate, document, HomeDataUtils: { fetchJsonWithCache() { assert.fail('Lifecycle must not refetch'); } },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, callback) { const listeners = windowListeners.get(type) || []; listeners.push(callback); windowListeners.set(type, listeners); },
    matchMedia() { return { matches: true }; },
  };
  if (performance) c.performance = { now: () => monotonicNow };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(UTILS, c);
  let source = SOURCE.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const functions = [...source.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((match) => match[1]);
  source = source.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${functions.join(',')},
    setInputs: (value) => { dashboardInputs = value; dashboardState = buildDashboardState(value.topics, value.events, value.meta); },
    readState: () => dashboardState,
    setReaderState: () => { newsVisibleCount = 24; searchVisibleCount = 16; searchQuery = 'Example'; },
    readerState: () => ({ newsVisibleCount, searchVisibleCount, searchQuery }),
  });})();`);
  vm.runInContext(source, c);
  return { c, document, elements, timers, documentListeners, windowListeners,
    time(wallValue, monotonicValue = monotonicNow) { wallNow = wallValue; monotonicNow = monotonicValue; },
    load(offers = [offer()], sources = []) { c.setInputs({ topics: [article()], events: [], meta: { generatedAt: iso(START), saleOffers: offers, saleSources: sources } }); c.renderDashboard(); },
    fire(type, location = windowListeners) { for (const callback of location.get(type) || []) callback({ type }); },
    tick() { assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; timers.delete(id); timer.callback(); },
  };
}

function official(state) { return state.steamSales.filter((item) => item.storeUrl); }

test('independent lifecycle: earliest declared deadline wins and exact six-hour boundary downgrades', () => {
  for (const freshUntil of [iso(START + 15000), iso(START + 48 * HOUR)]) {
    const h = harness();
    const inputs = offer({ checkedAt: iso(START - 6 * HOUR + 30000), freshUntil, priceValidUntil: iso(START + 18 * HOUR + 30000) });
    h.load([inputs]);
    h.c.bindOfferLifecycle();
    const expiry = Math.min(Date.parse(freshUntil), START + 30000);
    assert.equal([...h.timers.values()][0].delay, expiry - START);
    assert.equal(official(h.c.readState())[0].status, 'active');
    h.time(expiry, 1000 + expiry - START);
    h.tick();
    assert.equal(official(h.c.readState())[0].status, 'unknown');
    assert.equal(official(h.c.readState())[0].checkedAt, inputs.checkedAt);
    assert.match(h.elements.get('#steam-sale-list').innerHTML, /価格の再確認待ち|前回の割引価格/);
  }
});

test('independent lifecycle: expiry removes official pair on timer, focus, and pageshow without fresh fetches', () => {
  for (const event of ['timer', 'focus', 'pageshow']) {
    const h = harness();
    h.load([offer({ priceValidUntil: iso(START + 12000) })]);
    h.c.bindOfferLifecycle();
    h.time(START + 12000, 13000);
    if (event === 'timer') h.tick(); else h.fire(event);
    assert.equal(official(h.c.readState()).length, 0, event);
    assert.doesNotMatch(h.elements.get('#steam-sale-list').innerHTML, /2,000円|Steam公式/, event);
    assert.equal(h.timers.size, 1, event);
  }
});

test('independent lifecycle: hidden and pagehide clear timers; repeated visible events never multiply them', () => {
  const h = harness();
  h.load();
  h.c.bindOfferLifecycle();
  h.c.bindOfferLifecycle();
  for (const listeners of [...h.documentListeners.values(), ...h.windowListeners.values()]) assert.equal(listeners.length, 1);
  h.document.hidden = true;
  h.fire('visibilitychange', h.documentListeners);
  assert.equal(h.timers.size, 0);
  h.time(START + 6 * HOUR, 1000 + 6 * HOUR);
  h.fire('focus');
  h.fire('pageshow');
  assert.equal(h.timers.size, 0);
  h.document.hidden = false;
  h.fire('visibilitychange', h.documentListeners);
  assert.equal(official(h.c.readState())[0].status, 'unknown');
  for (let i = 0; i < 10; i++) { h.fire('focus'); h.fire('pageshow'); }
  assert.equal(h.timers.size, 1);
  h.fire('pagehide');
  assert.equal(h.timers.size, 0);
  h.fire('pageshow');
  assert.equal(h.timers.size, 1);
});

test('independent lifecycle: monotonic elapsed expires an offer despite a backward wall clock', () => {
  const h = harness();
  h.load();
  h.time(START - 2 * HOUR, 1000 + 24 * HOUR);
  h.c.synchronizeOfferLifecycle();
  assert.equal(official(h.c.readState()).length, 0);
  h.time(START - 4 * HOUR, 1000 + 25 * HOUR);
  h.c.synchronizeOfferLifecycle();
  assert.equal(official(h.c.readState()).length, 0);
});

test('independent lifecycle: observed forward wall clock remains a high-water mark without performance', () => {
  const h = harness({ performance: false });
  h.load();
  h.time(START + 25 * HOUR);
  h.c.synchronizeOfferLifecycle();
  assert.equal(official(h.c.readState()).length, 0);
  h.time(START);
  h.c.synchronizeOfferLifecycle();
  assert.equal(official(h.c.readState()).length, 0);
});

test('independent lifecycle: no-change refresh avoids replacement and expiration preserves query, corpus, and pagination', () => {
  const h = harness();
  h.load();
  h.c.setReaderState();
  const query = h.elements.get('#game-search-input');
  query.value = 'Example';
  query.focus();
  const corpus = h.c.readState().searchItems;
  const writes = [...h.elements].map(([key, element]) => [key, element.writes]);
  const before = plain(h.c.readerState());
  h.c.synchronizeOfferLifecycle();
  assert.deepEqual([...h.elements].map(([key, element]) => [key, element.writes]), writes);
  h.time(START + 25 * HOUR, 1000 + 25 * HOUR);
  h.c.synchronizeOfferLifecycle();
  assert.equal(h.c.readState().searchItems, corpus);
  assert.equal(h.document.activeElement, query);
  assert.equal(query.value, 'Example');
  assert.deepEqual(plain(h.c.readerState()), before);
  assert.equal(h.elements.get('#game-search-results').writes, 0);
});

function focusable(document, attrs, label = '', cardKey = null) {
  return { id: attrs.id || '', className: attrs.class || '', textContent: label,
    getAttribute(name) { return attrs[name] ?? null; }, hasAttribute(name) { return Object.hasOwn(attrs, name); },
    closest(selector) { return cardKey && selector === '[data-game-key]' ? { dataset: { gameKey: cardKey }, getAttribute: (name) => name === 'data-game-key' ? cardKey : null } : null; },
    focus(options) { document.activeElement = this; this.focusOptions = options; },
  };
}

function focusOwner(h, oldNodes, nextNodes) {
  let nodes = oldNodes;
  const heading = focusable(h.document, {}, 'Section');
  heading.setAttribute = () => {};
  const owner = { contains: (node) => nodes.includes(node), querySelectorAll: () => nodes,
    closest: () => ({ querySelector: () => heading }) };
  return { owner, heading, render() { nodes = nextNodes; h.document.activeElement = null; } };
}

test('independent lifecycle: removed focused card moves to its section heading without scrolling', () => {
  const h = harness();
  const original = focusable(h.document, { href: 'https://store.steampowered.com/app/123/', class: 'game-card-link' });
  const replacement = focusable(h.document, { href: 'https://example.com/other', class: 'game-card-link' });
  const { owner, heading, render } = focusOwner(h, [original], [replacement]);
  original.focus();
  h.c.renderPreservingFocus([owner], render);
  assert.equal(h.document.activeElement, heading);
  assert.equal(heading.focusOptions.preventScroll, true);
});

test('independent lifecycle: repeated hero targets preserve the particular focused button', () => {
  const h = harness();
  const attrs = { 'data-target': '#important-section', class: 'topic-meta-card game-home-stat' };
  const original = ['今日まず見ること', '最終更新'].map((label) => focusable(h.document, attrs, label));
  const updated = ['今日まず見ること', '最終更新'].map((label) => focusable(h.document, attrs, label));
  const { owner, render } = focusOwner(h, original, updated);
  original[1].focus();
  h.c.renderPreservingFocus([owner], render);
  assert.equal(h.document.activeElement, updated[1]);
});

test('independent lifecycle: duplicate roundup article links retain their particular card after replacement', () => {
  const h = harness();
  const attrs = { href: ARTICLE_URL, class: 'game-card-link' };
  const original = ['steam-123', 'steam-456'].map((key) => focusable(h.document, attrs, '紹介記事 ↗', key));
  const updated = ['steam-123', 'steam-456'].map((key) => focusable(h.document, attrs, '紹介記事 ↗', key));
  const { owner, render } = focusOwner(h, original, updated);
  original[1].focus();
  h.c.renderPreservingFocus([owner], render);
  assert.equal(h.document.activeElement, updated[1]);
});

test('independent lifecycle: recent authoritative unavailable evidence expires without changing input timestamps', () => {
  const h = harness();
  const source = { kind: 'steam', status: 'unavailable', appId: 123,
    url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp',
    attemptedAt: iso(START - 6 * HOUR + 15000), articleUrls: [ARTICLE_URL] };
  const before = plain(source);
  h.load([], [source]);
  assert.equal(h.c.readState().steamSales.length, 0);
  h.c.bindOfferLifecycle();
  assert.equal([...h.timers.values()][0].delay, 15000);
  h.time(START + 15000, 16000);
  h.tick();
  assert.equal(h.c.readState().steamSales.length, 1);
  assert.equal(h.c.readState().steamSales[0].priceState, 'article');
  assert.deepEqual(plain(source), before);
  h.time(START, 16000);
  h.c.synchronizeOfferLifecycle();
  assert.equal(h.c.readState().steamSales.length, 1, 'clock rollback cannot reinstate an aged authoritative suppression');
});

test('independent lifecycle: short stated validity and hard retention both remain half-open', () => {
  for (const validUntil of [START + 10000, START + 100000]) {
    const h = harness();
    const record = offer({ checkedAt: iso(START - 24 * HOUR + 30000), freshUntil: iso(START - 18 * HOUR + 30000),
      priceValidUntil: iso(Math.min(validUntil, START + 30000)) });
    const before = plain(record);
    h.load([record]);
    const deadline = Math.min(validUntil, START + 30000);
    h.time(deadline - 1, 1000 + deadline - START - 1);
    h.c.synchronizeOfferLifecycle();
    assert.equal(official(h.c.readState()).length, 1);
    h.time(deadline, 1000 + deadline - START);
    h.c.synchronizeOfferLifecycle();
    assert.equal(official(h.c.readState()).length, 0);
    assert.deepEqual(plain(record), before);
  }
});


test('independent lifecycle: reordered identical roundup links follow their stable card key', () => {
  const h = harness();
  const attrs = { href: ARTICLE_URL, class: 'game-card-link' };
  const original = ['steam-123', 'steam-456', 'steam-789'].map((key) => focusable(h.document, attrs, '紹介記事 ↗', key));
  const updated = ['steam-456', 'steam-789', 'steam-123'].map((key) => focusable(h.document, attrs, '紹介記事 ↗', key));
  const { owner, render } = focusOwner(h, original, updated);
  original[2].focus();
  h.c.renderPreservingFocus([owner], render);
  assert.equal(h.document.activeElement, updated[1]);
  assert.equal(updated[1].focusOptions.preventScroll, true);
});

test('independent lifecycle: removed card does not transfer focus to a surviving identical roundup link', () => {
  const h = harness();
  const attrs = { href: ARTICLE_URL, class: 'game-card-link' };
  const original = ['steam-123', 'steam-456'].map((key) => focusable(h.document, attrs, '紹介記事 ↗', key));
  const updated = [focusable(h.document, attrs, '紹介記事 ↗', 'steam-123')];
  const { owner, heading, render } = focusOwner(h, original, updated);
  original[1].focus();
  h.c.renderPreservingFocus([owner], render);
  assert.equal(h.document.activeElement, heading);
  assert.equal(heading.focusOptions.preventScroll, true);
});

test('independent lifecycle: hero control identity survives a changing label value', () => {
  const h = harness();
  const attrs = { 'data-target': '#important-section', class: 'topic-meta-card game-home-stat' };
  const original = [focusable(h.document, { ...attrs, 'data-game-control': '今日まず見ること' }, '今日まず見ること 1件'),
    focusable(h.document, { ...attrs, 'data-game-control': '最終更新' }, '最終更新 10/6 13:00')];
  const updated = [focusable(h.document, { ...attrs, 'data-game-control': '今日まず見ること' }, '今日まず見ること 0件'),
    focusable(h.document, { ...attrs, 'data-game-control': '最終更新' }, '最終更新 10/6 13:00')];
  const { owner, render } = focusOwner(h, original, updated);
  original[1].focus();
  h.c.renderPreservingFocus([owner], render);
  assert.equal(h.document.activeElement, updated[1]);
});
