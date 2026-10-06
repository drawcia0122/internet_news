import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { steamDeadlineSourceUrl, verifiedSteamDeadline } from '../lib/game-sale-offers.mjs';

// Independent, deterministic production-consumer review. All prices/deadlines
// here are invented fixtures; these tests make no live-price assertions.
const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const START = Date.parse('2026-10-06T04:00:00.000Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const ARTICLE_URL = 'https://example.com/game-sale';
const iso = (value) => new Date(value).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value));
const keys = (items) => Array.from(items, (item) => item.key);
const defaultFilters = { platform: 'all', store: 'all', sort: 'recommended', ceiling: '' };
const article = (extra = {}) => {
  const title = '『Example Quest』Steamで50%オフの1,000円、10月5日から10月6日まで';
  return { id: 'review-sale', title, sourceUrl: ARTICLE_URL, categories: ['games'], publishedAt: iso(START - HOUR),
    sourceSignals: [{ title, url: ARTICLE_URL, publishedAt: iso(START - HOUR) }], ...extra };
};
const offer = (extra = {}) => ({ appId: 123, title: 'Example Quest', store: 'Steam', country: 'JP', currency: 'JPY', edition: 'base-game',
  regularPrice: 2000, salePrice: 1000, discountPercent: 50, storeUrl: 'https://store.steampowered.com/app/123/?cc=jp&l=japanese',
  priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp&l=japanese' },
  articleUrls: [ARTICLE_URL], checkedAt: iso(START - HOUR), freshUntil: iso(START + 5 * HOUR), priceValidUntil: iso(START + 23 * HOUR), status: 'verified', ...extra });
function deadlineOffer(extra = {}, end = START + HOUR) {
  const item = offer(extra);
  return { ...item, endsAt: iso(end), deadlineSource: {
    kind: 'steam-storebrowse', appId: item.appId, packageId: 456, discountEndDate: end / 1000, checkedAt: item.checkedAt,
    url: steamDeadlineSourceUrl(item.appId), storeUrl: item.storeUrl, country: 'JP', currency: 'JPY', edition: 'base-game',
    regularPrice: item.regularPrice, salePrice: item.salePrice, discountPercent: item.discountPercent,
  } };
}
function catalog(size = 25) {
  return Array.from({ length: size }, (_, index) => {
    const appId = 1000 + index;
    return offer({ appId, title: `Example Quest ${index}`, regularPrice: 2000 + index * 2, salePrice: 1000 + index,
      storeUrl: `https://store.steampowered.com/app/${appId}/?cc=jp&l=japanese`,
      priceSource: { kind: 'steam-appdetails', url: `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp&l=japanese` } });
  });
}
function harness() {
  let wall = START;
  const elements = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const document = { hidden: false, activeElement: null, addEventListener() {},
    querySelector(selector) {
      if (!elements.has(selector)) {
        let html = '';
        let hidden = false;
        let nodes = [];
        const element = { value: '', textContent: '', writes: 0, listeners: {}, attributes: {},
          get hidden() { return hidden; },
          set hidden(value) { hidden = value; if (value && document.activeElement === this) document.activeElement = null; },
          get innerHTML() { return html; },
          set innerHTML(value) {
            if (nodes.includes(document.activeElement)) document.activeElement = null;
            html = value;
            this.writes++;
            nodes = [...html.matchAll(/<article\b[^>]*data-game-key="([^"]+)"[^>]*>[\s\S]*?<h3><a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/g)]
              .map((match, index) => ({ id: '', className: '', textContent: match[3], index, key: match[1],
                getAttribute(name) { return name === 'href' ? match[2] : null; }, hasAttribute() { return false; },
                closest(value) { return value === '[data-game-key]' ? { getAttribute: () => match[1] } : null; },
                focus(options) { document.activeElement = this; this.focusOptions = options; },
              }));
          },
          addEventListener(type, callback) { this.listeners[type] = callback; },
          querySelectorAll(value) {
            if (selector === '#game-sale-controls' && value === '[data-sale-filter]') return ['platform', 'store', 'sort', 'ceiling'].map((field) => document.querySelector(`#game-sale-${field}`));
            return nodes;
          },
          querySelector(value) { return selector === '#sale-section' && /^h2/.test(value) ? document.querySelector('#sale-section h2') : null; }, contains(node) { return nodes.includes(node); },
          closest() { return { querySelector: () => ({ setAttribute() {}, focus() { document.activeElement = this; } }) }; },
          getAttribute(name) { return name === 'data-sale-filter' ? selector.replace('#game-sale-', '') : this.attributes[name] ?? null; },
          setAttribute(name, value) { this.attributes[name] = value; },
          focus(options) { document.activeElement = this; this.focusOptions = options; }, scrollIntoView() {},
          insertAdjacentHTML(_position, value) { this.innerHTML += value; },
        };
        elements.set(selector, element);
      }
      return elements.get(selector);
    },
    createElement() { return { textContent: '', value: '', set innerHTML(value) { this.value = value; }, get innerHTML() { return this.textContent || this.value; } }; },
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return wall; }
  }
  const c = { console, URL, Intl, Date: ClockDate, document,
    HomeDataUtils: { fetchJsonWithCache() { assert.fail('Controls/lifecycle must not refetch'); } },
    addEventListener() {}, matchMedia() { return { matches: true }; },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(UTILS, c);
  let source = SOURCE.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const functions = [...source.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((match) => match[1]);
  source = source.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${functions.join(',')},
    setInputs: (value) => { dashboardInputs = value; dashboardState = buildDashboardState(value.topics, value.events, value.meta); },
    readState: () => dashboardState,
    readerState: () => ({ searchQuery, searchVisibleCount, newsVisibleCount, saleVisibleCount, saleFilters: { ...saleFilters } }),
    setReaderState: () => { searchQuery = 'Example'; searchVisibleCount = 16; newsVisibleCount = 24; },
  });})();`);
  vm.runInContext(source, c);
  c.bindInteractions();
  const el = (selector) => document.querySelector(selector);
  return { c, document, elements, timers, el,
    time(value) { wall = value; },
    load(offers = [offer()], topics = [article()]) { c.setInputs({ topics, events: [], meta: { generatedAt: iso(START), saleOffers: offers, saleSources: [] } }); c.renderDashboard(); },
    filter(field, value) { const target = el(`#game-sale-${field}`); target.value = value; target.focus(); el('#game-sale-controls').listeners.change({ target }); },
    click(selector) { el(selector).focus(); el(selector).listeners.click(); },
  };
}
const countCards = (h) => (h.el('#steam-sale-list').innerHTML.match(/data-game-key=/g) || []).length;
const selected = (c, cards, extra = {}) => c.selectSaleCards(cards, { ...defaultFilters, ...extra });
function comparable(key, extra = {}) {
  return { key, priceState: 'verified', status: 'active', store: 'Steam', platform: 'PC', salePrice: 1000, discountPercent: 50, ...extra };
}

test('review controls: the full 25-offer catalog survives building and every item is reachable', () => {
  const h = harness();
  const inputs = catalog();
  const before = plain(inputs);
  h.load(inputs);
  assert.equal(h.c.readState().steamSales.length, 25, 'neither the old four-card presentation nor ten-card builder caps may discard inventory');
  assert.equal(countCards(h), 8);
  assert.match(h.el('#game-sale-count').textContent, /25件.*全25件.*8件表示/);
  for (const [count, index] of [[16, 8], [24, 16], [25, 24]]) {
    h.click('#game-sale-more');
    assert.equal(countCards(h), count);
    assert.equal(h.document.activeElement.index, index, 'keyboard focus continues at the first newly visible title');
  }
  assert.equal(h.el('#game-sale-more').hidden, true);
  assert.equal(new Set(h.el('#steam-sale-list').querySelectorAll('h3 a').map((node) => node.key)).size, 25);
  assert.deepEqual(inputs, before);
});

test('review controls: article platform/store words do not become verified PC/Steam facets', () => {
  const h = harness();
  const unrelated = article({ id: 'article-only', sourceUrl: `${ARTICLE_URL}/other`,
    sourceSignals: [{ title: article().title, url: `${ARTICLE_URL}/other`, publishedAt: iso(START - HOUR) }] });
  const cards = h.c.buildSteamSales([article(), unrelated], [offer()]);
  assert.equal(cards.length, 2);
  assert.deepEqual(keys(selected(h.c, cards, { platform: 'PC' })), ['steam-123']);
  assert.deepEqual(keys(selected(h.c, cards, { store: 'Steam' })), ['steam-123']);
  const unknown = selected(h.c, cards, { platform: 'unknown', store: 'unknown' });
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].priceState, 'article');
  assert.equal(selected(h.c, cards, { platform: 'PC', store: 'unknown' }).length, 0);
});

test('review controls: malformed offer provenance cannot enter the verified facets', () => {
  const h = harness();
  for (const change of [{ currency: 'USD' }, { country: 'US' }, { edition: 'deluxe' }, { store: 'Other' },
    { priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=999&cc=jp' } },
    { priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=123&appids=999&cc=jp' } },
    { priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp&cc=us' } },
    { priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com:444/api/appdetails?appids=123&cc=jp' } },
    { articleUrls: ['https://example.com/unrelated'] }]) {
    const cards = h.c.buildSteamSales([article()], [offer(change)]);
    assert.equal(selected(h.c, cards, { platform: 'PC' }).length, 0, JSON.stringify(change));
    assert.equal(selected(h.c, cards, { store: 'Steam' }).length, 0, JSON.stringify(change));
  }
});

test('review controls: price sort is numeric, stable, non-mutating, and unknown/stale/ended are last', () => {
  const { c } = harness();
  const cards = [comparable('stale', { salePrice: 1, priceState: 'stale' }), comparable('equal-a'), comparable('cheap', { salePrice: 2 }),
    comparable('article', { priceState: 'article', salePrice: 3 }), comparable('equal-b'), comparable('ended', { status: 'ended', salePrice: 4 }),
    comparable('expensive', { salePrice: 10000 }), comparable('unknown', { salePrice: null })];
  const before = keys(cards);
  assert.deepEqual(keys(selected(c, cards, { sort: 'price' })), ['cheap', 'equal-a', 'equal-b', 'expensive', 'stale', 'article', 'ended', 'unknown']);
  assert.deepEqual(keys(cards), before);
  assert.deepEqual(keys(selected(c, cards)), before);
});

test('review controls: discount sort uses verified numeric percentages with stable ties and missing last', () => {
  const { c } = harness();
  const cards = [comparable('unknown', { discountPercent: null }), comparable('half-a'), comparable('ninety', { discountPercent: 90 }),
    comparable('stale', { discountPercent: 99, priceState: 'stale' }), comparable('half-b'), comparable('small', { discountPercent: 5 })];
  assert.deepEqual(keys(selected(c, cards, { sort: 'discount' })), ['ninety', 'half-a', 'half-b', 'small', 'unknown', 'stale']);
});

test('review controls: budget is inclusive and admits only fresh verified active price pairs', () => {
  const { c } = harness();
  const cards = [comparable('boundary'), comparable('cheap', { salePrice: 1 }), comparable('over', { salePrice: 1001 }),
    comparable('stale', { salePrice: 1, priceState: 'stale' }), comparable('ended', { salePrice: 1, status: 'ended' }),
    comparable('article', { salePrice: 1, priceState: 'article' }), comparable('unknown', { salePrice: null }),
    comparable('wrong-store', { salePrice: 1, store: null }), comparable('wrong-platform', { salePrice: 1, platform: null })];
  assert.deepEqual(keys(selected(c, cards, { ceiling: '1000' })), ['boundary', 'cheap']);
  assert.equal(selected(c, cards, { ceiling: '0' }).length, 0);
});

test('review controls: filter changes reset only sale pagination, and reset restores all controls/counts', () => {
  const h = harness();
  h.load(catalog());
  h.c.setReaderState();
  h.el('#game-search-input').value = 'Example';
  const searchCorpus = h.c.readState().searchItems;
  const searchWrites = h.el('#game-search-results').writes;
  h.click('#game-sale-more');
  h.filter('sort', 'price');
  h.filter('platform', 'PC');
  h.filter('store', 'Steam');
  h.filter('ceiling', '1000');
  assert.equal(countCards(h), 1);
  assert.match(h.el('#game-sale-count').textContent, /1件.*全25件.*1件表示/);
  assert.equal(h.el('#game-sale-more').hidden, true);
  h.click('#game-sale-reset');
  assert.deepEqual(plain(h.c.readerState()), { searchQuery: 'Example', searchVisibleCount: 16, newsVisibleCount: 24, saleVisibleCount: 8, saleFilters: defaultFilters });
  for (const [field, value] of Object.entries(defaultFilters)) assert.equal(h.el(`#game-sale-${field}`).value, value);
  assert.equal(countCards(h), 8);
  assert.equal(h.el('#game-sale-more').hidden, false);
  assert.equal(h.c.readState().searchItems, searchCorpus);
  assert.equal(h.el('#game-search-input').value, 'Example');
  assert.equal(h.el('#game-search-results').writes, searchWrites);
  assert.equal(h.document.activeElement, h.el('#game-sale-reset'));
});

test('review controls: empty facet combinations give a recoverable empty state and truthful count', () => {
  const h = harness();
  h.load(catalog());
  h.filter('platform', 'unknown');
  assert.equal(countCards(h), 0);
  assert.match(h.el('#steam-sale-list').innerHTML, /条件に合うセールはありません.*[\s\S]*リセット/);
  assert.match(h.el('#game-sale-count').textContent, /0件.*全25件.*0件表示/);
  assert.equal(h.el('#game-sale-more').hidden, true);
  assert.equal(h.document.activeElement, h.el('#game-sale-platform'));
});

test('review deadline: a precise official per-package deadline survives producer/consumer provenance checks', () => {
  const h = harness();
  const input = deadlineOffer();
  assert.equal(verifiedSteamDeadline(input), true);
  const card = h.c.verifiedSaleCard(input, [article()]);
  assert.equal(card.deadlineVerified, true);
  assert.equal(card.endsAt.toISOString(), input.endsAt);
  assert.equal(card.deadlineCheckedAt, input.checkedAt);
  assert.match(card.endsAtLabel, /2026.*10.*6.*14:00.*JST/);
  assert.equal(card.remainingLabel, '残り1時間');
  h.load([input]);
  assert.equal(h.c.readState().totals.endingSoonSaleCount, 1);
  assert.ok(h.c.readState().importantItems.some((item) => /セール終了/.test(item.title)));
  assert.match(h.el('#steam-sale-list').innerHTML, /期限確認.*[\s\S]*公式ストアの期限/);
});

test('review deadline: date-only, impossible, locale-dependent, millisecond, and implausibly distant values fail closed', () => {
  const { c } = harness();
  const base = deadlineOffer();
  for (const endsAt of ['2026-10-06', '2026-10-06T14:00:00+09:00', '2026-10-06T05:00:00.123Z', '2026-02-30T05:00:00.000Z',
    'not-a-date', START + HOUR, iso(START - HOUR), iso(START + 367 * DAY), null]) {
    const parsed = Date.parse(endsAt);
    const input = { ...base, endsAt, deadlineSource: { ...base.deadlineSource, discountEndDate: parsed / 1000 } };
    assert.equal(verifiedSteamDeadline(input), false, String(endsAt));
    const card = c.verifiedSaleCard(input, [article()]);
    assert.equal(card.deadlineVerified, false, String(endsAt));
    assert.equal(card.endsAt, null, String(endsAt));
    assert.equal(card.remainingLabel, null, String(endsAt));
  }
});

test('review deadline: every identity, price, currency, edition and timestamp source binding is required', () => {
  const { c } = harness();
  const base = deadlineOffer();
  const mutations = [{ kind: 'steam-store-countdown' }, { kind: 'article' }, { appId: 999 }, { appId: '123' },
    { packageId: 0 }, { packageId: '456' }, { discountEndDate: (START + HOUR) / 1000 + 1 }, { discountEndDate: String((START + HOUR) / 1000) }, { country: 'US' }, { currency: 'USD' }, { edition: 'deluxe' },
    { regularPrice: 2100 }, { salePrice: 999 }, { discountPercent: 49 }, { checkedAt: iso(START) },
    { url: steamDeadlineSourceUrl(999) }, { url: base.deadlineSource.url.replace('api.steampowered.com', 'evil.example') },
    { storeUrl: 'https://store.steampowered.com/app/999/?cc=jp&l=japanese' }];
  for (const change of mutations) {
    const input = { ...base, deadlineSource: { ...base.deadlineSource, ...change } };
    assert.equal(verifiedSteamDeadline(input), false, JSON.stringify(change));
    const card = c.verifiedSaleCard(input, [article()]);
    assert.equal(card.deadlineVerified, false, JSON.stringify(change));
    assert.equal(card.endsAt, null, JSON.stringify(change));
  }
  for (const deadlineSource of [null, {}, 'Steam']) assert.equal(c.verifiedSaleCard({ ...base, deadlineSource }, [article()]).deadlineVerified, false);
});

test('review deadline: raw endsAt without matching provenance never ends a fresh offer', () => {
  const h = harness();
  h.load([offer({ endsAt: iso(START - 60000) })]);
  const [card] = h.c.readState().steamSales;
  assert.equal(card.status, 'active');
  assert.equal(card.deadlineVerified, false);
  assert.equal(card.endsAt, null);
  assert.equal(selected(h.c, [card], { ceiling: '1000' }).length, 1);
  assert.match(h.el('#steam-sale-list').innerHTML, /終了日時未確認/);
  assert.doesNotMatch(h.el('#steam-sale-list').innerHTML, /期限確認|残り\d|終了済み/);
});

test('review deadline: article date ranges never drive official countdowns or ending-soon urgency', () => {
  const h = harness();
  h.load([]);
  assert.equal(h.c.readState().steamSales.length, 1);
  assert.equal(h.c.readState().totals.endingSoonSaleCount, 0);
  assert.ok(h.c.readState().briefing.every((line) => !/終了間近/.test(line)));
  assert.ok(h.c.readState().importantItems.every((item) => !/セール終了/.test(item.title)));
  assert.match(h.el('#steam-sale-list').innerHTML, /終了日時未確認/);
  assert.doesNotMatch(h.el('#steam-sale-list').innerHTML, /期限確認|残り\d/);
});

test('review deadline: ending sort places only verified fresh deadlines first and preserves stable ties/missing order', () => {
  const { c } = harness();
  const soon = new Date(START + HOUR);
  const later = new Date(START + 2 * HOUR);
  const cards = [comparable('unknown'), comparable('later', { deadlineVerified: true, endsAt: later }),
    comparable('soon-a', { deadlineVerified: true, endsAt: soon }), comparable('unverified', { endsAt: new Date(START + 1) }),
    comparable('stale', { priceState: 'stale', deadlineVerified: true, endsAt: soon }),
    comparable('soon-b', { deadlineVerified: true, endsAt: soon }), comparable('ended', { status: 'ended', deadlineVerified: true, endsAt: soon })];
  assert.deepEqual(keys(selected(c, cards, { sort: 'ending' })), ['soon-a', 'soon-b', 'later', 'unknown', 'unverified', 'stale', 'ended']);
});

test('review lifecycle: exact official end time removes budget eligibility and urgency without touching search', () => {
  const h = harness();
  const input = deadlineOffer({}, START + 15000);
  h.load([input]);
  h.c.setReaderState();
  h.filter('ceiling', '1000');
  const corpus = h.c.readState().searchItems;
  const checked = input.checkedAt;
  const searchWrites = h.el('#game-search-results').writes;
  h.c.bindOfferLifecycle();
  assert.equal([...h.timers.values()][0].delay, 15000);
  h.time(START + 14999);
  h.c.synchronizeOfferLifecycle();
  assert.equal(countCards(h), 1);
  h.time(START + 15000);
  h.c.synchronizeOfferLifecycle();
  assert.equal(countCards(h), 0);
  assert.equal(h.c.readState().steamSales[0].status, 'ended');
  assert.equal(h.c.readState().steamSales[0].remainingLabel, '終了済み');
  assert.equal(h.c.readState().totals.endingSoonSaleCount, 0);
  assert.equal(h.c.readState().steamSales[0].checkedAt, checked);
  assert.equal(h.c.readState().searchItems, corpus);
  assert.equal(h.el('#game-search-results').writes, searchWrites);
  assert.equal(h.c.readerState().searchQuery, 'Example');
  assert.equal(h.document.activeElement, h.el('#game-sale-ceiling'));
});

test('review lifecycle: six-hour aging preserves filters/pages/focus but immediately removes budget eligibility', () => {
  const h = harness();
  const inputs = catalog();
  h.load(inputs);
  h.filter('sort', 'price');
  h.filter('ceiling', '5000');
  h.click('#game-sale-more');
  h.c.setReaderState();
  const searchInput = h.el('#game-search-input');
  searchInput.value = 'Example';
  searchInput.focus();
  const before = plain(h.c.readerState());
  const corpus = h.c.readState().searchItems;
  h.time(START + 5 * HOUR - 1);
  h.c.synchronizeOfferLifecycle();
  assert.equal(countCards(h), 16);
  h.time(START + 5 * HOUR);
  h.c.synchronizeOfferLifecycle();
  assert.equal(countCards(h), 0);
  assert.equal(h.c.readState().steamSales.length, 25);
  assert.ok(h.c.readState().steamSales.every((item) => item.priceState === 'stale'));
  assert.deepEqual(plain(h.c.readerState()), before);
  assert.equal(h.c.readState().searchItems, corpus);
  assert.equal(h.document.activeElement, searchInput);
  assert.equal(searchInput.value, 'Example');
  h.time(START + 23 * HOUR);
  h.c.synchronizeOfferLifecycle();
  assert.ok(h.c.readState().steamSales.every((item) => item.priceState !== 'verified' && item.priceState !== 'stale'));
  assert.deepEqual(plain(h.c.readerState()), before);
});

test('review lifecycle: minute countdown rerenders preserve the exact focused sale-card identity', () => {
  const h = harness();
  h.load([deadlineOffer()]);
  const original = h.el('#steam-sale-list').querySelectorAll('h3 a')[0];
  original.focus();
  h.time(START + 60000);
  h.c.synchronizeOfferLifecycle();
  assert.notEqual(h.document.activeElement, original);
  assert.equal(h.document.activeElement.key, 'steam-123');
  assert.equal(h.document.activeElement.focusOptions.preventScroll, true);
  assert.equal(h.c.readState().steamSales[0].remainingLabel, '残り59分');
});

test('review deadline: API request identity rejects duplicate parameters, altered context and noncanonical provenance', () => {
  const { c } = harness();
  const base = deadlineOffer();
  const url = base.deadlineSource.url;
  const input = JSON.parse(new URL(url).searchParams.get('input_json'));
  const changed = (value) => `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(value))}`;
  for (const sourceUrl of [
    `${url}&input_json=${encodeURIComponent(JSON.stringify({ ...input, ids: [{ appid: 999 }] }))}`,
    `${url}#unverified`, `${url}&country_code=US`, url.replace('https://', 'http://'),
    url.replace('api.steampowered.com', 'user:password@api.steampowered.com'),
    changed({ ...input, ids: [{ appid: 123 }, { appid: 999 }] }),
    changed({ ...input, ids: [{ appid: 123, packageid: 999 }] }),
    changed({ ...input, context: { language: 'japanese', country_code: 'US' } }),
    changed({ ...input, data_request: { include_all_purchase_options: false } }),
  ]) {
    const value = { ...base, deadlineSource: { ...base.deadlineSource, url: sourceUrl } };
    assert.equal(verifiedSteamDeadline(value), false, sourceUrl);
    assert.equal(c.verifiedSaleCard(value, [article()]).deadlineVerified, false, sourceUrl);
  }
  const mismatchedStore = { ...base, storeUrl: base.storeUrl.replace('cc=jp', 'cc=us') };
  assert.equal(verifiedSteamDeadline(mismatchedStore), false);
  assert.equal(c.verifiedSaleCard(mismatchedStore, [article()]).deadlineVerified, false, 'the source must bind the same offer store URL');
});


test('review lifecycle: asynchronously hiding the focused More button moves focus to the sale heading', () => {
  const h = harness();
  h.load(catalog());
  h.filter('ceiling', '5000');
  const more = h.el('#game-sale-more');
  assert.equal(more.hidden, false);
  more.focus();
  h.time(START + 5 * HOUR);
  h.c.synchronizeOfferLifecycle();
  assert.equal(countCards(h), 0);
  assert.equal(more.hidden, true);
  const heading = h.el('#sale-section h2');
  assert.equal(h.document.activeElement, heading, 'a hidden button cannot retain usable keyboard focus');
  assert.equal(heading.getAttribute('tabindex'), '-1');
  assert.equal(heading.focusOptions.preventScroll, true);
});
