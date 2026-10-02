import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../refresh-status.js', import.meta.url), 'utf8');
const context = vm.createContext({ Intl, Date });
vm.runInContext(source, context);
const { buildRefreshNotice, loadRefreshNotice } = context.RefreshHealth;
const now = Date.parse('2026-10-02T06:00:00Z');
const fresh = '2026-10-02T05:30:00Z';
const report = (data = {}, extra = {}) => ({ schemaVersion: 1, status: 'ok', checkedAt: new Date(now).toISOString(), datasets: { 'home-news.json': { generatedAt: fresh, retained: false, ...data } }, ...extra });

test('normal data and image/count warnings do not show a freshness alarm', () => {
  assert.equal(buildRefreshNotice(report(), { now }).visible, false);
  assert.equal(buildRefreshNotice(report({}, { status: 'warning' }), { now }).visible, false);
});

test('stopped scheduler becomes stale from browser clock even with fresh checkedAt or stale=false', () => {
  const result = buildRefreshNotice(report({ generatedAt: '2026-10-02T01:00:00Z', stale: false }), { now });
  assert.equal(result.visible, true);
  assert.match(result.text, /更新が遅れています/);
  assert.match(result.text, /最終取得 2026\/10\/2 10:00 JST/);
  assert.ok(!result.text.includes('15:00'));
});

test('retained recent data shows original fetch timestamp without claiming it was refreshed', () => {
  const result = buildRefreshNotice(report({ retained: true }), { now });
  assert.equal(result.visible, true);
  assert.match(result.text, /前回のデータを表示中.*14:30 JST/);
});

test('news page scopes the message to its own dataset and missing data is not invented', () => {
  const input = report();
  input.datasets['events.json'] = { generatedAt: '2026-10-01T01:00:00Z', retained: true };
  assert.equal(buildRefreshNotice(input, { now, files: ['home-news.json'] }).visible, false);
  assert.match(buildRefreshNotice(input, { now }).text, /イベント/);
  assert.equal(buildRefreshNotice(null, { now }).visible, false);
  assert.match(buildRefreshNotice(report({ generatedAt: null, retained: true }), { now }).text, /取得日時不明/);
});

test('loader uses textContent, no-store, and remains non-blocking on missing report', async () => {
  const element = { textContent: '', hidden: true, dataset: { refreshDatasets: 'home-news.json' } };
  const document = { getElementById: () => element };
  await loadRefreshNotice({ document, now: () => now, fetchImpl: async (_url, options) => {
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => report({ retained: true }) };
  } });
  assert.equal(element.hidden, false);
  assert.match(element.textContent, /前回のデータ/);
  await loadRefreshNotice({ document, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(element.hidden, false);
});
