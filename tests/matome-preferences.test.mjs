import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MATOME_DEFAULT_CATEGORY_ORDER, MATOME_PREFERENCES_KEY, loadMatomePreferences,
  normalizeMatomePreferences, resetMatomePreferences, saveMatomePreferences,
} from '../matome-preferences.js';
import {
  MATOME_CATEGORIES, getMatomeViewModel, getNextMatomeCategory,
  initializeMatomeSection, normalizeMatomePayload,
} from '../matome-section.js';

const NOW = Date.parse('2026-10-02T03:00:00Z');
const defaults = () => ({ version: 1, categoryOrder: [...MATOME_DEFAULT_CATEGORY_ORDER], hiddenSourceIds: [] });
const choice = (overrides = {}) => ({ ...defaults(), ...overrides });
const sources = [
  { id: 'first', name: '取得元A', siteUrl: 'https://first.example.com/', status: 'ok' },
  { id: 'second', name: '取得元B', siteUrl: 'https://second.example.com/', status: 'ok' },
];
const sourceIds = sources.map(({ id }) => id);
const fixture = {
  schemaVersion: 1, generatedAt: new Date(NOW).toISOString(), checkedAt: new Date(NOW).toISOString(),
  status: 'ok', sources,
  items: Array.from({ length: 16 }, (_, i) => ({
    id: `item-${i}`, title: `まとめ記事 ${i}`, sourceId: sources[i % 2].id,
    url: `${sources[i % 2].siteUrl}archives/${i + 1}.html`,
    categories: i < 14 ? ['game', ...(i < 4 ? ['anime'] : [])] : ['chat', 'neta'],
    publishedAt: new Date(NOW - (i + 1) * 1000).toISOString(),
  })),
};
function storage(initial = null) {
  const data = new Map([['unrelated-reader-key', 'untouched']]);
  if (initial !== null) data.set(MATOME_PREFERENCES_KEY, initial);
  return {
    data,
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

test('malformed shapes and unsupported versions keep current defaults', () => {
  for (const value of [undefined, null, true, false, [], '', 1, {}, { version: '1' },
    { version: 2, categoryOrder: ['neta'], hiddenSourceIds: ['first'] }]) {
    assert.deepEqual(normalizeMatomePreferences(value, sourceIds), defaults());
  }
  for (const value of [undefined, null, '', 1, true, {}, 'neta']) {
    assert.deepEqual(normalizeMatomePreferences(choice({ categoryOrder: value, hiddenSourceIds: value }), sourceIds), defaults());
  }
});

test('normalization limits choices to supported IDs, repairs order, removes duplicates, and does not mutate input', () => {
  const input = Object.freeze({ version: 1,
    categoryOrder: Object.freeze(['neta', 'neta', '__proto__', false, {}, 'game']),
    hiddenSourceIds: Object.freeze(['first', 'first', 'unknown', '__proto__', '<img>', {}, false, 'second']),
  });
  const result = normalizeMatomePreferences(input, sourceIds);
  assert.deepEqual(result, { version: 1, categoryOrder: ['neta', 'game', 'anime', 'chat'], hiddenSourceIds: sourceIds });
  assert.deepEqual(normalizeMatomePreferences(input).hiddenSourceIds, []);
  assert.deepEqual(normalizeMatomePreferences(input, ['first', {}, '__proto__']).hiddenSourceIds, ['first']);
  assert.deepEqual(input.categoryOrder, ['neta', 'neta', '__proto__', false, {}, 'game']);
  result.categoryOrder.reverse();
  assert.deepEqual(MATOME_DEFAULT_CATEGORY_ORDER, ['game', 'anime', 'chat', 'neta']);
});

test('missing, corrupt, oversized and unknown-version storage fails safely without changing other keys', () => {
  for (const text of ['{broken', 'null', '[]', 'false', '"text"', '{"version":999}', 'x'.repeat(20001)]) {
    const localStorage = storage(text);
    const result = loadMatomePreferences(sourceIds, { localStorage });
    assert.deepEqual(result.preferences, defaults());
    assert.equal(result.status, 'invalid');
    assert.equal(localStorage.getItem(MATOME_PREFERENCES_KEY), text, 'reading does not overwrite corrupt settings');
  }
  assert.equal(loadMatomePreferences(sourceIds, { localStorage: storage() }).status, 'missing');
});

test('save and reset are repeatable, versioned and isolated from all other browser data', () => {
  const localStorage = storage();
  const windowRef = { localStorage };
  const value = choice({ categoryOrder: ['neta', 'chat', 'game', 'anime'], hiddenSourceIds: ['first', 'unknown'] });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(saveMatomePreferences(value, sourceIds, windowRef).saved, true);
    assert.deepEqual(loadMatomePreferences(sourceIds, windowRef).preferences, { ...value, hiddenSourceIds: ['first'] });
    assert.equal(JSON.parse(localStorage.getItem(MATOME_PREFERENCES_KEY)).version, 1);
  }
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(resetMatomePreferences(windowRef), { preferences: defaults(), saved: true });
    assert.equal(loadMatomePreferences(sourceIds, windowRef).status, 'missing');
  }
  assert.equal(localStorage.getItem('unrelated-reader-key'), 'untouched');
});

test('blocked storage getters, reads, writes and removals return honest failure with usable session defaults', () => {
  const fail = () => { throw new Error('Storage denied'); };
  for (const windowRef of [undefined, {}, { get localStorage() { return fail(); } },
    { localStorage: { getItem: fail, setItem: fail, removeItem: fail } }]) {
    assert.equal(loadMatomePreferences(sourceIds, windowRef).status, 'unavailable');
    const value = choice({ hiddenSourceIds: ['first'] });
    assert.deepEqual(saveMatomePreferences(value, sourceIds, windowRef), { preferences: value, saved: false });
    assert.deepEqual(resetMatomePreferences(windowRef), { preferences: defaults(), saved: false });
  }
});

test('hidden sources are filtered before multi-category counts and paging, including a fully hidden view', () => {
  const preferences = choice({ categoryOrder: ['neta', 'chat', 'game', 'anime'], hiddenSourceIds: ['first', 'unknown'] });
  assert.equal(getMatomeViewModel(fixture, { now: NOW, preferences }).category, 'neta');
  const view = getMatomeViewModel(fixture, { now: NOW, category: 'game', preferences });
  assert.deepEqual(view.counts, { game: 7, anime: 2, chat: 1, neta: 1 });
  assert.equal(view.items.length, 6);
  assert.equal(view.total, 7);
  assert.equal(view.moreCount, 1);
  assert.ok(view.items.every(({ sourceId }) => sourceId === 'second'));
  assert.equal(getMatomeViewModel(fixture, { now: NOW, category: 'game', visibleCount: 12, preferences }).items.length, 7);
  const hidden = getMatomeViewModel(fixture, { now: NOW, preferences: choice({ hiddenSourceIds: sourceIds }) });
  assert.equal(hidden.status, 'filtered-empty');
  assert.equal(hidden.total, 0);
  assert.equal(hidden.moreCount, 0);
  assert.deepEqual(hidden.counts, { game: 0, anime: 0, chat: 0, neta: 0 });
  assert.match(hidden.emptyMessage, /表示設定/);
  assert.deepEqual(normalizeMatomePayload(fixture, NOW).sources, sources);
});

test('tab keyboard navigation follows normalized saved order', () => {
  const order = ['neta', 'chat', 'game', 'anime'];
  assert.equal(getNextMatomeCategory('neta', 'ArrowLeft', order), 'anime');
  assert.equal(getNextMatomeCategory('anime', 'ArrowRight', order), 'neta');
  assert.equal(getNextMatomeCategory('neta', 'ArrowRight', order), 'chat');
  assert.equal(getNextMatomeCategory('game', 'Home', order), 'neta');
  assert.equal(getNextMatomeCategory('chat', 'End', order), 'anime');
  assert.equal(getNextMatomeCategory('game', 'Tab', order), null);
  assert.equal(getNextMatomeCategory('neta', 'ArrowRight', ['neta', 'neta', 'unknown']), 'game');
});

// DOM-only controller harness with persistent nodes and parent relationships.
class Element {
  constructor(tagName, ownerDocument) {
    Object.assign(this, { tagName, ownerDocument, children: [], dataset: {}, parentNode: null,
      attributes: new Map(), listeners: new Map(), hidden: false, disabled: false, checked: false, _text: '' });
  }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join(''); }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
  }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  insertBefore(node, next) { node.remove(); node.parentNode = this; this.children.splice(this.children.indexOf(next), 0, node); }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this._text = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  fire(type, event = {}) { if (this.disabled && type === 'click') return; for (const fn of this.listeners.get(type) ?? []) fn(event); }
  focus() { this.ownerDocument.activeElement = this; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector === '[role="tablist"]') return this.getAttribute('role') === 'tablist';
    const data = selector.match(/^\[data-([a-z-]+)\]$/u)?.[1];
    if (data) return data.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()) in this.dataset;
    return this.tagName === selector;
  }
  querySelectorAll(selector) { return this.children.flatMap((node) => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
function setup({ localStorage = storage(), fetchImpl = async () => ({ ok: true, json: async () => fixture }) } = {}) {
  const documentRef = new Element('document');
  documentRef.ownerDocument = documentRef;
  documentRef.createElement = (tag) => new Element(tag, documentRef);
  documentRef.visibilityState = 'visible';
  const root = documentRef.createElement('section');
  const add = (parent, tag, id) => { const node = documentRef.createElement(tag); node.id = id; parent.append(node); return node; };
  const tabList = add(root, 'div', 'tab-list'); tabList.setAttribute('role', 'tablist');
  const tabs = MATOME_CATEGORIES.map(({ id }) => {
    const node = add(tabList, 'button', `matome-tab-${id}`); node.dataset.matomeCategory = id;
    add(node, 'span').dataset.matomeCount = ''; return node;
  });
  const panel = add(root, 'div', 'matome-panel');
  const list = add(panel, 'ul', 'matome-list');
  const empty = add(panel, 'div', 'matome-empty');
  const more = add(panel, 'button', 'matome-more');
  add(root, 'p', 'matome-status'); add(root, 'p', 'matome-updated');
  let nextTimer = 0;
  const windowRef = { localStorage, setTimeout: () => ++nextTimer, clearTimeout() {}, setInterval: () => ++nextTimer, clearInterval() {} };
  const controller = initializeMatomeSection(root, { documentRef, windowRef, now: () => NOW, fetchImpl });
  const get = (id) => root.querySelector(`#${id}`);
  const save = get('matome-preferences-save');
  const reset = get('matome-preferences-reset');
  const settingsStatus = get('matome-preferences-status');
  const source = (id) => root.querySelectorAll('[data-matome-hide-source]').find((input) => input.dataset.matomeHideSource === id);
  const move = (id, direction) => root.querySelectorAll('[data-matome-move]').find((button) => button.dataset.matomeMove === `${id}:${direction}`);
  const order = () => tabList.children.map((node) => node.dataset.matomeCategory);
  return { root, tabs, panel, list, empty, more, controller, documentRef, localStorage, save, reset, settingsStatus, source, move, order };
}

test('controller loads first preferred tab, validates publisher options, filters counts and follows saved keyboard order', async () => {
  const value = choice({ categoryOrder: ['neta', 'chat', 'game', 'anime'], hiddenSourceIds: ['first', 'injected'] });
  const ui = setup({ localStorage: storage(JSON.stringify(value)), fetchImpl: async () => ({ ok: true, json: async () => ({
    ...fixture, sources: [...sources, { id: 'injected', name: '<img src=x onerror=bad()>', siteUrl: 'https://bad.example.com', status: 'ok' }],
  }) }) });
  await ui.controller.refresh();
  assert.deepEqual(ui.order(), value.categoryOrder);
  assert.equal(ui.tabs[3].getAttribute('aria-selected'), 'true');
  assert.equal(ui.list.children.length, 1);
  assert.equal(ui.source('first').checked, true);
  assert.equal(ui.source('injected'), undefined);
  ui.tabs[3].fire('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.equal(ui.documentRef.activeElement, ui.tabs[2]);
  ui.tabs[2].fire('keydown', { key: 'End', preventDefault() {} });
  assert.equal(ui.documentRef.activeElement, ui.tabs[1]);
  ui.controller.destroy();
});

test('draft moves and source changes apply only on save, preserve focus, survive refresh, and reset paging safely', async () => {
  let failed = false;
  const ui = setup({ fetchImpl: async () => { if (failed) throw new Error('offline'); return { ok: true, json: async () => fixture }; } });
  await ui.controller.refresh();
  ui.more.fire('click');
  assert.equal(ui.list.children.length, 12);
  const move = ui.move('neta', -1);
  move.focus();
  for (let i = 0; i < 3; i += 1) move.fire('click');
  assert.equal(ui.documentRef.activeElement, move);
  assert.equal(move.getAttribute('aria-disabled'), 'true');
  assert.deepEqual(ui.order(), defaults().categoryOrder, 'draft order does not change tabs');
  const checkbox = ui.source('first');
  checkbox.checked = true; checkbox.fire('change'); checkbox.focus();
  await ui.controller.refresh();
  assert.equal(ui.documentRef.activeElement, checkbox);
  assert.equal(checkbox.checked, true, 'refresh retains unsaved checkbox');
  assert.equal(ui.list.children.length, 12, 'unsaved filters do not affect pagination');
  ui.save.focus(); ui.save.fire('click');
  assert.equal(ui.documentRef.activeElement, ui.save);
  assert.deepEqual(ui.order(), ['neta', 'game', 'anime', 'chat']);
  assert.equal(ui.list.children.length, 6);
  assert.equal(ui.tabs[0].getAttribute('aria-selected'), 'true', 'save keeps the current category');
  assert.equal(ui.tabs[0].querySelector('[data-matome-count]').textContent, '7');
  assert.equal(ui.more.textContent, 'さらに1件見る ↓');
  ui.more.fire('click');
  assert.equal(ui.list.children.length, 7);
  failed = true;
  await ui.controller.refresh();
  assert.equal(ui.list.children.length, 7);
  assert.equal(ui.root.dataset.matomeStatus, 'network-error');
  assert.deepEqual(ui.order(), ['neta', 'game', 'anime', 'chat']);
  ui.save.focus(); ui.save.fire('click'); ui.save.fire('click');
  assert.equal(ui.list.children.length, 6, 'repeat save safely resets pagination');
  assert.equal(ui.documentRef.activeElement, ui.save);
  const reloaded = setup({ localStorage: ui.localStorage });
  await reloaded.controller.refresh();
  assert.equal(reloaded.tabs[3].getAttribute('aria-selected'), 'true');
  assert.equal(reloaded.source('first').checked, true);
  reloaded.controller.destroy();
  ui.reset.focus(); ui.reset.fire('click'); ui.reset.fire('click');
  assert.equal(ui.documentRef.activeElement, ui.reset);
  assert.deepEqual(ui.order(), defaults().categoryOrder);
  assert.equal(ui.list.children.length, 6);
  assert.equal(ui.tabs[0].querySelector('[data-matome-count]').textContent, '14');
  assert.equal(ui.source('first').checked, false);
  assert.equal(ui.localStorage.getItem(MATOME_PREFERENCES_KEY), null);
  assert.equal(ui.localStorage.getItem('unrelated-reader-key'), 'untouched');
  ui.controller.destroy();
});

test('blocked save/reset applies only the session state and reports both failures honestly', async () => {
  const localStorage = storage(JSON.stringify(choice({ categoryOrder: ['anime', 'game', 'chat', 'neta'] })));
  localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  localStorage.removeItem = () => { throw new Error('Blocked'); };
  const ui = setup({ localStorage });
  await ui.controller.refresh();
  for (const id of sourceIds) { ui.source(id).checked = true; ui.source(id).fire('change'); }
  ui.save.fire('click');
  assert.equal(ui.list.children.length, 0);
  assert.equal(ui.more.hidden, true);
  assert.match(ui.settingsStatus.textContent, /保存できませんでした/);
  assert.match(ui.empty.textContent, /表示設定/);
  ui.reset.fire('click');
  assert.equal(ui.list.children.length, 6);
  assert.equal(ui.tabs[0].getAttribute('aria-selected'), 'true');
  assert.match(ui.settingsStatus.textContent, /削除できませんでした/);
  assert.equal(JSON.parse(localStorage.getItem(MATOME_PREFERENCES_KEY)).categoryOrder[0], 'anime');
  ui.controller.destroy();
});

test('initial acquisition outage preserves stored hidden IDs until recovery, while reset remains available', async () => {
  let fail = true;
  const localStorage = storage(JSON.stringify(choice({ hiddenSourceIds: ['first'] })));
  const ui = setup({ localStorage, fetchImpl: async () => { if (fail) throw new Error('offline'); return { ok: true, json: async () => fixture }; } });
  await ui.controller.refresh();
  assert.equal(ui.save.disabled, true);
  assert.equal(ui.reset.disabled, false);
  assert.deepEqual(JSON.parse(localStorage.getItem(MATOME_PREFERENCES_KEY)).hiddenSourceIds, ['first']);
  fail = false;
  await ui.controller.refresh();
  assert.equal(ui.source('first').checked, true);
  assert.equal(ui.tabs[0].querySelector('[data-matome-count]').textContent, '7');
  ui.controller.destroy();
});

test('preferred selection is applied before acquisition finishes and reset can clear an outage safely', async () => {
  let release;
  const localStorage = storage(JSON.stringify(choice({ categoryOrder: ['chat', 'game', 'anime', 'neta'], hiddenSourceIds: ['first'] })));
  const ui = setup({ localStorage, fetchImpl: () => new Promise((resolve) => { release = resolve; }) });
  assert.equal(ui.tabs[2].getAttribute('aria-selected'), 'true');
  assert.equal(ui.tabs[2].tabIndex, 0);
  assert.equal(ui.panel.getAttribute('aria-labelledby'), 'matome-tab-chat');
  assert.equal(ui.save.disabled, true);
  ui.reset.fire('click');
  assert.equal(ui.localStorage.getItem(MATOME_PREFERENCES_KEY), null);
  assert.equal(ui.tabs[0].getAttribute('aria-selected'), 'true');
  const pending = ui.controller.refresh();
  await Promise.resolve();
  release({ ok: true, json: async () => fixture });
  await pending;
  assert.equal(ui.source('first').checked, false, 'late data must not restore pre-reset hidden sources');
  assert.equal(ui.tabs[0].querySelector('[data-matome-count]').textContent, '14');
  ui.controller.destroy();
});

test('changing validated source metadata updates choices and moves removed-option focus to the summary', async () => {
  let data = fixture;
  const ui = setup({ fetchImpl: async () => ({ ok: true, json: async () => data }) });
  await ui.controller.refresh();
  const first = ui.source('first');
  first.checked = true; first.fire('change'); ui.save.fire('click'); first.focus();
  data = { ...fixture, sources: [{ ...sources[1], name: '新しい媒体名' }] };
  await ui.controller.refresh();
  assert.equal(ui.source('first'), undefined);
  assert.equal(ui.documentRef.activeElement.tagName, 'summary');
  assert.match(ui.root.querySelector('#matome-preferences').textContent, /新しい媒体名/);
  assert.equal(ui.tabs[0].querySelector('[data-matome-count]').textContent, '7');
  ui.save.fire('click');
  assert.deepEqual(JSON.parse(ui.localStorage.getItem(MATOME_PREFERENCES_KEY)).hiddenSourceIds, []);
  ui.controller.destroy();
});
