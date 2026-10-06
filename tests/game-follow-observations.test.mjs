import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { GAME_FOLLOW_FRESH_MS, GAME_FOLLOW_MAX_AGE_MS, parseSteamReleaseObservation, steamUpdateSourceUrl,
  parseSteamUpdateObservations, retainedSteamFollowObservations, collectSteamFollowObservations } from '../lib/game-follow-observations.mjs';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const APP = 123;
const ANNOUNCEMENT = '677383425371407610';
const SOURCE = `https://steamcommunity.com/ogg/${APP}/announcements/detail/${ANNOUNCEMENT}`;
const item = (extra = {}) => ({ id: `steam:${APP}`, appId: APP, title: 'Example Quest', store: 'Steam', country: 'JP', currency: 'JPY',
  edition: 'base-game', checkedAt: NOW.toISOString(),
  priceSource: { kind: 'steam-appdetails', url: `https://store.steampowered.com/api/appdetails?appids=${APP}&cc=jp&l=japanese` }, ...extra });
const appdetails = (extra = {}) => ({ [APP]: { success: true, data: { steam_appid: APP, type: 'game', name: 'Example Quest',
  release_date: { coming_soon: false, date: '2017年12月6日' }, ...extra } } });
const newsitem = (extra = {}) => ({ appid: APP, gid: '1843481262705400', title: 'Patch 1.2 notes',
  url: 'https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1843481262705400',
  feedname: 'steam_community_announcements', feed_type: 1, date: Math.floor(NOW.getTime() / 1000) - 7200,
  tags: ['patchnotes'], ...extra });
const news = (entries = [newsitem()], extra = {}) => ({ appnews: { appid: APP, newsitems: entries, ...extra } });
const jsonResponse = (value, url) => ({ ok: true, status: 200, url,
  headers: { get: () => null }, text: async () => typeof value === 'string' ? value : JSON.stringify(value) });
const redirectResponse = (location = SOURCE, url = newsitem().url) => ({ ok: false, status: 302, url,
  headers: { get: (name) => name === 'location' ? location : null } });
const parsedUpdate = (extra = {}) => parseSteamUpdateObservations(news(), item(extra), { announcementUrl: SOURCE })[0];
const collector = (extra = {}) => collectSteamFollowObservations({ appdetails: appdetails(), item: item(), now: NOW,
  fetchImpl: async (url, options) => options.method === 'HEAD' ? redirectResponse(SOURCE, url) : jsonResponse(news(), url), ...extra });

test('release metadata uses the exact official game and actual explicit release day', () => {
  const release = parseSteamReleaseObservation(appdetails(), item());
  assert.equal(release.kind, 'release');
  assert.equal(release.date, '2017-12-06');
  assert.equal(release.status, 'released');
  assert.deepEqual(release.identity, { kind: 'steam', appId: APP });
  assert.equal(release.source.url, item().priceSource.url);
  assert.equal(release.source.verified, true);
  assert.equal(release.checkedAt, NOW.toISOString());
  assert.equal(Date.parse(release.freshUntil) - NOW.getTime(), GAME_FOLLOW_FRESH_MS);
  assert.deepEqual(JSON.parse(JSON.stringify(release)), release);
  const scheduled = parseSteamReleaseObservation(appdetails({ release_date: { coming_soon: true, date: '2027-02-03' } }), item());
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(scheduled.date, '2027-02-03');
});

test('ambiguous, impossible and missing release dates remain unknown', () => {
  for (const date of [undefined, null, 1791280800, '近日登場', '2027年', '2027年第1四半期', 'Q1 2027', 'Oct 2026',
    '10/06/2026', '2026-02-30', '2026年2月30日', '2026-13-01', '2026-01-00', '2026-10-06T12:00:00Z', '1970-00-01']) {
    assert.equal(parseSteamReleaseObservation(appdetails({ release_date: { coming_soon: false, date } }), item()), null, String(date));
  }
  assert.equal(parseSteamReleaseObservation(appdetails({ release_date: { coming_soon: false, date: '2026-10-07' } }), item()), null);
  assert.equal(parseSteamReleaseObservation(appdetails({ release_date: { coming_soon: false, date: '2024年2月29日' } }), item()).date, '2024-02-29');
});

test('release provenance rejects cross-game, DLC, title, regional and malformed identities', () => {
  for (const fields of [{ steam_appid: 456 }, { type: 'dlc' }, { name: 'Example Quest Deluxe' }, { release_date: { date: '2017年12月6日' } }]) {
    assert.equal(parseSteamReleaseObservation(appdetails(fields), item()), null);
  }
  assert.equal(parseSteamReleaseObservation({ [APP]: { ...appdetails()[APP], success: false } }, item()), null);
  assert.equal(parseSteamReleaseObservation({ '456': appdetails()[APP] }, item()), null);
  for (const fields of [{ appId: '123' }, { appId: 0 }, { appId: 2 ** 32 }, { id: 'steam:456' }, { store: 'Other' },
    { edition: 'dlc' }, { country: 'US' }, { currency: 'USD' }, { checkedAt: '2026-02-30T12:00:00.000Z' },
    { priceSource: { kind: 'steam-appdetails', url: item().priceSource.url.replace('123', '456') } }]) {
    assert.equal(parseSteamReleaseObservation(appdetails(), item(fields)), null, JSON.stringify(fields));
  }
});

test('the official API URL is per-app, bounded, feed-scoped and unauthenticated', () => {
  const url = new URL(steamUpdateSourceUrl(APP));
  assert.equal(url.origin, 'https://api.steampowered.com');
  assert.equal(url.pathname, '/ISteamNews/GetNewsForApp/v2/');
  assert.equal(url.searchParams.get('appid'), String(APP));
  assert.equal(url.searchParams.get('count'), '5');
  assert.equal(url.searchParams.get('maxlength'), '300');
  assert.equal(url.searchParams.get('feeds'), 'steam_community_announcements');
  assert.equal(url.searchParams.has('key'), false);
  for (const id of [0, -1, '123', 1.1, NaN, 2 ** 32]) assert.equal(steamUpdateSourceUrl(id), null);
});

test('only explicit per-game official patchnotes tags produce update observations', () => {
  const result = parseSteamUpdateObservations(news(), item(), { announcementUrl: SOURCE });
  assert.equal(result.length, 1);
  assert.equal(result[0].eventId, `steam-announcement-${ANNOUNCEMENT}`);
  assert.equal(result[0].date, '2026-10-06T10:00:00.000Z');
  assert.equal(result[0].eventType, 'release-notes');
  assert.equal(result[0].source.url, SOURCE);
  assert.equal(result[0].source.gameKey, `steam:${APP}`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  for (const entry of [newsitem({ tags: [] }), newsitem({ tags: ['sale'] }), newsitem({ title: 'Patch tomorrow', tags: undefined }),
    newsitem({ feedname: 'pcgamer' }), newsitem({ feed_type: 0 }), newsitem({ appid: 456 }), newsitem({ appid: '123' }),
    newsitem({ date: 0 }), newsitem({ date: '1791280800' }), newsitem({ date: Infinity }), newsitem({ date: 1791280800.5 }),
    newsitem({ date: NOW.getTime() }), newsitem({ date: Math.floor(NOW.getTime() / 1000) + 1 }),
    newsitem({ gid: 1843481262705400 }), newsitem({ gid: 'abc' }), newsitem({ title: '' })]) {
    assert.deepEqual(parseSteamUpdateObservations(news([entry]), item(), { announcementUrl: SOURCE }), [], JSON.stringify(entry));
  }
  assert.deepEqual(parseSteamUpdateObservations(news(undefined, { appid: 456 }), item(), { announcementUrl: SOURCE }), []);
});

test('news IDs never become guessed announcement IDs or fabricated event dates', () => {
  assert.deepEqual(parseSteamUpdateObservations(news(), item()), []);
  const historical = parseSteamUpdateObservations(news([newsitem({ date: 1500000000 })]), item(), { announcementUrl: SOURCE });
  assert.equal(historical[0].date, '2017-07-14T02:40:00.000Z');
  assert.notEqual(historical[0].eventId, `steam-announcement-${newsitem().gid}`);
  assert.notEqual(historical[0].date, item().checkedAt);
});

test('only the newest eligible patch among at most five entries is selected', () => {
  const entries = [newsitem({ gid: '5', date: 1500000000, url: SOURCE }), newsitem({ title: '<b>Newest</b>\u0000 note', url: SOURCE }),
    newsitem({ date: 1600000000, url: SOURCE }), newsitem({ tags: [], url: SOURCE }), newsitem({ tags: [], url: SOURCE }),
    newsitem({ title: 'Outside request limit', date: NOW.getTime() / 1000, url: SOURCE })];
  const result = parseSteamUpdateObservations(news(entries), item());
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Newest  note');
});

test('source validation rejects injected hosts, wrong-app URLs, queries and unsafe locations', () => {
  for (const url of ['http://steamcommunity.com/ogg/123/announcements/detail/1',
    'https://steamcommunity.com.evil.test/ogg/123/announcements/detail/1',
    'https://user:password@steamcommunity.com/ogg/123/announcements/detail/1',
    'https://steamcommunity.com:8443/ogg/123/announcements/detail/1',
    'https://steamcommunity.com/ogg/456/announcements/detail/1',
    'https://store.steampowered.com/news/app/456/view/1',
    `${SOURCE}?appid=123`, `${SOURCE}#fragment`, `${SOURCE}\n`, 'javascript:alert(1)',
    'https://steamcommunity.com/groups/example/announcements/detail/1']) {
    assert.deepEqual(parseSteamUpdateObservations(news(), item(), { announcementUrl: url }), [], url);
  }
  for (const url of ['https://evil.example/news/externalpost/steam_community_announcements/1843481262705400',
    newsitem().url.replace('1843481262705400', '222'), newsitem().url.replace('steam_community_announcements', 'pcgamer'),
    `${newsitem().url}?appid=123`, newsitem().url.replace('https:', 'http:')]) {
    assert.deepEqual(parseSteamUpdateObservations(news([newsitem({ url })]), item(), { announcementUrl: SOURCE }), [], url);
  }
});

test('collector performs one GET and one manual HEAD with the supplied budget signal', async () => {
  const calls = [];
  const controller = new AbortController();
  const result = await collector({ signal: controller.signal, timeoutMs: 900,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.signal.aborted, false);
      return options.method === 'HEAD' ? redirectResponse(SOURCE, url) : jsonResponse(news(), url);
    } });
  assert.equal(result.updateStatus, 'verified');
  assert.deepEqual(result.observations.map((entry) => entry.kind), ['release', 'update']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, steamUpdateSourceUrl(APP));
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].url, newsitem().url);
  assert.equal(calls[1].options.method, 'HEAD');
  assert.equal(calls[1].options.redirect, 'manual');
  controller.abort();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(calls[1].options.signal.aborted, true);
});

test('direct official announcement links need no redirect read', async () => {
  const calls = [];
  const result = await collector({ fetchImpl: async (url) => { calls.push(url); return jsonResponse(news([newsitem({ url: SOURCE })]), url); } });
  assert.equal(calls.length, 1);
  assert.equal(result.updateStatus, 'verified');
});

test('ordinary announcements do not trigger redirect requests or fake updates', async () => {
  let calls = 0;
  const result = await collector({ fetchImpl: async (url) => { calls++; return jsonResponse(news([newsitem({ title: 'Tournament winner', tags: [] })]), url); } });
  assert.equal(calls, 1);
  assert.equal(result.updateStatus, 'none');
  assert.deepEqual(result.observations.map((entry) => entry.kind), ['release']);
});

test('invalid inputs and an already-exhausted budget cannot start a news request', async () => {
  const never = async () => { assert.fail('must not fetch'); };
  assert.equal((await collector({ item: item({ appId: 456 }), fetchImpl: never })).updateStatus, 'unknown');
  assert.equal((await collector({ item: item({ checkedAt: '2026-10-07T12:00:00.000Z' }), fetchImpl: never })).updateStatus, 'unknown');
  const controller = new AbortController(); controller.abort();
  const result = await collector({ signal: controller.signal, fetchImpl: never });
  assert.equal(result.updateStatus, 'unavailable');
  assert.equal(result.observations[0].kind, 'release');
});

test('network, JSON, HTTP, feed shape and redirect failures never lose release evidence', async () => {
  for (const fetchImpl of [async () => { throw Error('offline'); }, async (url) => jsonResponse('{bad JSON', url),
    async () => ({ ok: false, status: 429 }), async (url) => jsonResponse(news(undefined, { appid: 456 }), url),
    async (url) => jsonResponse({ appnews: { appid: APP, newsitems: {} } }, url),
    async (url) => jsonResponse(news(), url.replace('api.steampowered.com', 'evil.test')),
    async (url, options) => options.method === 'HEAD' ? redirectResponse(SOURCE.replace('/123/', '/456/'), url) : jsonResponse(news(), url),
    async (url, options) => options.method === 'HEAD' ? redirectResponse(newsitem().url, url) : jsonResponse(news(), url),
    async (url, options) => options.method === 'HEAD' ? { ...redirectResponse(SOURCE, url), status: 200 } : jsonResponse(news(), url),
    async (url, options) => options.method === 'HEAD' ? redirectResponse(SOURCE, SOURCE) : jsonResponse(news(), url)]) {
    const result = await collector({ fetchImpl });
    assert.equal(result.updateStatus, 'unavailable');
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].date, '2017-12-06');
  }
});

test('responses are byte-bounded by headers, fallback text and streaming content', async () => {
  const large = 'x'.repeat(128 * 1024 + 1);
  const headerResponse = { ok: true, status: 200, headers: { get: () => String(large.length) }, text: async () => assert.fail('must not read body') };
  const textResponse = jsonResponse(large);
  let cancelled = false;
  const streamResponse = { ok: true, status: 200, body: { getReader: () => ({
    read: async () => ({ done: false, value: Buffer.from(large) }), cancel: async () => { cancelled = true; },
  }) } };
  for (const response of [headerResponse, textResponse, streamResponse]) {
    assert.equal((await collector({ fetchImpl: async () => response })).updateStatus, 'unavailable');
  }
  assert.equal(cancelled, true);
});

test('successful streaming reads produce the same bounded observations', async () => {
  const result = await collector({ fetchImpl: async (url, options) => options.method === 'HEAD' ? redirectResponse(SOURCE, url)
    : new Response(JSON.stringify(news()), { status: 200 }) });
  assert.equal(result.updateStatus, 'verified');
});

test('fallback keeps original event/check timestamps and expires at 24 hours', async () => {
  const update = parsedUpdate();
  const previous = [parseSteamReleaseObservation(appdetails(), item()), update];
  const saved = JSON.stringify(previous);
  for (const offset of [0, GAME_FOLLOW_FRESH_MS, GAME_FOLLOW_MAX_AGE_MS - 1]) {
    const now = new Date(NOW.getTime() + offset);
    const currentItem = item({ checkedAt: now.toISOString() });
    assert.equal(retainedSteamFollowObservations(previous, currentItem, { now }).length, 2);
    const result = await collector({ item: currentItem, now, previousObservations: previous, fetchImpl: async () => { throw Error('offline'); } });
    const kept = result.observations.find((entry) => entry.kind === 'update');
    assert.deepEqual(kept, update);
  }
  const now = new Date(NOW.getTime() + GAME_FOLLOW_MAX_AGE_MS);
  assert.deepEqual(retainedSteamFollowObservations(previous, item({ checkedAt: now.toISOString() }), { now }), []);
  assert.equal(JSON.stringify(previous), saved);
});

test('newly fetched unknown release metadata never inherits the historical release claim', async () => {
  const previous = [parseSteamReleaseObservation(appdetails(), item()), parsedUpdate()];
  const result = await collector({ appdetails: appdetails({ release_date: { coming_soon: false, date: 'Unknown' } }),
    previousObservations: previous, fetchImpl: async () => { throw Error('offline'); } });
  assert.deepEqual(result.observations.map((entry) => entry.kind), ['update']);
});

test('retained evidence rejects fabricated provenance, renewed freshness and future checks', () => {
  const update = parsedUpdate();
  for (const patch of [{ identity: { kind: 'steam', appId: 456 } }, { freshUntil: '2026-10-07T12:00:00.000Z' },
    { checkedAt: '2026-10-07T12:00:00.000Z' }, { eventId: 'headline-match' }, { eventType: 'installed-patch' },
    { date: '2026-10-07T12:00:00.000Z' }, { source: { ...update.source, verified: false } },
    { source: { ...update.source, gameKey: 'steam:456' } }, { source: { ...update.source, url: SOURCE.replace('/123/', '/456/') } }]) {
    assert.deepEqual(retainedSteamFollowObservations([{ ...update, ...patch }], item(), { now: NOW }), [], JSON.stringify(patch));
  }
  const release = parseSteamReleaseObservation(appdetails(), item());
  assert.deepEqual(retainedSteamFollowObservations([{ ...release, date: '2026-02-30' }], item(), { now: NOW }), []);
  assert.equal(retainedSteamFollowObservations([release, release, update, update], item(), { now: NOW }).length, 2);
});

test('emitted evidence is compatible with local follows and historical events remain baselines', async () => {
  const window = {};
  vm.runInNewContext(await readFile(new URL('../game-follow-utils.js', import.meta.url), 'utf8'), { window, URL, Date });
  const api = window.GameFollowUtils;
  const result = await collector();
  for (const entry of result.observations) assert.ok(api.normalizeObservation(entry, { now: NOW.getTime() }), entry.kind);
  const game = { identity: { kind: 'steam', appId: APP }, title: item().title };
  const state = api.followGame(null, game, result.observations, { now: NOW.getTime() }).state;
  assert.equal(state.follows[0].observations.length, 2);
  assert.equal(api.listChanges(state, { now: NOW.getTime() }).length, 0);
  const later = new Date(NOW.getTime() + 3600000);
  const sameEvents = await collector({ item: item({ checkedAt: later.toISOString() }), now: later });
  assert.equal(api.applyObservations(state, sameEvents.observations, { now: later.getTime() }).changes.length, 0);
});
