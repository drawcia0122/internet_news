import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { canonicalSaleArticleUrl, steamAppId, selectSaleArticles, extractArticleSteamApps, parseSteamPrice,
  collectGameSaleOffers, steamPriceSourceUrl, GAME_PRICE_FRESH_MS, GAME_PRICE_MAX_AGE_MS } from '../lib/game-sale-offers.mjs';
import { refreshGameSaleOffers } from '../scripts/fetch-game-sale-offers.mjs';
import { compareDatasets, inspectDataset, runGuardedRefresh, REFRESH_STAGE_FILES } from '../lib/refresh-health.mjs';

const NOW = new Date('2026-10-06T04:00:00.000Z');
const URL = 'https://automaton-media.com/articles/newsjp/sale-123';
const ARTICLE = { url: URL, title: 'Steam『The Outlast Trials』と『Getting Over It』のセール', publishedAt: '2026-10-04T08:00:00Z', topicId: 'roundup' };
const topic = (article = ARTICLE, extra = {}) => ({ id: article.topicId, category: 'games', title: article.title,
  sourceSignals: [{ title: article.title, url: article.url, publishedAt: article.publishedAt }], ...extra });
const paragraph = (title = 'The Outlast Trials', appId = 1304930) => `<p>『<strong>${title}</strong>』<br>税込450円/90％オフ（<a href="https://store.steampowered.com/app/${appId}/?utm_source=test">ストアページ</a>）</p>`;
const html = (contents = paragraph(), article = ARTICLE) => `<html><link rel="canonical" href="${article.url}/"><nav>${paragraph('Unrelated', 111)}</nav><section class="maintext">${contents}</section><aside>${paragraph('Unrelated sidebar', 222)}</aside></html>`;
const app = (appId = 1304930, fields = {}) => ({ [appId]: { success: true, data: { type: 'game', name: 'The Outlast Trials', steam_appid: appId,
  release_date: { coming_soon: false }, header_image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
  price_overview: { currency: 'JPY', initial: 450000, final: 45000, discount_percent: 90 }, ...fields } } });
const response = (value, url) => ({ ok: true, status: 200, url, text: async () => typeof value === 'string' ? value : JSON.stringify(value) });
const fetcher = (overrides = {}) => async (url) => response(overrides[url] ?? (url.includes('/api/') ? app(Number(new globalThis.URL(url).searchParams.get('appids'))) : html()), url);
const offer = (now = NOW) => parseSteamPrice(app(), 1304930, { now, articles: [ARTICLE] });
const previous = (checkedAt) => ({ items: [offer(new Date(checkedAt))], sources: [{ kind: 'article', url: URL, status: 'ok', checkedAt,
  candidates: [{ appId: 1304930, articleGameTitle: 'The Outlast Trials' }] }] });
const singleSaleArticle = { ...ARTICLE, title: 'Steam『The Outlast Trials』90%オフの450円、10月5日から10月8日まで' };
const singleSaleTopic = { ...topic(singleSaleArticle), sourceUrl: URL, publishedAt: ARTICLE.publishedAt };
const unavailableSources = (payload) => payload.sources.filter((source) => source.kind === 'steam' && source.status === 'unavailable');
const errorSources = (payload) => payload.sources.filter((source) => source.kind === 'steam' && source.status === 'error');
const unavailablePayload = (options = {}) => collectGameSaleOffers({ topics: [singleSaleTopic], now: NOW,
  fetchImpl: fetcher({ [steamPriceSourceUrl(1304930)]: { '1304930': { success: false } } }), ...options });

// Follow the emitted payload through the unchanged production consumer: the
// single-game article would otherwise revive an apparently active sale.
async function articleSaleCards(payload, now) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const context = { console, URL: globalThis.URL, Intl, Date: FixedDate, HomeDataUtils: {}, document: {
    querySelector: () => ({ innerHTML: '', querySelectorAll: () => [] }), createElement: () => ({}),
  } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(await readFile(new globalThis.URL('../shared-topic-utils.js', import.meta.url), 'utf8'), context);
  const source = (await readFile(new globalThis.URL('../game.js', import.meta.url), 'utf8'))
    .replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '')
    .replace(/\}\)\(\);\s*$/, 'window.buildSteamSales = buildSteamSales;})();');
  vm.runInContext(source, context);
  return context.buildSteamSales([singleSaleTopic], payload.items, payload.sources);
}

test('candidate articles require bounded current game-sale identity and known publishers', () => {
  const inputs = [topic(), topic({ ...ARTICLE, url: 'https://untrusted.example/sale' }), topic(ARTICLE, { category: 'books' }),
    topic({ ...ARTICLE, url: `${URL}-old`, publishedAt: '2026-09-20T00:00:00Z' }),
    topic({ ...ARTICLE, url: `${URL}-future`, publishedAt: '2026-10-07T00:00:00Z' }),
    topic({ ...ARTICLE, url: `${URL}-announcement`, title: 'Steamセールを来週開催予定' }),
    topic({ ...ARTICLE, url: `${URL}-no-sale`, title: 'Steam新作ゲーム登場' })];
  assert.deepEqual(selectSaleArticles(inputs, { now: NOW }), [ARTICLE]);
  assert.equal(canonicalSaleArticleUrl(`${URL}/?utm_source=test#fragment`), URL);
  assert.equal(canonicalSaleArticleUrl('https://user:pw@automaton-media.com/articles/newsjp/test'), '');
  assert.equal(canonicalSaleArticleUrl('https://automaton-media.com/tag/steam/'), '');
  assert.equal(canonicalSaleArticleUrl(`${URL}/?edition=deluxe`), '');
  assert.equal(canonicalSaleArticleUrl(`${URL}/?page=2`), '');
  const mismatch = topic();
  mismatch.sourceSignals[0].canonicalUrl = `${URL}-different`;
  assert.deepEqual(selectSaleArticles([mismatch], { now: NOW }), []);
});

test('Steam identities accept official HTTPS app URLs only, never searches/subs/bundles', () => {
  assert.equal(steamAppId('https://store.steampowered.com/app/1304930/name/?utm=1'), 1304930);
  for (const url of ['https://store.steampowered.com/search/?term=1304930', 'https://store.steampowered.com/sub/1304930/',
    'https://store.steampowered.com/bundle/1304930/', 'https://store.steampowered.com.evil.example/app/1304930/',
    'http://store.steampowered.com/app/1304930/', 'https://user:pass@store.steampowered.com/app/1304930/']) assert.equal(steamAppId(url), null);
});

test('roundup extraction joins one exact game paragraph to one app and ignores unrelated markup', () => {
  const content = paragraph('A different game', 55) + paragraph() + paragraph('Getting Over It with Bennett Foddy', 240720);
  const result = extractArticleSteamApps(html(content), ARTICLE);
  assert.deepEqual(result.map((r) => r.appId), [1304930, 240720, 55]);
  assert.equal(result[1].articleGameTitle, 'Getting Over It with Bennett Foddy');
});

test('article canonical identity, exact section identity and edition ambiguity fail closed', () => {
  assert.throws(() => extractArticleSteamApps(html().replace(`${URL}/`, `${URL}-wrong/`), ARTICLE), /identity/);
  assert.throws(() => extractArticleSteamApps(html().replace('maintext', 'related'), ARTICLE), /body/);
  const ambiguous = '<p>『<strong>Two games</strong>』450円 <a href="https://store.steampowered.com/app/11/">one</a><a href="https://store.steampowered.com/app/12/">two</a></p>';
  const noTitle = '<p>450円 <a href="https://store.steampowered.com/app/77/">store</a></p>';
  assert.deepEqual(extractArticleSteamApps(html(ambiguous + noTitle + paragraph('Game Deluxe Edition', 13) + paragraph('Game DLC', 14)), ARTICLE), []);
});

test('Denfami articleBody excludes recommendations and maps linked exact game title', () => {
  const article = { ...ARTICLE, url: 'https://news.denfaminicogamer.jp/news/2610052q' };
  const body = `<link rel="canonical" href="${article.url}"><div id="articleBody"><p>Steamの『<a href="https://store.steampowered.com/app/814380/"><strong>SEKIRO: SHADOWS DIE TWICE</strong></a>』セールが開催中、4180円</p><aside>${paragraph()}</aside></div>`;
  assert.deepEqual(extractArticleSteamApps(body, article), [{ appId: 814380, articleGameTitle: 'SEKIRO: SHADOWS DIE TWICE' }]);
});

test('JPY price pair comes from integer official amounts, never headline or rounded discount math', () => {
  const result = offer();
  assert.equal(result.regularPrice, 4500);
  assert.equal(result.salePrice, 450);
  assert.equal(result.discountPercent, 90);
  assert.equal(result.checkedAt, NOW.toISOString());
  assert.equal(Date.parse(result.freshUntil) - NOW.getTime(), GAME_PRICE_FRESH_MS);
  assert.equal(Date.parse(result.priceValidUntil) - NOW.getTime(), GAME_PRICE_MAX_AGE_MS);
  assert.equal(result.featuredInArticle, true);
  const rise = parseSteamPrice(app(1446780, { price_overview: { currency: 'JPY', initial: 399000, final: 39900, discount_percent: 90 } }), 1446780, { now: NOW });
  assert.equal(rise.regularPrice, 3990);
  assert.equal(rise.salePrice, 399);
});

test('wrong identity, currency, edition, release state and malformed prices are excluded', () => {
  for (const fields of [{ steam_appid: 123 }, { type: 'dlc' }, { release_date: { coming_soon: true } }, { release_date: {} },
    { price_overview: undefined }, { price_overview: { currency: 'USD', initial: 450000, final: 45000, discount_percent: 90 } },
    ...[{ initial: 450001 }, { final: 0 }, { final: 460000 }, { discount_percent: 0 }, { discount_percent: 50 }, { discount_percent: 90.1 }]
      .map((p) => ({ price_overview: { currency: 'JPY', initial: 450000, final: 45000, discount_percent: 90, ...p } }))]) {
    assert.throws(() => parseSteamPrice(app(1304930, fields), 1304930));
  }
  assert.equal(parseSteamPrice(app(1304930, { header_image: 'https://publisher.example/roundup.jpg' }), 1304930).thumbnailUrl, null);
  assert.equal(parseSteamPrice(app(1304930, { header_image: 'https://shared.akamai.steamstatic.com/steam/apps/999/header.jpg' }), 1304930).thumbnailUrl, null);
});

test('a verified non-discounted price is an ended outcome, not a current sale', () => {
  const result = parseSteamPrice(app(1304930, { price_overview: { currency: 'JPY', initial: 450000, final: 450000, discount_percent: 0 } }), 1304930);
  assert.equal(result.status, 'ended');
  assert.equal(result.regularPrice, result.salePrice);
});

test('collection fetches article and each app only once and records official sources', async () => {
  const calls = [];
  const payload = await collectGameSaleOffers({ topics: [topic(), topic()], now: NOW, fetchImpl: async (url) => { calls.push(url); return fetcher()(url); } });
  assert.equal(payload.items.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(payload.items[0].priceSource.url, steamPriceSourceUrl(1304930));
  assert.deepEqual(payload.items[0].articleUrls, [URL]);
  assert.equal(payload.items[0].articles[0].gameTitle, 'The Outlast Trials');
  assert.equal(payload.status, 'ok');
});

test('cache freshness does not advance successful price or article timestamps', async () => {
  const checkedAt = '2026-10-06T03:00:00.000Z';
  const result = await collectGameSaleOffers({ topics: [topic()], previous: previous(checkedAt), now: NOW, fetchImpl: () => { throw Error('should use cache'); } });
  assert.equal(result.items[0].status, 'cached');
  assert.equal(result.items[0].checkedAt, checkedAt);
  assert.equal(result.sources[0].checkedAt, checkedAt);
});

test('network failure keeps only recent verified history and marks it stale without invented freshness', async () => {
  const checkedAt = '2026-10-05T20:00:00.000Z';
  const result = await collectGameSaleOffers({ topics: [topic()], previous: previous(checkedAt), now: NOW, fetchImpl: () => { throw Error('offline'); } });
  assert.equal(result.items[0].status, 'stale');
  assert.equal(result.items[0].checkedAt, checkedAt);
  assert.equal(result.status, 'partial');
  const expired = await collectGameSaleOffers({ topics: [topic()], previous: previous('2026-10-04T00:00:00.000Z'), now: NOW, fetchImpl: () => { throw Error('offline'); } });
  assert.deepEqual(expired.items, []);
  const future = await collectGameSaleOffers({ topics: [topic()], previous: previous('2026-10-07T00:00:00.000Z'), now: NOW, fetchImpl: () => { throw Error('offline'); } });
  assert.deepEqual(future.items, []);
});

test('a new official non-sale or unavailable response never resurrects an old discount', async () => {
  const old = previous('2026-10-05T20:00:00.000Z');
  for (const official of [{ '1304930': { success: false } }, app(1304930, { price_overview: undefined }), app(1304930, { type: 'dlc' })]) {
    const result = await collectGameSaleOffers({ topics: [topic()], previous: old, now: NOW,
      fetchImpl: fetcher({ [steamPriceSourceUrl(1304930)]: official }) });
    assert.deepEqual(result.items, []);
    assert.equal(result.sources.at(-1).status, 'unavailable');
    assert.deepEqual(result.sources.at(-1).articleUrls, [URL]);
  }
  const ended = await collectGameSaleOffers({ topics: [topic()], previous: old, now: NOW,
    fetchImpl: fetcher({ [steamPriceSourceUrl(1304930)]: app(1304930, { price_overview: { currency: 'JPY', initial: 450000, final: 450000, discount_percent: 0 } }) }) });
  assert.equal(ended.items[0].status, 'ended');
  assert.equal(ended.items[0].salePrice, 4500);
});

test('consecutive outages preserve recent official unavailability without renewing its timestamp', async () => {
  let prior = await unavailablePayload();
  assert.equal((await articleSaleCards({ items: [], sources: [] }, NOW)).length, 1, 'the fixture has an article-only sale fallback');
  assert.equal((await articleSaleCards(prior, NOW)).length, 0);
  for (const offset of [30 * 60 * 1000, 2 * 60 * 60 * 1000, GAME_PRICE_FRESH_MS - 1]) {
    const now = new Date(NOW.getTime() + offset);
    const next = await collectGameSaleOffers({ topics: [singleSaleTopic], previous: prior, now,
      fetchImpl: async () => { throw new Error('network down'); } });
    assert.deepEqual(next.items, []);
    assert.equal(unavailableSources(next).length, 1);
    assert.equal(unavailableSources(next)[0].attemptedAt, NOW.toISOString());
    assert.deepEqual(unavailableSources(next)[0].articleUrls, [URL]);
    assert.equal(errorSources(next).length, 1);
    assert.equal(errorSources(next)[0].attemptedAt, now.toISOString());
    assert.equal(next.status, 'unavailable', 'the failure must not be disguised as a successful cache hit');
    const health = inspectDataset('game-sale-offers.json', next, { now });
    assert.equal(health.valid, true);
    assert.ok(health.issues.some((issue) => issue.code === 'source_failures'));
    assert.equal((await articleSaleCards(next, now)).length, 0, 'an outage cannot resurrect the article discount');
    prior = next;
  }
  const now = new Date(NOW.getTime() + GAME_PRICE_FRESH_MS);
  const expired = await collectGameSaleOffers({ topics: [singleSaleTopic], previous: prior, now,
    fetchImpl: async () => { throw new Error('still offline'); } });
  assert.deepEqual(unavailableSources(expired), [], 'the six-hour limit is exclusive despite repeated failed attempts');
  assert.equal(errorSources(expired)[0].attemptedAt, now.toISOString());
  assert.equal((await articleSaleCards(expired, now)).length, 1);
});

test('only non-authoritative failures may carry a prior unavailable observation', async () => {
  const prior = await unavailablePayload();
  const now = new Date(NOW.getTime() + 30 * 60 * 1000);
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async (url) => ({ ...response('', url), ok: false, status: 503 }),
    async (url) => response('not JSON', url),
    async (url) => response({ unexpected: true }, url),
  ]) {
    const result = await collectGameSaleOffers({ topics: [singleSaleTopic], previous: prior, now, fetchImpl });
    assert.deepEqual(unavailableSources(result), unavailableSources(prior));
    assert.equal(errorSources(result).length, 1);
  }
  for (const official of [app(), app(1304930, { price_overview: { currency: 'JPY', initial: 450000, final: 450000, discount_percent: 0 } })]) {
    const result = await collectGameSaleOffers({ topics: [singleSaleTopic], previous: prior, now,
      fetchImpl: fetcher({ [steamPriceSourceUrl(1304930)]: official }) });
    assert.deepEqual(unavailableSources(result), []);
    assert.deepEqual(errorSources(result), []);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].checkedAt, now.toISOString());
    assert.equal(result.status, 'ok');
    const failedLater = await collectGameSaleOffers({ topics: [singleSaleTopic], previous: result,
      now: new Date(now.getTime() + 30 * 60 * 1000), force: true, fetchImpl: async () => { throw new Error('offline again'); } });
    assert.deepEqual(unavailableSources(failedLater), [], 'an older negative observation cannot return after a successful price');
  }
  const replaced = await unavailablePayload({ previous: prior, now });
  assert.equal(unavailableSources(replaced).length, 1);
  assert.equal(unavailableSources(replaced)[0].attemptedAt, now.toISOString(), 'a new authoritative negative response replaces the old observation');
  assert.deepEqual(errorSources(replaced), []);
});

test('retained unavailable evidence requires exact app, Japanese API, timestamp and article provenance', async () => {
  const prior = await unavailablePayload();
  const original = unavailableSources(prior)[0];
  const now = new Date(NOW.getTime() + 30 * 60 * 1000);
  const invalid = [null, {},
    { ...original, kind: 'article' }, { ...original, status: 'error' }, { ...original, status: 'ok' },
    ...['1304930', 999, -1, 0, 1.5].map((appId) => ({ ...original, appId })),
    ...[undefined, null, '', 'invalid', [NOW.toISOString()], '2026-10-06T04:30:00.001Z',
      new Date(now.getTime() - GAME_PRICE_FRESH_MS).toISOString()].map((attemptedAt) => ({ ...original, attemptedAt })),
    ...[steamPriceSourceUrl(999), steamPriceSourceUrl(1304930).replace('cc=jp', 'cc=us'),
      steamPriceSourceUrl(1304930).replace('l=japanese', 'l=english'),
      steamPriceSourceUrl(1304930).replace('https:', 'http:'),
      steamPriceSourceUrl(1304930).replace('store.steampowered.com', 'store.steampowered.com.evil.test'),
      steamPriceSourceUrl(1304930).replace('https://', 'https://user:pass@'),
      `${steamPriceSourceUrl(1304930)}&appids=999`].map((url) => ({ ...original, url })),
    ...[undefined, null, URL, {}, [], [null], [URL, null], [URL, ''], [`${URL}-different`],
      ['https://untrusted.example/article'], [`${URL}?edition=other`], [`${URL}?utm_source=test`]]
      .map((articleUrls) => ({ ...original, articleUrls })),
  ];
  for (const source of invalid) {
    const result = await collectGameSaleOffers({ topics: [singleSaleTopic], now,
      previous: { ...prior, sources: [prior.sources[0], source] }, fetchImpl: async () => { throw new Error('offline'); } });
    assert.deepEqual(unavailableSources(result), [], JSON.stringify(source));
    assert.equal(errorSources(result).length, 1);
  }
  const zeroAge = await collectGameSaleOffers({ topics: [singleSaleTopic], previous: prior, now: NOW,
    fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(unavailableSources(zeroAge).length, 1, 'the zero-age boundary is inclusive');
});

test('retention never expands an unavailable observation to newly associated articles', async () => {
  const secondArticle = { ...singleSaleArticle, url: `${URL}-second`, topicId: 'second' };
  const prior = await unavailablePayload();
  const now = new Date(NOW.getTime() + 30 * 60 * 1000);
  const result = await collectGameSaleOffers({ topics: [singleSaleTopic, topic(secondArticle)], previous: prior, now,
    fetchImpl: async (url) => {
      if (url.includes('/api/')) throw new Error('offline');
      return response(html(paragraph(), secondArticle), url);
    } });
  assert.deepEqual(unavailableSources(result)[0].articleUrls, [URL]);
  assert.deepEqual(errorSources(result)[0].articleUrls, [URL, secondArticle.url]);
  const onlyNewArticle = await collectGameSaleOffers({ topics: [topic(secondArticle)], previous: result, now,
    fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(unavailableSources(onlyNewArticle), [], 'a different current article has no prior negative provenance');
});

test('guarded refresh publishes retained unavailability and a truthful warning while later stages continue', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'game-price-negative-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, 'trend-topics.json');
  const outputPath = join(directory, 'game-sale-offers.json');
  const now = new Date(NOW.getTime() + 30 * 60 * 1000);
  await writeFile(inputPath, JSON.stringify({ generatedAt: now.toISOString(), items: [singleSaleTopic] }));
  await writeFile(outputPath, JSON.stringify(await unavailablePayload()));
  let laterStageRan = false;
  const report = await runGuardedRefresh([
    { name: 'game-sale-offers', run: () => refreshGameSaleOffers({ inputPath, outputPath, now,
      fetchImpl: async () => { throw new Error('network down'); } }) },
    { name: 'matome', run: async () => {
      laterStageRan = true;
      await writeFile(join(directory, 'matome-threads.json'), JSON.stringify({ generatedAt: now.toISOString(), items: [] }));
    } },
  ], { dataDirectory: directory, now: () => now, logger: { log() {}, warn() {}, error() {} } });
  const published = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(report.stages[0].status, 'ok');
  assert.equal(report.status, 'warning');
  assert.equal(laterStageRan, true);
  assert.equal(published.generatedAt, now.toISOString());
  assert.equal(unavailableSources(published)[0].attemptedAt, NOW.toISOString());
  assert.equal(errorSources(published)[0].attemptedAt, now.toISOString());
  assert.ok(report.datasets['game-sale-offers.json'].issues.some((issue) => issue.code === 'source_failures'));
  assert.equal((await articleSaleCards(published, now)).length, 0);
});

test('tampered cached offers cannot keep invalid amounts or non-official price origins', async () => {
  for (const tamper of [{ currency: 'USD' }, { regularPrice: 45 }, { priceSource: { kind: 'steam-appdetails', url: 'https://evil.example' } }, { id: 'steam:999' }, { freshUntil: 'bad' }, { priceValidUntil: '2026-12-01T00:00:00Z' },
    { regularPrice: '4500' }, { storeUrl: 'https://store.steampowered.com/app/999/' }, { status: 'ended' }]) {
    const old = previous('2026-10-05T20:00:00.000Z');
    Object.assign(old.items[0], tamper);
    const result = await collectGameSaleOffers({ topics: [topic()], previous: old, now: NOW, fetchImpl: () => { throw Error('offline'); } });
    assert.deepEqual(result.items, []);
  }
});

test('enrichment respects article/app budgets and does not fetch unrelated articles', async () => {
  const calls = [];
  const result = await collectGameSaleOffers({ topics: [topic(), topic({ ...ARTICLE, url: `${URL}-2` })], now: NOW, maxArticles: 1, maxApps: 1,
    fetchImpl: async (url) => { calls.push(url); return response(url.includes('/api/') ? app() : html(paragraph() + paragraph('Other', 33)), url); } });
  assert.equal(result.items.length, 1);
  assert.equal(calls.length, 2);
});

test('bounded response reader rejects oversized documents', async () => {
  const result = await collectGameSaleOffers({ topics: [topic()], now: NOW, fetchImpl: async (url) => ({ ...response('', url), headers: { get: () => 3000000 } }) });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.sources[0].error, 'response_too_large');
});

test('reproducible refresh writes only its separate payload and preserves existing feed bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'game-prices-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, 'trend-topics.json');
  const outputPath = join(directory, 'game-sale-offers.json');
  const input = JSON.stringify({ items: [topic()] });
  await writeFile(inputPath, input);
  const result = await refreshGameSaleOffers({ inputPath, outputPath, now: NOW, fetchImpl: fetcher() });
  assert.equal(result.written, true);
  assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).items[0].salePrice, 450);
  assert.equal(await readFile(inputPath, 'utf8'), input);
});

test('sale expiry is allowed by refresh health, and enrichment is registered in sequential refresh', async () => {
  const before = { generatedAt: '2026-10-06T03:00:00Z', items: Array.from({ length: 30 }, (_, i) => ({ title: `game ${i}` })) };
  const after = { generatedAt: NOW.toISOString(), items: [] };
  assert.equal(compareDatasets('game-sale-offers.json', before, after, { now: NOW }).valid, true);
  assert.deepEqual(REFRESH_STAGE_FILES['game-sale-offers'], ['game-sale-offers.json']);
  const script = await readFile(new globalThis.URL('../scripts/refresh-data.mjs', import.meta.url), 'utf8');
  assert.ok(script.indexOf("name: 'trend'") < script.indexOf("name: 'game-sale-offers'"));
});
