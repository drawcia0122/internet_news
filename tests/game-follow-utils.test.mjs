import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const SOURCE = fs.readFileSync(new URL('../game-follow-utils.js', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-06T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const iso = (delta = 0) => new Date(NOW + delta).toISOString();
function harness() {
  const window = {};
  vm.runInNewContext(SOURCE, { window, URL, Date, console });
  return window.GameFollowUtils;
}
const api = harness();
const identity = { kind: 'steam', appId: 123 };
const game = { identity, title: 'Example Quest' };
function price(amount = 1000, delta = -HOUR, extra = {}) {
  return { identity, kind: 'price', checkedAt: iso(delta), amount, currency: 'JPY', country: 'JP', store: 'Steam', edition: 'base-game',
    source: { kind: 'steam-appdetails', verified: true, url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp' }, ...extra };
}
function event(kind, extra = {}) {
  return { identity, kind, checkedAt: iso(-HOUR), source: { kind: 'official-game', verified: true, gameKey: 'steam:123',
    url: 'https://store.steampowered.com/news/app/123/view/555' },
  ...(kind === 'update' ? { eventId: 'patch-1', date: iso(-2 * HOUR), title: 'Patch 1' } : { date: '2026-11-01', status: 'scheduled' }), ...extra };
}
function followed(observations = [price()]) { return api.followGame(null, game, observations, { now: NOW }).state; }
function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
}
function offer(extra = {}) {
  return { appId: 123, title: 'Example Quest', store: 'Steam', country: 'JP', currency: 'JPY', edition: 'base-game',
    regularPrice: 2000, salePrice: 1000, discountPercent: 50, status: 'verified',
    checkedAt: iso(-HOUR), freshUntil: iso(5 * HOUR), priceValidUntil: iso(23 * HOUR),
    storeUrl: 'https://store.steampowered.com/app/123/?cc=jp',
    priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp' }, ...extra };
}

// All amounts/events are deterministic fixtures, not claims about real games.
test('classic IIFE exposes isolated helpers and only exact explicit identities', () => {
  assert.equal(api.identityKey(identity), 'steam:123');
  assert.equal(api.identityKey({ store: 'Steam', appId: 123 }), 'steam:123');
  for (const value of [null, 'Example Quest', { title: 'Example Quest' }, { appId: 123 }, { kind: 'steam', appId: '123' },
    { kind: 'steam', appId: 0 }, { kind: 'steam', appId: 1.5 }, { kind: 'steam', appId: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(api.normalizeIdentity(value), null, JSON.stringify(value));
  }
  assert.equal(api.identityKey({ kind: 'external', namespace: 'publisher', id: 'game-5', officialUrl: 'https://publisher.example/game/5' }), 'external:publisher:game-5');
});

test('URL and label sanitization reject executable or credential-bearing links', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,boom', 'http://example.com', '//example.com', 'https://user:pass@example.com',
    'https://example.com:8443', 'https://example.com\n.evil.test', 'https:\\example.com']) assert.equal(api.safeUrl(url), '');
  const result = api.followGame(null, { ...game, title: '<img src=x>Example\u0000 Quest', url: 'javascript:alert(1)' }, [], { now: NOW });
  assert.equal(result.state.follows[0].title, 'Example  Quest');
  assert.equal(result.state.follows[0].url, 'https://store.steampowered.com/app/123/');
  assert.equal(api.normalizeIdentity({ kind: 'external', namespace: 'publisher', id: 'game', officialUrl: 'javascript:alert(1)' }), null);
});

test('following establishes a baseline and duplicate follows preserve that baseline', () => {
  const state = followed();
  assert.equal(state.follows.length, 1);
  assert.equal(state.follows[0].observations[0].amount, 1000);
  assert.equal(state.follows[0].changes.length, 0);
  const duplicate = api.followGame(state, game, [price(500)], { now: NOW });
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.status, 'already-following');
  assert.equal(duplicate.state.follows[0].observations[0].amount, 1000);
  assert.equal(api.listChanges(state, { now: NOW }).length, 0);
});

test('only a newer verified price check after following records an actual price change', () => {
  const state = followed();
  const original = JSON.stringify(state);
  const result = api.applyObservations(state, [price(700, HOUR)], { now: NOW + HOUR });
  assert.equal(JSON.stringify(state), original, 'input is immutable');
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].kind, 'price-drop');
  assert.equal(result.changes[0].before.amount, 1000);
  assert.equal(result.changes[0].after.amount, 700);
  const restored = api.normalizeState(JSON.parse(JSON.stringify(result.state)), { now: NOW + HOUR });
  assert.equal(restored.follows[0].changes.length, 1);
  assert.equal(api.applyObservations(restored, [price(700, HOUR)], { now: NOW + HOUR }).changes.length, 0);
  assert.equal(api.applyObservations(restored, [price(700, 2 * HOUR)], { now: NOW + 2 * HOUR }).changes.length, 0);
  const raised = api.applyObservations(restored, [price(2000, 2 * HOUR)], { now: NOW + 2 * HOUR });
  assert.equal(raised.changes[0].kind, 'price-increase');
});

test('late initial observations, older checks and fresh timestamps alone never imply a price drop', () => {
  let state = followed([]);
  let result = api.applyObservations(state, [price(700, HOUR)], { now: NOW + HOUR });
  assert.equal(result.changes.length, 0);
  state = result.state;
  for (const observation of [price(100, -HOUR), price(100, HOUR), price(700, 2 * HOUR)]) {
    result = api.applyObservations(state, [observation], { now: NOW + 2 * HOUR });
    assert.equal(result.changes.length, 0);
    assert.equal(result.state.follows[0].observations[0].amount, 700);
  }
  assert.equal(api.applyObservations(followed(), [price(700, -HOUR / 2)], { now: NOW + HOUR }).changes.length, 0);
});

test('different games, editions, regions, currencies and stores cannot be price comparisons', () => {
  const state = followed();
  for (const patch of [{ identity: { kind: 'steam', appId: 999 } }, { edition: 'deluxe' }, { currency: 'USD' },
    { country: 'US', source: { ...price().source, url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=us' } }, { store: 'OtherStore' }]) {
    const result = api.applyObservations(state, [price(1, HOUR, patch)], { now: NOW + HOUR });
    assert.equal(result.changes.length, 0, JSON.stringify(patch));
  }
});

test('unverified, mismatched, unsafe or nonnumeric observations are rejected', () => {
  const invalid = [
    { source: { ...price().source, verified: false } }, { source: { ...price().source, kind: 'article' } },
    { source: { ...price().source, url: 'https://store.steampowered.com.evil.test/api/appdetails?appids=123&cc=jp' } },
    { source: { ...price().source, url: 'https://store.steampowered.com/api/appdetails?appids=999&cc=jp' } },
    { source: { ...price().source, url: 'https://store.steampowered.com/api/appdetails?appids=123&appids=999&cc=jp' } },
    { source: { ...price().source, url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=us' } },
    { amount: '700' }, { amount: NaN }, { amount: Infinity }, { amount: -1 }, { currency: undefined },
    { checkedAt: 'today' }, { checkedAt: iso(HOUR) }, { freshUntil: iso(-2 * HOUR) },
    { currency: ['JPY'] }, { checkedAt: '2026-02-30T01:00:00Z' }, { checkedAt: '2026-10-05T24:00:00Z' },
  ];
  for (const patch of invalid) assert.equal(api.normalizeObservation(price(700, -HOUR, patch), { now: NOW }), null, JSON.stringify(patch));
});

test('source freshness uses checkedAt, honors shorter expiry and cannot be extended', () => {
  const observation = price(1000, 0);
  assert.equal(api.observationStatus(observation, { now: NOW + 6 * HOUR - 1 }), 'fresh');
  assert.equal(api.observationStatus(observation, { now: NOW + 6 * HOUR }), 'stale');
  assert.equal(api.observationStatus({ ...observation, freshUntil: iso(100 * HOUR) }, { now: NOW + 6 * HOUR }), 'stale');
  assert.equal(api.observationStatus({ ...observation, freshUntil: iso(HOUR) }, { now: NOW + HOUR }), 'stale');
  assert.equal(api.applyObservations(followed(), [price(700, HOUR)], { now: NOW + 7 * HOUR }).changes.length, 0);
  const changed = api.applyObservations(followed(), [price(700, HOUR)], { now: NOW + HOUR }).state;
  assert.equal(api.listChanges(changed, { now: NOW + 7 * HOUR })[0].freshness, 'stale');
});

test('release changes require explicit same-game official evidence; dates do not auto-release', () => {
  const state = followed([event('release')]);
  const same = api.applyObservations(state, [event('release', { checkedAt: iso(HOUR) })], { now: NOW + HOUR });
  assert.equal(same.changes.length, 0);
  const changed = api.applyObservations(state, [event('release', { date: '2026-11-15', checkedAt: iso(HOUR) })], { now: NOW + HOUR });
  assert.equal(changed.changes[0].kind, 'release-changed');
  const afterDate = api.normalizeState(state, { now: Date.parse('2026-12-01T00:00:00Z') });
  assert.equal(afterDate.follows[0].observations[0].status, 'scheduled');
  for (const patch of [{ status: 'released' }, { date: '2026-02-30' }, { source: { ...event('release').source, gameKey: 'steam:999' } },
    { source: { ...event('release').source, url: 'https://store.steampowered.com/news/app/999/view/555' } },
    { source: { ...event('release').source, url: 'https://news.example/game/123' } }]) {
    assert.equal(api.normalizeObservation(event('release', patch), { now: NOW }), null, JSON.stringify(patch));
  }
});

test('updates need a distinct later explicit event, not just a rechecked or rewritten article', () => {
  const state = followed([event('update')]);
  const next = { checkedAt: iso(2 * HOUR), eventId: 'patch-2', date: iso(HOUR) };
  assert.equal(api.applyObservations(state, [event('update', next)], { now: NOW + 2 * HOUR }).changes[0].kind, 'update');
  for (const patch of [{ checkedAt: iso(2 * HOUR) }, { ...next, eventId: 'patch-1' }, { ...next, date: iso(-2 * HOUR) },
    { ...next, date: iso(-HOUR) }, { ...next, date: iso(3 * HOUR) }]) {
    assert.equal(api.applyObservations(state, [event('update', patch)], { now: NOW + 2 * HOUR }).changes.length, 0);
  }
});

test('explicit external identities bind observations to the official origin and exact key', () => {
  const external = { kind: 'external', namespace: 'studio', id: 'quest', officialUrl: 'https://studio.example/games/quest' };
  const input = event('update', { identity: external, source: { kind: 'official-game', verified: true,
    gameKey: 'external:studio:quest', url: 'https://studio.example/news/patch' } });
  assert.ok(api.normalizeObservation(input, { now: NOW }));
  assert.equal(api.normalizeObservation({ ...input, source: { ...input.source, url: 'https://other.example/news/patch' } }, { now: NOW }), null);
  assert.equal(api.normalizeObservation({ ...input, source: { ...input.source, gameKey: 'external:studio:another' } }, { now: NOW }), null);
});

test('official Steam feed adapter validates identity, amounts, source and actual freshness', () => {
  assert.equal(api.observationFromSteamOffer(offer(), { now: NOW }).amount, 1000);
  assert.equal(api.observationFromSteamOffer(offer({ status: 'cached' }), { now: NOW }).checkedAt, iso(-HOUR));
  assert.equal(api.observationFromSteamOffer(offer({ status: 'ended', salePrice: 2000, discountPercent: 0 }), { now: NOW }).amount, 2000);
  for (const patch of [{ status: 'stale' }, { status: 'unknown' }, { status: 'ended' }, { checkedAt: iso(HOUR) },
    { freshUntil: iso(-1) }, { priceValidUntil: iso(-1) }, { priceValidUntil: iso(100 * HOUR) }, { salePrice: '1000' },
    { salePrice: 9999 }, { discountPercent: 99 }, { storeUrl: 'https://store.steampowered.com/app/999/' },
    { priceSource: { kind: 'article', url: 'https://example.com' } }, { country: 'US' }, { edition: 'deluxe' }]) {
    assert.equal(api.observationFromSteamOffer(offer(patch), { now: NOW }), null, JSON.stringify(patch));
  }
});

test('per-follow removal and bounded state survive malformed records without mutation', () => {
  let state = followed();
  for (let appId = 200; appId < 200 + api.MAX_FOLLOWS - 1; appId += 1) {
    state = api.followGame(state, { store: 'Steam', appId, title: `Game ${appId}` }, [], { now: NOW }).state;
  }
  assert.equal(state.follows.length, api.MAX_FOLLOWS);
  assert.equal(api.followGame(state, { store: 'Steam', appId: 999, title: 'Overflow' }, [], { now: NOW }).status, 'limit');
  const removed = api.removeGame(state, 'steam:123', { now: NOW });
  assert.equal(removed.state.follows.length, api.MAX_FOLLOWS - 1);
  assert.equal(state.follows.length, api.MAX_FOLLOWS);
  assert.equal(api.removeGame(removed.state, 'steam:123', { now: NOW }).changed, false);
  const corrupt = { ...state, follows: [null, {}, { ...state.follows[0], followedAt: 'yesterday' }, ...state.follows, state.follows[0]] };
  assert.equal(api.normalizeState(corrupt, { now: NOW }).follows.length, api.MAX_FOLLOWS);
  assert.equal(api.normalizeState({ version: 100, follows: state.follows }, { now: NOW }).follows.length, 0);
});

test('observation variants and change history have fixed bounds', () => {
  let state = followed();
  for (let index = 1; index < api.MAX_CHANGES + 8; index += 1) {
    state = api.applyObservations(state, [price(1000 - index, index * 1000)], { now: NOW + index * 1000 }).state;
  }
  assert.equal(state.follows[0].changes.length, api.MAX_CHANGES);
  const variants = Array.from({ length: 100 }, (_, index) => price(999, 100000, { edition: `edition-${index}` }));
  state = api.applyObservations(state, variants, { now: NOW + 100000 }).state;
  assert.equal(state.follows[0].observations.length, api.MAX_OBSERVATIONS);
  assert.ok(state.follows[0].observations.some((entry) => entry.edition === 'base-game'));
});

test('stored fake events cannot bypass source/identity checks or invent an amount change', () => {
  const state = followed();
  state.follows[0].changes = [
    { kind: 'price-drop', detectedAt: iso(HOUR), before: price(), after: price(1000, HOUR) },
    { kind: 'price-drop', detectedAt: iso(HOUR), before: price(), after: price(700, HOUR, { source: { ...price().source, verified: false } }) },
  ];
  assert.equal(api.normalizeState(state, { now: NOW + HOUR }).follows[0].changes.length, 0);
});

test('local persistence round-trips, corrupt/oversized data and security exceptions are harmless', () => {
  const localStorage = storage();
  const sessionStorage = storage();
  const store = api.createStore({ localStorage, sessionStorage });
  assert.equal(store.load({ now: NOW }).state.follows.length, 0);
  assert.equal(store.save(followed(), { now: NOW }).persisted, true);
  assert.equal(api.createStore({ localStorage, sessionStorage }).load({ now: NOW }).state.follows.length, 1);
  for (const raw of ['{', 'null', JSON.stringify({ version: 42, follows: [] }), 'x'.repeat(1000001)]) {
    const loaded = api.createStore({ localStorage: storage({ [api.STORAGE_KEY]: raw }) }).load({ now: NOW });
    assert.equal(loaded.state.follows.length, 0);
    assert.equal(loaded.reason, 'invalid');
  }
  const blocked = {};
  Object.defineProperty(blocked, 'localStorage', { get() { throw new Error('SecurityError'); } });
  Object.defineProperty(blocked, 'sessionStorage', { get() { throw new Error('SecurityError'); } });
  const unavailable = api.createStore(blocked);
  assert.equal(unavailable.load({ now: NOW }).status, 'memory');
  assert.equal(unavailable.save(followed(), { now: NOW }).status, 'memory');
  assert.equal(unavailable.load({ now: NOW }).state.follows.length, 1);
});

test('quota fallback persists in session and newer removal cannot resurrect stale local data', () => {
  const initial = followed();
  const localStorage = storage({ [api.STORAGE_KEY]: JSON.stringify(initial) });
  localStorage.setItem = () => { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; };
  const sessionStorage = storage();
  const store = api.createStore({ localStorage, sessionStorage });
  const removed = api.removeGame(store.load({ now: NOW }).state, 'steam:123', { now: NOW }).state;
  const saved = store.save(removed, { now: NOW });
  assert.equal(saved.status, 'session');
  assert.equal(saved.persisted, false);
  assert.equal(saved.reason, 'quota');
  const reload = api.createStore({ localStorage, sessionStorage }).load({ now: NOW });
  assert.equal(reload.status, 'session');
  assert.equal(reload.state.follows.length, 0);
});

test('memory fallback beats old saved state, and recovery does not revive an older session shadow', () => {
  const localStorage = storage();
  const sessionStorage = storage();
  const localWrite = localStorage.setItem;
  const sessionWrite = sessionStorage.setItem;
  const store = api.createStore({ localStorage, sessionStorage });
  store.save(followed(), { now: NOW });
  localStorage.setItem = sessionStorage.setItem = () => { throw new Error('write blocked'); };
  const removed = api.removeGame(store.load({ now: NOW }).state, 'steam:123', { now: NOW }).state;
  assert.equal(store.save(removed, { now: NOW }).status, 'memory');
  assert.equal(store.load({ now: NOW }).state.follows.length, 0);
  sessionWrite(api.STORAGE_KEY, JSON.stringify(followed()));
  localStorage.setItem = localWrite;
  sessionStorage.removeItem = () => { throw new Error('remove blocked'); };
  assert.equal(store.save(removed, { now: NOW }).status, 'local');
  assert.equal(api.createStore({ localStorage, sessionStorage }).load({ now: NOW }).state.follows.length, 0);
});


test('following a second game only establishes that game baseline', () => {
  const original = followed();
  const result = api.followGame(original, { store: 'Steam', appId: 456, title: 'Another Quest' }, [price(500, HOUR)], { now: NOW + HOUR });
  assert.equal(result.state.follows[0].observations[0].amount, 1000);
  assert.equal(result.state.follows[0].changes.length, 0);
  assert.equal(result.state.follows[1].observations.length, 0);
});


test('serialized byte bounds trim history without losing follows or creating unreadable saved state', () => {
  const state = { version: 1, revision: 100, follows: [] };
  for (let appId = 1; appId <= api.MAX_FOLLOWS; appId += 1) {
    const ownIdentity = { kind: 'steam', appId };
    const ownSource = { ...price().source, url: `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp&padding=${'x'.repeat(1800)}` };
    const observation = (amount, delta) => price(amount, delta, { identity: ownIdentity, source: ownSource });
    state.follows.push({ identity: ownIdentity, title: `Game ${appId}`, followedAt: iso(0), observations: [observation(700, 60000)],
      changes: Array.from({ length: api.MAX_CHANGES }, (_, index) => ({ detectedAt: iso((index + 1) * 1000),
        before: observation(1000 - index, index * 1000), after: observation(999 - index, (index + 1) * 1000) })) });
  }
  const localStorage = storage();
  const store = api.createStore({ localStorage });
  const saved = store.save(state, { now: NOW + 60000 });
  assert.equal(saved.status, 'local');
  assert.equal(saved.reason, 'trimmed');
  assert.equal(saved.state.follows.length, api.MAX_FOLLOWS);
  assert.ok(localStorage.getItem(api.STORAGE_KEY).length <= 1000000);
  assert.equal(api.createStore({ localStorage }).load({ now: NOW + 60000 }).state.follows.length, api.MAX_FOLLOWS);
});


test('release metadata accepts only exact appdetails identity and update labels remain announcements', () => {
  assert.ok(api.normalizeObservation(event('release', { source: price().source }), { now: NOW }));
  assert.equal(api.normalizeObservation(event('release', { source: { ...price().source,
    url: 'https://store.steampowered.com/api/appdetails?appids=999&cc=jp' } }), { now: NOW }), null);
  assert.equal(api.normalizeObservation(event('update'), { now: NOW }).eventType, 'announcement');
  assert.ok(api.normalizeObservation(event('update', { source: { ...event('update').source,
    url: 'https://steamcommunity.com/ogg/123/announcements/detail/555' } }), { now: NOW }));
  assert.equal(api.normalizeObservation(event('update', { eventType: 'release-notes' }), { now: NOW }).eventType, 'release-notes');
  assert.equal(api.normalizeObservation(event('update', { eventType: 'installable' }), { now: NOW }), null);
});

test('multiple official posts in one retrieval are aggregated once without older-feed regression', () => {
  const initial = followed([event('update')]);
  const post = (id, date, check = 3 * HOUR) => event('update', { eventId: id, date: iso(date), checkedAt: iso(check) });
  const batch = [post('patch-3', 2 * HOUR), post('patch-1', -2 * HOUR), post('patch-2', HOUR)];
  const first = api.applyObservations(initial, batch, { now: NOW + 3 * HOUR });
  assert.equal(first.changes.length, 2);
  assert.equal(first.state.follows[0].observations[0].eventId, 'patch-3');
  const again = api.applyObservations(first.state, batch.map((entry) => ({ ...entry, checkedAt: iso(4 * HOUR) })), { now: NOW + 4 * HOUR });
  assert.equal(again.changes.length, 0);
  assert.equal(again.state.follows[0].observations[0].eventId, 'patch-3');
  const correctedOld = api.applyObservations(again.state, [post('patch-1', 5 * HOUR, 6 * HOUR)], { now: NOW + 6 * HOUR });
  assert.equal(correctedOld.changes.length, 0);
  assert.equal(correctedOld.state.follows[0].observations[0].eventId, 'patch-3');
  assert.equal(api.normalizeState(first.state, { now: NOW + 3 * HOUR }).follows[0].changes.length, 2);
});
