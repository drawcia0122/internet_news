(function (root) {
  'use strict';
  const STALE_MS = 3 * 60 * 60 * 1000;
  const DATASETS = { 'home-news.json': '通常ニュース', 'trend-topics.json': '話題', 'events.json': 'イベント' };

  function buildRefreshNotice(report, { now = Date.now(), files = Object.keys(DATASETS) } = {}) {
    if (report?.schemaVersion !== 1 || !report.datasets) return { visible: false, text: '' };
    const notices = [];
    for (const file of files) {
      const data = report.datasets[file];
      if (!data) continue;
      const time = typeof data.generatedAt === 'string' ? Date.parse(data.generatedAt) : NaN;
      // Recompute with the visitor's clock: a stopped scheduler cannot update its
      // own stale flag. Never mistake a fresh checkedAt for a fresh fetch.
      const stale = Number.isFinite(time) && now - time > STALE_MS;
      if (!stale && !data.retained && report.status !== 'failed') continue;
      const date = Number.isFinite(time)
        ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(time)) + ' JST'
        : '取得日時不明';
      notices.push(`${DATASETS[file] ?? 'ニュース'}: ${stale ? '更新が遅れています' : '前回のデータを表示中'}（最終取得 ${date}）`);
    }
    return { visible: notices.length > 0, text: notices.join(' / ') };
  }

  async function loadRefreshNotice({ document = root.document, fetchImpl = root.fetch, now = () => Date.now() } = {}) {
    const element = document?.getElementById('data-refresh-health');
    if (!element) return;
    try {
      const response = await fetchImpl('./data/refresh-status.json', { cache: 'no-store' });
      if (!response.ok) return; // The report does not exist before the first guarded run.
      const report = await response.json();
      const files = element.dataset.refreshDatasets?.split(',').filter(Boolean);
      const notice = buildRefreshNotice(report, { now: now(), ...(files?.length ? { files } : {}) });
      element.textContent = notice.text;
      element.hidden = !notice.visible;
    } catch { /* A diagnostics request must never prevent the news from loading. */ }
  }

  root.RefreshHealth = { buildRefreshNotice, loadRefreshNotice };
  if (root.document) {
    loadRefreshNotice();
    // Recheck when a suspended tab is revisited, without polling in the background.
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState === 'visible') loadRefreshNotice();
    });
  }
}(typeof window !== 'undefined' ? window : globalThis));
