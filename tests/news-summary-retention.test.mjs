import assert from 'node:assert/strict';
import test from 'node:test';
process.env.TREND_FETCH_SKIP_MAIN_FOR_TESTS = '1';
const { mergeArchiveItems, normalizeStoredTopic, buildNewsArchivePayload, buildHomeNewsPayloads } = await import('../scripts/fetch-trend-topics.mjs');
const { sanitizeArticleSummaryFields } = globalThis.NewsSummaryIntegrity;
const title = '新作ゲームの発売日と予約受付を正式発表';
const summary = '新作ゲームの発売日と予約受付の日程が正式発表され、対応機種や特典などの詳細も公開された。';
const url = 'https://publisher.example/articles/new-game';
const item = (overrides = {}) => ({ id: 'stable', title, sourceUrl: url, summary, briefSummary: summary,
  sourceSignals: [{ title, url, summary, briefSummary: summary, publishedAt: '2026-10-02T10:00:00Z' }],
  publishedAt: '2026-10-02T10:00:00Z', capturedAt: '2026-10-02T11:00:00Z', category: 'games', categories: ['games'], score: 20, ...overrides });
const empty = (overrides = {}) => item({ summary: '', briefSummary: '', sourceSignals: [{ title, url, summary: '', briefSummary: '', publishedAt: '2026-10-02T10:00:00Z' }], capturedAt: '2026-10-02T16:00:00Z', ...overrides });

test('empty fresh RSS/enrichment retains summaries only for an unchanged primary article', () => {
  const merged = mergeArchiveItems([item()], [empty()])[0];
  assert.equal(merged.summary, summary); assert.equal(merged.briefSummary, summary);
  assert.equal(merged.sourceSignals[0].summary, summary);
  assert.equal(merged.sourceSignals[0].briefSummary, summary);
  assert.equal(merged.capturedAt, '2026-10-02T16:00:00Z');
});

test('raw trend roots prove primary identity through the same-title source signal', () => {
  const merged = mergeArchiveItems([item({ sourceUrl: undefined })], [empty({ sourceUrl: undefined })])[0];
  assert.equal(merged.summary, summary); assert.equal(merged.sourceSignals[0].summary, summary);
});

test('fresh valid summary wins even when shorter, while error-shell text cannot erase retained text', () => {
  const fresh = '新作ゲームの発売日が変更され、予約受付の日程が公開された。';
  assert.equal(mergeArchiveItems([item()], [empty({ summary: fresh })])[0].summary, fresh);
  assert.equal(mergeArchiveItems([item()], [empty({ summary: '503 Service Unavailable' })])[0].summary, summary);
});

test('same URL with a changed headline cannot inherit the old summary', () => {
  const merged = mergeArchiveItems([item()], [empty({ title: '新作ゲームの予約受付が中止に', sourceSignals: [{ title: '新作ゲームの予約受付が中止に', url }] })])[0];
  assert.equal(merged.summary, ''); assert.equal(merged.briefSummary, '');
});

test('shared IDs or search links cannot authorize summary transfer to a different primary URL', () => {
  const other = 'https://publisher.example/articles/different';
  const results = mergeArchiveItems([item()], [empty({ sourceUrl: other, sourceSignals: [{ title, url: other }], searchLinks: [{ url }] })]);
  assert.equal(results.find((x) => x.sourceUrl === other).summary, '');
  const noUrl = mergeArchiveItems([item({ sourceUrl: undefined, sourceSignals: [], searchLinks: [] })], [empty({ sourceUrl: undefined, sourceSignals: [], searchLinks: [] })])[0];
  assert.equal(noUrl.summary, '');
});

test('secondary source agreement cannot authorize a mismatched primary headline source', () => {
  const old = item({ sourceUrl: undefined, sourceSignals: [{ title: '別の見出し', url }, { title, url: 'https://publisher.example/articles/primary-old' }] });
  const fresh = empty({ sourceUrl: undefined, sourceSignals: [{ title: '別の見出し', url }, { title, url: 'https://publisher.example/articles/primary-new' }] });
  assert.equal(mergeArchiveItems([old], [fresh])[0].summary, '');
});

test('invalid retained summaries remain empty rather than being restored', () => {
  const invalid = item({ summary: '404 Not Found', briefSummary: '全く無関係な気象予報の解説です。', sourceSignals: [] });
  const merged = mergeArchiveItems([invalid], [empty()])[0];
  assert.equal(merged.summary, ''); assert.equal(merged.briefSummary, '');
});

test('scheduled baseball regression remains correct through repair, normalization, merge and consumers', () => {
  const articleTitle = '小園ら戦力外 移籍市場はどう評価';
  const articleUrl = 'https://news.yahoo.co.jp/pickup/6597310?source=rss';
  const old = item({ id: 'baseball', sourceUrl: undefined, title: articleTitle, summary: '', briefSummary: '', sourceName: 'Yahoo!ニュース / スポーツ', category: 'sports', categories: ['sports'], sourceSignals: [{ title: articleTitle, url: articleUrl, sourceName: 'Yahoo!ニュース / スポーツ', summary: '', briefSummary: '', publishedAt: '2026-10-02T10:12:15Z' }] });
  const repaired = normalizeStoredTopic(old);
  assert.match(repaired.summary, /^今回の戦力外は、いわゆる通常の戦力整理とは受け止めにくい。/);
  assert.equal(sanitizeArticleSummaryFields(old).summary, repaired.summary, 'browser heals already-generated blank');
  const fresh = { ...old, capturedAt: '2026-10-02T17:00:00Z' };
  const merged = mergeArchiveItems([repaired], [fresh]);
  assert.equal(merged[0].summary, repaired.summary);
  assert.equal(merged[0].sourceSignals[0].summary, repaired.summary);
  const newsArchivePayload = buildNewsArchivePayload({ archiveItems: merged, generatedAt: '2026-10-02T17:00:00Z' });
  assert.equal(newsArchivePayload.items[0].summary, repaired.summary);
  const consumers = buildHomeNewsPayloads({ newsArchivePayload, generatedAt: '2026-10-02T17:00:00Z' });
  assert.ok(JSON.stringify(consumers).includes(repaired.summary));
});

test('multiple same-headline signal URLs are ambiguous and cannot transfer the root summary', () => {
  const a = { title, url };
  const old = item({ sourceUrl: undefined, sourceSignals: [a, { title, url: 'https://publisher.example/articles/old-primary' }] });
  const fresh = empty({ sourceUrl: undefined, sourceSignals: [a, { title, url: 'https://publisher.example/articles/new-primary' }] });
  assert.equal(mergeArchiveItems([old], [fresh])[0].summary, '');
  const duplicate = item({ sourceUrl: undefined, sourceSignals: [a, { title, url: `${url}?utm_source=rss` }] });
  assert.equal(mergeArchiveItems([duplicate], [empty({ sourceUrl: undefined, sourceSignals: [a] })])[0].summary, summary);
});

test('known empty-field repair cannot fill a different primary from a grouped Yahoo signal', () => {
  const articleTitle = '小園ら戦力外 移籍市場はどう評価';
  const yahoo = { title: articleTitle, url: 'https://news.yahoo.co.jp/pickup/6597310?source=rss', summary: '', briefSummary: '' };
  const other = 'https://different-publisher.example/articles/other';
  for (const root of [
    { title: articleTitle, sourceUrl: other, summary: '', briefSummary: '', sourceSignals: [yahoo] },
    { title: articleTitle, summary: '', briefSummary: '', sourceSignals: [yahoo, { title: articleTitle, url: other }] },
  ]) {
    const result = sanitizeArticleSummaryFields(root);
    assert.equal(result.summary, ''); assert.equal(result.briefSummary, '');
    assert.match(result.sourceSignals[0].summary, /^今回の戦力外は/);
  }
});
