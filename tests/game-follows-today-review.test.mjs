import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { collectGameSaleOffers, steamDeadlineSourceUrl, steamPriceSourceUrl } from '../lib/game-sale-offers.mjs';
import { parseSteamReleaseObservation, retainedSteamFollowObservations, steamUpdateSourceUrl } from '../lib/game-follow-observations.mjs';

// Independent production integration review. Game identities, prices and events
// are invented fixtures. The DOM model tracks disconnected focus and real
// rendered attributes; no live price or browser-visual claims are made here.
const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const TOPICS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const FOLLOWS = fs.readFileSync(new URL('../game-follow-utils.js', import.meta.url), 'utf8');
const START = Date.parse('2026-10-06T04:00:00.000Z');
const HOUR = 3600000;
const iso = (time = START) => new Date(time).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value));
const ARTICLE = 'https://example.com/game-sale';
const DEFAULT_FILTERS = { platform: 'all', store: 'all', sort: 'recommended', ceiling: '' };
const storage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key), clear: () => data.clear() };
};
function article(title = '『Example Quest』Steamで50%オフの1,000円、10月5日から10月8日まで', extra = {}) {
  const value = { id: title, title, categories: ['games'], sourceUrl: ARTICLE, publishedAt: iso(START - HOUR), ...extra };
  return { ...value, sourceSignals: [{ title: value.title, url: value.sourceUrl, publishedAt: value.publishedAt }], ...extra };
}
function offer(extra = {}) {
  const appId = extra.appId ?? 123;
  return { id: `steam:${appId}`, appId, title: 'Example Quest', store: 'Steam', country: 'JP', currency: 'JPY', edition: 'base-game',
    regularPrice: 2000, salePrice: 1000, discountPercent: 50, status: 'verified',
    storeUrl: `https://store.steampowered.com/app/${appId}/?cc=jp&l=japanese`,
    priceSource: { kind: 'steam-appdetails', url: `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp&l=japanese` },
    articleUrls: [ARTICLE], checkedAt: iso(START - HOUR), freshUntil: iso(START + 5 * HOUR), priceValidUntil: iso(START + 23 * HOUR), ...extra };
}
function observed(kind, extra = {}) {
  const appId = extra.identity?.appId ?? 123;
  return { identity: { kind: 'steam', appId }, kind, checkedAt: iso(START - HOUR), freshUntil: iso(START + 5 * HOUR),
    ...(kind === 'release' ? { date: '2017-12-06', status: 'released', source: { ...offer({ appId }).priceSource, verified: true } }
      : { date: iso(START - 14 * 24 * HOUR), eventId: 'patch-1', title: 'Patch 1.0 notes', eventType: 'release-notes',
        source: { kind: 'official-game', gameKey: `steam:${appId}`, verified: true, url: `https://store.steampowered.com/news/app/${appId}/view/555` } }), ...extra };
}
function deadlineOffer(end = START + HOUR, extra = {}) {
  const item = offer(extra);
  return { ...item, endsAt: iso(end), deadlineSource: { kind: 'steam-storebrowse', appId: item.appId, packageId: 456,
    discountEndDate: end / 1000, checkedAt: item.checkedAt, url: steamDeadlineSourceUrl(item.appId), storeUrl: item.storeUrl,
    country: 'JP', currency: 'JPY', edition: 'base-game', regularPrice: item.regularPrice, salePrice: item.salePrice, discountPercent: item.discountPercent } };
}
function harness({ now = START, localStorage = storage(), sessionStorage = storage(), includeUtils = true } = {}) {
  let wall = now;
  const elements = new Map();
  const ids = new Map();
  const documentListeners = {};
  const windowListeners = {};
  const timers = new Map();
  const document = { hidden: false, activeElement: null, addEventListener(type, listener) { documentListeners[type] = listener; },
    getElementById(id) { return ids.get(id) || null; },
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, element(selector)); return elements.get(selector); },
    createElement() { return { textContent: '', value: '', set innerHTML(value) { this.value = value; }, get innerHTML() { return this.textContent || this.value; } }; },
  };
  const attrs = (markup) => Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  function node(tag, attributes, text = '', card = null) {
    const value = { tag, attributes, id: attributes.id || '', className: attributes.class || '', textContent: text.replace(/<[^>]*>/g, ''), card,
      getAttribute(name) { return this.attributes[name] ?? null; }, hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      closest(selector) {
        if (selector === '[data-game-key]') return this.card || (this.hasAttribute('data-game-key') ? this : null);
        return selector.split(',').some((part) => { const attribute = part.trim().match(/^\[([^\]]+)\]$/)?.[1]; return attribute && this.hasAttribute(attribute); }) ? this : null;
      },
      focus(options) { document.activeElement = this; this.focusOptions = options; },
      scrollIntoView(options) { this.scrollOptions = options; },
    };
    if (value.id) ids.set(value.id, value);
    return value;
  }
  function element(selector) {
    let html = '';
    let nodes = [];
    const section = selector === '#steam-sale-list' ? '#sale-section' : selector === '#game-follow-list' ? '#game-follow-section' : '#game-overview';
    const value = node('container', {});
    Object.assign(value, { value: '', textContent: '', hidden: false, listeners: {}, writes: 0,
      addEventListener(type, listener) { this.listeners[type] = listener; },
      contains(target) { return nodes.includes(target); },
      querySelectorAll(query) {
        if (selector === '#game-sale-controls' && query === '[data-sale-filter]') return Object.keys(DEFAULT_FILTERS).map((key) => document.querySelector(`#game-sale-${key}`));
        if (query === 'h3 a') return nodes.filter((entry) => entry.tag === 'a' && entry.hasAttribute('data-heading-link'));
        if (query === 'a, button, [tabindex]') return nodes;
        const attribute = query.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/);
        if (attribute) return nodes.filter((entry) => entry.hasAttribute(attribute[1]) && (!attribute[2] || entry.getAttribute(attribute[1]) === attribute[2]));
        return nodes;
      },
      querySelector(query) { return this.querySelectorAll(query)[0] || null; },
      closest(query) { return query === 'section' ? { querySelector: () => document.querySelector(`${section} h2`) } : null; },
      insertAdjacentHTML(_position, markup) { this.innerHTML += markup; },
    });
    if (selector.startsWith('#game-sale-') && Object.hasOwn(DEFAULT_FILTERS, selector.slice(11))) value.attributes['data-sale-filter'] = selector.slice(11);
    Object.defineProperty(value, 'innerHTML', { get: () => html, set(markup) {
      if (nodes.includes(document.activeElement)) document.activeElement = null;
      for (const old of nodes) if (old.id) ids.delete(old.id);
      html = markup; value.writes++; nodes = [];
      const cards = [...html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)];
      const parseControls = (body, card) => {
        for (const match of body.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
          const attributes = attrs(match[2]);
          if (match[1] === 'a' && /<h3>\s*$/.test(body.slice(0, match.index))) attributes['data-heading-link'] = '';
          nodes.push(node(match[1], attributes, match[3], card));
        }
      };
      for (const match of cards) {
        const card = node('article', attrs(match[1]));
        nodes.push(card); parseControls(match[2], card);
      }
      if (!cards.length) parseControls(html, null);
    } });
    return value;
  }
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [wall])); } static now() { return wall; } }
  const context = { console, URL, Intl, Date: FixedDate, document, localStorage, sessionStorage,
    HomeDataUtils: { fetchJsonWithCache() { assert.fail('Review UI actions must not fetch or authenticate'); } },
    addEventListener(type, listener) { windowListeners[type] = listener; }, matchMedia() { return { matches: true }; },
    setTimeout(callback, delay) { const key = timers.size + 1; timers.set(key, { callback, delay }); return key; }, clearTimeout(key) { timers.delete(key); },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(TOPICS, context);
  if (includeUtils) vm.runInContext(FOLLOWS, context);
  let script = SOURCE.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const functions = [...script.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((match) => match[1]);
  script = script.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${functions.join(',')},
    bootReview: () => { if (followStore) { const saved = followStore.load({ now: currentOfferTime() }); savedFollowState = saved.state; followStorageStatus = saved.status; if (saved.reason === 'invalid') followMessage = '保存データを読み直せなかったため、空の一覧から開始しました。'; } bindInteractions(); },
    setPayloads: (value) => { gameSourcePayloads = value; applyGameSourcePayloads(); },
    readReview: () => ({ dashboardState, savedFollowState, followStorageStatus, saleVisibleCount, saleFilters: { ...saleFilters } }),
  });})();`);
  vm.runInContext(script, context);
  context.bootReview();
  const el = (selector) => document.querySelector(selector);
  return { c: context, el, document, localStorage, sessionStorage, windowListeners,
    time(value) { wall = value; },
    load(offers = [offer()], topics = [article()]) {
      context.setPayloads({ trend: { items: topics, generatedAt: iso(wall) }, archive: { items: [] }, home: { items: [] },
        events: { items: [] }, prices: { items: offers, sources: [] } });
    },
    filter(field, value) { const target = el(`#game-sale-${field}`); target.value = value; target.focus(); el('#game-sale-controls').listeners.change({ target }); },
    clickAttribute(selector, attribute, value) {
      const target = el(selector).querySelectorAll(`[${attribute}="${value}"]`)[0];
      assert.ok(target, `${selector} has ${attribute}=${value}`); target.focus();
      let prevented = false; documentListeners.click({ target, preventDefault() { prevented = true; } }); return { target, prevented };
    },
    syncStorage(key = context.GameFollowUtils?.STORAGE_KEY) { windowListeners.storage({ key, storageArea: localStorage }); },
  };
}
const current = (h) => h.c.readReview();
const changes = (h) => current(h).savedFollowState.follows.flatMap((entry) => entry.changes);
const follow = (h, appId = 123) => h.clickAttribute('#steam-sale-list', 'data-game-follow', `steam:${appId}`);
const countCards = (h) => h.el('#steam-sale-list').querySelectorAll('[data-game-key]').filter((entry) => entry.tag === 'article').length;

test('review follow: first click baselines source prices and historical release/patch dates without false changes', () => {
  const h = harness();
  h.load([offer({ followObservations: [observed('release'), observed('update')] })]);
  assert.match(h.el('#game-hero-stats').innerHTML, /0作品/);
  follow(h);
  const state = current(h).savedFollowState;
  assert.equal(state.follows.length, 1);
  assert.equal(state.follows[0].observations.length, 3);
  assert.equal(changes(h).length, 0);
  assert.match(h.el('#game-follow-list').innerHTML, /2017-12-06/);
  assert.match(h.el('#game-follow-list').innerHTML, /Patch 1.0 notes/);
  assert.match(h.el('#game-follow-list').innerHTML, /9\/22/);
  assert.doesNotMatch(h.el('#game-follow-list').innerHTML, /値下げを確認|発売情報の変更|game-follow-changes/);
  assert.match(h.el('#game-follow-status').textContent, /1作品をフォロー中.*このブラウザー/);
  assert.match(h.el('#game-hero-stats').innerHTML, /1作品/);
  assert.equal(h.document.activeElement.getAttribute('data-game-unfollow'), 'steam:123', 'focus survives the card button changing action');
  assert.equal(JSON.parse(h.localStorage.getItem(h.c.GameFollowUtils.STORAGE_KEY)).follows.length, 1);
});

test('review follow: later official checks create only genuine post-follow changes and preserve actual event dates', () => {
  const h = harness();
  h.load([offer({ followObservations: [observed('release'), observed('update')] })]); follow(h);
  h.time(START + HOUR);
  const refreshed = offer({ checkedAt: iso(START + HOUR), freshUntil: iso(START + 7 * HOUR), priceValidUntil: iso(START + 24 * HOUR),
    salePrice: 800, discountPercent: 60, followObservations: [observed('release', { date: '2017-12-07', checkedAt: iso(START + HOUR), freshUntil: iso(START + 7 * HOUR) }),
      observed('update', { eventId: 'patch-2', date: iso(START + HOUR / 2), checkedAt: iso(START + HOUR), freshUntil: iso(START + 7 * HOUR) })] });
  h.load([refreshed]);
  assert.deepEqual(Array.from(changes(h), (entry) => entry.kind).sort(), ['price-drop', 'release-changed', 'update']);
  assert.equal(changes(h).find((entry) => entry.kind === 'update').after.date, iso(START + HOUR / 2));
  assert.match(h.el('#game-follow-list').innerHTML, /1,000円 → 800円/);
  h.load([refreshed]);
  assert.equal(changes(h).length, 3, 'retrying the same payload does not re-announce it');
  const reloaded = harness({ now: START + HOUR, localStorage: h.localStorage }); reloaded.load([refreshed]);
  assert.equal(changes(reloaded).length, 3, 'reload preserves history without duplication');
});

test('review follow: late initial series, rechecked old patches, and unrelated official identities never create changes', () => {
  const h = harness(); h.load(); follow(h); h.time(START + HOUR);
  const late = observed('update', { checkedAt: iso(START + HOUR), freshUntil: iso(START + 7 * HOUR) });
  const wrongIdentity = observed('release', { identity: { kind: 'steam', appId: 999 } });
  h.load([offer({ followObservations: [late, wrongIdentity] })]);
  assert.equal(current(h).savedFollowState.follows[0].observations.length, 2);
  assert.equal(changes(h).length, 0);
  h.time(START + 2 * HOUR);
  h.load([offer({ followObservations: [{ ...late, eventId: 'old-but-newly-found', date: iso(START - HOUR), checkedAt: iso(START + 2 * HOUR), freshUntil: iso(START + 8 * HOUR) }] })]);
  assert.equal(changes(h).length, 0, 'an old event newly discovered after follow is not a new update');
});

test('review follow: article-only sales and invalid same-title identities cannot be followed', () => {
  const h = harness(); h.load([]);
  assert.doesNotMatch(h.el('#steam-sale-list').innerHTML, /data-game-follow=/);
  for (const patch of [{ country: 'US' }, { edition: 'dlc' }, { appId: '123' }, { articleUrls: ['https://example.com/unrelated'] }]) {
    h.load([offer(patch)]); h.c.changeGameFollow(`steam:${offer(patch).appId}`, true);
    assert.equal(current(h).savedFollowState.follows.length, 0);
  }
});

test('review follow: removing a saved card preserves useful focus and updates all count/button views', () => {
  const h = harness(); h.load(); follow(h);
  h.clickAttribute('#game-follow-list', 'data-game-unfollow', 'steam:123');
  assert.equal(current(h).savedFollowState.follows.length, 0);
  assert.equal(h.document.activeElement, h.el('#game-follow-section h2'));
  assert.match(h.el('#game-follow-status').textContent, /0作品をフォロー中/);
  assert.match(h.el('#game-hero-stats').innerHTML, /0作品/);
  assert.match(h.el('#steam-sale-list').innerHTML, /data-game-follow="steam:123"/);
  const reload = harness({ localStorage: h.localStorage }); reload.load();
  assert.equal(current(reload).savedFollowState.follows.length, 0);
});

test('review follow: quota fallback and memory-only fallback are truthful and stay usable', () => {
  for (const status of ['session', 'memory']) {
    const localStorage = storage();
    localStorage.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
    const sessionStorage = storage();
    if (status === 'memory') sessionStorage.setItem = () => { throw new Error('blocked'); };
    const h = harness({ localStorage, sessionStorage }); h.load(); follow(h);
    assert.equal(current(h).followStorageStatus, status);
    assert.match(h.el('#game-follow-status').textContent, status === 'session' ? /このタブの保存領域/ : /開いている間だけ保持/);
    assert.equal(current(h).savedFollowState.follows.length, 1);
    h.clickAttribute('#game-follow-list', 'data-game-unfollow', 'steam:123');
    assert.equal(current(h).savedFollowState.follows.length, 0);
    assert.equal(changes(h).length, 0);
  }
});

test('review follow: malformed and future-version storage cannot crash or create invented follows', () => {
  for (const raw of ['{', 'null', JSON.stringify({ version: 999, follows: [] }), JSON.stringify({ version: 1, follows: [null, {}, { title: 'Fake', identity: { kind: 'steam', appId: 123 }, followedAt: 'tomorrow' }] })]) {
    const h = harness({ localStorage: storage({ 'internet-news-game-follows-v1': raw }) }); h.load();
    assert.equal(current(h).savedFollowState.follows.length, 0);
    assert.match(h.el('#game-hero-stats').innerHTML, /0作品/);
    follow(h); assert.equal(current(h).savedFollowState.follows.length, 1);
  }
});

test('review follow: cross-tab follow/removal sync refreshes actual count and safely ignores unrelated keys', () => {
  const localStorage = storage(); const a = harness({ localStorage }); const b = harness({ localStorage }); a.load(); b.load();
  follow(a); b.syncStorage('unrelated-key'); assert.equal(current(b).savedFollowState.follows.length, 0);
  b.syncStorage(); assert.equal(current(b).savedFollowState.follows.length, 1);
  assert.match(b.el('#game-hero-stats').innerHTML, /1作品/);
  b.clickAttribute('#game-follow-list', 'data-game-unfollow', 'steam:123'); a.syncStorage();
  assert.equal(current(a).savedFollowState.follows.length, 0);
  assert.match(a.el('#steam-sale-list').innerHTML, /data-game-follow="steam:123"/);
});

test('review follow: storage clear in another tab does not resurrect an in-memory saved follow', () => {
  const h = harness(); h.load(); follow(h);
  h.localStorage.clear(); h.syncStorage(null);
  assert.equal(current(h).savedFollowState.follows.length, 0);
  assert.match(h.el('#game-hero-stats').innerHTML, /0作品/);
});

test('review follow: expired known sale is no longer displayed as a current discounted follow price', () => {
  const h = harness(); h.load([deadlineOffer()]); follow(h);
  assert.match(h.el('#game-follow-list').innerHTML, /確認価格 1,000円/);
  h.time(START + HOUR); h.c.refreshTimeSensitiveDashboard();
  assert.equal(current(h).dashboardState.steamSales[0].status, 'ended');
  assert.doesNotMatch(h.el('#game-follow-list').innerHTML, /<p>確認価格 1,000円/);
  assert.match(h.el('#game-follow-list').innerHTML, /前回確認.*1,000円/);
  assert.equal(changes(h).length, 0, 'expiry alone cannot invent a full-price increase');
});

test('review follow: newly seen expired discounted offer cannot establish a current-price baseline', () => {
  const h = harness({ now: START + HOUR }); h.load([deadlineOffer()]); follow(h);
  assert.equal(current(h).savedFollowState.follows[0].observations.filter((entry) => entry.kind === 'price').length, 0);
  assert.doesNotMatch(h.el('#game-follow-list').innerHTML, /確認価格 1,000円/);
});

test('review follow: verified full-price recheck after a sale creates actual increase but mere missing coverage does not', () => {
  const h = harness(); h.load(); follow(h); h.load([]);
  assert.match(h.el('#game-follow-list').innerHTML, /今回の掲載対象外/);
  assert.equal(changes(h).length, 0);
  h.time(START + HOUR);
  h.load([offer({ status: 'ended', salePrice: 2000, discountPercent: 0, checkedAt: iso(START + HOUR), freshUntil: iso(START + 7 * HOUR), priceValidUntil: iso(START + 24 * HOUR) })]);
  assert.equal(changes(h)[0].kind, 'price-increase');
  assert.match(h.el('#game-follow-list').innerHTML, /確認価格 2,000円/);
});

test('review release: JP day-only released evidence is valid after JST midnight without inventing an exact time', () => {
  const at = Date.parse('2026-10-06T15:30:00.000Z');
  const h = harness({ now: at }); const item = offer({ checkedAt: iso(at) });
  const event = observed('release', { date: '2026-10-07', checkedAt: iso(at), freshUntil: iso(at + 6 * HOUR) });
  assert.equal(h.c.GameFollowUtils.normalizeObservation(event, { now: at })?.date, '2026-10-07');
  const payload = { '123': { success: true, data: { steam_appid: 123, type: 'game', name: item.title, release_date: { coming_soon: false, date: '2026年10月7日' } } } };
  assert.equal(parseSteamReleaseObservation(payload, item)?.date, '2026-10-07');
  assert.equal(retainedSteamFollowObservations([event], item, { now: new Date(at) }).length, 1);
  assert.equal(h.c.GameFollowUtils.normalizeObservation({ ...event, date: '2026-10-08' }, { now: at }), null);
  assert.equal(h.c.GameFollowUtils.normalizeObservation({ ...event, date: iso(at + 1) }, { now: at }), null, 'precise future release times remain future');
});

test('review today: top is at most three distinct games, source-labeled, with no stale article filler', () => {
  const h = harness();
  h.load(Array.from({ length: 7 }, (_, index) => offer({ appId: 200 + index, title: `Example Quest ${index}` })));
  assert.equal(current(h).dashboardState.todayHighlights.length, 3);
  assert.equal(new Set(current(h).dashboardState.todayHighlights.map((entry) => entry.title)).size, 3);
  assert.equal((h.el('#game-hero-command').innerHTML.match(/<article/g) || []).length, 3);
  assert.match(h.el('#game-hero-command').innerHTML, /本日価格確認/);
  assert.doesNotMatch(h.el('#game-hero-command').innerHTML, /本日値下げ/);
  h.load([], [article('『Example Quest』Steam新作を紹介', { publishedAt: iso(START - 24 * HOUR) })]);
  assert.equal(current(h).dashboardState.todayHighlights.length, 0);
  assert.match(h.el('#game-hero-command').innerHTML, /今日分の確認情報はまだありません/);
});

test('review today: JST calendar rollover excludes yesterday and recognizes current-day verified price checks', () => {
  const at = Date.parse('2026-10-06T15:01:00.000Z');
  const h = harness({ now: at });
  h.load([offer({ checkedAt: iso(at - 2 * 60000), freshUntil: iso(at + HOUR), priceValidUntil: iso(at + 23 * HOUR) })]);
  assert.equal(current(h).dashboardState.todayHighlights.length, 0, 'Oct 6 23:59 JST is yesterday although UTC date matches');
  h.load([offer({ checkedAt: iso(at - 30000), freshUntil: iso(at + HOUR), priceValidUntil: iso(at + 23 * HOUR) })]);
  assert.equal(current(h).dashboardState.todayHighlights.length, 1);
});

test('review today: update/release effective date, not retrieval or article publication, controls inclusion', () => {
  const h = harness();
  h.load([], [article('『Example Quest』10月5日に大型アップデート配信'), article('『Other Quest』Steam版10月5日発売', { sourceUrl: `${ARTICLE}/other` })]);
  assert.equal(current(h).dashboardState.todayHighlights.length, 0);
  h.load([], [article('『Example Quest』10月6日に大型アップデート配信'), article('『Other Quest』Steam版10月6日発売', { sourceUrl: `${ARTICLE}/other` })]);
  assert.deepEqual(Array.from(current(h).dashboardState.todayHighlights, (entry) => entry.label).sort(), ['本日更新の報道', '本日発売の報道']);
});

test('review today: one game with sale and update evidence appears once without borrowing evidence', () => {
  const h = harness();
  h.load([offer()], [article(), article('『Example Quest』10月6日に大型アップデート配信', { sourceUrl: `${ARTICLE}/update` })]);
  const picks = current(h).dashboardState.todayHighlights;
  assert.equal(picks.length, 1);
  assert.equal(picks[0].label, '本日更新の報道');
  assert.equal(picks[0].salePrice, undefined);
  assert.equal(picks[0].href, `${ARTICLE}/update`);
});

test('review today: trials keep trial/condition language and never become ownership claims', () => {
  const h = harness();
  h.load([], [article('『Example Quest』Steamで無料トライアル、10月6日から10月8日まで')]);
  const picks = current(h).dashboardState.todayHighlights;
  assert.equal(picks.length, 1);
  assert.equal(picks[0].offerType, 'trial');
  assert.match(h.el('#game-hero-command').innerHTML, /無料体験|無料プレイ|トライアル/);
  assert.match(h.el('#game-hero-command').innerHTML, /利用条件は記事で確認/);
  assert.doesNotMatch(h.el('#game-hero-command').innerHTML, /永久|所有|受け取る/);
});

test('review today: direct sale jump resets conflicting controls, reveals off-page target and focuses the exact card', () => {
  const h = harness();
  const offers = Array.from({ length: 19 }, (_, index) => offer({ appId: 1000 + index, title: `Example Quest ${index}`, salePrice: 1000 + index, regularPrice: 2000 + index * 2,
    ...(index === 18 ? { featuredInArticle: false } : {}) }));
  h.load(offers); const key = current(h).dashboardState.steamSales[18].key;
  assert.equal(countCards(h), 8);
  h.filter('platform', 'unknown'); h.filter('ceiling', '1'); h.filter('sort', 'price');
  assert.equal(countCards(h), 0);
  h.c.jumpToGameCard(key);
  assert.deepEqual(plain(current(h).saleFilters), DEFAULT_FILTERS);
  for (const [field, value] of Object.entries(DEFAULT_FILTERS)) assert.equal(h.el(`#game-sale-${field}`).value, value);
  assert.equal(countCards(h), 19);
  assert.equal(h.document.activeElement.id, `game-card-${key}`);
  assert.equal(h.document.activeElement.getAttribute('tabindex'), '-1');
  assert.equal(h.document.activeElement.scrollOptions.block, 'start');
});

test('review today: hero sale link uses the delegated direct jump rather than leaving a hidden hash target', () => {
  const h = harness(); h.load(); h.filter('ceiling', '1');
  assert.equal(countCards(h), 0);
  const clicked = h.clickAttribute('#game-hero-command', 'data-game-jump', 'steam-123');
  assert.equal(clicked.prevented, true);
  assert.equal(countCards(h), 1);
  assert.equal(h.document.activeElement.id, 'game-card-steam-123');
});

test('review follow: optional helper failure is visible without breaking sale/search rendering', () => {
  const h = harness({ includeUtils: false }); h.load();
  assert.match(h.el('#game-follow-status').textContent, /フォロー機能を読み込めません/);
  assert.equal(countCards(h), 1);
  assert.doesNotMatch(h.el('#steam-sale-list').innerHTML, /data-game-follow=/);
});

const PRODUCER_ARTICLE = 'https://automaton-media.com/articles/newsjp/follow-review-123';
const producerTopic = () => article('Steam『Example Quest』と『Other Quest』のセール', { id: 'producer-review', sourceUrl: PRODUCER_ARTICLE });
const producerHtml = (ids = [123]) => `<link rel="canonical" href="${PRODUCER_ARTICLE}/"><section class="maintext">${ids.map((appId) =>
  `<p>『<strong>${appId === 123 ? 'Example Quest' : 'Other Quest'}</strong>』税込1,000円/50％オフ（<a href="https://store.steampowered.com/app/${appId}/">ストアページ</a>）</p>`).join('')}</section>`;
const producerApp = (appId = 123) => ({ [appId]: { success: true, data: { type: 'game', name: appId === 123 ? 'Example Quest' : 'Other Quest', steam_appid: appId,
  release_date: { coming_soon: false, date: '2017年12月6日' }, price_overview: { currency: 'JPY', initial: 200000, final: 100000, discount_percent: 50 } } } });
const producerNews = (appId = 123, date = START - 12 * 24 * HOUR) => ({ appnews: { appid: appId, newsitems: [{
  appid: appId, gid: `1843481262705${appId}`, title: 'Patch 1.0 notes',
  url: `https://store.steampowered.com/news/app/${appId}/view/555`, feedname: 'steam_community_announcements', feed_type: 1,
  date: date / 1000, tags: ['patchnotes'],
}] } });
const producerResponse = (value, url) => ({ ok: true, status: 200, url, headers: { get: () => null }, text: async () => typeof value === 'string' ? value : JSON.stringify(value) });
function producerFetch(calls = [], ids = [123], { newsFailure = false } = {}) {
  return async (url) => {
    calls.push(url);
    if (url === `${PRODUCER_ARTICLE}/`) return producerResponse(producerHtml(ids), url);
    const price = ids.find((appId) => url === steamPriceSourceUrl(appId));
    if (price) return producerResponse(producerApp(price), url);
    const news = ids.find((appId) => url === steamUpdateSourceUrl(appId));
    if (news) {
      if (newsFailure) throw new Error('optional source offline');
      return producerResponse(producerNews(news), url);
    }
    assert.fail(`Unexpected production collector request: ${url}`);
  };
}

test('review pipeline: actual price collector integrates exact official release/patch observations after all price checks', async () => {
  const calls = [];
  const payload = await collectGameSaleOffers({ topics: [producerTopic()], now: new Date(START), fetchImpl: producerFetch(calls, [123, 456]), concurrency: 1 });
  assert.equal(payload.items.length, 2);
  assert.deepEqual(calls, [`${PRODUCER_ARTICLE}/`, steamPriceSourceUrl(123), steamPriceSourceUrl(456), steamUpdateSourceUrl(123), steamUpdateSourceUrl(456)]);
  for (const item of payload.items) {
    assert.deepEqual(item.followObservations.map((entry) => entry.kind), ['release', 'update']);
    assert.equal(item.followObservations[0].date, '2017-12-06');
    assert.equal(item.followObservations[1].date, iso(START - 12 * 24 * HOUR));
    assert.equal(item.followObservations[1].checkedAt, iso(START));
    assert.equal(item.followObservations[1].source.gameKey, item.id);
    assert.equal(payload.sources.find((entry) => entry.appId === item.appId).followUpdateStatus, 'verified');
  }
  const h = harness(); h.load(payload.items, [producerTopic()]); follow(h);
  assert.equal(current(h).savedFollowState.follows[0].observations.length, 3);
  assert.equal(changes(h).length, 0);
});

test('review pipeline: cached collector repeat preserves original check/event times and performs no optional fetches', async () => {
  const previous = await collectGameSaleOffers({ topics: [producerTopic()], now: new Date(START), fetchImpl: producerFetch() });
  const payload = await collectGameSaleOffers({ topics: [producerTopic()], previous, now: new Date(START + HOUR),
    fetchImpl: async () => assert.fail('A fresh cached result must not refetch even an optional follow source') });
  assert.equal(payload.items[0].status, 'cached');
  assert.equal(payload.items[0].checkedAt, iso(START));
  assert.deepEqual(payload.items[0].followObservations, previous.items[0].followObservations);
  assert.equal(payload.generatedAt, iso(START + HOUR));
});

test('review pipeline: optional patch outage never discards a good price or renews the cached patch check', async () => {
  const previous = await collectGameSaleOffers({ topics: [producerTopic()], now: new Date(START), fetchImpl: producerFetch() });
  const payload = await collectGameSaleOffers({ topics: [producerTopic()], previous, now: new Date(START + 7 * HOUR),
    fetchImpl: producerFetch([], [123], { newsFailure: true }) });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].status, 'verified');
  assert.equal(payload.items[0].checkedAt, iso(START + 7 * HOUR));
  const release = payload.items[0].followObservations.find((entry) => entry.kind === 'release');
  const update = payload.items[0].followObservations.find((entry) => entry.kind === 'update');
  assert.equal(release.checkedAt, iso(START + 7 * HOUR));
  assert.equal(update.checkedAt, iso(START));
  assert.equal(update.date, iso(START - 12 * 24 * HOUR));
  assert.equal(payload.sources.find((entry) => entry.kind === 'steam').followUpdateStatus, 'unavailable');
  const h = harness({ now: START + 7 * HOUR }); h.load(payload.items, [producerTopic()]); follow(h);
  assert.equal(current(h).savedFollowState.follows[0].observations.filter((entry) => entry.kind === 'update').length, 0, 'stale patch evidence is not silently freshened by a new good price');
});

test('review pipeline: cross-game optional news response stays unavailable while verified price/release survive', async () => {
  const base = producerFetch();
  const payload = await collectGameSaleOffers({ topics: [producerTopic()], now: new Date(START),
    fetchImpl: (url) => url === steamUpdateSourceUrl(123) ? producerResponse(producerNews(999), url) : base(url) });
  assert.equal(payload.items[0].salePrice, 1000);
  assert.deepEqual(payload.items[0].followObservations.map((entry) => entry.kind), ['release']);
  assert.equal(payload.sources.find((entry) => entry.kind === 'steam').followUpdateStatus, 'unavailable');
});

test('review follow: cross-tab count sync preserves a focused hero jump link across rerender', () => {
  const localStorage = storage(); const a = harness({ localStorage }); const b = harness({ localStorage }); a.load(); b.load();
  const before = b.el('#game-hero-command').querySelectorAll('[data-game-jump="steam-123"]')[0];
  before.focus(); follow(a); b.syncStorage();
  assert.equal(b.document.activeElement?.getAttribute('data-game-jump'), 'steam-123');
  assert.equal(b.document.activeElement?.textContent, before.textContent);
});

test('review follow: explicit cross-tab clear remains authoritative if removing an older session shadow fails', () => {
  const localStorage = storage(); const sessionStorage = storage(); const h = harness({ localStorage, sessionStorage }); h.load([offer(), offer({ appId: 456, title: 'Other Quest' })]); follow(h);
  const key = h.c.GameFollowUtils.STORAGE_KEY;
  sessionStorage.setItem(key, localStorage.getItem(key));
  sessionStorage.removeItem = () => { throw new Error('session removal blocked'); };
  localStorage.clear(); h.syncStorage(null);
  assert.equal(current(h).savedFollowState.follows.length, 0);
  const reloaded = harness({ localStorage, sessionStorage }); reloaded.load();
  assert.equal(current(reloaded).savedFollowState.follows.length, 0, 'the authoritative empty tombstone also survives an actual store recreation');
  follow(h, 456);
  assert.deepEqual(Array.from(current(h).savedFollowState.follows, (entry) => entry.key), ['steam:456']);
  assert.deepEqual(JSON.parse(localStorage.getItem(key)).follows.map((entry) => entry.key), ['steam:456']);
});

test('review follow: the 50-game cap reports the true saved count rather than catalog size or a successful extra follow', () => {
  const follows = Array.from({ length: 50 }, (_, index) => ({ identity: { kind: 'steam', appId: 1000 + index }, title: `Saved Quest ${index}`,
    followedAt: iso(START - HOUR), observations: [], changes: [] }));
  const h = harness({ localStorage: storage({ 'internet-news-game-follows-v1': JSON.stringify({ version: 1, revision: 50, follows }) }) });
  h.load(); follow(h);
  assert.equal(current(h).savedFollowState.follows.length, 50);
  assert.match(h.el('#game-follow-status').textContent, /50作品をフォロー中.*フォローは50作品まで/);
  assert.match(h.el('#game-hero-stats').innerHTML, /50作品/);
  assert.match(h.el('#steam-sale-list').innerHTML, /data-game-follow="steam:123"/);
  assert.doesNotMatch(h.el('#game-follow-status').textContent, /追加しました/);
});

test('review follow: rejected latest offer evidence cannot leave the saved discount labeled current', () => {
  const h = harness(); h.load(); follow(h);
  for (const patch of [{ status: 'stale' }, { country: 'US' }, { articleUrls: ['https://example.com/unrelated'] }]) {
    h.load([offer(patch)]);
    assert.doesNotMatch(h.el('#game-follow-list').innerHTML, /<p>確認価格 1,000円/);
    assert.match(h.el('#game-follow-list').innerHTML, /前回確認.*1,000円/);
    assert.equal(changes(h).length, 0);
  }
});

test('review today: open tabs clear yesterday picks exactly at JST midnight', () => {
  const before = Date.parse('2026-10-06T14:59:59.500Z');
  const h = harness({ now: before });
  h.load([offer({ checkedAt: iso(before - 1000), freshUntil: iso(before + 5 * HOUR), priceValidUntil: iso(before + 23 * HOUR) })]);
  assert.equal(current(h).dashboardState.todayHighlights.length, 1);
  let timer;
  h.c.setTimeout = (callback, delay) => { timer = { callback, delay }; return 100; };
  h.c.scheduleOfferRefresh();
  assert.equal(timer.delay, 500);
  h.time(before + 500); timer.callback();
  assert.equal(current(h).dashboardState.todayHighlights.length, 0);
  assert.match(h.el('#game-hero-command').innerHTML, /今日分の確認情報はまだありません/);
});
