import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const HTML = fs.readFileSync(new URL('../game.html', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const HOUR = 3600000;
const START = Date.parse('2026-10-06T04:00:00Z');
const ARTICLE_URL = 'https://example.com/articles/example-quest';
const TITLE = '『Example Quest』Steamセールの対象作品を紹介';
const escape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = (value) => String(value).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
function article(id = 'sale', extra = {}) {
  const title = id === 'sale' ? TITLE : `『Archive Expedition ${id}』ゲームの新しい地図と追加ルール`;
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

function harness({ topics = [article(), ...Array.from({ length: 20 }, (_, i) => article(i))], offers = [offer()], sources = [], fetchError = false, responses = {} } = {}) {
  let wall = START;
  let monotonic = 500;
  const timers = new Map();
  const windowEvents = new Map();
  const documentEvents = new Map();
  const elements = new Map();
  let timerId = 0;
  let fetchCount = 0;
  const requests = [];
  const responseByFile = new Map(Object.entries(responses));
  const eventAdds = new Map();
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
    addEventListener(name, fn) { this.listeners[name] = fn; eventAdds.set(`${this.id}:${name}`, (eventAdds.get(`${this.id}:${name}`) || 0) + 1); }
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
      node.section = sectionFor(selector); node.hidden = ['#game-search-section', '#game-load-notice'].includes(selector); elements.set(selector, node);
      if (['#game-load-message', '#game-load-retry'].includes(selector)) elements.get('#game-load-notice').children.push(node);
    }
    return elements.get(selector);
  };
  document.createElement = () => ({ set innerHTML(value) { this.value = decode(value); }, get innerHTML() { return escape(this.textContent ?? this.value); }, value: '' });
  document.addEventListener = (name, fn) => { documentEvents.set(name, fn); eventAdds.set(`document:${name}`, (eventAdds.get(`document:${name}`) || 0) + 1); };
  const NativeDate = Date;
  class ClockDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return wall; }
  }
  const c = { document, console, URL, Intl, Date: ClockDate, performance: { now: () => monotonic } };
  c.window = c; c.matchMedia = () => ({ matches: true });
  c.addEventListener = (name, fn) => { windowEvents.set(name, fn); eventAdds.set(`window:${name}`, (eventAdds.get(`window:${name}`) || 0) + 1); };
  c.setTimeout = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; };
  c.clearTimeout = (id) => timers.delete(id);
  c.HomeDataUtils = { fetchJsonWithCache: async ({ endpoints }) => {
    fetchCount++;
    const file = endpoints[0].split('/').pop(); requests.push(file);
    if (responseByFile.has(file)) {
      const response = responseByFile.get(file);
      if (response instanceof Error) throw response;
      return typeof response === 'function' ? response() : response;
    }
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
    c, elements, timers, windowEvents, documentEvents, document, submit, requests, eventAdds,
    setResponse(file, response) { responseByFile.set(file, response); },
    fetchCount: () => fetchCount,
    advance(ms) { wall += ms; monotonic += ms; },
    setWall(ms) { wall = ms; },
    fireTimer() { assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; timers.delete(id); timer.fn(); },
    foreground() { document.hidden = false; documentEvents.get('visibilitychange')(); },
    background() { document.hidden = true; documentEvents.get('visibilitychange')(); },
  };
}
const SOURCE_FILES = ['trend-topics.json', 'news-archive.json', 'home-news.json', 'events.json', 'game-sale-offers.json'];
const failed = () => new Error('fixture unavailable');
const payload = (items = []) => ({ generatedAt: new Date(START).toISOString(), items });
const official = (h) => h.c.state().steamSales.filter((item) => item.storeUrl);
const resultCount = (h) => (h.elements.get('#game-search-results').innerHTML.match(/data-game-result-title/g) || []).length;

function deferred() {
  let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve };
}

test('an unavailable events source cannot discard successfully loaded articles, search or official prices', async () => {
  const h = harness({ responses: { 'events.json': failed() } }); await h.c.init();
  assert.equal(h.c.state().searchItems.length, 21);
  assert.equal(official(h).length, 1);
  assert.equal(h.elements.get('#game-load-notice').hidden, false);
  assert.match(h.elements.get('#game-load-message').textContent, /イベント情報を読み込めませんでした.*読み込めた情報だけ/);
  h.submit('Archive Expedition'); assert.equal(resultCount(h), 8);
  assert.equal(h.timers.size, 1);
});

test('every article-source failure is isolated, including when the remaining article sources are honestly empty', async () => {
  for (const file of SOURCE_FILES.slice(0, 3)) {
    const h = harness({ responses: { [file]: failed(), ...(file === 'trend-topics.json' ? { 'home-news.json': payload([article('survivor')]) } : {}) } });
    await h.c.init(); assert.ok(h.c.state().searchItems.length > 0, file);
    assert.equal(h.elements.get('#game-load-notice').hidden, false);
  }
  const h = harness({ responses: { 'trend-topics.json': failed(), 'news-archive.json': payload(), 'home-news.json': payload() } });
  await h.c.init(); assert.equal(h.c.state().searchItems.length, 0);
  assert.match(h.elements.get('#game-load-message').textContent, /新着記事/);
  assert.doesNotMatch(h.elements.get('#game-search-status').textContent, /読み込めませんでした/);
});

test('malformed source schemas are failures, while valid empty arrays are successful empty snapshots', async () => {
  for (const malformed of [null, {}, { items: null }, { items: {} }, 'wrong', { items: [null, article('invalid-neighbour')] }]) {
    const h = harness({ responses: { 'news-archive.json': malformed } }); await h.c.init();
    assert.equal(h.c.state().searchItems.length, 21);
    assert.match(h.elements.get('#game-load-message').textContent, /過去の記事/);
  }
  const h = harness({ responses: Object.fromEntries(SOURCE_FILES.map((file) => [file, payload()])) });
  await h.c.init(); assert.equal(h.c.state().searchItems.length, 0);
  assert.equal(h.elements.get('#game-load-notice').hidden, true);
});

test('malformed price diagnostics remain a visible isolated price-source failure', async () => {
  const h = harness({ responses: { 'game-sale-offers.json': { items: [offer()], sources: {} } } }); await h.c.init();
  assert.equal(h.c.state().searchItems.length, 21);
  assert.equal(official(h).length, 0);
  assert.match(h.elements.get('#game-load-message').textContent, /Steam公式価格/);
  assert.match(h.elements.get('#steam-sale-list').innerHTML, /公式価格を読み込めませんでした/);
});

test('all failed article sources clear every loading surface and recover through one retry without reload', async () => {
  const h = harness({ responses: Object.fromEntries(SOURCE_FILES.map((file) => [file, failed()])) });
  const sections = ['#game-hero-command', '#game-hero-stats', '#important-list', '#game-hub-list', '#free-game-list', '#steam-sale-list', '#steam-story-list', '#news-list'];
  sections.forEach((selector) => { h.elements.get(selector).innerHTML = '整理中です'; });
  const init = h.c.init(); h.submit('Quest'); await init;
  assert.equal(h.c.state(), null); assert.equal(h.timers.size, 0);
  for (const selector of sections) {
    assert.match(h.elements.get(selector).innerHTML, /読み込めませんでした/, selector);
    assert.doesNotMatch(h.elements.get(selector).innerHTML, /整理中|ローカルHTTP/, selector);
  }
  SOURCE_FILES.forEach((file) => h.setResponse(file, payload(file === 'trend-topics.json' ? [article()] : [])));
  h.elements.get('#game-load-retry').focus(); await h.c.retryGameSources();
  assert.equal(h.c.state().searchItems.length, 1); assert.equal(resultCount(h), 1);
  assert.equal(h.elements.get('#game-search-input').value, 'Quest');
  assert.equal(h.elements.get('#game-load-notice').hidden, true);
  assert.equal(h.document.activeElement, h.elements.get('#game-search-input'));
  assert.equal(h.timers.size, 1);
});

test('retry fetches only failed sources and replaces their snapshots without duplicates or extra listeners', async () => {
  const h = harness({ responses: { 'news-archive.json': failed(), 'events.json': failed() } }); await h.c.init();
  h.submit('Archive Expedition'); h.elements.get('#game-search-more').listeners.click();
  h.elements.get('#news-list').querySelector('[data-game-more-news]').listeners.click();
  assert.equal(h.c.visibleNews(), 16);
  h.setResponse('news-archive.json', payload([article('new'), article(0)])); h.setResponse('events.json', payload());
  await h.c.retryGameSources();
  assert.deepEqual(h.requests.slice(5), ['news-archive.json', 'events.json']);
  assert.equal(h.c.state().searchItems.length, 22);
  assert.equal(new Set(h.c.state().searchItems.map((item) => item.key)).size, 22);
  assert.equal(h.c.visibleNews(), 16); assert.equal(resultCount(h), 16);
  assert.equal(h.eventAdds.get('game-search-form:submit'), 1);
  assert.equal(h.eventAdds.get('game-load-retry:click'), 1);
  assert.equal(h.eventAdds.get('document:visibilitychange'), 1);
  assert.equal(h.eventAdds.get('window:focus'), 1);
  assert.equal(h.timers.size, 1);
});

test('repeated retry activation while pending performs one request batch and keeps the button focused', async () => {
  const h = harness({ responses: { 'events.json': failed() } }); await h.c.init();
  const pending = deferred(); h.setResponse('events.json', () => pending.promise);
  const button = h.elements.get('#game-load-retry'); button.focus();
  const first = h.c.retryGameSources(); const second = h.c.retryGameSources();
  assert.equal(h.requests.filter((file) => file === 'events.json').length, 2);
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(h.document.activeElement, button);
  pending.resolve(payload()); await Promise.all([first, second]);
  assert.equal(button.getAttribute('aria-disabled'), 'false');
  assert.equal(h.elements.get('#game-load-notice').hidden, true);
  assert.equal(h.document.activeElement, h.elements.get('#game-search-input'));
});

test('changing the submitted query during retry updates the current query instead of restoring the old one', async () => {
  const h = harness({ responses: { 'news-archive.json': failed() } }); await h.c.init();
  h.submit('Quest'); const pending = deferred(); h.setResponse('news-archive.json', () => pending.promise);
  const retry = h.c.retryGameSources(); h.submit('Nebula Harbour');
  pending.resolve(payload([article('nebula', { title: '『Nebula Harbour』ゲームの続報を公開' })])); await retry;
  assert.equal(h.elements.get('#game-search-input').value, 'Nebula Harbour'); assert.equal(resultCount(h), 1);
  assert.match(h.elements.get('#game-search-heading').textContent, /Nebula Harbour/);
  assert.equal(h.document.activeElement, h.elements.get('#game-search-heading'));
});

test('clearing or editing the input during retry does not reopen cleared results or overwrite new input', async () => {
  for (const input of ['', 'unsubmitted edit']) {
    const h = harness({ responses: { 'events.json': failed() } }); await h.c.init(); h.submit('Quest');
    const pending = deferred(); h.setResponse('events.json', () => pending.promise); const retry = h.c.retryGameSources();
    const field = h.elements.get('#game-search-input'); field.value = input; field.focus(); field.listeners.input();
    pending.resolve(payload()); await retry;
    assert.equal(field.value, input); assert.equal(h.document.activeElement, field);
    if (!input) assert.equal(h.elements.get('#game-search-section').hidden, true);
  }
});

test('a second failed retry preserves the usable article corpus, current query and source-specific warning', async () => {
  const h = harness({ responses: { 'events.json': failed() } }); await h.c.init(); h.submit('Quest');
  const titles = h.c.state().searchItems.map((item) => item.title).join('|');
  await h.c.retryGameSources();
  assert.equal(h.c.state().searchItems.map((item) => item.title).join('|'), titles);
  assert.equal(resultCount(h), 1); assert.equal(h.elements.get('#game-search-input').value, 'Quest');
  assert.match(h.elements.get('#game-load-message').textContent, /イベント情報/);
});

test('recovered official prices require their exact article and retain original stale-check timestamps', async () => {
  const h = harness({ responses: { 'trend-topics.json': failed(), 'game-sale-offers.json': failed() } }); await h.c.init();
  h.setResponse('game-sale-offers.json', { items: [offer()] }); await h.c.retryGameSources();
  assert.equal(official(h).length, 0, 'the source article is still unavailable');
  h.advance(7 * HOUR); h.setResponse('trend-topics.json', payload([article()])); await h.c.retryGameSources();
  assert.equal(official(h).length, 1); assert.equal(official(h)[0].priceState, 'stale');
  assert.equal(official(h)[0].checkedAt, new Date(START).toISOString());
  assert.equal(h.requests.filter((file) => file === 'game-sale-offers.json').length, 2, 'a successful price source is not refetched with the article');
  assert.equal(h.timers.size, 1);
});

test('a recovered genuinely empty price source clears the error-specific sale empty state', async () => {
  const h = harness({ responses: { 'game-sale-offers.json': failed() } }); await h.c.init();
  assert.match(h.elements.get('#steam-sale-list').innerHTML, /公式価格を読み込めませんでした/);
  h.setResponse('game-sale-offers.json', payload()); await h.c.retryGameSources();
  assert.doesNotMatch(h.elements.get('#steam-sale-list').innerHTML, /読み込めませんでした/);
  assert.match(h.elements.get('#steam-sale-list').innerHTML, /確認できるセール情報はまだありません/);
  assert.equal(h.elements.get('#game-load-notice').hidden, true);
});

test('load notice and recovery action remain separate from server refresh diagnostics and have accessible states', () => {
  assert.match(HTML, /id="game-load-notice" hidden/);
  assert.match(HTML, /id="game-load-message" role="status" aria-live="polite"/);
  assert.match(HTML, /id="game-load-retry" aria-disabled="false"/);
  assert.match(HTML, /id="data-refresh-health"/);
  assert.match(CSS, /\.game-home-page \.game-load-notice \.game-card-link[\s\S]*?color: #76521e/);
  assert.match(CSS, /\.game-home-stats > \.game-empty-card[\s\S]*?grid-column: 1 \/ -1/);
  assert.doesNotMatch(SOURCE, /ローカルHTTPサーバー/);
});
