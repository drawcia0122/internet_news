(function () {
  'use strict';

  /**
   * Browser-local game follows; no network, account, notifications or title matching.
   *
   * State (JSON-safe): {version:1, revision, follows:[{key, identity, title, url,
   * followedAt, observations:[], changes:[]}]}. Call the mutation helpers rather
   * than editing state. They return {state, changed, status}; applyObservations
   * also returns the newly recorded changes. Input objects are never mutated.
   *
   * Identity: {kind:'steam', appId:positiveInteger}, or an explicitly curated
   * {kind:'external', namespace, id, officialUrl:HTTPS}. A game is
   * {identity, title}; raw {store:'Steam', appId, title} is also accepted.
   *
   * Observation: {identity, kind, checkedAt:ISO, source:{kind, url, verified:true},
   * freshUntil?:ISO, ...}. Price: {amount:number, currency:ISO4217, country:ISO3166,
   * store, edition}; amounts are actual store units, never formatted text or an
   * inferred discount. Steam requires the exact official appdetails URL and
   * matching country. observationFromSteamOffer adapts the existing JP feed.
   *
   * Release: {date:'YYYY-MM-DD'|ISO, status:'scheduled'|'released'}.
   * Update: {eventId:stableId, date:ISO, title?:string,
   * eventType?:'announcement'|'release-notes'}; default is announcement, never
   * a claim that an update is installable. These require a verified
   * source {kind:'official-game', gameKey:identityKey(identity), url}; Steam URLs
   * must identify that exact app, external URLs must share officialUrl's origin.
   * Release metadata also accepts exact per-app steam-appdetails provenance.
   * The integrator must have verified the explicit game/date/source relationship;
   * setting verified:true is an assertion, not a substitute for verification.
   * Never pass fuzzy article-title matches, generic franchise news or fetch times
   * as release/update event dates. Unavailable evidence produces no observation.
   *
   * The first observation of each comparable series is a baseline, including
   * those added later. Checking the same facts again never creates a change.
   * Only fresh checks after following can add changes. Price/release checks
   * must be strictly newer; distinct dated updates may share one check. Prices
   * compare within identical store/country/currency/edition; releases compare
   * explicit date/status; updates require a new event ID with a later event date.
   * listChanges returns historical events, each annotated fresh/stale from the
   * source's original checkedAt (six hours for price, 24 hours otherwise).
   * Render all labels as text/escapeHtml; safe HTTPS links are not HTML markup.
   *
   * createStore(windowRef).load()/save(state) return {state,persisted,status},
   * status local/session/memory; persisted means saved in localStorage only.
   * reason may be invalid, quota, unavailable, write-failed or trimmed. Histories
   * are trimmed before saving if the serialized state would exceed one MB;
   * identities and follows are retained. sessionStorage
   * shadows a failed local write; revisions prevent an older shadow resurrecting
   * a removed follow. If both stores fail, the store instance retains tab memory.
   */
  const VERSION = 1;
  const STORAGE_KEY = 'internet-news-game-follows-v1';
  const MAX_FOLLOWS = 50;
  const MAX_OBSERVATIONS = 8;
  const MAX_CHANGES = 12;
  const MAX_STORAGE_LENGTH = 1000000;
  const PRICE_FRESHNESS_MS = 6 * 60 * 60 * 1000;
  const EVENT_FRESHNESS_MS = 24 * 60 * 60 * 1000;
  const STABLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

  function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function text(value, max = 200) {
    return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      return url.href;
    } catch { return ''; }
  }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    // Date.parse accepts rollover dates (February 30 and 24:00); reject them.
    const day = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)
      || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
    const date = Date.parse(value);
    return Number.isFinite(date) && date >= 0 ? date : null;
  }
  function nowValue(options = {}) {
    const value = options.now instanceof Date ? options.now.getTime() : typeof options.now === 'string' ? timestamp(options.now) : options.now;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : Date.now();
  }
  function iso(value) { return new Date(value).toISOString(); }
  function emptyState() { return { version: VERSION, revision: 0, follows: [] }; }

  function normalizeIdentity(value) {
    const source = record(value?.identity) ? value.identity : value;
    if (!record(source)) return null;
    if ((source.kind === 'steam' || (!source.kind && source.store === 'Steam'))
      && Number.isSafeInteger(source.appId) && source.appId > 0) return { kind: 'steam', appId: source.appId };
    if (source.kind !== 'external' || typeof source.namespace !== 'string' || !/^[a-z][a-z0-9.-]{0,49}$/.test(source.namespace)
      || typeof source.id !== 'string' || !STABLE_ID.test(source.id)) return null;
    const officialUrl = safeUrl(source.officialUrl);
    return officialUrl ? { kind: 'external', namespace: source.namespace, id: source.id, officialUrl } : null;
  }
  function identityKey(value) {
    const identity = normalizeIdentity(value);
    return identity?.kind === 'steam' ? `steam:${identity.appId}` : identity ? `external:${identity.namespace}:${identity.id}` : '';
  }
  function identityUrl(identity) {
    return identity.kind === 'steam' ? `https://store.steampowered.com/app/${identity.appId}/` : identity.officialUrl;
  }
  function sameIdentity(left, right) {
    return identityKey(left) === identityKey(right)
      && (left.kind !== 'external' || left.officialUrl === right.officialUrl);
  }
  function normalizeSource(value, identity, kind, country) {
    if (!record(value) || value.verified !== true) return null;
    const urlText = safeUrl(value.url);
    if (!urlText) return null;
    const url = new URL(urlText);
    if (identity.kind === 'steam' && (kind === 'price' || (kind === 'release' && value.kind === 'steam-appdetails'))) {
      if (value.kind !== 'steam-appdetails' || url.hostname !== 'store.steampowered.com' || url.pathname !== '/api/appdetails'
        || url.searchParams.getAll('appids').length !== 1 || url.searchParams.get('appids') !== String(identity.appId)
        || url.searchParams.getAll('cc').length !== 1
        || (kind === 'price' ? url.searchParams.get('cc')?.toUpperCase() !== country : !/^[a-zA-Z]{2}$/.test(url.searchParams.get('cc')))) return null;
      return { kind: value.kind, url: urlText, verified: true };
    }
    if (value.kind !== 'official-game' || value.gameKey !== identityKey(identity)) return null;
    if (identity.kind === 'steam') {
      const app = String(identity.appId);
      const exactApp = url.hostname === 'store.steampowered.com'
        && (new RegExp(`^/app/${app}(?:/|$)`).test(url.pathname) || new RegExp(`^/news/app/${app}/view/[0-9]+/?$`).test(url.pathname));
      const announcement = url.hostname === 'steamcommunity.com' && new RegExp(`^/(?:games|ogg)/${app}/announcements/detail/[0-9]+/?$`).test(url.pathname);
      if (!exactApp && !announcement) return null;
    } else if (url.origin !== new URL(identity.officialUrl).origin) return null;
    return { kind: value.kind, url: urlText, gameKey: value.gameKey, verified: true };
  }
  function eventDate(value, allowDay) {
    if (allowDay && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = Date.parse(`${value}T00:00:00Z`);
      return Number.isFinite(date) && iso(date).slice(0, 10) === value ? value : null;
    }
    const date = timestamp(value);
    return date === null ? null : iso(date);
  }
  function normalizeObservation(value, options = {}) {
    if (!record(value) || !['price', 'release', 'update'].includes(value.kind)) return null;
    const identity = normalizeIdentity(value.identity);
    const checked = timestamp(value.checkedAt);
    const now = nowValue(options);
    if (!identity || checked === null || checked > now) return null;
    const freshness = value.kind === 'price' ? PRICE_FRESHNESS_MS : EVENT_FRESHNESS_MS;
    let freshUntil = checked + freshness;
    if (value.freshUntil !== undefined && value.freshUntil !== null) {
      const declared = timestamp(value.freshUntil);
      if (declared === null || declared <= checked) return null;
      freshUntil = Math.min(freshUntil, declared);
    }
    const country = typeof value.country === 'string' ? value.country : '';
    const source = normalizeSource(value.source, identity, value.kind, country);
    if (!source) return null;
    const base = { identity, kind: value.kind, checkedAt: iso(checked), freshUntil: iso(freshUntil), source };
    if (value.kind === 'price') {
      if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount < 0 || value.amount > 1000000000
        || typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency) || !/^[A-Z]{2}$/.test(country)
        || typeof value.edition !== 'string' || !STABLE_ID.test(value.edition)
        || typeof value.store !== 'string' || !STABLE_ID.test(value.store)
        || (identity.kind === 'steam' && value.store !== 'Steam')) return null;
      return { ...base, amount: value.amount, currency: value.currency, country, store: value.store, edition: value.edition };
    }
    const date = eventDate(value.date, value.kind === 'release');
    if (!date) return null;
    if (value.kind === 'release') {
      const japanDay = /^\d{4}-\d{2}-\d{2}$/.test(date) && identity.kind === 'steam'
        && source.kind === 'steam-appdetails' && new URL(source.url).searchParams.get('cc')?.toUpperCase() === 'JP';
      const futureRelease = japanDay ? date > new Date(checked + 9 * 3600000).toISOString().slice(0, 10) : Date.parse(date) > checked;
      if (!['scheduled', 'released'].includes(value.status) || (value.status === 'released' && futureRelease)) return null;
      return { ...base, date, status: value.status };
    }
    if (typeof value.eventId !== 'string' || !STABLE_ID.test(value.eventId) || Date.parse(date) > checked) return null;
    const eventType = value.eventType ?? 'announcement';
    if (!['announcement', 'release-notes'].includes(eventType)) return null;
    return { ...base, eventId: value.eventId, date, title: text(value.title), eventType };
  }
  function seriesKey(observation) {
    return observation.kind === 'price'
      ? JSON.stringify(['price', observation.store, observation.country, observation.currency, observation.edition]) : observation.kind;
  }
  function observationStatus(observation, options = {}) {
    const normalized = normalizeObservation(observation, options);
    if (!normalized) return 'unavailable';
    return nowValue(options) < timestamp(normalized.freshUntil) ? 'fresh' : 'stale';
  }
  function makeChange(before, after, followedAt, detectedAt) {
    if (!sameIdentity(before.identity, after.identity) || seriesKey(before) !== seriesKey(after)
      || timestamp(after.checkedAt) < timestamp(before.checkedAt)
      || (after.kind !== 'update' && timestamp(after.checkedAt) === timestamp(before.checkedAt))
      || timestamp(after.checkedAt) <= timestamp(followedAt)) return null;
    let kind = '';
    if (after.kind === 'price' && before.amount !== after.amount) kind = after.amount < before.amount ? 'price-drop' : 'price-increase';
    if (after.kind === 'release' && (before.date !== after.date || before.status !== after.status)) kind = 'release-changed';
    if (after.kind === 'update' && before.eventId !== after.eventId && Date.parse(after.date) > Date.parse(before.date)
      && Date.parse(after.date) > timestamp(followedAt)) kind = 'update';
    if (!kind) return null;
    const key = identityKey(after.identity);
    return { id: JSON.stringify([key, seriesKey(after), after.checkedAt, after.kind === 'update' ? after.eventId : null]), key, kind, detectedAt, before, after };
  }
  function normalizeState(value, options = {}) {
    const state = emptyState();
    if (!record(value) || value.version !== VERSION || !Array.isArray(value.follows)) return state;
    state.revision = Number.isSafeInteger(value.revision) && value.revision >= 0 && value.revision < Number.MAX_SAFE_INTEGER ? value.revision : 0;
    const keys = new Set();
    const now = nowValue(options);
    for (const item of value.follows.slice(0, MAX_FOLLOWS * 2)) {
      if (state.follows.length >= MAX_FOLLOWS || !record(item)) continue;
      const identity = normalizeIdentity(item.identity);
      const key = identityKey(identity);
      const followedAt = timestamp(item.followedAt);
      const title = text(item.title);
      if (!identity || !title || keys.has(key) || followedAt === null || followedAt > now) continue;
      const observations = [];
      const series = new Set();
      const candidates = (Array.isArray(item.observations) ? item.observations : []).slice(0, 100)
        .map((entry) => normalizeObservation(entry, { now })).filter((entry) => entry && sameIdentity(entry.identity, identity))
        .sort((a, b) => timestamp(b.checkedAt) - timestamp(a.checkedAt)
          || (a.kind === 'update' && b.kind === 'update' ? Date.parse(b.date) - Date.parse(a.date) : 0));
      for (const observation of candidates) {
        if (observations.length >= MAX_OBSERVATIONS || series.has(seriesKey(observation))) continue;
        series.add(seriesKey(observation));
        observations.push(observation);
      }
      const changes = [];
      const changeIds = new Set();
      for (const raw of (Array.isArray(item.changes) ? item.changes : []).slice(0, MAX_CHANGES * 2)) {
        if (!record(raw)) continue;
        const before = normalizeObservation(raw.before, { now });
        const after = normalizeObservation(raw.after, { now });
        const detected = timestamp(raw.detectedAt);
        if (!before || !after || !sameIdentity(after.identity, identity) || detected === null || detected > now
          || detected < timestamp(after.checkedAt) || detected >= timestamp(after.freshUntil)) continue;
        const change = makeChange(before, after, iso(followedAt), iso(detected));
        if (!change || changeIds.has(change.id)) continue;
        changes.push(change);
        changeIds.add(change.id);
      }
      keys.add(key);
      state.follows.push({ key, identity, title, url: identityUrl(identity), followedAt: iso(followedAt), observations,
        changes: changes.sort((a, b) => timestamp(b.detectedAt) - timestamp(a.detectedAt)).slice(0, MAX_CHANGES) });
    }
    return state;
  }
  function result(state, changed, status, changes = []) { return { state, changed, status, changes }; }
  function followGame(value, game, observations = [], options = {}) {
    const now = nowValue(options);
    const state = normalizeState(value, { now });
    const identity = normalizeIdentity(game);
    const key = identityKey(identity);
    const title = text(game?.title);
    if (!identity || !title) return result(state, false, 'invalid');
    if (state.follows.some((entry) => entry.key === key)) return result(state, false, 'already-following');
    if (state.follows.length >= MAX_FOLLOWS) return result(state, false, 'limit');
    state.follows.push({ key, identity, title, url: identityUrl(identity), followedAt: iso(now), observations: [], changes: [] });
    const matching = (Array.isArray(observations) ? observations : []).filter((entry) => {
      const observedIdentity = normalizeIdentity(entry?.identity);
      return observedIdentity && sameIdentity(identity, observedIdentity);
    });
    const baseline = applyObservations(state, matching, { now });
    baseline.state.revision = state.revision + 1;
    return result(baseline.state, true, 'followed');
  }
  function removeGame(value, key, options = {}) {
    const state = normalizeState(value, options);
    const previous = state.follows.length;
    state.follows = state.follows.filter((entry) => entry.key !== key);
    const changed = previous !== state.follows.length;
    if (changed) state.revision += 1;
    return result(state, changed, changed ? 'removed' : 'missing');
  }
  function applyObservations(value, input, options = {}) {
    const now = nowValue(options);
    const state = normalizeState(value, { now });
    const changes = [];
    let changed = false;
    const observations = (Array.isArray(input) ? input : []).slice(0, 1000)
      .map((entry) => normalizeObservation(entry, { now })).filter(Boolean)
      .sort((a, b) => timestamp(a.checkedAt) - timestamp(b.checkedAt)
        || (a.kind === 'update' && b.kind === 'update' ? Date.parse(a.date) - Date.parse(b.date) : 0));
    for (const observation of observations) {
      if (observationStatus(observation, { now }) !== 'fresh') continue;
      const follow = state.follows.find((entry) => sameIdentity(entry.identity, observation.identity));
      if (!follow) continue;
      const index = follow.observations.findIndex((entry) => seriesKey(entry) === seriesKey(observation));
      const previous = follow.observations[index];
      if (previous) {
        const olderCheck = timestamp(observation.checkedAt) < timestamp(previous.checkedAt);
        const sameCheck = timestamp(observation.checkedAt) === timestamp(previous.checkedAt);
        const laterEvent = observation.kind === 'update' && observation.eventId !== previous.eventId
          && Date.parse(observation.date) > Date.parse(previous.date);
        if (olderCheck || (sameCheck && !laterEvent)) continue;
        if (observation.kind === 'update' && observation.eventId !== previous.eventId) {
          // Repeated feeds may include older posts or correct an old post's date.
          const alreadySeen = follow.changes.some((entry) => entry.kind === 'update'
            && [entry.before.eventId, entry.after.eventId].includes(observation.eventId));
          if (!laterEvent || alreadySeen) continue;
        }
      }
      // Keep existing series rather than evicting a baseline to admit arbitrary variants.
      if (!previous && follow.observations.length >= MAX_OBSERVATIONS) continue;
      const change = previous ? makeChange(previous, observation, follow.followedAt, iso(now)) : null;
      if (change && !follow.changes.some((entry) => entry.id === change.id)) {
        follow.changes.unshift(change);
        follow.changes = follow.changes.slice(0, MAX_CHANGES);
        changes.push(change);
      }
      if (index < 0) follow.observations.push(observation);
      else follow.observations[index] = observation;
      changed = true;
    }
    if (changed) state.revision += 1;
    return result(state, changed, changed ? 'updated' : 'unchanged', changes);
  }
  function listChanges(value, options = {}) {
    return normalizeState(value, options).follows.flatMap((follow) => follow.changes.map((change) => ({
      ...change, title: follow.title, url: change.after.source.url, freshness: observationStatus(change.after, options),
    }))).sort((a, b) => timestamp(b.detectedAt) - timestamp(a.detectedAt));
  }
  function observationFromSteamOffer(offer, options = {}) {
    if (!record(offer) || !['verified', 'cached', 'ended'].includes(offer.status) || offer.store !== 'Steam'
      || offer.country !== 'JP' || offer.currency !== 'JPY' || offer.edition !== 'base-game'
      || !Number.isSafeInteger(offer.salePrice) || !Number.isSafeInteger(offer.regularPrice)
      || offer.salePrice <= 0 || offer.regularPrice <= 0 || offer.salePrice > offer.regularPrice
      || !Number.isInteger(offer.discountPercent) || offer.discountPercent < 0 || offer.discountPercent > 99
      || Math.abs(100 * (offer.regularPrice - offer.salePrice) / offer.regularPrice - offer.discountPercent) > 1
      || (offer.status === 'ended' && (offer.salePrice !== offer.regularPrice || offer.discountPercent !== 0))) return null;
    const identity = normalizeIdentity(offer);
    const storeUrl = safeUrl(offer.storeUrl);
    const checked = timestamp(offer.checkedAt);
    const validUntil = timestamp(offer.priceValidUntil);
    const freshUntil = timestamp(offer.freshUntil);
    const now = nowValue(options);
    if (!identity || !storeUrl || checked === null || validUntil === null || freshUntil === null
      || validUntil <= checked || validUntil - checked > EVENT_FRESHNESS_MS || validUntil <= now
      || new URL(storeUrl).hostname !== 'store.steampowered.com'
      || !new RegExp(`^/app/${identity.appId}(?:/|$)`).test(new URL(storeUrl).pathname)) return null;
    const observation = normalizeObservation({ identity, kind: 'price', checkedAt: offer.checkedAt,
      freshUntil: iso(Math.min(validUntil, freshUntil)), source: { ...offer.priceSource, verified: true },
      amount: offer.salePrice, currency: offer.currency, country: offer.country, store: offer.store, edition: offer.edition }, { now });
    return observation && observationStatus(observation, { now }) === 'fresh' ? observation : null;
  }
  function createStore(windowRef = window) {
    let memory = emptyState();
    let memoryActive = false;
    let suppressSession = false;
    function storage(name) { try { return windowRef?.[name] ?? null; } catch { return null; } }
    function read(name, options) {
      try {
        const target = storage(name);
        if (!target) return { state: null, reason: 'unavailable' };
        const raw = target.getItem(STORAGE_KEY);
        if (raw === null) return { state: null, reason: '' };
        if (typeof raw !== 'string' || raw.length > MAX_STORAGE_LENGTH) return { state: null, reason: 'invalid' };
        const value = JSON.parse(raw);
        if (!record(value) || value.version !== VERSION || !Array.isArray(value.follows)) return { state: null, reason: 'invalid' };
        return { state: normalizeState(value, options), reason: '' };
      } catch (error) { return { state: null, reason: error?.name === 'SyntaxError' ? 'invalid' : 'unavailable' }; }
    }
    function load(options = {}) {
      const local = read('localStorage', options);
      const session = read('sessionStorage', options);
      // A real cross-tab replacement/removal is authoritative, including clear().
      // Do not revive a deleted follow from this tab's previous memory/shadow.
      if (options.external === true && !local.reason) {
        const previousRevision = Math.max(memory.revision, session.state?.revision || 0, local.state?.revision || 0);
        memory = local.state || emptyState();
        memory.revision = Math.min(Number.MAX_SAFE_INTEGER - 1, previousRevision + 1);
        memoryActive = true;
        suppressSession = true;
        try { storage('sessionStorage')?.removeItem(STORAGE_KEY); }
        catch {
          // If a stale shadow cannot be removed, a newer empty local tombstone
          // prevents it from returning after reload. If both writes fail, expose
          // tab-memory-only status instead of claiming the reset was persisted.
          if (!local.state && session.state) {
            try { storage('localStorage').setItem(STORAGE_KEY, JSON.stringify(memory)); }
            catch { return { state: normalizeState(memory, options), persisted: false, status: 'memory', reason: 'write-failed' }; }
          }
        }
        return { state: normalizeState(memory, options), persisted: true, status: 'local', reason: '' };
      }
      const candidates = [
        ...(local.state ? [{ state: local.state, status: 'local' }] : []),
        ...(!suppressSession && session.state ? [{ state: session.state, status: 'session' }] : []),
        ...(memoryActive ? [{ state: normalizeState(memory, options), status: 'memory' }] : []),
      ].sort((a, b) => b.state.revision - a.state.revision);
      const chosen = candidates[0];
      memory = chosen?.state || emptyState();
      const status = chosen?.status || (storage('localStorage') && local.reason !== 'unavailable' ? 'local' : storage('sessionStorage') && session.reason !== 'unavailable' ? 'session' : 'memory');
      return { state: normalizeState(memory, options), persisted: status === 'local', status, reason: status === 'local' ? local.reason : local.reason || session.reason };
    }
    function save(value, options = {}) {
      memory = normalizeState(value, options);
      memoryActive = true;
      let serialized = JSON.stringify(memory);
      let trimmed = false;
      // Bound bytes as well as record counts, even for unusually long URLs.
      while (serialized.length > MAX_STORAGE_LENGTH) {
        const withChanges = memory.follows.filter((entry) => entry.changes.length);
        const candidates = withChanges.length ? withChanges : memory.follows.filter((entry) => entry.observations.length);
        if (!candidates.length) break;
        for (const entry of candidates) {
          if (withChanges.length) entry.changes.pop();
          else entry.observations.pop();
        }
        trimmed = true;
        serialized = JSON.stringify(memory);
      }
      let reason = 'unavailable';
      for (const [name, status] of [['localStorage', 'local'], ['sessionStorage', 'session']]) {
        try {
          const target = storage(name);
          if (!target) continue;
          target.setItem(STORAGE_KEY, serialized);
          if (status === 'local') {
            try { storage('sessionStorage')?.removeItem(STORAGE_KEY); } catch { /* Revisions keep a stale shadow harmless. */ }
          }
          return { state: normalizeState(memory, options), persisted: status === 'local', status, reason: status === 'local' ? (trimmed ? 'trimmed' : '') : reason };
        } catch (error) { reason = error?.name === 'QuotaExceededError' ? 'quota' : 'write-failed'; }
      }
      return { state: normalizeState(memory, options), persisted: false, status: 'memory', reason };
    }
    return { load, save };
  }

  window.GameFollowUtils = Object.freeze({ VERSION, STORAGE_KEY, MAX_FOLLOWS, MAX_OBSERVATIONS, MAX_CHANGES,
    PRICE_FRESHNESS_MS, EVENT_FRESHNESS_MS, emptyState, safeUrl, normalizeIdentity, identityKey, normalizeObservation,
    normalizeState, observationStatus, followGame, removeGame, applyObservations, listChanges, observationFromSteamOffer, createStore });
})();
