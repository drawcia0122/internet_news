import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  MATOME_CATEGORIES, MATOME_MAX_AGE_MS, MATOME_STALE_AFTER_MS,
  formatMatomeTime, getMatomeViewModel, getNextMatomeCategory,
  initializeMatomeSection, normalizeMatomePayload, safeMatomeUrl,
} from '../matome-section.js';

const NOW = Date.parse('2026-10-02T03:00:00.000Z');
const iso = (milliseconds) => new Date(milliseconds).toISOString();
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const source = freeze({
  id: 'example', name: 'まとめ媒体', siteUrl: 'https://publisher.example.com/',
  feedUrl: 'https://publisher.example.com/feed.xml', status: 'ok',
  lastSuccessAt: iso(NOW), error: null, itemCount: 14, retainedCount: 0,
});
const fixture = freeze({
  schemaVersion: 1, generatedAt: iso(NOW), checkedAt: iso(NOW), status: 'ok', sources: [source],
  items: Array.from({ length: 14 }, (_, i) => ({
    id: `item-${i}`, title: `元の記事タイトル ${i}`, url: `https://publisher.example.com/archives/${100 + i}.html`,
    sourceId: source.id, sourceName: source.name, sourceUrl: source.siteUrl,
    categories: i < 3 ? ['game', 'anime'] : i < 12 ? ['game'] : ['chat', 'neta'],
    publishedAt: iso(NOW - (i + 1) * 3600000), firstSeenAt: iso(NOW), fetchedAt: iso(NOW), cached: false,
  })),
});
const view = (payload = fixture, options = {}) => getMatomeViewModel(payload, { now: NOW, ...options });
const article = fixture.items[0];
const one = (overrides) => ({ ...fixture, items: [{ ...article, ...overrides }] });

test('default game tab shows six original headlines, exact source, date and direct destination', () => {
  const result = view();
  assert.equal(result.category, 'game');
  assert.equal(result.items.length, 6);
  assert.equal(result.total, 12);
  assert.equal(result.moreCount, 6);
  assert.equal(result.items[0].title, article.title);
  assert.equal(result.items[0].url, article.url);
  assert.equal(result.items[0].sourceName, source.name);
  assert.equal(result.items[0].publishedAt, article.publishedAt);
  assert.deepEqual(result.counts, { game: 12, anime: 3, chat: 2, neta: 2 });
  assert.equal(result.status, 'ok');
});

test('pagination ends at the category size and does not mix the four sections', () => {
  assert.equal(view(fixture, { visibleCount: 12 }).items.length, 12);
  assert.equal(view(fixture, { visibleCount: 12 }).moreCount, 0);
  assert.equal(view(fixture, { visibleCount: 100 }).items.length, 12);
  assert.equal(view(fixture, { category: 'anime' }).items.length, 3);
  assert.equal(view(fixture, { category: 'chat' }).items.length, 2);
  assert.equal(view(fixture, { category: 'neta' }).items.length, 2);
  for (const visibleCount of [null, '12', NaN, Infinity, -1, 1, {}, []]) {
    assert.equal(view(fixture, { visibleCount }).items.length, 6);
  }
  assert.equal(view(fixture, { category: '__proto__' }).category, 'game');
});

test('invalid envelopes fail closed without throwing or coercing data types', () => {
  for (const payload of [null, [], {}, '', 1, true,
    { ...fixture, schemaVersion: '1' }, { ...fixture, status: {} },
    { ...fixture, sources: {} }, { ...fixture, items: 'bad' },
    { ...fixture, generatedAt: 'October 2, 2026' }, { ...fixture, checkedAt: 123 },
    { ...fixture, generatedAt: iso(NOW + 3600000) },
  ]) {
    assert.equal(normalizeMatomePayload(payload, NOW), null);
    assert.equal(view(payload).status, 'unavailable');
    assert.deepEqual(view(payload).items, []);
  }
  assert.equal(initializeMatomeSection(null), null);
});

test('invalid article fields, source IDs and raw HTML are never promoted into the UI', () => {
  for (const overrides of [
    { title: null }, { title: {} }, { title: '<img src=x onerror=alert(1)>' },
    { title: 'text\u0000more' }, { id: [] }, { sourceId: 'unknown' },
    { categories: 'game' }, { categories: [false, {}, '__proto__'] },
    { publishedAt: 1 }, { publishedAt: 'not a date' },
    { publishedAt: iso(NOW + 3600000) },
  ]) assert.deepEqual(view(one(overrides)).items, []);
  const malformed = { ...fixture, items: [null, [], {}, 1, false, ...fixture.items] };
  assert.equal(view(malformed).total, 12);
  const spoof = view(one({ sourceName: '<b>official</b>', sourceUrl: 'javascript:alert(1)', summary: 'fabricated', image: 'bad' }));
  assert.equal(spoof.items[0].sourceName, source.name);
  assert.equal(spoof.items[0].sourceUrl, source.siteUrl);
  assert.equal('summary' in spoof.items[0], false);
  assert.equal('image' in spoof.items[0], false);
});

test('links reject scripts, credentials, local destinations and publisher spoofing', () => {
  for (const url of [null, 1, {}, [], '', 'javascript:alert(1)', 'data:text/html,hi',
    '//publisher.example.com/a', 'https://name:pass@publisher.example.com/a',
    'http://localhost/a', 'http://127.0.0.1/a', 'http://[::1]/a',
    'http://10.0.0.1/a', 'https://printer.local/a', 'https://site.internal/a',
    'https://publisher.example.com:8443/a', 'https://publisher.example.com/\nhi',
    'https://publisher.example.com\\@evil.example.org/a',
  ]) {
    assert.equal(safeMatomeUrl(url), null);
    assert.deepEqual(view(one({ url })).items, []);
  }
  for (const url of [
    'https://evil.example.org/archives/1.html',
    'https://publisher.example.com.evil.example.org/archives/1.html',
    'https://unrelated.publisher.example.com/archives/1.html',
    'https://publisher.example.com/',
    'https://publisher.example.com/archives/recent',
    'https://publisher.example.com/archives/1.png',
  ]) assert.deepEqual(view(one({ url })).items, []);
  assert.equal(safeMatomeUrl('https://publisher.example.com/a#part'), 'https://publisher.example.com/a');
  assert.equal(view(one({ url: 'http://publisher.example.com/archives/1.html' })).items.length, 1);
});

test('invalid publisher metadata cannot supply cards', () => {
  for (const override of [{ name: {} }, { name: '<script>bad</script>' }, { siteUrl: 'javascript:x' }, { status: 'unknown' }]) {
    assert.deepEqual(view({ ...fixture, sources: [{ ...source, ...override }] }).items, []);
  }
});

test('exactly seven days is allowed; older items expire even on network failure', () => {
  const old = one({ publishedAt: iso(NOW - MATOME_MAX_AGE_MS) });
  assert.equal(view(old).items.length, 1);
  assert.equal(view(old).nextExpiryAt, NOW + 1);
  assert.deepEqual(view(old, { now: NOW + 1 }).items, []);
  assert.deepEqual(view(old, { now: NOW + 1, networkError: true }).items, []);
});

test('sorting is newest-first and duplicate IDs, URLs and categories are not counted twice', () => {
  const result = view({ ...fixture, items: [
    ...fixture.items.toReversed(), { ...article }, { ...article, id: 'another-id' },
    { ...article, id: 'tracking-copy', url: `${article.url}?from=tracking#heading` },
  ] });
  assert.equal(result.items[0].id, article.id);
  assert.deepEqual(result.counts, { game: 12, anime: 3, chat: 2, neta: 2 });
  assert.deepEqual(view(one({ categories: ['game', 'game', 'anime', {}, 'unknown'] })).counts,
    { game: 1, anime: 1, chat: 0, neta: 0 });
});

test('failure, delayed, partial, empty and unavailable states are explicit without false freshness', () => {
  const failed = view(fixture, { category: 'game', visibleCount: 12, networkError: true });
  assert.equal(failed.status, 'network-error');
  assert.equal(failed.items.length, 12);
  assert.equal(failed.category, 'game');
  assert.match(failed.statusText, /前回取得分/);
  assert.equal(failed.updatedText, view().updatedText);
  assert.equal(view({ ...fixture, generatedAt: iso(NOW - MATOME_STALE_AFTER_MS - 1) }).status, 'stale');
  assert.equal(view({ ...fixture, status: 'partial' }).status, 'partial');
  assert.equal(view({ ...fixture, status: 'unavailable' }).status, 'unavailable');
  assert.equal(view({ ...fixture, items: [] }).status, 'empty');
  assert.equal(view({ ...fixture, items: [], generatedAt: null, status: 'unavailable' }).updatedText, '');
  assert.equal(view({ ...fixture, items: [article] }, { category: 'chat' }).total, 0);
});

test('publication time is Japan time with an explicit timezone', () => {
  assert.equal(formatMatomeTime('2026-10-01T23:05:00Z'), '10/2 08:05 JST');
  assert.equal(formatMatomeTime('bad'), '');
  assert.equal(formatMatomeTime({}), '');
});

test('tabs support arrows with wraparound, Home and End', () => {
  assert.deepEqual(MATOME_CATEGORIES.map(({ id }) => id), ['game', 'anime', 'chat', 'neta']);
  assert.equal(getNextMatomeCategory('game', 'ArrowRight'), 'anime');
  assert.equal(getNextMatomeCategory('game', 'ArrowLeft'), 'neta');
  assert.equal(getNextMatomeCategory('neta', 'ArrowRight'), 'game');
  assert.equal(getNextMatomeCategory('chat', 'Home'), 'game');
  assert.equal(getNextMatomeCategory('anime', 'End'), 'neta');
  assert.equal(getNextMatomeCategory('game', 'Tab'), null);
});

test('the compact section stays after personal news and before events, with isolated assets', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../matome-section.js', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="personal-news"') < html.indexOf('id="matome-threads"'));
  assert.ok(html.indexOf('id="matome-threads"') < html.indexOf('id="featured-events"'));
  assert.equal((html.match(/href="#matome-threads"/g) ?? []).length, 2);
  assert.match(html, /掲示板の反応・ネタを含むまとめ記事です。一般ニュースとは別枠で掲載しています/);
  assert.equal((html.match(/role="tab" data-matome-category=/g) ?? []).length, 4);
  assert.match(html, /role="tabpanel" aria-labelledby="matome-tab-game"/);
  assert.match(html, /<script type="module" src="\.\/matome-section.js\?v=\d+"><\/script>/);
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|localStorage|createElement\(['"]img/);
  assert.match(js, /cache: 'no-cache'/);
  assert.match(js, /visibilitychange/);
});

test('fixture consumers leave deeply frozen caller data unchanged', () => {
  const original = JSON.stringify(fixture);
  normalizeMatomePayload(fixture, NOW);
  view(fixture, { category: 'anime', networkError: true });
  assert.equal(JSON.stringify(fixture), original);
  assert.ok(Object.isFrozen(fixture.items[0].categories));
});

// A small DOM harness exercises the module's controller without browser globals,
// timers, network access, or mutable shared fixture data.
class TestElement {
  constructor(tag, documentRef) {
    this.tagName = tag;
    this.documentRef = documentRef;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this._text = '';
  }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  fire(type, event = {}) { for (const handler of this.listeners.get(type) ?? []) handler(event); }
  focus() { this.documentRef.activeElement = this; }
  contains(target) { return this === target || this.children.some((node) => node.contains(target)); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector === '[data-matome-category]') return 'matomeCategory' in this.dataset;
    if (selector === '[data-matome-count]') return 'matomeCount' in this.dataset;
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((node) => [
      ...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function setupController(fetchImpl) {
  const documentRef = new TestElement('document');
  documentRef.documentRef = documentRef;
  documentRef.createElement = (tag) => new TestElement(tag, documentRef);
  documentRef.visibilityState = 'visible';
  documentRef.activeElement = null;
  const root = documentRef.createElement('section');
  const add = (parent, tag, id) => {
    const node = documentRef.createElement(tag);
    node.id = id;
    parent.append(node);
    return node;
  };
  const tabs = MATOME_CATEGORIES.map(({ id }) => {
    const tab = add(root, 'button', `matome-tab-${id}`);
    tab.dataset.matomeCategory = id;
    add(tab, 'span').dataset.matomeCount = '';
    return tab;
  });
  const panel = add(root, 'div', 'matome-panel');
  const list = add(panel, 'ul', 'matome-list');
  const empty = add(panel, 'div', 'matome-empty');
  const more = add(panel, 'button', 'matome-more');
  const status = add(root, 'p', 'matome-status');
  const updated = add(root, 'p', 'matome-updated');
  let timerId = 0;
  let currentTime = NOW;
  const timeouts = new Map();
  const intervals = new Map();
  const windowRef = {
    setTimeout(fn, delay) { const id = ++timerId; timeouts.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn, delay) { const id = ++timerId; intervals.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  const controller = initializeMatomeSection(root, { fetchImpl, documentRef, windowRef, now: () => currentTime });
  return {
    root, panel, list, empty, more, status, updated, tabs, documentRef, controller, timeouts, intervals,
    setTime(value) { currentTime = value; },
  };
}

test('controller keeps successful cards, selected category, paging and focus through failed refresh', async () => {
  let fail = false;
  let requestedCache;
  const ui = setupController(async (_url, options) => {
    requestedCache = options.cache;
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => fixture };
  });
  await ui.controller.refresh();
  assert.equal(requestedCache, 'no-cache');
  assert.equal(ui.list.children.length, 6);
  assert.equal(ui.tabs[0].getAttribute('aria-selected'), 'true');
  ui.more.fire('click');
  assert.equal(ui.list.children.length, 12);
  assert.equal(ui.more.hidden, true);
  assert.equal(ui.documentRef.activeElement.dataset.matomeItem, 'item-6');
  const lastUpdated = ui.updated.textContent;
  fail = true;
  await ui.controller.refresh();
  assert.equal(ui.list.children.length, 12);
  assert.equal(ui.documentRef.activeElement.dataset.matomeItem, 'item-6');
  assert.equal(ui.root.dataset.matomeStatus, 'network-error');
  assert.equal(ui.updated.textContent, lastUpdated);
  ui.tabs[1].fire('click');
  assert.equal(ui.panel.getAttribute('aria-labelledby'), 'matome-tab-anime');
  assert.equal(ui.list.children.length, 3);
  await ui.controller.refresh();
  assert.equal(ui.tabs[1].getAttribute('aria-selected'), 'true');
  ui.tabs[0].fire('click');
  assert.equal(ui.list.children.length, 12, 'each tab retains its existing paging');
  ui.controller.destroy();
  assert.equal(ui.intervals.size, 0);
  assert.equal(ui.timeouts.size, 0);
});

test('controller deduplicates pending requests and refreshes when the page becomes visible', async () => {
  let release;
  let calls = 0;
  const ui = setupController(() => {
    calls += 1;
    return new Promise((resolve) => { release = () => resolve({ ok: true, json: async () => fixture }); });
  });
  const first = ui.controller.refresh();
  assert.equal(first, ui.controller.refresh());
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await first;
  ui.documentRef.visibilityState = 'hidden';
  ui.documentRef.fire('visibilitychange');
  [...ui.intervals.values()][0].fn();
  await Promise.resolve();
  assert.equal(calls, 1);
  ui.documentRef.visibilityState = 'visible';
  ui.documentRef.fire('visibilitychange');
  const second = ui.controller.refresh();
  await Promise.resolve();
  assert.equal(calls, 2);
  release();
  await second;
  ui.controller.destroy();
});

test('controller keyboard activation wraps, moves focus and updates ARIA selection', async () => {
  const ui = setupController(async () => ({ ok: true, json: async () => fixture }));
  await ui.controller.refresh();
  let prevented = false;
  ui.tabs[0].fire('keydown', { key: 'ArrowLeft', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(ui.documentRef.activeElement, ui.tabs[3]);
  assert.equal(ui.tabs[3].tabIndex, 0);
  assert.equal(ui.tabs[0].tabIndex, -1);
  assert.equal(ui.tabs[3].getAttribute('aria-selected'), 'true');
  assert.equal(ui.list.children.length, 2);
  ui.tabs[3].fire('keydown', { key: 'Home', preventDefault() {} });
  assert.equal(ui.documentRef.activeElement, ui.tabs[0]);
  assert.equal(ui.list.children.length, 6);
  ui.controller.destroy();
});

test('controller removes articles as they cross seven days, without waiting for a network refresh', async () => {
  const old = freeze(one({ publishedAt: iso(NOW - MATOME_MAX_AGE_MS) }));
  const ui = setupController(async () => ({ ok: true, json: async () => old }));
  await ui.controller.refresh();
  assert.equal(ui.list.children.length, 1);
  const expiry = [...ui.timeouts.values()].find(({ delay }) => delay === 1);
  assert.ok(expiry);
  ui.setTime(NOW + 1);
  expiry.fn();
  assert.equal(ui.list.hidden, true);
  assert.equal(ui.list.children.length, 0);
  assert.equal(ui.empty.hidden, false);
  ui.controller.destroy();
});

test('a synchronous fetch failure can recover on the next refresh', async () => {
  let fail = true;
  const ui = setupController(() => {
    if (fail) throw new Error('sync failure');
    return Promise.resolve({ ok: true, json: async () => fixture });
  });
  await ui.controller.refresh();
  assert.equal(ui.root.dataset.matomeStatus, 'unavailable');
  fail = false;
  await ui.controller.refresh();
  assert.equal(ui.root.dataset.matomeStatus, 'ok');
  assert.equal(ui.list.children.length, 6);
  ui.controller.destroy();
});
