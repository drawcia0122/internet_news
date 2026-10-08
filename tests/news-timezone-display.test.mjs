import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../', import.meta.url).href;
for (const timezone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
  test(`news timestamps stay in explicit JST across date boundaries in ${timezone}`, () => {
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { readFileSync } from 'node:fs';
      import vm from 'node:vm';
      globalThis.window = globalThis;
      for (const file of ['shared-topic-utils.js', 'home-brief-utils.js', 'refresh-status.js']) await import(${JSON.stringify(root)} + file);
      const app = readFileSync(new URL('app.js', ${JSON.stringify(root)}), 'utf8');
      vm.runInThisContext(app.match(/function formatAbsoluteDate\\(dateString\\) \\{[\\s\\S]*?\\n\\}/)[0]);
      const inputs = ['2026-10-07T15:00:00Z', '2026-12-31T15:00:00Z', '2028-02-29T14:59:00Z', '2028-02-29T15:00:00Z', '2026-03-08T09:59:00Z', '2026-03-08T10:00:00Z'];
      const topic = { publishedAt: inputs[0], generatedAt: inputs[1], time: '古いラベル' };
      const before = JSON.stringify(topic);
      const labels = inputs.map(value => [TopicClientUtils.formatDate(value), formatAbsoluteDate(value), HomeBriefUtils.formatBriefTimelineTime(value), TopicClientUtils.formatTopicDisplayTime({ publishedAt: value })]);
      Date.now = () => Date.parse('2026-10-08T15:00:00Z');
      const range = { minHours: 0, maxHours: 24 };
      console.log(JSON.stringify({ labels,
        invalid: TopicClientUtils.formatDate('invalid'),
        fallback: TopicClientUtils.formatTopicDisplayTime({ time: '時刻未確認' }),
        selected: TopicClientUtils.formatTopicDisplayTime(topic),
        timestamp: TopicClientUtils.archiveTimestamp(topic), unchanged: before === JSON.stringify(topic),
        range: [0, 1, -1].map(offset => TopicClientUtils.isWithinRange({ publishedAt: new Date(Date.parse(inputs[0]) + offset).toISOString() }, range)),
        notice: RefreshHealth.buildRefreshNotice({ schemaVersion: 1, datasets: { 'home-news.json': { generatedAt: inputs[0], retained: true } } }, { now: Date.now() }).text,
        manualUsesSameFormatter: app.includes("showRefreshStatus('更新を確認: ' + formatAbsoluteDate(new Date()))")
      }));
    `], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' }));
    const expected = ['10/8 00:00 JST', '1/1 00:00 JST', '2/29 23:59 JST', '3/1 00:00 JST', '3/8 18:59 JST', '3/8 19:00 JST'];
    assert.deepEqual(result.labels, expected.map(label => Array(4).fill(label)));
    assert.equal(result.invalid, '不明');
    assert.equal(result.fallback, '時刻未確認');
    assert.equal(result.selected, expected[0], 'publication timestamp still takes priority over generation time');
    assert.equal(result.timestamp, Date.parse('2026-10-07T15:00:00Z'));
    assert.equal(result.unchanged, true);
    assert.deepEqual(result.range, [false, true, false], '24-hour cutoff remains instant-based');
    assert.match(result.notice, /2026\/10\/8 00:00 JST/);
    assert.equal(result.manualUsesSameFormatter, true);
  });
}
