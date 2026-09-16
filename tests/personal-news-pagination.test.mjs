import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
await import('../home-render-utils.js');

const {
  advancePersonalNewsVisibleCount,
  getPersonalNewsPageState,
  isRedundantPriorityReason,
} = globalThis.HomeRenderUtils;

test('10 items initially show 5 with a load-more step', () => {
  assert.deepEqual(getPersonalNewsPageState(10, 5, 5), {
    visibleCount: 5,
    remainingCount: 5,
    nextCount: 5,
    hasMore: true,
  });
});

test('5 or fewer items do not expose load more', () => {
  assert.equal(getPersonalNewsPageState(5, 5, 5).hasMore, false);
  assert.equal(getPersonalNewsPageState(3, 5, 5).hasMore, false);
});

test('12 items advance 5 to 10 to 12 and then stop', () => {
  const secondPage = advancePersonalNewsVisibleCount(12, 5, 5);
  const finalPage = advancePersonalNewsVisibleCount(12, secondPage, 5);
  assert.equal(secondPage, 10);
  assert.equal(finalPage, 12);
  assert.equal(getPersonalNewsPageState(12, finalPage, 5).hasMore, false);
});

test('duplicate summary and personal reason are suppressed conservatively', () => {
  const summary = '任天堂が新作ゲームの発売日と対応機種を正式に発表した。';
  assert.equal(isRedundantPriorityReason(summary, summary), true);
  assert.equal(isRedundantPriorityReason(summary, '発売前に対応機種を確認しておきたいニュースです。'), false);
});
