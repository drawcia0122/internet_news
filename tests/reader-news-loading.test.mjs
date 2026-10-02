import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
await import('../home-reader-loading.js');

const { createSharedArchivePager, createReaderNewsLoader } = globalThis.HomeReaderLoading;
const asyncTest = (name, fn) => test(name, { timeout: 2000 }, fn);
const stories = (kind, count, prefix = kind) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, kind }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate) {
  for (let turn = 0; turn < 100 && !predicate(); turn += 1) await Promise.resolve();
  assert.ok(predicate(), 'expected asynchronous work did not start');
}

function fixture({ pages = {}, initialItems = [], initialCursor = 2, enabled = true, ready = true, fetchPage, ensureOnUpdate = false } = {}) {
  const state = { cursor: initialCursor, items: [...initialItems], enabled, ready, wanted: 'match' };
  const requests = [];
  const applied = [];
  const notifications = [];
  const updates = [];
  const pager = createSharedArchivePager({
    getCursor: () => state.cursor,
    async fetchPage(page) {
      requests.push(page);
      assert.ok(requests.length < 30, 'archive fetching must be bounded');
      if (fetchPage) return fetchPage(page);
      assert.ok(Object.hasOwn(pages, page), `unexpected page ${page}`);
      return pages[page];
    },
    applyPage(payload) {
      applied.push(payload);
      state.items.push(...payload.items);
      state.cursor = payload.nextPage;
    },
    onUpdate(...args) {
      updates.push(args);
      if (ensureOnUpdate) loader.ensure();
    },
  });
  const count = () => state.items.filter((item) => item.kind === state.wanted).length;
  const loader = createReaderNewsLoader({
    isEnabled: () => state.enabled,
    isReady: () => state.ready,
    getCount: count,
    hasMore: () => state.cursor !== null,
    loadNext: () => pager.loadNext(),
    onState: (value) => notifications.push({ ...value }),
    limit: 10,
  });
  return { state, requests, applied, updates, notifications, pager, loader, count };
}

asyncTest('later archive matches replenish to ten and stop before an unnecessary page', async () => {
  const f = fixture({
    initialItems: stories('other', 3, 'initial'),
    pages: {
      2: { items: stories('other', 5, 'page2'), nextPage: 3 },
      3: { items: stories('match', 10, 'page3'), nextPage: 4 },
      4: { items: stories('match', 4, 'page4'), nextPage: null },
    },
  });
  await f.loader.ensure();
  assert.deepEqual(f.requests, [2, 3]);
  assert.equal(f.count(), 10);
  assert.equal(f.state.cursor, 4);
  assert.deepEqual(f.loader.getState(), { phase: 'complete', retryable: false });
  await f.loader.ensure();
  assert.deepEqual(f.requests, [2, 3], 'rendering again cannot fetch past the target');
});

asyncTest('zero matches exhaust the finite archive without restoring unwanted stories', async () => {
  const f = fixture({ pages: {
    2: { items: stories('other', 4, 'page2'), nextPage: 3 },
    3: { items: [], nextPage: 4 },
    4: { items: stories('other', 4, 'page4'), nextPage: null },
  } });
  await f.loader.ensure();
  assert.deepEqual(f.requests, [2, 3, 4]);
  assert.equal(f.count(), 0);
  assert.equal(f.state.cursor, null);
  assert.deepEqual(f.loader.getState(), { phase: 'complete', retryable: false });
  await f.loader.ensure();
  assert.equal(f.requests.length, 3);
});

asyncTest('a partial match set stops cleanly at archive exhaustion', async () => {
  const f = fixture({ initialItems: stories('match', 2, 'initial'), pages: {
    2: { items: stories('match', 3, 'page2'), nextPage: null },
  } });
  await f.loader.ensure();
  assert.equal(f.count(), 5);
  assert.deepEqual(f.requests, [2]);
  assert.deepEqual(f.loader.getState(), { phase: 'complete', retryable: false });
});

asyncTest('default-disabled preferences and an unready initial snapshot perform no requests', async () => {
  const f = fixture({ enabled: false, ready: false, pages: { 2: { items: [], nextPage: null } } });
  await f.loader.ensure();
  assert.deepEqual(f.requests, []);
  assert.equal(f.loader.getState().phase, 'idle');
  f.state.enabled = true;
  await f.loader.ensure();
  assert.deepEqual(f.requests, []);
  f.state.ready = true;
  await f.loader.ensure();
  assert.deepEqual(f.requests, [2]);
});

asyncTest('an already full or exhausted initial candidate set does not fetch', async () => {
  const full = fixture({ initialItems: stories('match', 10) });
  await full.loader.ensure();
  assert.deepEqual(full.requests, []);
  assert.equal(full.loader.getState().phase, 'complete');
  const exhausted = fixture({ initialCursor: null });
  await exhausted.loader.ensure();
  assert.deepEqual(exhausted.requests, []);
  assert.equal(exhausted.loader.getState().phase, 'complete');
});

asyncTest('network failure retains loaded cards and cursor until explicit retry clears the error', async () => {
  let attempts = 0;
  const f = fixture({ initialItems: stories('match', 2, 'initial'), fetchPage() {
    if (++attempts === 1) throw new Error('temporary network failure');
    return { items: stories('match', 8, 'page2'), nextPage: 3 };
  } });
  await f.loader.ensure();
  assert.deepEqual(f.loader.getState(), { phase: 'error', retryable: true });
  assert.equal(f.state.cursor, 2);
  assert.equal(f.count(), 2);
  assert.equal(f.applied.length, 0);
  await f.loader.ensure();
  assert.deepEqual(f.requests, [2], 'rendering does not silently retry an error');
  await f.loader.retry();
  assert.deepEqual(f.requests, [2, 2]);
  assert.equal(f.count(), 10);
  assert.equal(f.state.cursor, 3);
  assert.deepEqual(f.loader.getState(), { phase: 'complete', retryable: false });
  assert.ok(f.notifications.some(({ phase, retryable }) => phase === 'error' && retryable));
  assert.equal(f.notifications.at(-1).phase, 'complete');
});

asyncTest('invalid archive payload cannot be appended or consume the retry cursor', async () => {
  const f = fixture({ fetchPage: () => ({ items: null, nextPage: 3 }) });
  const result = await f.pager.loadNext();
  assert.equal(result.status, 'error');
  assert.equal(f.state.cursor, 2);
  assert.equal(f.applied.length, 0);
  assert.deepEqual(f.state.items, []);
});

asyncTest('simultaneous ensures share pending work rather than duplicate pages', async () => {
  const pending = deferred();
  const f = fixture({ fetchPage: () => pending.promise });
  const runs = [f.loader.ensure(), f.loader.ensure(), f.loader.ensure()];
  await until(() => f.requests.length === 1);
  assert.deepEqual(f.requests, [2]);
  pending.resolve({ items: stories('match', 10, 'page2'), nextPage: 3 });
  await Promise.all(runs);
  assert.deepEqual(f.requests, [2]);
  assert.equal(f.applied.length, 1);
  assert.equal(f.count(), 10);
});

asyncTest('preference change during a pending page uses the new match count', async () => {
  const pending = deferred();
  const f = fixture({ fetchPage(page) {
    return page === 2 ? pending.promise : { items: stories('new', 10, 'page3'), nextPage: 4 };
  } });
  const oldRun = f.loader.ensure();
  await until(() => f.requests.length === 1);
  f.state.wanted = 'new';
  f.loader.restart();
  const newRun = f.loader.ensure();
  pending.resolve({ items: stories('match', 10, 'page2'), nextPage: 3 });
  await Promise.all([oldRun, newRun]);
  assert.deepEqual(f.requests, [2, 3]);
  assert.equal(f.count(), 10);
  assert.equal(f.applied.length, 2);
  assert.deepEqual(f.loader.getState(), { phase: 'complete', retryable: false });
});

asyncTest('resetting preferences during a request stops automatic archive continuation', async () => {
  const pending = deferred();
  const f = fixture({ fetchPage: () => pending.promise });
  const oldRun = f.loader.ensure();
  await until(() => f.requests.length === 1);
  f.state.enabled = false;
  f.loader.restart();
  await f.loader.ensure();
  pending.resolve({ items: stories('other', 5, 'page2'), nextPage: 3 });
  await oldRun;
  assert.deepEqual(f.requests, [2]);
  assert.equal(f.loader.getState().phase, 'idle');
  assert.equal(f.loader.getState().retryable, false);
});

asyncTest('repeated saves during the same pending page do not duplicate fetch or append', async () => {
  const pending = deferred();
  const f = fixture({ fetchPage: () => pending.promise });
  const runs = [f.loader.ensure()];
  await until(() => f.requests.length === 1);
  for (let save = 0; save < 3; save += 1) {
    f.loader.restart();
    runs.push(f.loader.ensure());
  }
  pending.resolve({ items: stories('match', 10, 'page2'), nextPage: 3 });
  await Promise.all(runs);
  assert.deepEqual(f.requests, [2]);
  assert.equal(f.applied.length, 1);
  assert.equal(f.count(), 10);
  assert.equal(f.loader.getState().phase, 'complete');
});

for (const manualFirst of [true, false]) {
  asyncTest(`normal-news and personal loads share a page when ${manualFirst ? 'manual' : 'personal'} loading starts first`, async () => {
    const pending = deferred();
    const f = fixture({ fetchPage(page) {
      return page === 2 ? pending.promise : { items: stories('match', 5, 'page3'), nextPage: 4 };
    } });
    let manual;
    let personal;
    if (manualFirst) {
      manual = f.pager.loadNext();
      personal = f.loader.ensure();
    } else {
      personal = f.loader.ensure();
      await until(() => f.requests.length === 1);
      manual = f.pager.loadNext();
    }
    await until(() => f.requests.length === 1);
    pending.resolve({ items: stories('match', 5, 'page2'), nextPage: 3 });
    const [manualResult] = await Promise.all([manual, personal]);
    assert.equal(manualResult.status, 'loaded');
    assert.deepEqual(f.requests, [2, 3]);
    assert.equal(f.applied.length, 2);
    assert.equal(new Set(f.state.items.map(({ id }) => id)).size, 10);
    assert.equal(f.count(), 10);
  });
}

asyncTest('pager coalesces callers and reports exhaustion without a request', async () => {
  const pending = deferred();
  const f = fixture({ fetchPage: () => pending.promise });
  const first = f.pager.loadNext();
  const second = f.pager.loadNext();
  assert.equal(first, second, 'all consumers receive the same in-flight promise');
  pending.resolve({ items: [], nextPage: null });
  assert.equal((await first).status, 'loaded');
  assert.equal((await f.pager.loadNext()).status, 'exhausted');
  assert.deepEqual(f.requests, [2]);
  assert.equal(f.applied.length, 1);
});

asyncTest('cyclic archive cursors cannot refetch an already applied page indefinitely', async () => {
  const f = fixture({ pages: {
    2: { items: [], nextPage: 3 },
    3: { items: [], nextPage: 2 },
  } });
  await f.loader.ensure();
  assert.deepEqual(f.requests, [2, 3]);
  assert.equal(f.applied.length, 2);
  assert.notEqual(f.loader.getState().phase, 'loading');
  assert.equal(f.loader.getState().retryable, false);
  await f.loader.ensure();
  assert.deepEqual(f.requests, [2, 3]);
});

asyncTest('invalid page numbers cannot reach archive fetch', async () => {
  for (const cursor of [-1, 0, 1, 2.5, 10001, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '2', true, {}]) {
    const f = fixture({ initialCursor: cursor });
    const result = await f.pager.loadNext();
    assert.ok(['error', 'exhausted'].includes(result.status));
    assert.deepEqual(f.requests, [], `must reject invalid cursor ${String(cursor)}`);
    assert.equal(f.applied.length, 0);
  }
});

asyncTest('new initial snapshot invalidates an older pending page before it can append', async () => {
  const pending = deferred();
  const f = fixture({ fetchPage(page) {
    return page === 2 ? pending.promise : { items: stories('match', 1, 'fresh-page'), nextPage: null };
  } });
  const oldRun = f.pager.loadNext();
  await until(() => f.requests.length === 1);
  f.pager.reset();
  f.state.items = stories('match', 1, 'fresh-initial');
  f.state.cursor = 7;
  pending.resolve({ items: stories('match', 3, 'outdated-page'), nextPage: 3 });
  assert.equal((await oldRun).status, 'stale');
  assert.equal(f.state.cursor, 7);
  assert.deepEqual(f.state.items.map(({ id }) => id), ['fresh-initial-0']);
  assert.equal(f.applied.length, 0);
  assert.equal((await f.pager.loadNext()).status, 'loaded');
  assert.deepEqual(f.requests, [2, 7]);
  assert.deepEqual(f.state.items.map(({ id }) => id), ['fresh-initial-0', 'fresh-page-0']);
});

asyncTest('archive-render callbacks can reenter ensure without duplicate requests or deadlock', async () => {
  const f = fixture({ ensureOnUpdate: true, pages: {
    2: { items: stories('other', 3, 'page2'), nextPage: 3 },
    3: { items: stories('match', 5, 'page3'), nextPage: 4 },
    4: { items: stories('match', 5, 'page4'), nextPage: 5 },
  } });
  await f.loader.ensure();
  assert.deepEqual(f.requests, [2, 3, 4]);
  assert.equal(f.updates.length, 3);
  assert.equal(f.count(), 10);
  assert.deepEqual(f.loader.getState(), { phase: 'complete', retryable: false });
  assert.deepEqual(f.notifications.map(({ phase }) => phase), ['loading', 'complete']);
});

for (const staleFailure of [false, true]) {
  asyncTest(`a refreshed initial snapshot resumes its new cursor after the shared old page ${staleFailure ? 'fails' : 'resolves'}`, async () => {
    const pending = deferred();
    const f = fixture({ ensureOnUpdate: true, fetchPage(page) {
      return page === 2 ? pending.promise : { items: stories('match', 9, 'fresh-page'), nextPage: 8 };
    } });
    const oldRun = f.loader.ensure();
    await until(() => f.requests.length === 1);
    f.state.ready = false;
    f.loader.restart();
    f.pager.reset();
    await f.loader.ensure();
    assert.deepEqual(f.requests, [2], 'no request while initial data is not ready');
    f.state.items = stories('match', 1, 'fresh-initial');
    f.state.cursor = 7;
    f.state.ready = true;
    const newRun = f.loader.ensure();
    if (staleFailure) pending.reject(new Error('old snapshot request failed'));
    else pending.resolve({ items: stories('match', 10, 'stale-page'), nextPage: 3 });
    await Promise.all([oldRun, newRun]);
    assert.deepEqual(f.requests, [2, 7]);
    assert.equal(f.applied.length, 1);
    assert.equal(f.updates.length, 1, 'stale responses cannot trigger archive render');
    assert.equal(f.count(), 10);
    assert.equal(f.state.items.some(({ id }) => id.startsWith('stale')), false);
    assert.equal(f.state.cursor, 8);
    assert.deepEqual(f.loader.getState(), { phase: 'complete', retryable: false });
    assert.equal(f.notifications.some(({ phase }) => phase === 'error'), false);
  });
}

asyncTest('pager exposes failed state for auto-load guards and clears it on successful retry/reset', async () => {
  let fail = true;
  const f = fixture({ fetchPage() {
    if (fail) throw new Error('offline');
    return { items: stories('match', 1, 'recovered'), nextPage: null };
  } });
  assert.deepEqual(f.pager.getState(), { failed: false });
  assert.equal((await f.pager.loadNext()).status, 'error');
  assert.deepEqual(f.pager.getState(), { failed: true });
  assert.equal(f.state.cursor, 2, 'failed cursor stays retryable');
  fail = false;
  assert.equal((await f.pager.loadNext()).status, 'loaded');
  assert.deepEqual(f.pager.getState(), { failed: false });
  f.state.cursor = 2;
  assert.equal((await f.pager.loadNext()).retryable, false, 'cycle sets a non-retryable failure');
  assert.deepEqual(f.pager.getState(), { failed: true });
  f.pager.reset();
  assert.deepEqual(f.pager.getState(), { failed: false });
});

asyncTest('malformed responses and failed application do not consume the retryable page cursor', async () => {
  for (const malformed of [null, {}, { items: null }, { items: 'bad' }]) {
    let payload = malformed;
    const f = fixture({ fetchPage: () => payload });
    assert.equal((await f.pager.loadNext()).status, 'error');
    assert.equal(f.state.cursor, 2);
    payload = { items: [], nextPage: null };
    assert.equal((await f.pager.loadNext()).status, 'loaded');
    assert.deepEqual(f.requests, [2, 2]);
  }
  let fail = true;
  let cursor = 2;
  const pager = createSharedArchivePager({ getCursor: () => cursor, fetchPage: async () => ({ items: [] }),
    applyPage() { if (fail) throw new Error('cannot normalize'); cursor = null; } });
  assert.equal((await pager.loadNext()).status, 'error');
  fail = false;
  assert.equal((await pager.loadNext()).status, 'loaded');
  assert.deepEqual(pager.getState(), { failed: false });
});
