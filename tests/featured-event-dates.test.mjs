import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const moduleUrl = new URL('../home-event-utils.js', import.meta.url).href;
const runInTimezone = (timezone) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
  const OriginalDate = Date;
  let instant = '2026-10-02T03:00:00Z';
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return OriginalDate.parse(instant); }
  };
  globalThis.window = globalThis;
  await import(${JSON.stringify(moduleUrl)});
  const u = HomeEventUtils;
  const dateValue = (date) => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  const opening = { title: '10月2日開始の展示', startDate: '2026-10-02', endDate: '2026-10-05', category: '展示' };
  const dayCases = ['2026-10-01T14:59:59Z', '2026-10-01T15:00:00Z', '2026-10-02T03:00:00Z', '2026-10-02T14:59:59Z', '2026-10-02T15:00:00Z'].map(value => {
    instant = value;
    return { instant: value, today: dateValue(u.getTodayDate()), ongoing: u.isEventOngoing(opening), daysLeft: u.getEventDaysUntilEnd(opening), ongoingCount: u.getEventItemsForTab([opening], 'ongoing', 'general').length, closingCount: u.getEventItemsForTab([opening], 'closingSoon', 'general').length, period: u.formatEventPeriod(opening) };
  });
  const monthCases = ['2026-10-31T15:00:00Z', '2026-12-31T15:00:00Z'].map(value => {
    instant = value;
    const today = dateValue(u.getTodayDate());
    const item = { title: '月初の展示', startDate: today, endDate: today, category: '展示' };
    return { today, thisMonth: u.getEventItemsForTab([item], 'thisMonth', 'general').length, currentMonthLimited: u.isCurrentMonthLimited(item), status: u.eventStatusLabel(item), daysLeft: u.getEventDaysUntilEnd(item) };
  });
  console.log(JSON.stringify({dayCases, monthCases, dstDays: u.daysBetween(u.parseEventDate('2026-11-02'),u.parseEventDate('2026-10-31'))}));
`], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' }));

for (const timezone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York']) {
  test(`Japan event day and closing countdown are correct in ${timezone}`, () => {
    const { dayCases, monthCases, dstDays } = runInTimezone(timezone);
    assert.deepEqual(dayCases.map(({ today, ongoing, daysLeft, ongoingCount, closingCount }) => ({ today, ongoing, daysLeft, ongoingCount, closingCount })), [
      { today: '2026-10-01', ongoing: false, daysLeft: 4, ongoingCount: 0, closingCount: 0 },
      { today: '2026-10-02', ongoing: true, daysLeft: 3, ongoingCount: 1, closingCount: 1 },
      { today: '2026-10-02', ongoing: true, daysLeft: 3, ongoingCount: 1, closingCount: 1 },
      { today: '2026-10-02', ongoing: true, daysLeft: 3, ongoingCount: 1, closingCount: 1 },
      { today: '2026-10-03', ongoing: true, daysLeft: 2, ongoingCount: 1, closingCount: 1 },
    ]);
    assert.ok(dayCases.every(({ period }) => period === '10/2〜10/5'));
    assert.deepEqual(monthCases, [
      { today: '2026-11-01', thisMonth: 1, currentMonthLimited: true, status: '終了間近', daysLeft: 0 },
      { today: '2027-01-01', thisMonth: 1, currentMonthLimited: true, status: '終了間近', daysLeft: 0 },
    ]);
    assert.equal(dstDays, 2);
  });
}
