import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const START = Date.parse('2026-10-06T04:00:00Z');
const HOUR = 3600000;
const FILES = ['trend-topics.json', 'news-archive.json', 'home-news.json', 'events.json', 'game-sale-offers.json'];
const plain = (value) => JSON.parse(JSON.stringify(value));
const iso = (value) => new Date(value).toISOString();
const empty = () => ({ items: [], generatedAt: iso(START) });
const offline = () => { throw new Error('offline'); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
function article(id, extra = {}) {
  const title = `ゲーム制作の記録 ${id}`;
  const sourceUrl = `https://example.com/story/${id}`;
  return { id: `news-${id}`, title, sourceUrl, categories: ['games'], publishedAt: iso(START - HOUR),
    sourceSignals: [{ title, url: sourceUrl, sourceName: 'Game publisher', publishedAt: iso(START - HOUR) }], ...extra };
}
const SALE_URL = 'https://example.com/sales/story?item=ONE';
const SALE_TITLE = '『Example Quest』Steamで50%オフの1,000円';
function saleArticle() {
  return article('sale', { title: SALE_TITLE, sourceUrl: SALE_URL,
    sourceSignals: [{ title: SALE_TITLE, url: SALE_URL, sourceName: 'Game publisher', publishedAt: iso(START - HOUR) }] });
}
function offer(extra = {}) {
  return { appId: 123, title: 'Example Quest', store: 'Steam', country: 'JP', currency: 'JPY', edition: 'base-game',
    regularPrice: 2000, salePrice: 1000, discountPercent: 50, storeUrl: 'https://store.steampowered.com/app/123/',
    priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp' },
    articleUrls: [SALE_URL], checkedAt: iso(START - HOUR), freshUntil: iso(START + 5 * HOUR),
    priceValidUntil: iso(START + 23 * HOUR), status: 'verified', ...extra };
}

function harness(plan = {}, sourceText = SOURCE) {
  let wall = START;
  let monotonic = 1000;
  let timerId = 0;
  const timers = new Map();
  const requests = [];
  const errors = [];
  const elements = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const record = (map, name, callback) => map.set(name, [...(map.get(name) || []), callback]);
  const document = { activeElement: null, hidden: false,
    addEventListener: (type, callback) => record(documentListeners, type, callback),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element(selector));
      return elements.get(selector);
    },
    createElement() { return { textContent: '', value: '', set innerHTML(value) { this.value = value; }, get innerHTML() { return this.textContent || this.value; } }; },
  };
  function control(tag, attributes, label = '', cardKey = null) {
    const listeners = new Map();
    const result = { tag, attributes, listeners, id: attributes.id || '', className: attributes.class || '', textContent: label,
      getAttribute(name) { return attributes[name] ?? null; }, hasAttribute(name) { return Object.hasOwn(attributes, name); },
      setAttribute(name, value) { attributes[name] = String(value); },
      closest(selector) { return selector === '[data-game-key]' && cardKey ? { getAttribute: () => cardKey } : null; },
      focus(options) { document.activeElement = this; this.focusOptions = options; },
      addEventListener(type, callback) { record(listeners, type, callback); },
      fire(type, event = {}) { return Promise.all((listeners.get(type) || []).map((listener) => listener(event))); },
      querySelector() { return this.link || null; },
    };
    return result;
  }
  function element(selector) {
    let html = '';
    let nodes = [];
    const result = control('div', { id: selector.slice(1) });
    Object.assign(result, { value: '', hidden: selector === '#game-search-section' || selector === '#game-load-notice', writes: 0,
      scrollIntoView(options) { this.scrollOptions = options; },
      contains(node) { return node === this || nodes.includes(node) || (selector === '#game-load-notice' && node === elements.get('#game-load-retry')); },
      querySelectorAll(query) {
        if (query === '[data-game-result-title]') return nodes.filter((node) => node.hasAttribute('data-game-result-title'));
        if (query === '.game-news-row h3 a') return nodes.filter((node) => node.inHeading && node.tag === 'a');
        return nodes.filter((node) => node.tag === 'a' || node.tag === 'button' || node.hasAttribute('tabindex'));
      },
      querySelector(query) { return query === '[data-game-more-news]' ? nodes.find((node) => node.hasAttribute('data-game-more-news')) || null : null; },
      closest(query) { return query === 'section' ? { querySelector: () => document.querySelector(`${selector}-heading`) } : null; },
      insertAdjacentHTML(_position, value) { this.innerHTML += value; },
    });
    Object.defineProperty(result, 'innerHTML', { get: () => html, set(value) {
      if (nodes.includes(document.activeElement)) document.activeElement = null;
      html = value;
      result.writes++;
      nodes = [];
      for (const match of value.matchAll(/<(a|button|h3)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
        const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] || '']));
        const prefix = value.slice(0, match.index);
        const key = [...prefix.matchAll(/<article[^>]*data-game-key="([^"]*)"/g)].at(-1)?.[1] || null;
        const node = control(match[1], attrs, match[3].replace(/<[^>]*>/g, ''), key);
        nodes.push(node);
        if (match[1] === 'h3') {
          const link = match[3].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/);
          if (link) {
            const linkAttrs = Object.fromEntries([...link[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] || '']));
            const child = control('a', linkAttrs, link[2], key);
            child.inHeading = true;
            node.link = child;
            nodes.push(child);
          }
        }
      }
    } });
    return result;
  }
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return wall; }
  }
  const c = { console: { error: (...args) => errors.push(args) }, URL, Intl, Date: TestDate, document,
    performance: { now: () => monotonic }, matchMedia: () => ({ matches: true }),
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, addEventListener: (type, callback) => record(windowListeners, type, callback),
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
  const names = [...source.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((match) => match[1]);
  source = source.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${names.join(',')},
    readState: () => dashboardState, readInputs: () => dashboardInputs,
    readReader: () => ({ searchQuery, searchVisibleCount, newsVisibleCount }),
    readLoader: () => ({ failures: [...gameSourceFailures], snapshots: Object.keys(gameSourcePayloads), loading: gameSourceLoading }),
  });})();`);
  vm.runInContext(source, c);
  function submit(value) {
    document.querySelector('#game-search-input').value = value;
    return document.querySelector('#game-search-form').fire('submit', { preventDefault() {} });
  }
  return { c, document, elements, requests, errors, timers, plan, documentListeners, windowListeners, submit,
    el: (selector) => document.querySelector(selector),
    retry: () => document.querySelector('#game-load-retry').fire('click'),
    time(value) { wall = value; monotonic = 1000 + value - START; },
    tick() { assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; timers.delete(id); timer.callback(); },
  };
}
const countResults = (h) => h.el('#game-search-results').querySelectorAll('[data-game-result-title]').length;
const official = (h) => h.c.readState()?.steamSales.filter((item) => item.storeUrl) || [];

test('independent loading: each unavailable source preserves articles from the other sources', async () => {
  for (const failed of FILES) {
    const plan = Object.fromEntries(FILES.slice(0, 3).map((file, i) => [file, { items: [article(i)] }]));
    plan[failed] = offline;
    const h = harness(plan);
    await h.c.init();
    assert.ok(h.c.readState(), failed);
    assert.ok(h.c.readState().searchItems.length > 0, failed);
    assert.equal(h.el('#game-load-notice').hidden, false, failed);
    assert.equal(h.requests.length, 5, failed);
    assert.equal(h.errors.length, 0, failed);
  }
});

test('independent loading: missing, malformed, and valid empty article snapshots are distinct', async () => {
  for (const bad of [null, {}, [], 'invalid', { items: null }, { items: {} }, { items: [null] }, { items: [article('valid'), null] }, { items: [{ title: 3 }] }]) {
    const h = harness({ 'trend-topics.json': bad, 'home-news.json': { items: [article('kept')] } });
    await h.c.init();
    assert.deepEqual(plain(h.c.readLoader().failures), ['trend'], JSON.stringify(bad));
    assert.equal(h.c.readState().searchItems.length, 1, JSON.stringify(bad));
  }
  const h = harness();
  await h.c.init();
  assert.deepEqual(plain(h.c.readLoader().failures), []);
  assert.equal(h.el('#game-load-notice').hidden, true);
  assert.equal(h.c.readState().searchItems.length, 0);
  assert.match(h.el('#game-search-status').textContent, /0件/);
});

test('independent loading: malformed price diagnostics stay isolated from ordinary articles', async () => {
  for (const sources of [null, {}, 'invalid']) {
    const h = harness({ 'home-news.json': { items: [article('kept')] }, 'game-sale-offers.json': { items: [offer()], sources } });
    await h.c.init();
    assert.deepEqual(plain(h.c.readLoader().failures), ['prices']);
    assert.equal(h.c.readState().searchItems.length, 1);
    assert.match(h.el('#steam-sale-list').innerHTML, /読み込めませんでした/);
  }
});

test('independent loading: all failed sources recover in stages and retry only what still fails', async () => {
  const h = harness(Object.fromEntries(FILES.map((file) => [file, offline])));
  await h.c.init();
  assert.equal(h.c.readState(), null);
  for (const selector of ['#game-hero-command', '#game-hero-brief', '#game-hero-stats', '#steam-story-list', '#steam-sale-list', '#news-list']) {
    assert.match(h.el(selector).innerHTML, /読み込|失敗/);
    assert.doesNotMatch(h.el(selector).innerHTML, /ローカルHTTP|整理中|整理しています/);
  }
  h.plan['home-news.json'] = { items: [article('recover')] };
  await h.retry();
  assert.equal(h.c.readState().searchItems.length, 1);
  assert.equal(h.requests.length, 10);
  h.plan['trend-topics.json'] = empty();
  h.plan['events.json'] = empty();
  h.plan['game-sale-offers.json'] = empty();
  await h.retry();
  assert.equal(h.requests.length, 14);
  assert.equal(h.requests.filter((name) => name === 'home-news.json').length, 2);
  assert.deepEqual(plain(h.c.readLoader().failures), ['archive']);
  h.plan['news-archive.json'] = { items: [article('recover'), article('second')] };
  await h.retry();
  assert.equal(h.requests.length, 15);
  assert.equal(h.c.readState().searchItems.length, 2);
  assert.equal(h.el('#game-load-notice').hidden, true);
  assert.equal(h.timers.size, 1);
});

test('independent loading: concurrent retry clicks issue one request and preserve reader state on failure', async () => {
  const h = harness({ 'trend-topics.json': { items: Array.from({ length: 25 }, (_, i) => article(i)) }, 'events.json': offline });
  await h.c.init();
  await h.submit('ゲーム');
  await h.el('#game-search-more').fire('click');
  await h.el('#news-list').querySelector('[data-game-more-news]').fire('click');
  const before = plain(h.c.readReader());
  const corpus = plain(h.c.readState().searchItems);
  const pending = deferred();
  h.plan['events.json'] = () => pending.promise;
  const first = h.retry();
  const again = h.retry();
  const third = h.retry();
  assert.equal(h.requests.length, 6);
  assert.equal(h.el('#game-load-retry').getAttribute('aria-disabled'), 'true');
  pending.reject(new Error('still offline'));
  await Promise.all([first, again, third]);
  assert.deepEqual(plain(h.c.readReader()), before);
  assert.deepEqual(plain(h.c.readState().searchItems), corpus);
  assert.equal(countResults(h), 16);
  assert.equal(h.el('#game-load-retry').getAttribute('aria-disabled'), 'false');
  for (const element of h.elements.values()) for (const listeners of element.listeners.values()) assert.equal(listeners.length, 1);
  for (const listeners of [...h.documentListeners.values(), ...h.windowListeners.values()]) assert.equal(listeners.length, 1);
  assert.equal(h.timers.size, 1);
});

test('independent loading: retry completion honors a newer query or native clear without stealing input focus', async () => {
  for (const clear of [false, true]) {
    const h = harness({ 'trend-topics.json': { items: [article('old')] }, 'news-archive.json': offline });
    await h.c.init();
    await h.submit('old');
    const pending = deferred();
    h.plan['news-archive.json'] = () => pending.promise;
    const retry = h.retry();
    if (clear) {
      h.el('#game-search-input').value = '';
      await h.el('#game-search-input').fire('input');
    } else await h.submit('new');
    h.el('#game-search-input').focus();
    pending.resolve({ items: [article('new')] });
    await retry;
    assert.equal(h.document.activeElement, h.el('#game-search-input'));
    assert.equal(h.c.readReader().searchQuery, clear ? '' : 'new');
    assert.equal(h.el('#game-search-section').hidden, clear);
    if (!clear) {
      assert.equal(countResults(h), 1);
      assert.match(h.el('#game-search-results').innerHTML, /story\/new/);
      assert.doesNotMatch(h.el('#game-search-results').innerHTML, /story\/old/);
    }
  }
});

test('independent loading: recovering articles preserves the focused result by identity after reordering', async () => {
  const h = harness({ 'trend-topics.json': { items: [article('old')] }, 'news-archive.json': offline });
  await h.c.init();
  await h.submit('ゲーム');
  const pending = deferred();
  h.plan['news-archive.json'] = () => pending.promise;
  const retry = h.retry();
  const original = h.el('#game-search-results').querySelectorAll('[data-game-result-title]')[0].querySelector('a');
  original.focus();
  pending.resolve({ items: [article('new', { publishedAt: iso(START - 1000) })] });
  await retry;
  assert.notEqual(h.document.activeElement, original);
  assert.equal(h.document.activeElement.getAttribute('href'), 'https://example.com/story/old');
  assert.equal(h.document.activeElement.focusOptions.preventScroll, true);
});

test('independent loading: successful retry moves focus from the now-hidden retry button only when needed', async () => {
  const h = harness({ 'events.json': offline });
  await h.c.init();
  h.el('#game-load-retry').focus();
  h.plan['events.json'] = empty();
  await h.retry();
  assert.equal(h.document.activeElement, h.el('#game-search-input'));
  assert.equal(h.document.activeElement.focusOptions.preventScroll, true);
});

test('independent loading: a recovered sale joins only its exact article, retains timestamps, and schedules its expiry', async () => {
  const item = offer({ freshUntil: iso(START + 1000) });
  const h = harness({ 'trend-topics.json': { items: [saleArticle()] }, 'game-sale-offers.json': offline });
  await h.c.init();
  const pending = deferred();
  h.plan['game-sale-offers.json'] = () => pending.promise;
  const retry = h.retry();
  pending.resolve({ items: [item, offer({ appId: 456, storeUrl: 'https://store.steampowered.com/app/456/', articleUrls: [SALE_URL.replace('ONE', 'OTHER')] })], generatedAt: iso(START + 24 * HOUR) });
  await retry;
  assert.equal(official(h).length, 1);
  assert.equal(official(h)[0].checkedAt, item.checkedAt);
  assert.equal([...h.timers.values()][0].delay, 1000);
  h.time(START + 1000);
  h.tick();
  assert.equal(official(h)[0].status, 'unknown');
  assert.equal(official(h)[0].checkedAt, item.checkedAt);
  assert.equal(h.requests.length, 6, 'aging must not silently refetch');
});

test('independent loading: price recovery cannot attach offers before exact article recovery', async () => {
  const h = harness({ 'trend-topics.json': offline, 'game-sale-offers.json': offline });
  await h.c.init();
  h.plan['game-sale-offers.json'] = { items: [offer()] };
  await h.retry();
  assert.equal(official(h).length, 0);
  h.plan['trend-topics.json'] = { items: [saleArticle()] };
  await h.retry();
  assert.equal(official(h).length, 1);
  assert.equal(h.requests.filter((file) => file === 'game-sale-offers.json').length, 2);
});

test('independent loading: malformed event records cannot discard successful article sources', async () => {
  const malformed = { items: [{ title: 'Valid game event', startDate: iso(START) }, { title: 3, category: 'game', startDate: iso(START) }] };
  const h = harness({ 'trend-topics.json': { items: [article('kept')] }, 'events.json': malformed });
  await h.c.init();
  assert.equal(h.c.readState()?.searchItems.length, 1, 'one bad event must not discard the successful news snapshot');
  assert.deepEqual(plain(h.c.readLoader().failures), ['events']);
});

test('independent loading: a recovered source updates the visible generation time even when article content is unchanged', async () => {
  const h = harness({ 'trend-topics.json': offline, 'home-news.json': { items: [], generatedAt: iso(START - HOUR) } });
  await h.c.init();
  const before = h.el('#game-hero-stats').innerHTML;
  h.plan['trend-topics.json'] = { items: [], generatedAt: iso(START) };
  await h.retry();
  assert.equal(h.c.readState().generatedAt, iso(START));
  assert.notEqual(h.el('#game-hero-stats').innerHTML, before, 'the visible last-update timestamp must follow the recovered snapshot');
  assert.match(h.el('#game-hero-stats').innerHTML, /13:00/);
});

test('independent loading: focused unlinked result headlines survive retry by article identity', async () => {
  const h = harness({ 'trend-topics.json': { items: [article('unlinked', { sourceUrl: 'javascript:alert(1)', sourceSignals: [] })] }, 'news-archive.json': offline });
  await h.c.init();
  await h.submit('ゲーム');
  const original = h.el('#game-search-results').querySelectorAll('[data-game-result-title]')[0];
  assert.equal(original.querySelector('a'), null);
  original.focus();
  const recovered = article('new', { title: '宇宙飛行アクションゲームのサウンド収録現場', publishedAt: iso(START - 1000) });
  h.plan['news-archive.json'] = { items: [recovered] };
  await h.retry();
  assert.equal(h.c.readState().searchItems.length, 2, 'both distinct articles must survive existing story deduplication');
  assert.equal(h.document.activeElement.textContent, original.textContent, 'an unchanged unlinked article should keep its keyboard position');
  assert.equal(h.document.activeElement.hasAttribute('data-game-result-title'), true);
  assert.equal(h.document.activeElement.focusOptions.preventScroll, true);
});

test('independent loading: a slow price recovery never rejuvenates an expired source observation', async () => {
  const observation = offer();
  const h = harness({ 'trend-topics.json': { items: [saleArticle()] }, 'game-sale-offers.json': offline });
  await h.c.init();
  const pending = deferred();
  h.plan['game-sale-offers.json'] = () => pending.promise;
  const retry = h.retry();
  h.time(START + 25 * HOUR);
  pending.resolve({ items: [observation], generatedAt: iso(START + 25 * HOUR) });
  await retry;
  assert.equal(official(h).length, 0);
  assert.equal(h.c.readInputs().meta.saleOffers[0].checkedAt, observation.checkedAt);
  assert.doesNotMatch(h.el('#steam-sale-list').innerHTML, /Steam公式.*2,000/);
});

test('independent loading: recovered authoritative unavailable evidence suppresses the matching article price only', async () => {
  const h = harness({ 'trend-topics.json': { items: [saleArticle()] }, 'game-sale-offers.json': offline });
  await h.c.init();
  assert.equal(h.c.readState().steamSales.length, 1);
  const source = { kind: 'steam', status: 'unavailable', appId: 123,
    url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp', attemptedAt: iso(START), articleUrls: [SALE_URL] };
  const before = plain(source);
  h.plan['game-sale-offers.json'] = { items: [], sources: [source] };
  await h.retry();
  assert.equal(h.c.readState().steamSales.length, 0);
  assert.equal(h.c.readState().searchItems.length, 1, 'superseded sale article remains searchable');
  assert.deepEqual(source, before);
});

test('independent loading: recovery while hidden keeps timers suspended and binds each lifecycle listener once', async () => {
  const h = harness({ 'trend-topics.json': { items: [saleArticle()] }, 'game-sale-offers.json': offline });
  await h.c.init();
  h.document.hidden = true;
  for (const listener of h.documentListeners.get('visibilitychange')) listener();
  assert.equal(h.timers.size, 0);
  h.plan['game-sale-offers.json'] = { items: [offer()] };
  await h.retry();
  assert.equal(h.timers.size, 0);
  h.time(START + 6 * HOUR);
  h.document.hidden = false;
  for (const listener of h.documentListeners.get('visibilitychange')) listener();
  assert.equal(official(h)[0].status, 'unknown');
  assert.equal(h.timers.size, 1);
  for (const listeners of [...h.documentListeners.values(), ...h.windowListeners.values()]) assert.equal(listeners.length, 1);
});
