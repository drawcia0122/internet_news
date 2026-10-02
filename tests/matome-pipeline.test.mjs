import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalMatomeUrl, classifyMatomeCategories, collectMatomeThreads, parseMatomeFeed } from '../lib/matome-aggregator.mjs';
import { MATOME_SOURCES } from '../config/matome-sources.mjs';
import { refreshMatomeThreads } from '../scripts/fetch-matome-threads.mjs';

const now = new Date('2026-10-02T03:30:00.000Z');
const publishedAt = '2026-10-02T12:00:00+09:00';
const [game, anime, chat] = MATOME_SOURCES;
const noSleep = async () => {};
const item = ({ title = '好きなゲームの思い出を語ろう', url = `${game.siteUrl}archives/123.html`, date = publishedAt, categories = ['話題'], extra = '' } = {}) => `<item><title><![CDATA[${title}]]></title><link>${url}</link>${date == null ? '' : `<dc:date>${date}</dc:date>`}${categories.map((category) => `<dc:subject>${category}</dc:subject>`).join('')}${extra}</item>`;
const rdf = (body = item()) => `<?xml version="1.0"?><rdf:RDF xmlns:rdf="urn:rdf" xmlns:dc="urn:dc"><channel><title>feed</title></channel>${body}</rdf:RDF>`;
const response = (body, status = 200) => new Response(body, { status });
const collect = (options = {}) => collectMatomeThreads({ now, sources: [game], sleepImpl: noSleep, fetchImpl: async () => response(rdf()), ...options });

test('RDF dc:date, CDATA, entities, source attribution and direct links are preserved', () => {
  const result = parseMatomeFeed(rdf(item({ title: 'RPG &amp; アニメの思い出', url: `${game.siteUrl}archives/123.html?utm_source=rss#comments`, extra: '<description>本文は保存しない<img src="https://example.com/adult.jpg"/></description>' })), game, { now });
  assert.equal(result.entryCount, 1);
  assert.equal(result.items[0].title, 'RPG & アニメの思い出');
  assert.equal(result.items[0].publishedAt, '2026-10-02T03:00:00.000Z');
  assert.equal(result.items[0].url, `${game.siteUrl}archives/123.html`);
  assert.deepEqual(result.items[0].categories, ['game', 'anime']);
  assert.equal(result.items[0].sourceName, game.name);
  for (const key of ['description', 'summary', 'thumbnail', 'image']) assert.equal(key in result.items[0], false);
});

test('RSS2 uses pubDate and per-entry categories, excluding commercial posts', () => {
  const xml = `<rss><channel><item><title>アニメの名場面について</title><link>${anime.siteUrl}archives/44</link><pubDate>Fri, 02 Oct 2026 02:00:00 +0000</pubDate><category>アニメ総合</category></item><item><title>コミック50％OFFセール</title><link>${anime.siteUrl}archives/45</link><pubDate>Fri, 02 Oct 2026 02:00:00 +0000</pubDate><category>漫画セール情報</category></item></channel></rss>`;
  const result = parseMatomeFeed(xml, anime, { now });
  assert.equal(result.entryCount, 2);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].categories, ['anime']);
});

test('Atom chooses alternate article link, not the first enclosure or self link', () => {
  const xml = `<feed><entry><title>ゲームの思い出</title><link rel="enclosure" href="https://images.invalid/1.jpg"/><link rel="self" href="${game.feedUrl}"/><link href="${game.siteUrl}archives/88.html" rel="alternate"/><published>${publishedAt}</published><category term="話題"/></entry></feed>`;
  assert.equal(parseMatomeFeed(xml, game, { now }).items[0].url, `${game.siteUrl}archives/88.html`);
});

test('unsafe, wrong-publisher, feed, and non-article URLs are rejected', () => {
  for (const value of ['javascript:alert(1)', 'data:text/plain,test', 'https://aatyu.livedoor.blog.evil.example/archives/1.html', 'https://user:secret@aatyu.livedoor.blog/archives/1.html', 'https://aatyu.livedoor.blog:8080/archives/1.html', game.feedUrl, game.siteUrl]) assert.equal(canonicalMatomeUrl(value, game), '');
  assert.equal(canonicalMatomeUrl('http://aatyu.livedoor.blog/archives/1.html?ref=rss', game), `${game.siteUrl}archives/1.html`);
});

test('no fabricated publication dates: missing, invalid, future and expired items are omitted', () => {
  for (const date of [null, 'nonsense', '2026-10-03T00:00:00Z', '2026-09-24T00:00:00Z', '2026-09-31T03:00:00Z', 'Thu, 31 Sep 2026 03:00:00 +0000']) assert.equal(parseMatomeFeed(rdf(item({ date })), game, { now }).items.length, 0);
});

test('HTML error pages, malformed XML, DTD/entity documents and excessive size fail closed', () => {
  for (const xml of ['<html><body>Site Unavailable</body></html>', '<rss><item></rss>', '<rss>', '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>', 'x'.repeat(1024 * 1024 + 1)]) assert.throws(() => parseMatomeFeed(xml, game, { now }));
  for (const opening of ['<item nonsense =>', '<item id="a" id="b">', '<item id=unquoted>', '<item id="a"bad="b">']) assert.throws(() => parseMatomeFeed(rdf(item()).replace('<item>', opening), game, { now }));
});

test('CDATA containing markup and fake item boundaries stays within its own item', () => {
  const xml = rdf(item({ title: 'ゲームの思い出', extra: '<description><![CDATA[</item><item><title>偽の記事</title>]]></description>' }));
  const result = parseMatomeFeed(xml, game, { now });
  assert.equal(result.entryCount, 1);
  assert.equal(result.items.length, 1);
});

test('mixed-content XML title preserves its original text order', () => {
  const xml = rdf(item()).replace('<![CDATA[好きなゲームの思い出を語ろう]]>', '好きな<em>ゲーム</em>の思い出');
  assert.equal(parseMatomeFeed(xml, game, { now }).items[0].title, '好きなゲームの思い出');
});

test('explicit, shock and serious personal-harm headlines are filtered before publication', () => {
  for (const title of ['エロ画像まとめ', '閲覧注意の映像', '有名人の不倫が発覚', '殺人事件の現場', '個人情報晒しスレ', '死体を発見']) assert.equal(parseMatomeFeed(rdf(item({ title })), game, { now }).items.length, 0);
});

test('mixed chat feed admits discussion and humour, not its general news categories', () => {
  const xml = rdf(item({ title: '宇宙について不思議なこと', url: `${chat.siteUrl}archives/1.html`, categories: ['科学・自然'] }) + item({ title: '新しい条例が成立', url: `${chat.siteUrl}archives/2.html`, categories: ['国内ニュース'] }) + item({ title: '吹いたコピペを教えて', url: `${chat.siteUrl}archives/3.html`, categories: ['吹いたレス・爆笑コピペ'] }));
  const result = parseMatomeFeed(xml, chat, { now });
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((article) => article.categories), [['chat'], ['neta']]);
});

test('neta is evidence-based and can overlap, never a catch-all or ネタバレ substring', () => {
  assert.deepEqual(classifyMatomeCategories('ゲームで見た珍回答ｗｗｗ', ['話題'], game), ['game', 'neta']);
  assert.deepEqual(classifyMatomeCategories('漫画のネタバレ感想', ['アニメ'], anime), ['anime']);
  assert.deepEqual(classifyMatomeCategories('最近の生活について', ['生活'], chat), ['chat']);
  assert.deepEqual(classifyMatomeCategories('新しいゲーム', ['ゲーム'], anime), ['game']);
  assert.deepEqual(classifyMatomeCategories('ロックマンエグゼのシステムとアニメ', ['なんでも実況J'], game), ['game', 'anime']);
});

test('canonical URL dedupe is stable and publication dates do not become fetch dates', async () => {
  const payload = await collect({ fetchImpl: async () => response(rdf(item() + item({ url: `${game.siteUrl}archives/123.html?utm_source=other#top` }))) });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.items[0].publishedAt, '2026-10-02T03:00:00.000Z');
  assert.equal(payload.items[0].fetchedAt, now.toISOString());
});

test('transient HTTP errors retry once; 403/404 and HTML challenges are not retried', async () => {
  let attempts = 0;
  const recovered = await collect({ fetchImpl: async () => ++attempts === 1 ? response('', 503) : response(rdf()) });
  assert.equal(attempts, 2);
  assert.equal(recovered.status, 'ok');
  for (const [body, status, kind] of [['', 403, 'http_403'], ['', 404, 'http_404'], ['<html>Unavailable</html>', 200, 'invalid_feed']]) {
    attempts = 0;
    const failed = await collect({ fetchImpl: async () => { attempts++; return response(body, status); } });
    assert.equal(attempts, 1);
    assert.equal(failed.status, 'unavailable');
    assert.equal(failed.sources[0].error, kind);
  }
});

test('partial outage retains failed-source articles, timestamps and first-seen identity', async () => {
  const baseline = await collect({ sources: [game, anime], fetchImpl: async (url) => response(rdf(item({ url: `${url.includes('jumpmatome') ? anime.siteUrl : game.siteUrl}archives/123.html` }))) });
  const later = new Date('2026-10-02T04:00:00Z');
  const next = await collect({ previous: baseline, now: later, sources: [game, anime], fetchImpl: async (url) => url === anime.feedUrl ? response('', 403) : response(rdf(item())) });
  assert.equal(next.status, 'partial');
  assert.equal(next.items.length, 2);
  const old = next.items.find((entry) => entry.sourceId === anime.id);
  assert.equal(old.cached, true);
  assert.equal(old.fetchedAt, now.toISOString());
  assert.equal(old.firstSeenAt, now.toISOString());
  assert.equal(next.sources[1].lastSuccessAt, now.toISOString());
  assert.equal(next.generatedAt, later.toISOString());
});

test('complete outage preserves last successful acquisition time and marks cached articles', async () => {
  const previous = await collect();
  const next = await collect({ previous, now: new Date('2026-10-02T04:00:00Z'), fetchImpl: async () => response('', 404) });
  assert.equal(next.status, 'unavailable');
  assert.equal(next.generatedAt, previous.generatedAt);
  assert.equal(next.items[0].publishedAt, previous.items[0].publishedAt);
  assert.equal(next.items[0].fetchedAt, previous.items[0].fetchedAt);
  assert.equal(next.items[0].cached, true);
  assert.notEqual(next.checkedAt, previous.checkedAt);
});

test('syntactically valid malformed cache envelopes do not stop scheduled collection', async () => {
  for (const previous of [null, [], 'invalid', 1, { sources: [null, false, 2], items: [null, false, 2] }]) {
    const result = await collect({ previous });
    assert.equal(result.status, 'ok');
    assert.equal(result.items.length, 1);
  }
});

test('cache retention is seven days, capped per source, and revalidates public data', async () => {
  const initial = await collect();
  const good = initial.items[0];
  const previous = { ...initial, items: Array.from({ length: 70 }, (_, index) => ({ ...good, url: `${game.siteUrl}archives/${index}.html` })).concat([{ ...good, url: 'javascript:alert(1)' }, { ...good, url: `${game.siteUrl}archives/800.html`, publishedAt: '2026-09-01T00:00:00Z' }]) };
  const next = await collect({ previous, fetchImpl: async () => response('', 404) });
  assert.equal(next.items.length, 60);
  assert.ok(next.items.every((entry) => entry.url.startsWith(game.siteUrl)));
  const expired = await collect({ previous: initial, now: new Date('2026-10-10T04:00:00Z'), fetchImpl: async () => response('', 404) });
  assert.equal(expired.items.length, 0);
});

test('successful rolling feeds retain recently seen older entries without making them new', async () => {
  const previous = await collect();
  const next = await collect({ previous, now: new Date('2026-10-02T04:00:00Z'), fetchImpl: async () => response(rdf(item({ url: `${game.siteUrl}archives/124.html` }))) });
  assert.equal(next.items.length, 2);
  assert.equal(next.items.find((entry) => entry.url === previous.items[0].url).fetchedAt, previous.items[0].fetchedAt);
});

test('currently rejected entries revoke their previously benign cached identities', async () => {
  const previous = await collect();
  for (const change of [{ title: 'エロ画像まとめ' }, { title: 'ゲームのセール情報' }, { date: null }, { date: '2026-01-01T00:00:00Z' }]) {
    const next = await collect({ previous, fetchImpl: async () => response(rdf(item(change))) });
    assert.equal(next.status, 'ok');
    assert.equal(next.items.length, 0);
    assert.equal(next.sources[0].retainedCount, 0);
  }
  const contradictory = await collect({ previous, fetchImpl: async () => response(rdf(item() + item({ title: 'エロ画像まとめ' }))) });
  assert.equal(contradictory.items.length, 0);
});

test('refresh writes atomic generated JSON and first-run failure never writes an empty success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'matome-refresh-'));
  const outputPath = join(directory, 'matome.json');
  try {
    const failed = await refreshMatomeThreads({ outputPath, now, sources: [game], sleepImpl: noSleep, fetchImpl: async () => response('', 404) });
    assert.equal(failed.written, false);
    await assert.rejects(readFile(outputPath), { code: 'ENOENT' });
    const success = await refreshMatomeThreads({ outputPath, now, sources: [game], sleepImpl: noSleep, fetchImpl: async () => response(rdf()) });
    assert.equal(success.written, true);
    assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).items.length, 1);
    const old = await readFile(outputPath, 'utf8');
    await refreshMatomeThreads({ outputPath, now: new Date('2026-10-10T04:00:00Z'), sources: [game], sleepImpl: noSleep, fetchImpl: async () => response('', 404) });
    assert.equal(await readFile(outputPath, 'utf8'), old);
    await writeFile(outputPath, '{invalid');
    const repaired = await refreshMatomeThreads({ outputPath, now, sources: [game], sleepImpl: noSleep, fetchImpl: async () => response(rdf()) });
    assert.equal(repaired.written, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('scheduled refresh runs the collector and commits its generated JSON', async () => {
  const refresh = await readFile(new URL('../scripts/refresh-data.mjs', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/refresh-news.yml', import.meta.url), 'utf8');
  assert.match(refresh, /name: 'matome',[\s\S]*fetch-matome-threads\.mjs[\s\S]*refreshMatomeThreads/);
  assert.match(refresh, /await runGuardedRefresh/);
  assert.match(workflow, /npm run refresh/);
  assert.match(workflow, /git add data/);
  assert.match(workflow, /7,37 \* \* \* \*/);
});
