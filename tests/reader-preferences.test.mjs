import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; }, set innerHTML(value) { this.textContent = value; } }) };
await import('../article-category-quality.js');
await import('../news-summary-integrity.js');
await import('../shared-topic-utils.js');
await import('../reader-preferences.js');
await import('../home-topic-selection-utils.js');
const P = globalThis.ReaderPreferences;
const { selectPersonalNews } = globalThis.HomeTopicSelectionUtils;
const settings = (values = {}) => P.normalizePreferences({ version: 1, enabled: true, ...values });
const topic = (id, title, category = 'games', sourceId = 'publisher') => ({
  id, title, summary: `${title}について正式な発表があり、詳しい内容が公開されました。`,
  category, categories: [category], personalScore: 80, score: 80, hotScore: 80,
  publishedAt: '2026-10-02T01:00:00Z',
  sourceSignals: [{ sourceId, sourceName: 'テスト媒体', url: `https://example.com/news/${id}`, title }],
});
const game = topic('game', '任天堂が新作ゲームの発売日を正式発表');
const anime = topic('anime', '人気アニメの新シリーズの放送日が決定', 'anime');
const tech = topic('tech', '生成AIの新しいモデルが正式に公開されました', 'tech');

test('normalization is versioned, bounded, deduplicated and rejects malformed structures and IDs', () => {
  const empty = P.normalizePreferences(null);
  for (const input of [undefined, null, [], 'text', 12, true, {}, { version: 2, enabled: true }, { version: '1' }]) {
    assert.deepEqual(P.normalizePreferences(input), empty);
  }
  assert.deepEqual(settings({ enabled: 'true', categories: ['games', 'games', '__proto__', {}, 'future'],
    keywords: [' ＳＴＥＡＭ ', 'Steam', null, 'x'.repeat(81), 'bad\u0000'], excludedSources: ['id:publisher', 'id:publisher', '__proto__', 'host:example.com', 'id:x" onclick="alert(1)'] }),
  { version: 1, enabled: false, categories: ['games'], keywords: ['steam'], excludedKeywords: [], excludedSources: ['id:publisher', 'host:example.com'] });
  assert.equal(settings({ keywords: Array.from({ length: 40 }, (_, i) => `word${i}`) }).keywords.length, 20);
  assert.equal(settings({ excludedSources: Array.from({ length: 220 }, (_, i) => `id:source${i}`) }).excludedSources.length, 200);
});

test('missing, corrupt, oversized, unknown-version, blocked and quota-failing storage are safe', () => {
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; }, removeItem: () => { raw = null; } };
  const store = P.createPreferenceStore(storage);
  assert.equal(store.load().warning, '');
  for (raw of ['{', 'null', '[]', '{"version":2}', 'x'.repeat(100001)]) {
    assert.equal(store.load().preferences.enabled, false);
    assert.ok(store.load().warning);
  }
  for (let i = 0; i < 3; i++) {
    assert.equal(store.save(settings({ keywords: ['Steam'] })).saved, true);
    assert.deepEqual(store.load().preferences.keywords, ['steam']);
    assert.equal(store.reset().saved, true);
    assert.equal(raw, null);
  }
  const broken = P.createPreferenceStore({ getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } });
  assert.ok(broken.load().warning);
  assert.equal(broken.save(settings({ keywords: ['Steam'] })).saved, false);
  assert.equal(broken.reset().saved, false);
  assert.equal(P.createPreferenceStore(null).save(settings()).saved, false);
  assert.equal(P.getStorage('localStorage', Object.defineProperty({}, 'localStorage', { get() { throw new Error(); } })), null);
});

test('disabled and empty preferences preserve the exact legacy selection and ranking', () => {
  const input = [tech, anime, game];
  const baseline = selectPersonalNews(input);
  for (const preferences of [settings(), settings({ enabled: false, categories: ['tech'], excludedSources: ['id:publisher'] })]) {
    assert.deepEqual(selectPersonalNews(input, { preferences }), baseline);
  }
  assert.deepEqual(input, [tech, anime, game]);
});

test('wanted categories and keywords are OR matches; exclusions take precedence without fallback leakage', () => {
  const preferences = settings({ categories: ['anime'], keywords: ['生成AI'] });
  assert.deepEqual(selectPersonalNews([game, anime, tech], { preferences }).map(({ id }) => id), ['anime', 'tech']);
  assert.deepEqual(selectPersonalNews([game, anime, tech], { preferences: settings({ keywords: ['does not exist'] }) }), []);
  assert.deepEqual(selectPersonalNews([game, anime], { preferences: settings({ categories: ['games', 'anime'], excludedKeywords: ['アニメ'] }) }), [game]);
  assert.deepEqual(selectPersonalNews([game, anime], { preferences: settings({ categories: ['games'], excludedSources: ['id:publisher'] }) }), []);
});

test('exclusions-only preserve legacy rank while replenishing before pagination limit', () => {
  const hidden = { ...game, id: 'hidden', title: '任天堂のネタバレを含むゲーム新情報を公開', personalScore: 99 };
  assert.deepEqual(selectPersonalNews([hidden, game, anime], { limit: 1, preferences: settings({ excludedKeywords: ['ネタバレ'] }) }), [game]);
});

test('explicit interests retain adult and upper-section article identity protections', () => {
  const duplicate = { ...game, id: 'duplicate', sourceSignals: [{ ...game.sourceSignals[0], url: `${game.sourceSignals[0].url}?utm_source=rss` }] };
  const adult = topic('adult', '成人向けゲームの新しい発売日が決定しました');
  const keys = globalThis.TopicClientUtils.createArticleIdentitySet([game]);
  assert.deepEqual(selectPersonalNews([duplicate, adult, anime], { excludedArticleKeys: keys, preferences: settings({ categories: ['games', 'anime'] }) }), [anime]);
});

test('Pokemon uses article evidence, not broad feed tags, and keywords are literal text', () => {
  assert.equal(P.matchesTopic({ ...game, sourceSignals: [{ ...game.sourceSignals[0], sourceTags: ['pokemon'] }] }, settings({ categories: ['pokemon'] })), false);
  assert.equal(P.matchesTopic(topic('pokemon', 'ポケモンの新しいゲームが正式に公開'), settings({ categories: ['pokemon'] })), true);
  assert.equal(P.matchesTopic(game, settings({ keywords: ['.*'] })), false);
  assert.equal(P.matchesTopic({ title: 'STEAMのゲームを紹介' }, settings({ keywords: ['ＳＴＥＡＭ'] })), true);
});

test('source identifiers remain stable, normalized and independent of spoofed labels', () => {
  assert.equal(P.sourceKey({ sourceId: 'Media_A', url: 'https://site.example.com/a' }), 'id:media_a');
  assert.equal(P.sourceKey({ url: 'https://www.example.com/story' }), 'host:example.com');
  assert.equal(P.sourceKey({ url: 'javascript:alert(1)' }), null);
  assert.equal(P.sourceKey({ url: 'https://user:pass@example.com/story' }), null);
  const sources = P.collectSources([game, { sourceName: '<img onerror=alert(1)>', sourceUrl: 'https://other.example.com/story' }, anime]);
  assert.equal(sources.length, 2);
  assert.equal(sources.find(({ id }) => id === 'host:other.example.com').label, '<img onerror=alert(1)>');
  const mixed = { ...game, sourceSignals: [...game.sourceSignals, { sourceId: 'blocked' }] };
  assert.equal(P.matchesTopic(mixed, settings({ excludedSources: ['id:blocked'] })), false);
});

test('keyword input limits and separators are explicit rather than regex interpreted', () => {
  assert.deepEqual(P.parseKeywordInput('Steam、ポケモン\n ＳＴＥＡＭ ,.*'), ['steam', 'ポケモン', '.*']);
  assert.equal(P.parseKeywordInput('a'.repeat(81)), null);
  assert.equal(P.parseKeywordInput(Array.from({ length: 21 }, (_, i) => `x${i}`).join('\n')), null);
});

class Node {
  constructor(tag, ownerDocument) {
    Object.assign(this, { tag, ownerDocument, children: [], attributes: {}, value: '', checked: false, hidden: false, listeners: new Map(), ownText: '' });
  }
  set textContent(text) { this.children = []; this.ownText = String(text); }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  set innerHTML(_html) { throw new Error('Unsafe HTML assignment'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.ownText = ''; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name) { this.listeners.delete(name); }
  fire(name) { this.listeners.get(name)?.({ preventDefault() {} }); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const matches = (node) => {
      if (selector === 'input:checked') return node.tag === 'input' && node.checked;
      const name = selector.match(/^\[name="([^"]+)"\]$/u);
      if (name) return node.name === name[1];
      const attribute = selector.match(/^\[([^\]]+)\]$/u);
      if (attribute) return attribute[1] in node.attributes;
      return node.tag === selector;
    };
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
function readerUI({ stored = null, fail = false } = {}) {
  const documentRef = { activeElement: null, createElement(tag) { return new Node(tag, this); } };
  const root = documentRef.createElement('details'); root.hidden = true;
  const form = documentRef.createElement('form'); root.append(form);
  const add = (tag, name, attribute) => {
    const node = documentRef.createElement(tag);
    if (name) node.name = name;
    if (attribute) node.attributes[attribute] = '';
    form.append(node); return node;
  };
  const enabled = add('input', 'reader-enabled');
  const categories = add('div', null, 'data-reader-categories');
  const wanted = add('textarea', 'reader-keywords');
  const excluded = add('textarea', 'reader-excluded-keywords');
  const sources = add('div', null, 'data-reader-sources');
  const status = add('p', null, 'data-reader-status');
  const reset = add('button', null, 'data-reader-reset');
  let raw = stored;
  const storage = {
    getItem() { if (fail) throw new Error(); return raw; },
    setItem(_key, text) { if (fail) throw new Error(); raw = text; },
    removeItem() { if (fail) throw new Error(); raw = null; },
  };
  const changes = [];
  const controller = P.initializeReaderPreferences(root, { documentRef, store: P.createPreferenceStore(storage), onChange: (value) => changes.push(value) });
  return { documentRef, root, form, enabled, categories, wanted, excluded, sources, status, reset, controller, changes, raw: () => raw };
}

test('controller initializes accessible explicit opt-in controls, saves and resets repeatedly without HTML injection', () => {
  const ui = readerUI();
  assert.equal(ui.root.hidden, false);
  assert.equal(ui.enabled.checked, false);
  assert.equal(ui.categories.querySelectorAll('input').length, P.CATEGORIES.length);
  ui.controller.updateSources([game, { sourceName: '<img src=x onerror=bad()>', sourceUrl: 'https://other.example.com/story' }]);
  assert.equal(ui.sources.querySelectorAll('input').length, 2);
  assert.ok(ui.sources.textContent.includes('<img src=x onerror=bad()>'));
  ui.wanted.value = '<img src=x onerror=bad()>、ＳＴＥＡＭ';
  ui.enabled.checked = true;
  ui.sources.querySelector('input').checked = true;
  for (let i = 0; i < 3; i++) {
    ui.form.fire('submit');
    assert.equal(ui.controller.getPreferences().enabled, true);
    assert.equal(ui.controller.getPreferences().keywords.includes('steam'), true);
    assert.equal(ui.controller.getPreferences().excludedSources.length, 1);
    assert.match(ui.status.textContent, /保存しました/);
  }
  for (let i = 0; i < 3; i++) {
    ui.reset.fire('click');
    assert.equal(ui.raw(), null);
    assert.deepEqual(ui.controller.getPreferences(), P.normalizePreferences(null));
    assert.equal(ui.wanted.value, ''); assert.equal(ui.enabled.checked, false);
  }
  ui.controller.destroy();
  assert.equal(ui.form.listeners.size, 0); assert.equal(ui.reset.listeners.size, 0);
});

test('controller preserves unsaved choices, saved unavailable sources and focus across source refresh', () => {
  const ui = readerUI({ stored: JSON.stringify(settings({ excludedSources: ['id:missing'] })) });
  assert.equal(ui.sources.querySelector('input').checked, true);
  ui.controller.updateSources([game]);
  const input = ui.sources.querySelectorAll('input').find((node) => node.value === 'id:publisher');
  input.checked = true; input.focus();
  ui.wanted.value = '未保存キーワード';
  ui.controller.updateSources([game, topic('other', '別のゲームの発売情報を公開しました', 'games', 'new')]);
  assert.equal(ui.documentRef.activeElement.value, 'id:publisher');
  assert.equal(ui.documentRef.activeElement.checked, true);
  assert.equal(ui.sources.querySelectorAll('input:checked').length, 2);
  assert.equal(ui.wanted.value, '未保存キーワード');
  assert.equal(ui.controller.getPreferences().keywords.length, 0, 'draft remains unapplied');
  ui.form.fire('submit');
  assert.deepEqual(ui.controller.getPreferences().excludedSources.sort(), ['id:missing', 'id:publisher']);
});

test('controller reports corrupt/failed storage honestly, applies session settings and rejects oversized inputs', () => {
  assert.match(readerUI({ stored: '{bad' }).status.textContent, /読み込めません/);
  const ui = readerUI({ fail: true });
  ui.enabled.checked = true; ui.wanted.value = 'a'.repeat(81);
  ui.form.fire('submit');
  assert.equal(ui.changes.length, 0); assert.equal(ui.documentRef.activeElement, ui.wanted);
  assert.match(ui.status.textContent, /80文字以内/);
  ui.wanted.value = 'ポケモン'; ui.form.fire('submit');
  assert.equal(ui.changes.length, 1); assert.match(ui.status.textContent, /保存できません/);
  assert.deepEqual(ui.controller.getPreferences().keywords, ['ポケモン']);
  ui.reset.fire('click'); assert.match(ui.status.textContent, /削除できず/);
  assert.equal(ui.controller.getPreferences().enabled, false);
});
