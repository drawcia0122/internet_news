import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectGameSaleOffers, parseSteamPrice, parseSteamDeadline, verifiedSteamDeadline,
  steamPriceSourceUrl, steamDeadlineSourceUrl, GAME_PRICE_FRESH_MS, GAME_PRICE_MAX_AGE_MS } from '../lib/game-sale-offers.mjs';
import { refreshGameSaleOffers } from '../scripts/fetch-game-sale-offers.mjs';

// Structure independently checked against the public official responses for
// app 240720 / package 201019 on 2026-10-06. Deliberately excludes bundles.
const NOW = new Date('2026-10-06T15:00:00.000Z');
const END = '2026-10-08T17:00:00.000Z';
const ID = 240720;
const PACKAGE = 201019;
const TITLE = 'Getting Over It with Bennett Foddy';
const ARTICLE_URL = 'https://automaton-media.com/articles/newsjp/deadline-fixture';
const TOPIC = { id: 'sale', category: 'games', title: `Steam『${TITLE}』セール`, sourceSignals: [{
  title: `Steam『${TITLE}』セール`, url: ARTICLE_URL, publishedAt: '2026-10-06T10:00:00.000Z',
}] };
const ARTICLE_HTML = `<link rel="canonical" href="${ARTICLE_URL}/"><section class="maintext"><p>『<strong>${TITLE}</strong>』セール <a href="https://store.steampowered.com/app/${ID}/">Steam</a></p></section>`;
const pricePayload = () => ({ [ID]: { success: true, data: {
  steam_appid: ID, name: TITLE, type: 'game', release_date: { coming_soon: false },
  price_overview: { currency: 'JPY', initial: 82000, final: 12300, discount_percent: 85 },
  packages: [PACKAGE], package_groups: [{ name: 'default', is_recurring_subscription: 'false', subs: [{
    packageid: PACKAGE, option_text: `${TITLE} - <span class="discount_original_price">¥ 820</span> ¥ 123`,
    price_in_cents_with_discount: 12300, is_free_license: false, can_get_free_license: '0',
  }] }],
} } });
const option = () => ({ packageid: PACKAGE, purchase_option_name: TITLE,
  original_price_in_cents: '82000', final_price_in_cents: '12300', discount_pct: 85,
  included_game_count: 1, package_group: 'default', must_purchase_as_set: false,
  hide_discount_pct_for_compliance: false, price_cannot_be_displayed_as_discount: false,
  active_discounts: [{ discount_amount: '69700', discount_end_date: Date.parse(END) / 1000 }],
});
const deadlinePayload = () => ({ response: { store_items: [{
  item_type: 0, id: ID, appid: ID, success: 1, visible: true, name: TITLE, type: 0,
  best_purchase_option: option(), purchase_options: [option()],
}] } });
const offer = (now = NOW, payload = pricePayload()) => parseSteamPrice(payload, ID, { now });
const fullOffer = (now = NOW) => { const item = offer(now); return { ...item, ...parseSteamDeadline(deadlinePayload(), item, pricePayload()) }; };
const response = (value, url) => ({ ok: true, status: 200, url, text: async () => typeof value === 'string' ? value : JSON.stringify(value) });
const collect = (options = {}) => collectGameSaleOffers({ topics: [TOPIC], now: NOW, fetchImpl: async (url) => {
  if (url === steamPriceSourceUrl(ID)) return response(pricePayload(), url);
  if (url === steamDeadlineSourceUrl(ID)) return response(deadlinePayload(), url);
  assert.equal(url, `${ARTICLE_URL}/`);
  return response(ARTICLE_HTML, url);
}, ...options });
const noDeadline = { endsAt: null, deadlineSource: null };

test('official exact app/package JP offer proves a Unix-second deadline, never cache expiry', () => {
  const item = fullOffer();
  assert.equal(item.endsAt, END);
  assert.equal(verifiedSteamDeadline(item), true);
  assert.equal(item.deadlineSource.packageId, PACKAGE);
  assert.equal(item.deadlineSource.discountEndDate, Date.parse(END) / 1000);
  assert.equal(item.deadlineSource.checkedAt, item.checkedAt);
  assert.equal(item.deadlineSource.url, steamDeadlineSourceUrl(ID));
  assert.equal(item.deadlineSource.storeUrl, item.storeUrl);
  assert.notEqual(item.endsAt, item.freshUntil);
  assert.notEqual(item.endsAt, item.priceValidUntil);
  const url = new URL(item.deadlineSource.url);
  assert.equal(url.hostname, 'api.steampowered.com');
  assert.deepEqual(JSON.parse(url.searchParams.get('input_json')), {
    ids: [{ appid: ID }], context: { language: 'japanese', country_code: 'JP' },
    data_request: { include_all_purchase_options: true },
  });
});

test('price snapshots, guessed fields and date-only text cannot prove a deadline', () => {
  const p = pricePayload();
  p[ID].data.endsAt = END;
  p[ID].data.price_overview.discount_end_date = Date.parse(END) / 1000;
  const item = offer(NOW, p);
  assert.equal(item.endsAt, null);
  assert.equal(item.deadlineSource, null);
  for (const input of [null, {}, { response: { store_items: [] } }, { endsAt: END },
    'スペシャルプロモーション！10月8日に終了', '<script>InitDailyDealTimer(timer,1791478800)</script>']) {
    assert.deepEqual(parseSteamDeadline(input, item, p), noDeadline);
  }
});

test('rejects wrong app, unavailable, non-game and ambiguous official entries', () => {
  for (const update of [{ id: 123 }, { appid: 123 }, { item_type: 1 }, { type: 4 }, { success: 0 },
    { visible: false }, { name: `${TITLE} Deluxe` }]) {
    const p = deadlinePayload();
    Object.assign(p.response.store_items[0], update);
    assert.deepEqual(parseSteamDeadline(p, offer(), pricePayload()), noDeadline, JSON.stringify(update));
  }
  const p = deadlinePayload();
  p.response.store_items.push(structuredClone(p.response.store_items[0]));
  assert.deepEqual(parseSteamDeadline(p, offer(), pricePayload()), noDeadline);
});

test('rejects package, edition, multi-game, amount and discount mismatch', () => {
  for (const update of [{ packageid: 999 }, { bundleid: 999 }, { purchase_option_name: `${TITLE} Deluxe` },
    { included_game_count: 2 }, { included_game_count: undefined }, { package_group: 'subscriptions' },
    { must_purchase_as_set: true }, { hide_discount_pct_for_compliance: true }, { price_cannot_be_displayed_as_discount: true },
    { original_price_in_cents: '82001' }, { final_price_in_cents: '12301' }, { final_price_in_cents: 12300 }, { discount_pct: 84 }]) {
    const p = deadlinePayload();
    Object.assign(p.response.store_items[0].purchase_options[0], update);
    assert.deepEqual(parseSteamDeadline(p, offer(), pricePayload()), noDeadline, JSON.stringify(update));
  }
  const p = deadlinePayload();
  p.response.store_items[0].best_purchase_option.final_price_in_cents = '12400';
  assert.deepEqual(parseSteamDeadline(p, offer(), pricePayload()), noDeadline);
  p.response.store_items[0].best_purchase_option = option();
  p.response.store_items[0].purchase_options.push(option());
  assert.deepEqual(parseSteamDeadline(p, offer(), pricePayload()), noDeadline);
});

test('requires independently matching appdetails base package and no ambiguous purchase choice', () => {
  for (const mutate of [
    (p) => { p[ID].data.packages = []; },
    (p) => { p[ID].data.steam_appid = 123; },
    (p) => { p[ID].data.package_groups[0].name = 'subscriptions'; },
    (p) => { p[ID].data.package_groups[0].is_recurring_subscription = 'true'; },
    (p) => { p[ID].data.package_groups[0].subs[0].price_in_cents_with_discount = 12301; },
    (p) => { p[ID].data.package_groups[0].subs[0].option_text = `${TITLE} Deluxe - ¥ 123`; },
    (p) => { p[ID].data.package_groups[0].subs[0].is_free_license = true; },
    (p) => { p[ID].data.packages.push(123); p[ID].data.package_groups[0].subs.push({ ...p[ID].data.package_groups[0].subs[0], packageid: 123 }); },
  ]) {
    const p = pricePayload(); mutate(p);
    assert.deepEqual(parseSteamDeadline(deadlinePayload(), offer(), p), noDeadline);
  }
});

test('missing, malformed, past, impossible and stacked discount timestamps stay unknown', () => {
  for (const end of [undefined, null, 0, -1, NaN, Infinity, 1.5, '1791478800', Date.parse(END),
    NOW.getTime() / 1000, NOW.getTime() / 1000 - 1, 1e16, Date.parse('2030-01-01T00:00:00Z') / 1000]) {
    const p = deadlinePayload();
    for (const option of [p.response.store_items[0].purchase_options[0], p.response.store_items[0].best_purchase_option]) option.active_discounts[0].discount_end_date = end;
    assert.deepEqual(parseSteamDeadline(p, offer(), pricePayload()), noDeadline, String(end));
  }
  for (const discounts of [[], null, [{ discount_amount: '100', discount_end_date: Date.parse(END) / 1000 }], [option().active_discounts[0], option().active_discounts[0]]]) {
    const p = deadlinePayload(); p.response.store_items[0].purchase_options[0].active_discounts = discounts;
    assert.deepEqual(parseSteamDeadline(p, offer(), pricePayload()), noDeadline);
  }
  const p = deadlinePayload();
  p.response.store_items[0].best_purchase_option.active_discounts[0].discount_end_date += 1;
  assert.deepEqual(parseSteamDeadline(p, offer(), pricePayload()), noDeadline);
});

test('deadline provenance is exact for country, endpoint, package, prices and original observation', () => {
  for (const update of [{ kind: 'article' }, { appId: 123 }, { packageId: 0 }, { packageId: '201019' },
    { country: 'US' }, { currency: 'USD' }, { edition: 'deluxe' }, { regularPrice: 821 }, { salePrice: 124 },
    { discountPercent: 86 }, { checkedAt: new Date(NOW.getTime() + 1000).toISOString() },
    { discountEndDate: Date.parse(END) / 1000 + 1 }, { url: 'https://example.com/proof' },
    { url: steamDeadlineSourceUrl(ID).replace('JP', 'US') }, { url: steamDeadlineSourceUrl(123) },
    { storeUrl: `https://store.steampowered.com/app/${ID}/?cc=us&l=english` }]) {
    const item = fullOffer(); Object.assign(item.deadlineSource, update);
    assert.equal(verifiedSteamDeadline(item), false, JSON.stringify(update));
  }
  for (const endsAt of ['2026-10-08', '2026-10-08T17:00:00', '2026-02-30T17:00:00.000Z', NOW.toISOString(), 'not a date']) {
    assert.equal(verifiedSteamDeadline({ ...fullOffer(), endsAt }), false);
  }
});

test('real collector performs one bounded official deadline read after a proven price', async () => {
  const calls = [];
  const payload = await collect({ fetchImpl: async (url) => {
    calls.push(url);
    return response(url === steamPriceSourceUrl(ID) ? pricePayload() : url === steamDeadlineSourceUrl(ID) ? deadlinePayload() : ARTICLE_HTML, url);
  } });
  assert.deepEqual(calls, [`${ARTICLE_URL}/`, steamPriceSourceUrl(ID), steamDeadlineSourceUrl(ID)]);
  assert.equal(payload.items[0].endsAt, END);
  assert.equal(payload.sources.at(-1).deadlineStatus, 'verified');
  assert.equal(payload.status, 'ok');
});

test('non-sale or unproven package does not add deadline fetches', async () => {
  for (const nonSale of [false, true]) {
    const p = pricePayload();
    if (nonSale) Object.assign(p[ID].data.price_overview, { final: 82000, discount_percent: 0 });
    else delete p[ID].data.package_groups;
    const calls = [];
    const result = await collect({ fetchImpl: async (url) => {
      calls.push(url); return response(url === steamPriceSourceUrl(ID) ? p : ARTICLE_HTML, url);
    } });
    assert.equal(calls.length, 2);
    assert.equal(result.items[0].endsAt, null);
    assert.equal(result.items[0].deadlineSource, null);
  }
});

test('deadline endpoint failure, non-JP redirect or oversized data never discards a good price', async () => {
  for (const failure of [
    () => { throw new Error('offline'); },
    (url) => response('not JSON', url),
    (url) => response(deadlinePayload(), url.replace('JP', 'US')),
    (url) => ({ ...response(deadlinePayload(), url), ok: false, status: 429 }),
    (url) => ({ ...response(deadlinePayload(), url), headers: { get: () => 2 * 1024 * 1024 } }),
  ]) {
    const result = await collect({ fetchImpl: async (url) => url === steamDeadlineSourceUrl(ID) ? failure(url)
      : response(url === steamPriceSourceUrl(ID) ? pricePayload() : ARTICLE_HTML, url) });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].status, 'verified');
    assert.equal(result.items[0].salePrice, 123);
    assert.equal(result.items[0].endsAt, null);
    assert.equal(result.items[0].deadlineSource, null);
    assert.equal(result.sources.at(-1).deadlineStatus, 'unavailable');
  }
});

test('cache and consecutive outages preserve deadline proof without renewing source timestamps', async () => {
  let previous = await collect();
  for (const offset of [1000, GAME_PRICE_FRESH_MS - 1, GAME_PRICE_FRESH_MS + 1000, GAME_PRICE_MAX_AGE_MS - 1]) {
    const now = new Date(NOW.getTime() + offset);
    previous = await collect({ previous, now, fetchImpl: () => { throw new Error('outage'); } });
    assert.equal(previous.items[0].endsAt, END);
    assert.equal(previous.items[0].checkedAt, NOW.toISOString());
    assert.equal(previous.items[0].deadlineSource.checkedAt, NOW.toISOString());
    assert.equal(verifiedSteamDeadline(previous.items[0]), true);
  }
  const expired = await collect({ previous, now: new Date(NOW.getTime() + GAME_PRICE_MAX_AGE_MS + 1), fetchImpl: () => { throw new Error('outage'); } });
  assert.deepEqual(expired.items, []);
});

test('exact sale end bypasses fresh price cache; failed recheck retains expired proof, not a new deadline', async () => {
  const earlyEnd = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
  const previous = await collect();
  previous.items[0].endsAt = earlyEnd;
  previous.items[0].deadlineSource.discountEndDate = Date.parse(earlyEnd) / 1000;
  const calls = [];
  const result = await collect({ previous, now: new Date(earlyEnd), fetchImpl: async (url) => { calls.push(url); throw new Error('offline'); } });
  assert.deepEqual(calls, [steamPriceSourceUrl(ID)]);
  assert.equal(result.items[0].status, 'stale');
  assert.equal(result.items[0].endsAt, earlyEnd);
  assert.equal(result.items[0].checkedAt, NOW.toISOString());
  assert.ok(Date.parse(result.items[0].endsAt) <= Date.parse(result.generatedAt));
});

test('new successful price cannot inherit a previous deadline; invalid retained provenance is stripped', async () => {
  const previous = await collect();
  const now = new Date(NOW.getTime() + GAME_PRICE_FRESH_MS + 1);
  const fresh = await collect({ previous, now, fetchImpl: async (url) => {
    if (url === steamDeadlineSourceUrl(ID)) throw new Error('deadline unavailable');
    return response(url === steamPriceSourceUrl(ID) ? pricePayload() : ARTICLE_HTML, url);
  } });
  assert.equal(fresh.items[0].checkedAt, now.toISOString());
  assert.equal(fresh.items[0].endsAt, null);
  assert.equal(fresh.items[0].deadlineSource, null);
  previous.items[0].deadlineSource.country = 'US';
  const cached = await collect({ previous, now: new Date(NOW.getTime() + 1000), fetchImpl: () => { throw new Error('use cache'); } });
  assert.equal(cached.items[0].salePrice, 123);
  assert.equal(cached.items[0].endsAt, null);
  assert.equal(cached.items[0].deadlineSource, null);
});

test('production refresh persists proof and repeat-refresh keeps original observation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'game-sale-deadlines-'));
  try {
    const inputPath = join(dir, 'topics.json');
    const outputPath = join(dir, 'offers.json');
    await writeFile(inputPath, JSON.stringify({ items: [TOPIC] }));
    const fetchImpl = async (url) => response(url === steamPriceSourceUrl(ID) ? pricePayload() : url === steamDeadlineSourceUrl(ID) ? deadlinePayload() : ARTICLE_HTML, url);
    await refreshGameSaleOffers({ inputPath, outputPath, now: NOW, fetchImpl });
    await refreshGameSaleOffers({ inputPath, outputPath, now: new Date(NOW.getTime() + 1000), fetchImpl: () => { throw new Error('cached'); } });
    const saved = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(saved.items[0].endsAt, END);
    assert.equal(saved.items[0].deadlineSource.checkedAt, NOW.toISOString());
    assert.equal(saved.items[0].status, 'cached');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('deadline enrichment remains inside selected app budget and never fetches unrelated packages', async () => {
  const extra = `<p>『<strong>Other Game</strong>』セール <a href="https://store.steampowered.com/app/999/">Steam</a></p>`;
  const calls = [];
  const result = await collect({ maxApps: 1, maxArticles: 1, fetchImpl: async (url) => {
    calls.push(url);
    return response(url === steamPriceSourceUrl(ID) ? pricePayload() : url === steamDeadlineSourceUrl(ID) ? deadlinePayload()
      : ARTICLE_HTML.replace('</section>', `${extra}</section>`), url);
  } });
  assert.equal(result.items.length, 1);
  assert.deepEqual(calls, [`${ARTICLE_URL}/`, steamPriceSourceUrl(ID), steamDeadlineSourceUrl(ID)]);
});
