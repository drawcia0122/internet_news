import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const HOUR = 3600000;
const START = Date.parse('2026-10-06T04:00:00Z');
const ARTICLE_URL = 'https://example.com/articles/example-quest';
const TITLE = '『Example Quest』Steamセールの対象作品を紹介';
const escape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = (value) => String(value).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
function article(id = 'sale', extra = {}) {
  const title = id === 'sale' ? TITLE : `ゲームの補完ニュース ${id}`;
  const url = id === 'sale' ? ARTICLE_URL : `https://example.com/articles/${id}`;
  return { id, title, categories: ['games'], sourceUrl: url, publishedAt: '2026-10-06T02:00:00Z', sourceSignals: [{ title, url, sourceName: 'Example', publishedAt: '2026-10-06T02:00:00Z' }], ...extra };
}
function offer(extra = {}) {
  return {
    appId: 123, title: 'Example Quest', store: 'Steam', country: 'JP', currency: 'JPY', edition: 'base-game',
    regularPrice: 2000, salePrice: 1000, discountPercent: 50,
    storeUrl: 'https://store.steampowered.com/app/123/?cc=jp&l=japanese',
    priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp&l=japanese' },
    articleUrls: [ARTICLE_URL], status: 'verified', checkedAt: new Date(START).toISOString(),
    freshUntil: new Date(START + 6 * HOUR).toISOString(), priceValidUntil: new Date(START + 24 * HOUR).toISOString(),
    ...extra,
  };
}

function harness({ topics = [article(), ...Array.from({ length: 20 }, (_, i) => article(i))], offers = [offer()], sources = [], fetchError = false } = {}) {
  let wall = START;
  let monotonic = 500;
  const timers = new Map();
  const windowEvents = new Map();
  const documentEvents = new Map();
  const elements = new Map();
  let timerId = 0;
  let fetchCount = 0;
  const body = { tagName: 'BODY', id: '' };
  const document = { activeElement: body, hidden: false };
  class Node {
    constructor(tag = 'DIV', attrs = {}, owner = null) {
      this.tagName = tag; this.attrs = attrs; this.owner = owner; this.id = attrs.id || ''; this.className = attrs.class || '';
      this.children = []; this._html = ''; this.textContent = ''; this.value = ''; this.hidden = false; this.listeners = {}; this.writes = 0;
    }
    get innerHTML() { return this._html; }
    set innerHTML(value) {
      if (this.contains(document.activeElement)) document.activeElement = body;
      this._html = value; this.children = []; this.writes++;
      for (const match of value.matchAll(/<(a|button|h3)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
        const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], decode(m[2] || '')]));
        const child = new Node(match[1].toUpperCase(), attrs, this);
        child.textContent = decode(match[3].replace(/<[^>]+>/g, ''));
        if (child.tagName === 'H3') {
          for (const anchor of match[3].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
            const a = new Node('A', Object.fromEntries([...anchor[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])])), child);
            a.textContent = decode(anchor[2]); child.children.push(a);
          }
        }
        this.children.push(child);
      }
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    setAttribute(name, value) { this.attrs[name] = value; }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    scrollIntoView() {}
    addEventListener(name, fn) { this.listeners[name] = fn; }
    insertAdjacentHTML(_where, value) { this.innerHTML = this._html + value; }
    allChildren() { return this.children.flatMap((child) => [child, ...child.allChildren()]); }
    querySelectorAll(selector) {
      const children = this.allChildren();
      if (selector === 'a, button, [tabindex]') return children.filter((child) => ['A', 'BUTTON'].includes(child.tagName) || child.hasAttribute('tabindex'));
      if (selector.includes('data-game-result-title')) return children.filter((child) => child.hasAttribute('data-game-result-title'));
      if (selector.includes('h3 a')) return children.filter((child) => child.tagName === 'A' && child.owner?.tagName === 'H3');
      return children.filter((child) => child.tagName === selector.toUpperCase());
    }
    querySelector(selector) {
      if (selector === '[data-game-more-news]') return this.allChildren().find((child) => child.hasAttribute('data-game-more-news')) || null;
      if (selector === 'h2, h1') return this.heading || null;
      return this.querySelectorAll(selector)[0] || null;
    }
    closest() { return this.section || this.owner?.closest() || null; }
  }
  const sectionFor = (selector) => {
    const section = new Node('SECTION'); section.heading = new Node('H2', { id: `${selector.slice(1)}-heading` }, section); return section;
  };
  document.querySelector = (selector) => {
    if (!elements.has(selector)) {
      const node = new Node('DIV', { id: selector.slice(1) });
      node.section = sectionFor(selector); node.hidden = selector === '#game-search-section'; elements.set(selector, node);
    }
    return elements.get(selector);
  };
  document.createElement = () => ({ set innerHTML(value) { this.value = decode(value); }, get innerHTML() { return escape(this.textContent ?? this.value); }, value: '' });
  document.addEventListener = (name, fn) => documentEvents.set(name, fn);
  const NativeDate = Date;
  class ClockDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return wall; }
  }
  const c = { document, console, URL, Intl, Date: ClockDate, performance: { now: () => monotonic } };
  c.window = c; c.matchMedia = () => ({ matches: true });
  c.addEventListener = (name, fn) => windowEvents.set(name, fn);
  c.setTimeout = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; };
  c.clearTimeout = (id) => timers.delete(id);
  c.HomeDataUtils = { fetchJsonWithCache: async ({ endpoints }) => {
    fetchCount++;
    if (fetchError) throw new Error('fixture offline');
    if (endpoints[0].includes('game-sale-offers')) return { items: offers, sources };
    return { generatedAt: new NativeDate(START).toISOString(), items: endpoints[0].includes('trend-topics') ? topics : [] };
  } };
  c.open = () => assert.fail('Lifecycle must not open windows');
  vm.createContext(c); vm.runInContext(UTILS, c);
  let script = SOURCE.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const names = [...script.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((m) => m[1]);
  script = script.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${names.join(',')}, state: () => dashboardState, visibleNews: () => newsVisibleCount });})();`);
  vm.runInContext(script, c);
  const submit = (query) => { elements.get('#game-search-input').value = query; elements.get('#game-search-form').listeners.submit({ preventDefault() {} }); };
  return {
    c, elements, timers, windowEvents, documentEvents, document, submit,
    fetchCount: () => fetchCount,
    advance(ms) { wall += ms; monotonic += ms; },
    setWall(ms) { wall = ms; },
    fireTimer() { assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; timers.delete(id); timer.fn(); },
    foreground() { document.hidden = false; documentEvents.get('visibilitychange')(); },
    background() { document.hidden = true; documentEvents.get('visibilitychange')(); },
  };
}
const official = (state) => state.steamSales.filter((item) => item.storeUrl);

test('one already-initialized tab downgrades exactly at six hours and removes the official pair at 24 hours', async () => {
  const h = harness(); await h.c.init();
  assert.equal(official(h.c.state())[0].status, 'active');
  h.advance(6 * HOUR - 1); h.fireTimer();
  assert.equal(official(h.c.state())[0].status, 'active');
  assert.equal([...h.timers.values()][0].delay, 1);
  h.advance(1); h.fireTimer();
  const stale = official(h.c.state())[0];
  assert.equal(stale.status, 'unknown'); assert.equal(stale.priceState, 'stale');
  assert.equal(stale.checkedAt, new Date(START).toISOString());
  assert.match(h.elements.get('#steam-sale-list').innerHTML, /前回の割引価格|価格の再確認待ち/);
  h.advance(18 * HOUR); h.fireTimer();
  assert.equal(official(h.c.state()).length, 0);
  assert.doesNotMatch(h.elements.get('#steam-sale-list').innerHTML, /1,000円|2,000円/);
  assert.equal(h.fetchCount(), 5, 'only the original input requests occur');
});

test('shorter declared freshness and price validity schedule exact half-open transitions', async () => {
  const h = harness({ offers: [offer({ freshUntil: new Date(START + 30000).toISOString(), priceValidUntil: new Date(START + 90000).toISOString() })] });
  await h.c.init(); assert.equal([...h.timers.values()][0].delay, 30000);
  h.advance(30000); h.fireTimer(); assert.equal(official(h.c.state())[0].priceState, 'stale');
  assert.equal([...h.timers.values()][0].delay, 60000);
  h.advance(60000); h.fireTimer(); assert.equal(official(h.c.state()).length, 0);
});

test('returning from a hidden tab immediately catches missed expiry without fetching or duplicate timers', async () => {
  const h = harness(); await h.c.init();
  assert.equal(h.timers.size, 1); h.background(); assert.equal(h.timers.size, 0);
  h.advance(25 * HOUR); h.foreground();
  assert.equal(official(h.c.state()).length, 0); assert.equal(h.timers.size, 1);
  h.windowEvents.get('focus')(); h.windowEvents.get('pageshow')(); h.foreground();
  assert.equal(h.timers.size, 1); assert.equal(h.fetchCount(), 5);
});

test('unchanged foreground events do not replace visible nodes or continuously changing sort-score cards', async () => {
  const h = harness({ offers: [offer({ endsAt: new Date(START + 4 * HOUR).toISOString() })] }); await h.c.init();
  const writes = new Map([...h.elements].map(([key, element]) => [key, element.writes]));
  h.advance(1000); h.windowEvents.get('focus')(); h.windowEvents.get('pageshow')();
  for (const [key, count] of writes) assert.equal(h.elements.get(key).writes, count, key);
  assert.equal(h.timers.size, 1);
});

test('expiry leaves query, result expansion, focused result and expanded news intact', async () => {
  const h = harness(); await h.c.init();
  h.submit('ゲーム'); h.elements.get('#game-search-more').listeners.click();
  const resultFocus = h.document.activeElement;
  const resultHTML = h.elements.get('#game-search-results').innerHTML;
  const resultStatus = h.elements.get('#game-search-status').textContent;
  const index = h.c.state().searchItems;
  h.elements.get('#news-list').querySelector('[data-game-more-news]').listeners.click();
  assert.equal(h.c.visibleNews(), 16);
  resultFocus.focus();
  h.advance(24 * HOUR); h.fireTimer();
  assert.equal(h.elements.get('#game-search-input').value, 'ゲーム');
  assert.equal(h.elements.get('#game-search-results').innerHTML, resultHTML);
  assert.equal(h.elements.get('#game-search-status').textContent, resultStatus);
  assert.equal(h.elements.get('#game-search-section').hidden, false);
  assert.equal(h.document.activeElement, resultFocus);
  assert.equal(h.c.visibleNews(), 16);
  assert.equal(h.c.state().searchItems, index);
});

test('stale-price replacement restores the surviving focused store link without scrolling', async () => {
  const h = harness(); await h.c.init();
  const saleList = h.elements.get('#steam-sale-list');
  const link = saleList.querySelectorAll('a, button, [tabindex]').find((node) => node.className === 'game-card-link' && node.getAttribute('href').includes('steampowered'));
  link.focus(); h.advance(6 * HOUR); h.fireTimer();
  assert.notEqual(h.document.activeElement, link);
  assert.equal(h.document.activeElement.getAttribute('href'), link.getAttribute('href'));
  assert.equal(h.document.activeElement.className, link.className);
  assert.equal(h.document.activeElement.focusOptions.preventScroll, true);
});

test('when an expired store control disappears, focus moves to its section heading rather than body', async () => {
  const h = harness(); await h.c.init();
  const saleList = h.elements.get('#steam-sale-list');
  saleList.querySelectorAll('a, button, [tabindex]').find((node) => node.getAttribute('href')?.includes('steampowered')).focus();
  h.advance(24 * HOUR); h.fireTimer();
  assert.equal(h.document.activeElement, saleList.section.heading);
  assert.equal(h.document.activeElement.getAttribute('tabindex'), '-1');
  assert.equal(h.document.activeElement.focusOptions.preventScroll, true);
});

test('bfcache-style pagehide/pageshow cancels then resumes a single catch-up timer', async () => {
  const h = harness(); await h.c.init(); h.windowEvents.get('pagehide')(); assert.equal(h.timers.size, 0);
  h.advance(6 * HOUR); h.windowEvents.get('pageshow')();
  assert.equal(official(h.c.state())[0].priceState, 'stale'); assert.equal(h.timers.size, 1);
  h.windowEvents.get('pageshow')(); assert.equal(h.timers.size, 1);
});

test('backward wall-clock corrections cannot extend the current-price window or revive expired snapshots', async () => {
  const h = harness(); await h.c.init();
  h.advance(5 * HOUR); h.setWall(START + 2 * HOUR); h.fireTimer();
  assert.equal(official(h.c.state())[0].status, 'active');
  h.advance(HOUR); h.fireTimer(); assert.equal(official(h.c.state())[0].priceState, 'stale');
  h.setWall(START + 25 * HOUR); h.fireTimer(); assert.equal(official(h.c.state()).length, 0);
  h.setWall(START + HOUR); h.fireTimer(); assert.equal(official(h.c.state()).length, 0);
});

test('free-offer end status and urgency are refreshed from the unchanged loaded article evidence', async () => {
  const title = '『Example Quest』Steam無料配布、10月6日12:00から10月6日14:00まで';
  const h = harness({ topics: [article('trial', { title, sourceSignals: [{ title, url: 'https://example.com/articles/trial', publishedAt: '2026-10-06T02:00:00Z' }] })], offers: [] });
  await h.c.init(); assert.equal(h.c.state().freeGames[0].status, 'active');
  h.advance(HOUR); h.fireTimer(); assert.equal(h.c.state().freeGames[0].status, 'ended');
  assert.equal(h.c.state().importantItems.length, 0);
});

test('cleared search remains cleared through future lifecycle updates', async () => {
  const h = harness(); await h.c.init(); h.submit('Quest'); h.elements.get('#game-search-clear').listeners.click();
  h.advance(6 * HOUR); h.fireTimer();
  assert.equal(h.elements.get('#game-search-input').value, ''); assert.equal(h.elements.get('#game-search-section').hidden, true);
  assert.equal(h.document.activeElement, h.elements.get('#game-search-input'));
});

test('empty optional offers keep a bounded visible timer and no timer in the background', async () => {
  const h = harness({ offers: [] }); await h.c.init();
  assert.equal([...h.timers.values()][0].delay, 60000); h.background(); assert.equal(h.timers.size, 0);
  h.windowEvents.get('focus')(); assert.equal(h.timers.size, 0);
  h.foreground(); assert.equal(h.timers.size, 1);
});


test('failed initial data does not start background retries or a lifecycle timer', async () => {
  const h = harness({ fetchError: true });
  await assert.doesNotReject(h.c.init());
  assert.equal(h.c.state(), null);
  assert.match(h.elements.get('#game-search-status').textContent, /再試行/);
  assert.equal(h.timers.size, 0);
  assert.equal(h.windowEvents.has('focus'), false);
  assert.equal(h.fetchCount(), 5);
});

test('initialization in a hidden tab waits until foreground to schedule its single timer', async () => {
  const h = harness(); h.document.hidden = true; await h.c.init();
  assert.equal(h.timers.size, 0);
  h.advance(6 * HOUR); h.foreground();
  assert.equal(h.timers.size, 1);
  assert.equal(official(h.c.state())[0].priceState, 'stale');
});
