import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../news-summary-integrity.js';
import { repairArticleSummariesInPayload, repairStoredArticleSummary } from '../lib/article-summary-corrections.mjs';
import { repairSummarySnapshots } from '../scripts/repair-summary-snapshots.mjs';
process.env.TREND_FETCH_SKIP_MAIN_FOR_TESTS = '1';
const { fetchPageMetadata, extractOutboundArticleUrls, extractYahooPickupArticle, normalizeStoredTopic, normalizeSummaryText, sanitizeFetchedMetadata } = await import('../scripts/fetch-trend-topics.mjs');
const { plainSummaryText, sanitizeArticleSummaryFields } = globalThis.NewsSummaryIntegrity;
const pickup = 'https://news.yahoo.co.jp/pickup/6597306';
const headline = '速報バレー男子 日本vs中国';
const synopsis = 'アジア大会バレー男子・準決勝、日本vs.中国を速報する。';
const sports = 'https://sports.yahoo.co.jp/volley/japan/competitions/5001/game/2620/point';
const unrelated = 'https://news.yahoo.co.jp/articles/judo';
const badSummary = '衝撃の試合展開が国際的な波紋を広げている。 問題となっているのは、10月1日に行われた愛知・名古屋アジア大会の柔道女子70キロ級の準々決勝だ。前田凛（日本）が唐婧（中国）に左腕を噛まれる、前代未聞の';
const titleTag = (title) => `<meta property="og:title" content="${title}">`;
const stateTag = (detail) => `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ topicsDetail: detail, accessRanking: { url: unrelated } })}</script>`;
const primary = { id: 6597306, url: pickup, title: headline, article: { url: sports, title: 'アジア大会バレー男子・準決勝 日本vs.中国' } };
const wrapper = `${titleTag(headline)}<meta content="${synopsis}" name="description"><main><a href="${unrelated}">柔道の日本と中国</a><p>${badSummary}</p></main>${stateTag(primary)}`;

async function fetchFixture(t, pages, url = pickup, title = headline) {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (target) => {
    requested.push(target);
    const fixture = pages[target];
    assert.ok(fixture, `Unexpected URL ${target}`);
    return { ok: true, url: fixture.url || target, text: async () => fixture.html };
  });
  return { metadata: await fetchPageMetadata(url, title), requested };
}

test('Yahoo primary content identity excludes higher-ranked recommendation URLs', async (t) => {
  const { metadata, requested } = await fetchFixture(t, {
    [pickup]: { html: wrapper }, [sports]: { html: '<title>バレーボール 日本対中国</title>' },
  });
  assert.deepEqual(requested, [pickup, sports]);
  assert.equal(metadata.summary, synopsis);
  assert.equal(metadata.briefSummary, synopsis);
  assert.equal(metadata.thumbnailUrl, null);
});

test('unknown Yahoo state keeps its short source synopsis and never mines sidebar/script text', async (t) => {
  const html = wrapper.replace(stateTag(primary), `<script>const story="${unrelated}";</script>`);
  const { metadata, requested } = await fetchFixture(t, { [pickup]: { html } });
  assert.deepEqual(requested, [pickup]);
  assert.equal(metadata.summary, synopsis);
  assert.equal(metadata.briefSummary, synopsis);
});

test('Yahoo embedded source identity must match both pickup ID and URL', () => {
  assert.deepEqual(extractYahooPickupArticle(wrapper, pickup, headline), { url: sports, title: primary.article.title });
  for (const detail of [{ ...primary, id: 99 }, { ...primary, url: 'https://news.yahoo.co.jp/pickup/99' }, { ...primary, title: '別の政治記事' }, { ...primary, article: { url: 'javascript:alert(1)', title: headline } }]) {
    assert.equal(extractYahooPickupArticle(stateTag(detail), pickup, headline), null);
  }
});

test('generic nested links require a unique matching headline, not URL depth or common words', () => {
  const title = '新作ゲームの発売日を正式発表';
  const link = 'https://publisher.example/articles/one';
  const html = `<a href="${unrelated}">日本と中国の別記事</a><script>const x="https://publisher.example/article/12345678";</script><a href="${link}">${title}</a>`;
  assert.deepEqual(extractOutboundArticleUrls(html, pickup, title), [link]);
  assert.deepEqual(extractOutboundArticleUrls(`${html}<a href="https://other.example/story">${title}</a>`, pickup, title), []);
});

test('different page title rejects coincidental 日本/中国 summary overlap and thumbnail', () => {
  assert.equal(sanitizeFetchedMetadata({ pageTitle: '柔道女子で中国選手に噛まれた前田凛', summary: badSummary, thumbnailUrl: 'https://publisher.example/judo.jpg' }, headline), null);
});

test('redirect to a different article is rejected before recommendations are followed', async (t) => {
  const { metadata, requested } = await fetchFixture(t, { [pickup]: { url: unrelated, html: `${titleTag('柔道女子で中国選手に噛まれた前田凛')}<meta name="description" content="${badSummary}">` } });
  assert.equal(metadata, null);
  assert.deepEqual(requested, [pickup]);
});

test('redirected Yahoo Expert article excludes citation and embedded-script paragraphs', async (t) => {
  const url = 'https://news.yahoo.co.jp/pickup/6597310';
  const title = '小園ら戦力外 移籍市場はどう評価';
  const canonical = 'https://news.yahoo.co.jp/expert/articles/32e047893c67efce237c3eb2b84fbacbeb2d2b77';
  const commentary = '今回の戦力外は、いわゆる通常の戦力整理とは受け止めにくい。広島球団は4選手と来季契約を結ばない判断をした。';
  const html = `${titleTag('広島・小園ら4選手の戦力外で考える契約と信頼、移籍市場で問われる評価')}<article><blockquote><p>小園らの戦力外で移籍市場にも影響。<a href="https://unrelated.example">出典リンクだけの引用です。</a></p></blockquote><p>${commentary}</p></article><script>{"html":"<p>小園ら戦力外に関する無関係な推薦記事の本文を取り込まないことを確認します。</p>"}</script>`;
  const { metadata, requested } = await fetchFixture(t, { [url]: { url: canonical, html } }, url, title);
  assert.deepEqual(requested, [url]);
  assert.equal(metadata.summary, commentary);
  assert.equal(metadata.briefSummary, commentary);
  assert.equal(metadata.summarySourceUrl, canonical);
});

test('all generation and integrity normalization emits plain text before truncation', () => {
  const markup = '新作ゲームの発売日を&lt;a href=&quot;https://example.com&quot;&gt;正式発表しました&lt;/a&gt;。';
  const expected = '新作ゲームの発売日を 正式発表しました 。';
  for (const normalize of [plainSummaryText, normalizeSummaryText]) {
    assert.equal(normalize(markup), expected);
    assert.equal(normalize(markup.replaceAll('&', '&amp;')), expected);
    assert.equal(normalize('新作ゲームを<a href="https://example.com…'), '新作ゲームを');
    assert.equal(normalize('100 < 200、A &amp; B'), '100 < 200、A & B');
    assert.equal(normalize('新作ゲーム<script>alert(1)</script>を発表'), '新作ゲーム を発表');
    assert.doesNotThrow(() => normalize('文字 &#999999999; &#xD800;'));
  }
  const item = { title: '新作ゲームの発売日', summary: markup, briefSummary: markup, sourceSignals: [{ title: '新作ゲームの発売日', summary: markup }] };
  const safe = sanitizeArticleSummaryFields(item);
  assert.equal(safe.summary, expected); assert.equal(safe.briefSummary, expected); assert.equal(safe.sourceSignals[0].summary, expected);
  assert.equal(item.summary, markup);
});

test('known volleyball contamination is repaired by exact source identity in retained normalization', () => {
  const item = { id: 'original-id', title: headline, sourceUrl: `${pickup}?source=rss`, summary: badSummary, briefSummary: badSummary, category: 'sports', categories: ['sports'], thumbnailUrl: null, publishedAt: '2026-10-02T10:25:08Z', capturedAt: '2026-10-02T11:17:34Z' };
  const repaired = repairStoredArticleSummary(item);
  assert.deepEqual(repaired, { ...item, summary: synopsis, briefSummary: synopsis });
  assert.equal(normalizeStoredTopic(item).summary, synopsis);
  assert.equal(normalizeStoredTopic(item).briefSummary, synopsis);
  assert.equal(repairStoredArticleSummary({ ...item, sourceUrl: unrelated }).summary, badSummary);
  assert.equal(repairStoredArticleSummary({ ...item, summary: 'バレー男子の準決勝を速報します。' }).summary, 'バレー男子の準決勝を速報します。');
});

test('snapshot migration preserves every field except summary text and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'summary-repair-'));
  const payload = { generatedAt: '2026-10-02T11:17:34Z', hasMore: true, nextPage: 2, items: [{ id: 'original', title: headline, sourceUrl: pickup, summary: badSummary, briefSummary: badSummary, thumbnailUrl: null, score: 84, categories: ['world'], sourceSignals: [{ title: headline, url: pickup, summary: badSummary }] }] };
  try {
    for (const name of ['home-news.json', 'home-news-page-2.json', 'news-archive.json', 'trend-topics-archive.json']) await writeFile(join(directory, name), JSON.stringify(payload));
    assert.equal(await repairSummarySnapshots(directory), 4);
    const expected = repairArticleSummariesInPayload(payload);
    assert.equal(expected.items[0].summary, synopsis);
    assert.equal(expected.items[0].sourceSignals[0].summary, synopsis);
    for (const name of ['home-news.json', 'home-news-page-2.json', 'news-archive.json', 'trend-topics-archive.json']) assert.deepEqual(JSON.parse(await readFile(join(directory, name))), expected);
    assert.equal(await repairSummarySnapshots(directory), 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('scheduled refresh repairs snapshots before health-guard fallback capture', async () => {
  const script = await readFile(new URL('../scripts/refresh-data.mjs', import.meta.url), 'utf8');
  assert.ok(script.indexOf('await repairSummarySnapshots(') < script.indexOf('await runGuardedRefresh('));
});

test('retained trend/home roots can prove a correction through an exact-title primary signal', () => {
  const item = { id: 'trend-root', title: headline, summary: badSummary, briefSummary: badSummary, sourceSignals: [{ title: headline, url: `${pickup}?source=rss`, summary: badSummary }] };
  const result = repairArticleSummariesInPayload({ items: [item] }).items[0];
  assert.equal(result.summary, synopsis);
  assert.equal(result.briefSummary, synopsis);
  assert.equal(result.sourceSignals[0].summary, synopsis);
  assert.equal(sanitizeArticleSummaryFields(item).summary, synopsis, 'browser cached data also receives the identity-bound repair');
  const other = { ...item, sourceSignals: [{ ...item.sourceSignals[0], title: '柔道の違う記事' }] };
  assert.equal(repairStoredArticleSummary(other).summary, badSummary);
});

test('baseball retained root replaces only its known citation error using proven identity', () => {
  const title = '小園ら戦力外 移籍市場はどう評価';
  const old = { title, summary: '広島、小園ら4選手に戦力外通告 昨年2冠＆WBC選出も異例…矢野＆田村ら主力候補も 出典：<a data-role="anchor" href="https://full-count.jp/example…', sourceSignals: [{ title, url: 'https://news.yahoo.co.jp/pickup/6597310?source=rss' }] };
  const after = repairStoredArticleSummary(old);
  assert.match(after.summary, /^今回の戦力外は、いわゆる通常の戦力整理とは受け止めにくい。/);
  assert.equal(sanitizeArticleSummaryFields(old).summary, after.summary);
});

test('bad retained snapshots do not abort migration or prevent health-guard recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'summary-repair-bad-'));
  const warnings = [];
  try {
    await writeFile(join(directory, 'news-archive.json'), '{broken');
    await writeFile(join(directory, 'home-news.json'), JSON.stringify({ items: [{ title: headline, sourceUrl: pickup, summary: badSummary }] }));
    assert.equal(await repairSummarySnapshots(directory, { logger: { warn: (value) => warnings.push(value) } }), 1);
    assert.equal(await readFile(join(directory, 'news-archive.json'), 'utf8'), '{broken');
    assert.equal(JSON.parse(await readFile(join(directory, 'home-news.json'))).items[0].summary, synopsis);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Skipping news-archive.json/);
    assert.equal(await repairSummarySnapshots(join(directory, 'missing')), 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
