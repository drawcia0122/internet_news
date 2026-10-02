import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

globalThis.window = globalThis;
await import('../home-event-utils.js');
const { getEventCategories, matchesEventCategory, getEventItemsForTab } = globalThis.HomeEventUtils;
const today = new Date(2026, 9, 2);
const event = (id, overrides = {}) => ({
  id, title: id, category: 'イベント', startDate: '2026-10-01', endDate: '2026-10-12', tags: [], ...overrides,
});
const fixtures = [
  event('exhibition', { category: '展覧会・展示', tags: ['exhibition'] }),
  event('cafe', { category: 'コラボカフェ', tags: ['collab-cafe'] }),
  event('popup', { category: 'ポップアップ', tags: ['popup'] }),
  event('experience', { category: '体験型', tags: ['experience'] }),
  event('pokemon', { title: 'ポケモンの展示会' }),
  event('escape', { title: '街歩きナゾトキ', tags: ['escape'] }),
  event('crossover', { title: 'ポケモンと謎解き', tags: ['pokemon', 'escape'] }),
  event('future', { startDate: '2026-11-10', endDate: '2026-11-30' }),
];
const ids = (items) => items.map((item) => item.id).sort();

test('General includes exhibitions, cafés, popups and experiences', () => {
  assert.deepEqual(ids(getEventItemsForTab(fixtures, 'ongoing', 'general', today)), ['cafe', 'exhibition', 'experience', 'popup']);
});

test('Pokémon and escape collaborations belong to both specialist filters, never General', () => {
  assert.deepEqual(getEventCategories(fixtures.find((item) => item.id === 'crossover')), ['pokemon', 'escape']);
  assert.deepEqual(ids(getEventItemsForTab(fixtures, 'ongoing', 'pokemon', today)), ['crossover', 'pokemon']);
  assert.deepEqual(ids(getEventItemsForTab(fixtures, 'ongoing', 'escape', today)), ['crossover', 'escape']);
});

test('All shows each event once, including crossovers, and preserves the original period-only API', () => {
  assert.equal(getEventItemsForTab(fixtures, 'ongoing', 'all', today).length, 7);
  assert.equal(new Set(ids(getEventItemsForTab(fixtures, 'ongoing', 'all', today))).size, 7);
  assert.equal(matchesEventCategory(fixtures[0]), true);
});

test('Type and period filters intersect without falling back to a different type', () => {
  assert.deepEqual(ids(getEventItemsForTab(fixtures, 'nextMonth', 'general', today)), ['future']);
  assert.deepEqual(getEventItemsForTab(fixtures, 'nextMonth', 'escape', today), []);
  assert.deepEqual(getEventItemsForTab(fixtures, 'nextMonth', 'pokemon', today), []);
});

test('All four period filters retain their semantics inside each type', () => {
  const data = [
    event('ending-today', { title: 'ポケモン展', endDate: '2026-10-02' }),
    event('ended', { title: 'ポケモン展', startDate: '2026-09-01', endDate: '2026-10-01' }),
    event('later-month', { title: 'ポケモン展', startDate: '2026-10-20', endDate: '2026-10-21' }),
    event('next-month', { title: 'ポケモン展', startDate: '2026-11-01', endDate: '2026-11-20' }),
    event('general', { endDate: '2026-10-02' }),
  ];
  assert.deepEqual(ids(getEventItemsForTab(data, 'closingSoon', 'pokemon', today)), ['ending-today']);
  assert.deepEqual(ids(getEventItemsForTab(data, 'ongoing', 'pokemon', today)), ['ending-today']);
  assert.deepEqual(ids(getEventItemsForTab(data, 'thisMonth', 'pokemon', today)), ['ended', 'ending-today', 'later-month']);
  assert.deepEqual(ids(getEventItemsForTab(data, 'nextMonth', 'pokemon', today)), ['next-month']);
});

test('Specialist official sources and established tags classify generic titles', () => {
  assert.deepEqual(getEventCategories(event('Summer Carnival', { sourceName: 'PokéPark KANTO' })), ['pokemon']);
  assert.deepEqual(getEventCategories(event('イベント開催', { sourceName: 'ポケットモンスターオフィシャルサイト' })), ['pokemon']);
  assert.deepEqual(getEventCategories(event('MYSTERY MAIL BOX', { sourceName: 'SCRAP / リアル脱出ゲーム' })), ['escape']);
  assert.deepEqual(getEventCategories(event('体験会', { tags: ['ESCAPE'] })), ['escape']);
});

test('Recommendations and descriptive mentions do not override an event’s identity', () => {
  assert.deepEqual(getEventCategories(event('イラスト展', {
    description: 'ポケモンや謎解きが好きな人にもおすすめ',
    recommendationReasons: ['脱出ゲーム好き向け'],
  })), ['general']);
  assert.deepEqual(getEventCategories(event('Great Escape ゲーム原画展', { sourceName: 'SCRAPBOOK ART' })), ['general']);
});

test('English Pokémon spelling, park spelling and Japanese escape names are recognized', () => {
  for (const title of ['Pokémon Exhibition', 'Pokemon pop-up', 'ポケパーク カントー']) {
    assert.equal(matchesEventCategory(event(title), 'pokemon'), true);
  }
  for (const title of ['Escape Room', '街歩き謎とき', 'ナゾ解きツアー', 'ある部屋からの脱出']) {
    assert.equal(matchesEventCategory(event(title), 'escape'), true);
  }
});

test('Missing metadata is General and invalid filter keys never leak all events', () => {
  assert.deepEqual(getEventCategories({ title: '企画展' }), ['general']);
  assert.deepEqual(getEventCategories(null), ['general']);
  assert.deepEqual(getEventItemsForTab(fixtures, 'ongoing', 'unknown', today), []);
  assert.deepEqual(getEventItemsForTab(fixtures, 'unknown', 'all', today), []);
});

test('Filtering does not mutate the stored item order or tags', () => {
  const before = JSON.stringify(fixtures);
  getEventItemsForTab(fixtures, 'closingSoon', 'general', today);
  assert.equal(JSON.stringify(fixtures), before);
});

test('Tokyo and Saitama events lead each type-period result without hiding nationwide events', () => {
  const data = [
    event('osaka', { location: '大阪府大阪市', eventScore: 100 }),
    event('tokyo', { location: '東京都豊島区', eventScore: 10 }),
    event('saitama', { location: '埼玉県秩父市', eventScore: 20 }),
    event('nagoya', { location: '愛知県名古屋市', eventScore: 80 }),
  ];
  const visible = getEventItemsForTab(data, 'ongoing', 'general', today);
  assert.deepEqual(visible.map((item) => item.id), ['saitama', 'tokyo', 'osaka', 'nagoya']);
  assert.equal(visible.length, data.length);
  assert.deepEqual(data.map((item) => item.id), ['osaka', 'tokyo', 'saitama', 'nagoya']);
});

test('Region preference uses location rather than titles, recommendations, or broad source tags', () => {
  const { isPreferredEventRegion } = globalThis.HomeEventUtils;
  assert.equal(isPreferredEventRegion(event('東京を描く展', { location: '大阪府', tags: ['tokyo'] })), false);
  assert.equal(isPreferredEventRegion(event('展覧会', { location: '全国', venue: '東京ゲームショウ', recommendationReasons: ['東京開催'] })), false);
  assert.equal(isPreferredEventRegion(event('展覧会', { location: 'Tokyo / Osaka' })), true);
  assert.equal(isPreferredEventRegion(event('展覧会', { location: 'Saitama' })), true);
});

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const functionBlock = (name, nextName) => app.slice(app.indexOf(`function ${name}(`), app.indexOf(`function ${nextName}(`));
function renderContext(category = 'general', period = 'closingSoon') {
  const element = () => ({ innerHTML: '', textContent: '', querySelector: () => null });
  const context = vm.createContext({
    document: { activeElement: null },
    activeEventCategory: category, activeEventTab: period, eventItems: fixtures,
    featuredEventListElement: element(), featuredEventTabsElement: element(),
    featuredEventCategoryTabsElement: element(), featuredEventStatusElement: element(),
    escapeHtml: (value) => String(value),
    getEventItemsForTabFromList: (items, tab, type) => getEventItemsForTab(items, tab, type, today),
    replaceChildrenFromHtml: (target, children) => { target.innerHTML = children.join(''); },
    renderEventCard: (item) => `<article>${item.id}</article>`,
  });
  const constants = app.slice(app.indexOf('const EVENT_CATEGORY_DEFINITIONS'), app.indexOf('let activeTrendFilter'));
  vm.runInContext(constants + '\n' + functionBlock('renderFeaturedEvents', 'renderEventCard') + '\n' + functionBlock('getEventItemsForTab', 'buildClosingSoonBadge'), context);
  vm.runInContext('renderFeaturedEvents()', context);
  return context;
}

test('The initial UI defaults to General and type filters are labeled independent controls', () => {
  assert.match(app, /let activeEventCategory = 'general'/);
  assert.match(html, /id="featured-event-category-tabs" role="group" aria-label="注目イベントの種類"/);
  assert.match(html, /id="featured-event-tabs" role="group" aria-label="注目イベントの期間"/);
  const context = renderContext();
  assert.doesNotMatch(context.featuredEventListElement.innerHTML, /pokemon|escape|crossover/);
  assert.match(context.featuredEventCategoryTabsElement.innerHTML, /data-event-category="general" aria-pressed="true"/);
  assert.match(context.featuredEventStatusElement.textContent, /一般イベント.*4件/);
});

test('Counts reflect the current type/period intersection and an empty specialist filter stays empty', () => {
  const context = renderContext('pokemon', 'nextMonth');
  assert.match(context.featuredEventTabsElement.innerHTML, /data-event-tab="ongoing"[^>]*>開催中<strong>2<\/strong>/);
  assert.match(context.featuredEventCategoryTabsElement.innerHTML, /data-event-category="general"[^>]*>一般イベント<strong>1<\/strong>/);
  assert.match(context.featuredEventListElement.innerHTML, /ポケモン：この期間の掲載イベントはありません/);
  assert.doesNotMatch(context.featuredEventListElement.innerHTML, /<article>future/);
  assert.match(context.featuredEventStatusElement.textContent, /ポケモン.*0件/);
});

test('Changing categories repeatedly keeps the selected period and resets the card scroller', () => {
  const listenerContext = renderContext();
  class Button { constructor(category) { this.dataset = { eventCategory: category }; } }
  let click;
  Object.assign(listenerContext, {
    HTMLButtonElement: Button,
    featuredEventCategoryTabsElement: { addEventListener: (_name, handler) => { click = handler; } },
    featuredEventListElement: { scrollLeft: 400 },
    renderFeaturedEvents: () => {},
    activeEventTab: 'nextMonth',
  });
  const start = app.indexOf('if (featuredEventCategoryTabsElement) {\n  featuredEventCategoryTabsElement.addEventListener');
  vm.runInContext(app.slice(start, app.indexOf('\nif (topicChannelTabsElement)', start)), listenerContext);
  for (const category of ['pokemon', 'escape', 'all', 'general']) {
    click({ target: { closest: () => new Button(category) } });
    assert.equal(listenerContext.activeEventCategory, category);
    assert.equal(listenerContext.activeEventTab, 'nextMonth');
    assert.equal(listenerContext.featuredEventListElement.scrollLeft, 0);
  }
});


test('Refreshing the filters restores the actually focused button, including inactive choices', () => {
  const context = renderContext();
  let focusedSelector;
  context.document.activeElement = { dataset: { eventCategory: 'pokemon' } };
  context.featuredEventCategoryTabsElement.querySelector = (selector) => ({ focus: () => { focusedSelector = selector; } });
  vm.runInContext('renderFeaturedEvents()', context);
  assert.equal(focusedSelector, '[data-event-category="pokemon"]');
  assert.equal(context.activeEventCategory, 'general');
  context.document.activeElement = { dataset: { eventTab: 'nextMonth' } };
  context.featuredEventTabsElement.querySelector = (selector) => ({ focus: () => { focusedSelector = selector; } });
  vm.runInContext('renderFeaturedEvents()', context);
  assert.equal(focusedSelector, '[data-event-tab="nextMonth"]');
  assert.equal(context.activeEventTab, 'closingSoon');
});
