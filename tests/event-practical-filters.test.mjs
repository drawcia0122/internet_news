import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildMiraikanItem } from '../lib/event-source-utils.mjs';
globalThis.window = globalThis;
await import('../home-event-utils.js');
const u = globalThis.HomeEventUtils;
const friday = new Date(2026, 9, 2);
const event = (changes = {}) => ({ title: '展示', category: '展示', location: '東京都', startDate: '2026-10-02', endDate: '2026-10-04', officialUrl: 'https://official.example/event/1', tags: ['exhibition'], ...changes });
const fixture = (name) => readFile(new URL(`./fixtures/events/${name}`, import.meta.url), 'utf8');

test('region filters rely on locations and preserve nationwide selection', () => {
  assert.equal(u.matchesEventFilters(event(), { region: 'tokyo' }), true);
  assert.equal(u.matchesEventFilters(event(), { region: 'saitama' }), false);
  assert.equal(u.matchesEventFilters(event({ location: '埼玉県秩父市' }), { region: 'nearby' }), true);
  assert.equal(u.matchesEventFilters(event({ title: '東京展', location: '大阪府', tags: ['tokyo'] }), { region: 'nearby' }), false);
  assert.equal(u.matchesEventFilters(event({ location: '全国' }), { region: 'all' }), true);
  assert.equal(u.matchesEventFilters(event({ location: '全国' }), { region: 'nearby' }), false);
  assert.equal(u.matchesEventFilters(event(), { region: 'unknown' }), false);
});

test('types use category and tags, not descriptive recommendations', () => {
  assert.deepEqual(u.getEventKinds(event()), ['exhibition']);
  assert.equal(u.matchesEventFilters(event({ title: 'カフェの絵画展', description: 'コラボカフェ好きにもおすすめ' }), { kind: 'cafe' }), false);
  assert.equal(u.matchesEventFilters(event({ category: 'Gratte', tags: ['collab-cafe'] }), { kind: 'cafe' }), true);
  assert.equal(u.matchesEventFilters(event({ category: 'オンリーショップ', tags: [] }), { kind: 'popup' }), true);
  assert.equal(u.matchesEventFilters(event({ category: '体験型 / 科学・ワークショップ', tags: [] }), { kind: 'experience' }), true);
});

test('weekend includes overlapping dates but never guesses unknown end dates or invalid calendars', () => {
  assert.equal(u.eventOverlapsWeekend(event(), friday), true);
  assert.equal(u.eventOverlapsWeekend(event({ endDate: '2026-10-02' }), friday), false);
  assert.equal(u.eventOverlapsWeekend(event({ startDate: '2026-10-04', endDate: '2026-10-04' }), friday), true);
  assert.equal(u.eventOverlapsWeekend(event({ startDate: '2026-10-05', endDate: '2026-10-07' }), friday), false);
  assert.equal(u.eventOverlapsWeekend(event({ endDate: null, tags: ['ongoing'] }), friday), false);
  assert.equal(u.normalizeEventDateValue('2026-02-30'), null);
  assert.equal(u.parseEventDate('2026-02-30'), null);
  assert.equal(u.eventOverlapsWeekend(event({ startDate: '2026-10-05', endDate: '2026-10-04' }), friday), false);
});

test('weekend on Sunday excludes already-ended Saturday and handles year boundaries', () => {
  assert.equal(u.eventOverlapsWeekend(event({ endDate: '2026-10-03' }), new Date(2026, 9, 4)), false);
  assert.equal(u.eventOverlapsWeekend(event(), new Date(2026, 9, 4)), true);
  assert.equal(u.eventOverlapsWeekend(event({ startDate: '2027-01-02', endDate: '2027-01-03' }), new Date(2026, 11, 31)), true);
});

test('free requires event-specific verified metadata, not tags or missing prices', () => {
  assert.equal(u.matchesEventFilters(event({ tags: ['free'], description: '無料登録' }), { free: true }), false);
  assert.equal(u.matchesEventFilters(event({ attendance: { isFree: true } }), { free: true }), false);
  assert.equal(u.matchesEventFilters(event({ attendance: { isFree: true, sourceUrl: 'https://official.example/' } }), { free: true }), false);
  assert.equal(u.matchesEventFilters(event({ attendance: { isFree: true, sourceUrl: 'javascript:alert(1)' } }), { free: true }), false);
  assert.equal(u.matchesEventFilters(event({ attendance: { isFree: true, sourceUrl: 'https://official.example/event/1' } }), { free: true }), true);
});

test('all practical filters intersect periods/categories without mutation', () => {
  const data = [event({ id: 'yes' }), event({ id: 'no-region', location: '大阪府' }), event({ id: 'no-weekend', endDate: '2026-10-02' }), event({ id: 'no-category', title: 'ポケモン展' })];
  const before = JSON.stringify(data);
  const result = u.getEventItemsForTab(data, 'ongoing', 'general', friday, { region: 'tokyo', weekend: true, kind: 'exhibition' });
  assert.deepEqual(result.map((item) => item.id), ['yes']);
  assert.equal(JSON.stringify(data), before);
});

test('Miraikan extracts exact fee and known booking metadata without applying later-session deadlines', async () => {
  const payload = JSON.parse(await fixture('miraikan.json'));
  const entry = payload.find((item) => item.id === 4743);
  const html = await fixture('miraikan-detail.html');
  const result = buildMiraikanItem(entry, html + '<dt>参加費</dt><dd>無料</dd>', '2026-10-02');
  assert.equal(result.attendance.feeText, '無料');
  assert.equal(result.attendance.isFree, true);
  assert.equal(result.attendance.reservationRequired, true);
  assert.equal(result.attendance.sourceUrl, result.officialUrl);
  assert.equal(result.attendance.deadlineAt, undefined);
  for (const text of ['登録無料・参加費1000円', '小学生無料', '無料（別途入館料が必要）', '無料 ※材料費500円']) {
    const mixed = buildMiraikanItem(entry, html + `<dt>参加費</dt><dd>${text}</dd>`, '2026-10-02');
    assert.equal(mixed.attendance.isFree, false, text);
  }
  assert.equal(buildMiraikanItem(entry, html + '<footer>登録無料</footer>', '2026-10-02').attendance.feeText, undefined);
});

test('single-session official booking deadlines retain their zone and closed state, rejecting malformed deadlines', async () => {
  const payload = JSON.parse(await fixture('miraikan.json'));
  const entry = payload.find((item) => item.id === 4754);
  const html = await fixture('miraikan-chichibu.html');
  const result = buildMiraikanItem(entry, html, '2026-10-02');
  assert.equal(result.attendance.deadlineAt, '2026-10-25T23:59:59+09:00');
  assert.equal(result.attendance.reservationClosed, false);
  assert.equal(result.attendance.isFree, undefined);
  for (const deadline of ['2026-10-25', '2026-02-30T12:00:00+09:00', '2026-12-01T12:00:00+09:00']) {
    const malformed = buildMiraikanItem({ ...entry, apply: { ...entry.apply, end: deadline, isClosed: '1' } }, html, '2026-10-02');
    assert.equal(malformed.attendance.deadlineAt, undefined);
    assert.equal(malformed.attendance.reservationClosed, true);
  }
});

test('attendance rendering escapes source text, uses Japan time and omits unknown claims', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('function renderEventAttendance('), app.indexOf('function buildClosingSoonBadge('));
  const context = vm.createContext({ getEventAttendance: u.getEventAttendance, Intl, Date, escapeHtml: (x) => String(x).replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
  vm.runInContext(code, context);
  assert.equal(context.renderEventAttendance(event()), '');
  const rendered = context.renderEventAttendance(event({ sourceCheckedAt: '2026-10-02T05:29:45Z', attendance: { sourceUrl: 'https://official.example/event/1', feeText: '<script>', reservationRequired: true, deadlineAt: '2026-10-25T14:59:59Z' } }));
  assert.match(rendered, /&lt;script&gt;/);
  assert.match(rendered, /23:59/);
  assert.match(rendered, /14:29/);
  assert.match(rendered, /事前申込が必要/);
});


test('changing and resetting practical filters retains chosen period/category and resets scrolling', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf("if (featuredEventFiltersElement) {\n  featuredEventFiltersElement.addEventListener"), app.indexOf("if (topicChannelTabsElement) {\n  topicChannelTabsElement.addEventListener"));
  const handlers = {};
  let renders = 0;
  const context = vm.createContext({ activeEventFilters: {}, activeEventTab: 'nextMonth', activeEventCategory: 'pokemon', featuredEventListElement: { scrollLeft: 600 }, renderFeaturedEvents: () => { renders += 1; }, featuredEventFiltersElement: { elements: { region: { value: 'tokyo' }, kind: { value: 'cafe' }, weekend: { checked: true }, free: { checked: false } }, addEventListener: (name, fn) => { handlers[name] = fn; } } });
  vm.runInContext(code, context);
  handlers.change();
  assert.deepEqual(JSON.parse(JSON.stringify(context.activeEventFilters)), { region: 'tokyo', kind: 'cafe', weekend: true, free: false });
  assert.equal(context.featuredEventListElement.scrollLeft, 0);
  handlers.reset(); handlers.reset();
  assert.deepEqual(JSON.parse(JSON.stringify(context.activeEventFilters)), { region: 'all', kind: 'all', weekend: false, free: false });
  assert.equal(context.activeEventTab, 'nextMonth');
  assert.equal(context.activeEventCategory, 'pokemon');
  assert.equal(renders, 3);
});
