import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
globalThis.window = globalThis;
await import('../home-event-utils.js');
const u = globalThis.HomeEventUtils;
const today = new Date(2026, 9, 9);
const event = (changes = {}) => ({ title: '展示', category: '展示', location: '東京都', venue: '展示会場', startDate: '2026-10-01', endDate: '2026-10-09', tags: [], ...changes });

test('a known closing date stays active through its final Japan calendar day', () => {
  assert.equal(u.eventStatusLabel(event(), today), '終了間近');
  assert.equal(u.eventStatusLabel(event(), new Date(2026, 9, 10)), '終了');
  assert.equal(u.getEventItemsForTab([event()], 'ongoing', 'all', new Date(2026, 9, 10)).length, 0);
  assert.equal(u.getEventItemsForTab([event()], 'closingSoon', 'all', new Date(2026, 9, 10)).length, 0);
});

test('this-month history is retained with an honest expired label', () => {
  const ended = event({ endDate: '2026-10-08' });
  assert.equal(u.getEventItemsForTab([ended], 'thisMonth', 'general', today).length, 1);
  assert.equal(u.eventStatusLabel(ended, today), '終了');
});

test('a lone starting date does not become an indefinite ongoing event', () => {
  const uncertain = event({ endDate: null });
  assert.equal(u.isEventOngoing(uncertain, today), false);
  assert.equal(u.eventStatusLabel(uncertain, today), '日程確認');
  assert.equal(u.getEventItemsForTab([uncertain], 'ongoing', 'all', today).length, 0);
  assert.equal(u.getEventItemsForTab([uncertain], 'thisMonth', 'all', today).length, 1);
  assert.equal(u.matchesEventFilters(uncertain, { weekend: true }, today), false);
});

test('explicit long-running events retain their existing ongoing behavior without inventing an end date', () => {
  const permanent = event({ endDate: null, tags: ['ongoing'] });
  assert.equal(u.isEventOngoing(permanent, today), true);
  assert.equal(u.eventStatusLabel(permanent, today), '開催中');
  assert.equal(u.formatEventPeriod(permanent), '10/1〜（終了日未確認）');
});

test('missing, invalid and reversed dates are not presented as a confirmed period', () => {
  for (const item of [event({ startDate: null, endDate: null }), event({ startDate: '2026-02-30', endDate: null }), event({ startDate: '2026-10-11', endDate: '2026-10-10' })]) {
    assert.equal(u.eventStatusLabel(item, today), '日程確認');
    assert.equal(u.formatEventPeriod(item), '開催日程は詳細ページで確認');
    assert.equal(u.isEventOngoing(item, today), false);
  }
  assert.equal(u.formatEventPeriod(event({ startDate: null })), '〜10/9（開始日未確認）');
});

test('future statuses distinguish next month from later months across the year boundary', () => {
  const december = new Date(2026, 11, 15);
  assert.equal(u.eventStatusLabel(event({ startDate: '2027-01-02', endDate: '2027-01-03' }), december), '来月');
  assert.equal(u.eventStatusLabel(event({ startDate: '2027-02-02', endDate: '2027-02-03' }), december), '開催予定');
});

test('date display makes cross-year ranges clear and single-day events compact', () => {
  assert.equal(u.formatEventPeriod(event({ startDate: '2026-12-30', endDate: '2027-01-03' })), '2026/12/30〜2027/1/3');
  assert.equal(u.formatEventPeriod(event({ startDate: '2026-10-09' })), '10/9');
  assert.equal(u.formatEventPeriod(event()), '10/1〜10/9');
});

test('location comparison has no dangling separators, duplicate places or empty facts', () => {
  assert.equal(u.formatEventLocation(event()), '展示会場 / 東京都');
  assert.equal(u.formatEventLocation(event({ venue: null })), '東京都');
  assert.equal(u.formatEventLocation(event({ venue: ' 東京都 ' })), '東京都');
  assert.equal(u.formatEventLocation({}), '開催場所は詳細ページで確認');
});

test('every card gets a fee row while unknown or unverified fees never imply free admission', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('function renderEventAttendance('), app.indexOf('function buildClosingSoonBadge('));
  const context = vm.createContext({ getEventAttendance: u.getEventAttendance, Intl, Date, escapeHtml: (x) => String(x).replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
  vm.runInContext(code, context);
  for (const attendance of [undefined, { feeText: '無料' }, { feeText: '無料', sourceUrl: 'https://example.com/other' }, { feeText: ' ', sourceUrl: 'https://example.com/event' }]) {
    const item = event({ officialUrl: 'https://example.com/event', attendance });
    assert.match(context.renderEventAttendance(item), /参加費<\/dt><dd>料金は詳細ページで確認/);
    assert.equal(u.matchesEventFilters(item, { free: true }), false);
  }
  const paid = event({ officialUrl: 'https://example.com/event', attendance: { sourceUrl: 'https://example.com/event', feeText: '一般 1,000円（別途入館料）' } });
  assert.match(context.renderEventAttendance(paid), /一般 1,000円（別途入館料）/);
});


test('missing location stays unknown through the production normalization path', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('function normalizeEventItem('), app.indexOf('function renderTrends('));
  const context = vm.createContext({ normalizeEventDateValue: u.normalizeEventDateValue, calculateEventScore: u.calculateEventScore, calculateClosingSoonScore: u.calculateClosingSoonScore, slugifyRoutePart: () => 'event' });
  vm.runInContext(code, context);
  const normalized = context.normalizeEventItem(event({ venue: null, location: null }));
  assert.equal(u.formatEventLocation(normalized), '開催場所は詳細ページで確認');
  assert.equal(u.matchesEventFilters(normalized, { region: 'nearby' }), false);
  assert.equal(u.formatEventLocation(context.normalizeEventItem(event({ venue: '東京会場', location: null }))), '東京会場');
});
