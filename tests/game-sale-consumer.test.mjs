import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the production consumer without importing its browser-only startup.
// Prices in these deterministic fixtures are examples, never live store claims.
const NOW = '2026-10-06T04:00:00Z';
const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const ARTICLE_URL = 'https://example.com/articles/sale?id=ONE';
const TITLE = '『Example Quest』Steamで50%オフの1,000円、10月5日から10月8日まで';

function harness(now = NOW) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const elements = new Map();
  const context = { console, URL, Intl, Date: FixedDate, document: {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { innerHTML: '', querySelectorAll: () => [] });
      return elements.get(selector);
    },
    createElement() { return { set innerHTML(value) { this.value = value; }, get innerHTML() { return this.textContent ?? this.value; } }; },
  } };
  context.window = context;
  context.HomeDataUtils = {};
  vm.createContext(context);
  vm.runInContext(UTILS, context);
  let source = SOURCE.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const functions = [...source.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((match) => match[1]);
  source = source.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${functions.join(',')}, setState: (state) => { dashboardState = state; } });})();`);
  vm.runInContext(source, context);
  return { c: context, elements };
}

function article(extra = {}) {
  return {
    id: 'example-sale', title: TITLE, categories: ['games'], publishedAt: '2026-10-06T02:00:00Z',
    sourceUrl: ARTICLE_URL,
    sourceSignals: [{ title: TITLE, url: ARTICLE_URL, publishedAt: '2026-10-06T02:00:00Z' }],
    ...extra,
  };
}
function offer(extra = {}) {
  return {
    appId: 123, title: 'Example Quest', store: 'Steam', country: 'JP', currency: 'JPY', edition: 'base-game',
    regularPrice: 2000, salePrice: 1000, discountPercent: 50,
    storeUrl: 'https://store.steampowered.com/app/123/?cc=jp&l=japanese',
    priceSource: { kind: 'steam-appdetails', name: 'Steam Store API', url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp&l=japanese' },
    articleUrls: [ARTICLE_URL], articles: [{ title: TITLE, url: ARTICLE_URL, publishedAt: '2026-10-06T02:00:00Z', topicId: 'example-sale', gameTitle: 'Example Quest' }],
    checkedAt: '2026-10-06T03:00:00Z', freshUntil: '2026-10-06T09:00:00Z', priceValidUntil: '2026-10-07T03:00:00Z',
    status: 'verified', endsAt: null,
    ...extra,
  };
}
function dashboard(c, topics, offers) {
  return c.buildDashboardState(topics, [], { generatedAt: NOW, saleOffers: offers });
}

function officialCards(cards) { return cards.filter((card) => card.storeUrl); }

test('malformed optional sale-feed records never break the rest of the dashboard', () => {
  const { c } = harness();
  for (const bad of [null, {}, offer({ articleUrls: ARTICLE_URL }), offer({ articleUrls: {} }), offer({ articleUrls: [null, {}] })]) {
    let result;
    assert.doesNotThrow(() => { result = dashboard(c, [article()], [bad]); }, JSON.stringify(bad));
    assert.ok(result, 'other game sections still receive a dashboard');
    assert.equal(officialCards(result.steamSales).length, 0, JSON.stringify(bad));
  }
});

test('offer provenance cannot bypass a rejected named source using the topic fallback URL', () => {
  const { c } = harness();
  const mismatched = article({ sourceSignals: [{ title: 'Different article', url: ARTICLE_URL }] });
  assert.equal(c.articleSource(mismatched), null);
  assert.equal(officialCards(c.buildSteamSales([mismatched], [offer()])).length, 0);
  const wrongQuery = article({ sourceSignals: [{ title: TITLE, url: ARTICLE_URL.replace('ONE', 'TWO') }] });
  assert.equal(c.articleSource(wrongQuery), null);
  assert.equal(officialCards(c.buildSteamSales([wrongQuery], [offer()])).length, 0);
});

test('canonical article aliases attach only to the matching canonical source', () => {
  const { c } = harness();
  const source = article({ sourceSignals: [{ title: TITLE, url: 'https://example.com/redirect', canonicalUrl: ARTICLE_URL }] });
  assert.ok(c.articleSource(source));
  assert.equal(officialCards(c.buildSteamSales([source], [offer()])).length, 1);
  assert.equal(officialCards(c.buildSteamSales([source], [offer({ articleUrls: [ARTICLE_URL.replace('ONE', 'TWO')] })])).length, 0);
  const tracked = article({ sourceUrl: `${ARTICLE_URL}&utm_source=mail`, sourceSignals: [{ title: TITLE, url: ARTICLE_URL }] });
  assert.equal(officialCards(c.buildSteamSales([tracked], [offer()])).length, 1);
});

test('unknown statuses and invalid freshness declarations cannot produce active official sales', () => {
  const { c } = harness();
  for (const change of [
    { status: 'unexpected' }, { status: null }, { freshUntil: 'not-a-date' },
    { freshUntil: '2026-10-06T02:00:00Z' }, { priceValidUntil: 'not-a-date' },
    { checkedAt: '2026-10-06T04:00:01Z' },
  ]) {
    assert.ok(officialCards(c.buildSteamSales([article()], [offer(change)])).every((item) => item.status !== 'active'), JSON.stringify(change));
  }
});

test('the freshness declaration can shorten but never extend the six-hour current-price window', () => {
  const { c } = harness();
  const short = c.verifiedSaleCard(offer({ freshUntil: NOW }), [article()]);
  assert.ok(!short || short.status !== 'active', 'the freshness boundary is half-open');
  const later = harness('2026-10-06T09:00:00Z').c.verifiedSaleCard(offer({ freshUntil: '2026-10-07T03:00:00Z' }), [article()]);
  assert.ok(!later || later.status !== 'active', 'a malformed long freshUntil cannot expand the hard cap');
  assert.equal(harness('2026-10-07T03:00:00Z').c.verifiedSaleCard(offer(), [article()]), null, 'the retention boundary is half-open');
});

test('an explicit ended official offer is never promoted back into a current discount', () => {
  const { c } = harness();
  const item = c.verifiedSaleCard(offer({ status: 'ended' }), [article()]);
  assert.ok(!item || item.status === 'ended');
  const result = dashboard(c, [article()], [offer({ status: 'ended', endsAt: '2026-10-06T05:00:00Z' })]);
  assert.equal(result.totals.endingSoonSaleCount, 0);
  assert.equal(result.importantItems.filter((item) => /セール終了/.test(item.title)).length, 0);
});

test('a current zero-discount API observation suppresses the older article sale claim', () => {
  const { c } = harness();
  const fullPrice = offer({ regularPrice: 2000, salePrice: 2000, discountPercent: 0, status: 'ended' });
  const result = dashboard(c, [article()], [fullPrice]);
  assert.ok(result.steamSales.every((item) => item.status !== 'active' && item.status !== 'unknown'));
  assert.equal(result.totals.endingSoonSaleCount, 0);
  assert.equal(result.importantItems.length, 0);
});

test('newer no-discount observations win over older discounted duplicates regardless of order', () => {
  const { c } = harness();
  const oldSale = offer({ checkedAt: '2026-10-06T02:30:00Z', freshUntil: '2026-10-06T08:30:00Z', priceValidUntil: '2026-10-07T02:30:00Z' });
  const fullPrice = offer({ regularPrice: 2000, salePrice: 2000, discountPercent: 0, status: 'ended' });
  for (const offers of [[oldSale, fullPrice], [fullPrice, oldSale]]) {
    const items = c.buildSteamSales([article()], offers);
    assert.ok(items.every((item) => item.status !== 'active' && item.status !== 'unknown'));
  }
});

test('newest verified price wins over duplicate app snapshots independent of feed ordering', () => {
  const { c } = harness();
  const older = offer({ checkedAt: '2026-10-06T02:30:00Z', freshUntil: '2026-10-06T08:30:00Z', priceValidUntil: '2026-10-07T02:30:00Z', salePrice: 500, discountPercent: 75 });
  for (const offers of [[older, offer()], [offer(), older]]) {
    const items = officialCards(c.buildSteamSales([article()], offers));
    assert.equal(items.length, 1);
    assert.equal(items[0].salePrice, 1000);
  }
});

test('base-game cards reject other currencies, editions, apps and ambiguous API requests', () => {
  const { c } = harness();
  for (const change of [
    { edition: 'deluxe' }, { edition: 'bundle' }, { country: 'US' }, { currency: 'USD' },
    { appId: '123' }, { appId: 0 }, { salePrice: 1000.5 }, { regularPrice: 0 },
    { storeUrl: 'https://store.steampowered.com/app/1234/' },
    { priceSource: { url: 'https://store.steampowered.com/api/appdetails?appids=456&cc=jp' } },
    { priceSource: { url: 'https://store.steampowered.com/api/appdetails?appids=123,456&cc=jp' } },
    { priceSource: { url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=us' } },
    { priceSource: { url: 'https://store.steampowered.com.evil.test/api/appdetails?appids=123&cc=jp' } },
  ]) assert.equal(c.verifiedSaleCard(offer(change), [article()]), null, JSON.stringify(change));
});

test('source future-publication and missing publication cannot become verified current actions', () => {
  const { c } = harness();
  for (const publishedAt of ['2026-10-07T02:00:00Z', 'not-a-date', null]) {
    const topic = article({ publishedAt, sourceSignals: [{ title: TITLE, url: ARTICLE_URL, publishedAt }] });
    assert.equal(c.verifiedSaleCard(offer(), [topic]), null, String(publishedAt));
  }
});

test('failed verification preserves an article whose original price is unknown', () => {
  const { c, elements } = harness();
  const result = dashboard(c, [article()], [offer({ currency: 'USD' })]);
  assert.equal(result.steamSales.length, 1);
  assert.equal(result.steamSales[0].regularPrice, null);
  assert.equal(result.steamSales[0].salePrice, 1000);
  c.setState(result);
  c.renderSteamSales();
  const html = elements.get('#steam-sale-list').innerHTML;
  assert.match(html, /未確認/);
  assert.match(html, /1,000円/);
  assert.doesNotMatch(html, /2,000円/);
});

test('one authoritative no-discount result suppresses every associated article, not just the first', () => {
  const { c } = harness();
  const secondUrl = 'https://example.com/articles/second';
  const second = article({ id: 'second-sale', sourceUrl: secondUrl, sourceSignals: [{ title: TITLE, url: secondUrl, publishedAt: '2026-10-06T02:00:00Z' }] });
  const fullPrice = offer({ regularPrice: 2000, salePrice: 2000, discountPercent: 0, status: 'ended', articleUrls: [ARTICLE_URL, secondUrl],
    articles: [
      { title: TITLE, url: ARTICLE_URL, publishedAt: '2026-10-06T02:00:00Z', topicId: 'example-sale', gameTitle: 'Example Quest' },
      { title: TITLE, url: secondUrl, publishedAt: '2026-10-06T02:00:00Z', topicId: 'second-sale', gameTitle: 'Example Quest' },
    ] });
  for (const topics of [[article(), second], [second, article()]]) {
    const result = dashboard(c, topics, [fullPrice]);
    assert.ok(result.steamSales.every((item) => item.status !== 'active' && item.status !== 'unknown'));
  }
});

test('one official game price does not coexist with a conflicting older claim from another associated article', () => {
  const { c } = harness();
  const secondUrl = 'https://example.com/articles/second';
  const secondTitle = TITLE.replace('1,000円', '900円');
  const second = article({ id: 'second-sale', title: secondTitle, sourceUrl: secondUrl, sourceSignals: [{ title: secondTitle, url: secondUrl, publishedAt: '2026-10-06T02:00:00Z' }] });
  const price = offer({ articleUrls: [ARTICLE_URL, secondUrl], articles: [
    { title: TITLE, url: ARTICLE_URL, publishedAt: '2026-10-06T02:00:00Z', topicId: 'example-sale', gameTitle: 'Example Quest' },
    { title: secondTitle, url: secondUrl, publishedAt: '2026-10-06T02:00:00Z', topicId: 'second-sale', gameTitle: 'Example Quest' },
  ] });
  const cards = c.buildSteamSales([article(), second], [price]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].salePrice, 1000);
});

function unavailable(extra = {}) {
  return { kind: 'steam', status: 'unavailable', appId: 123,
    url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp&l=japanese',
    attemptedAt: '2026-10-06T03:00:00Z', articleUrls: [ARTICLE_URL], ...extra };
}

test('recent authoritative unavailability suppresses a prior article price and stays in normal news', () => {
  const { c } = harness();
  assert.equal(c.buildSteamSales([article()], [], [unavailable()]).length, 0);
  const result = c.buildDashboardState([article()], [], { generatedAt: NOW, saleOffers: [], saleSources: [unavailable()] });
  assert.equal(result.steamSales.length, 0, 'the dashboard threads diagnostic sources through to the consumer');
  assert.ok([...result.steamStories, ...result.newsItems].some((item) => item.topicId === 'example-sale' || item.key === 'example-sale'));
  const canonical = article({ sourceSignals: [{ title: TITLE, url: 'https://example.com/redirect', canonicalUrl: ARTICLE_URL }] });
  assert.equal(c.buildSteamSales([canonical], [], [unavailable()]).length, 0);
});

test('network errors, stale diagnostics and malformed provenance cannot suppress an article sale', () => {
  const { c } = harness();
  for (const change of [
    { status: 'error' }, { status: 'ok' }, { kind: 'article' }, { appId: '123' },
    { attemptedAt: '2026-10-06T04:00:01Z' }, { attemptedAt: '2026-10-05T22:00:00Z' }, { attemptedAt: 'invalid' },
    { articleUrls: ARTICLE_URL }, { articleUrls: [null] }, { articleUrls: [ARTICLE_URL.replace('ONE', 'TWO')] },
    { url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=us' },
    { url: 'https://store.steampowered.com/api/appdetails?appids=456&cc=jp' },
    { url: 'https://evil.test/api/appdetails?appids=123&cc=jp' },
    { url: 'https://user:password@store.steampowered.com/api/appdetails?appids=123&cc=jp' },
  ]) {
    let items;
    assert.doesNotThrow(() => { items = c.buildSteamSales([article()], [], [unavailable(change)]); }, JSON.stringify(change));
    assert.equal(items.length, 1, JSON.stringify(change));
    assert.equal(items[0].priceState, 'article');
  }
});
