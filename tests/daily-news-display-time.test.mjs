import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const moduleUrls = ['shared-topic-utils.js', 'home-brief-utils.js', 'home-render-utils.js']
  .map((name) => new URL(`../${name}`, import.meta.url).href);

function displayTimes(timezone) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.window = globalThis;
    for (const url of ${JSON.stringify(moduleUrls)}) await import(url);
    const publishedAt = '2026-10-03T14:51:27.000Z';
    const deps = {
      buildArticleTitleLink: (title) => title,
      escapeHtml: (value) => String(value ?? ''),
      formatBriefTimelineTime: HomeBriefUtils.formatBriefTimelineTime,
      sanitizeBriefSummaryText: (value) => value,
    };
    const inputs = [
      { publishedAt, publishedLabel: '1時間前' },
      { publishedAt, publishedLabel: '10/3 14:51' },
      { publishedAt, publishedLabel: '' },
      { publishedAt },
      { publishedAt: null, publishedLabel: '1/1 00:00' },
      { publishedAt: '', publishedLabel: '1時間前' },
      { publishedAt: 'invalid', publishedLabel: '10/3 14:51' },
      { publishedLabel: '直近' },
    ].map((value) => ({ title: '記事', ...value }));
    const before = JSON.stringify(inputs);
    const times = inputs.map((item) => HomeRenderUtils.renderBriefCard(item, 0, {}, deps).match(/<time>(.*?)<\\/time>/)[1]);
    console.log(JSON.stringify({ times, expected: TopicClientUtils.formatTopicDisplayTime({ publishedAt }), unchanged: before === JSON.stringify(inputs) }));
  `], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' }));
}

for (const timezone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
  test(`daily news uses the same publication date as the archive in ${timezone}`, () => {
    const { times, expected, unchanged } = displayTimes(timezone);
    assert.deepEqual(times.slice(0, 4), Array(4).fill(expected), 'generated relative/UTC labels must not override the publication timestamp');
    assert.deepEqual(times.slice(4), Array(4).fill('時刻不明'), 'missing or invalid dates must not appear as the epoch or stale relative labels');
    assert.equal(unchanged, true);
  });
}
