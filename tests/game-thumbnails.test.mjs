import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const utils = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const first = 'https://images.example.com/photos/first.jpg';
const second = 'https://images.example.com/photos/second.jpg';
const third = 'https://images.example.com/photos/third.jpg';
const title = '『Example Quest』Steamで発売されたゲームの詳しい紹介';
const url = 'https://example.com/articles/example-quest';
const plain = (value) => JSON.parse(JSON.stringify(value));
const article = (extra = {}) => ({ id: 'example', title, categories: ['games'], sourceUrl: url,
  publishedAt: '2026-10-06T02:00:00Z', sourceSignals: [{ title, url, sourceName: 'Example' }], ...extra });

function harness() {
  const elements = new Map();
  const node = () => ({ innerHTML: '', textContent: '', hidden: false, value: '', addEventListener() {}, focus() {}, scrollIntoView() {}, insertAdjacentHTML(_where, html) { this.innerHTML += html; }, querySelector() { return null; }, querySelectorAll() { return []; } });
  const c = { console, URL, Intl, Date, document: {
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, node()); return elements.get(selector); },
    createElement() { return { set innerHTML(value) { this.value = value; }, get innerHTML() { return this.textContent ?? this.value; }, value: '' }; },
  } };
  c.window = c; c.HomeDataUtils = {}; vm.createContext(c); vm.runInContext(utils, c);
  let script = source.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const names = [...script.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((m) => m[1]);
  script = script.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${names.join(',')}, setState: (state) => { dashboardState = state; }, setQuery: (query) => { searchQuery = query; } });})();`);
  vm.runInContext(script, c); return { c, elements };
}

test('article snapshots keep all supported image fields but reject sibling donors', () => {
  const { c } = harness();
  const topic = article({ ogImage: first, sourceSignals: [
    { title: 'Other game', url: 'https://example.com/articles/other', thumbnailUrl: third },
    { title, url: url + '?utm_source=rss', thumbnailUrl: second },
  ] });
  assert.deepEqual(plain(c.articleImageCandidates(topic)), [first, second]);
  assert.deepEqual(plain(c.articleImageCandidates(article({ sourceSignals: topic.sourceSignals.slice(0, 1) }))), []);
});

test('normalization and fuzzy topic grouping cannot manufacture article-owned images', () => {
  const { c } = harness();
  const raw = article({ sourceSignals: [{ title: 'Other game', url: 'https://example.com/articles/other', thumbnailUrl: third }] });
  const [prepared] = c.prepareGameSourcePayload({ articles: true, file: 'fixture' }, { items: [raw] }).items;
  assert.equal(prepared.thumbnailUrl, third, 'generic normalizer still has its legacy cluster fallback');
  assert.deepEqual(plain(c.articleImageCandidates(prepared)), [], 'captured provenance prevents use on this article');
  const own = c.prepareGameSourcePayload({ articles: true, file: 'fixture' }, { items: [article({ thumbnailUrl: first })] }).items[0];
  assert.deepEqual(plain(c.articleImageCandidates({ ...own, thumbnailUrl: third })), [first]);
  assert.deepEqual(plain(c.articleImageCandidates({ ...own, sourceUrl: 'https://example.com/articles/other' })), []);
});

test('missing primary URL only uses the matching headline signal image', () => {
  const { c } = harness();
  const topic = article({ sourceUrl: '', thumbnailUrl: third, sourceSignals: [
    { title: 'Unrelated neighbour with a longer title', url: 'https://example.com/articles/other', thumbnailUrl: third },
    { title, url, thumbnailUrl: first },
  ] });
  assert.deepEqual(plain(c.articleImageCandidates(topic)), [first]);
});

test('tracking-only URL mirrors contribute images without adding search articles', () => {
  const { c } = harness();
  const items = c.buildSearchArticles([article(), article({ sourceUrl: url + '?utm_source=feed', thumbnailUrl: second })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, url);
  assert.deepEqual(plain(items[0].thumbnailCandidates), [second]);
  assert.equal(c.buildSearchArticles([article(), article({ sourceUrl: url + '?id=2', thumbnailUrl: third })]).length, 2);
});

test('Steam cards accept only image assets for their exact app identity', () => {
  const { c } = harness();
  const exact = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/abc/header_japanese.jpg?t=42';
  assert.deepEqual(plain(c.steamImageCandidates({ appId: 123, thumbnailUrl: exact })), [exact]);
  for (const image of [first, exact.replace('/123/', '/1234/'), exact.replace('steamstatic.com', 'steamstatic.com.evil.example'), exact.replace('https://', 'https://user:pass@'), exact.replace('/store_item_assets/steam/', '/unrelated/')]) {
    assert.deepEqual(plain(c.steamImageCandidates({ appId: 123, thumbnailUrl: image })), []);
  }
});

test('roundup artwork remains article art and is omitted from a multi-subject game action', () => {
  const { c } = harness();
  const topic = article({ title: '『Example Quest』と『Another Quest』の無料プレイ', thumbnailUrl: first });
  assert.equal(c.actionCardBase(topic, { title: 'Example Quest', claim: '', url, multipleSubjects: true }).thumbnailUrl, null);
  assert.equal(c.buildNewsFeed([topic], new Set())[0].thumbnailUrl, first);
});

test('backup and search rows render original article thumbnails without losing links', () => {
  const { c, elements } = harness();
  const topic = article({ thumbnailUrl: first });
  const state = { newsItems: c.buildNewsFeed([topic], new Set()), searchItems: c.buildSearchArticles([topic]) };
  c.setState(state); c.renderNewsList(); c.setQuery('Example'); c.renderSearchResults();
  for (const selector of ['#news-list', '#game-search-results']) {
    const html = elements.get(selector).innerHTML;
    assert.match(html, /class="game-card-image"/);
    assert.ok(html.includes(first)); assert.ok(html.includes(`href="${url}"`));
    assert.match(html, /alt="" width="460" height="259" loading="lazy" decoding="async" referrerpolicy="no-referrer"/);
  }
});

test('image-free article rows stay text-only without fabricated visual placeholders', () => {
  const { c, elements } = harness();
  c.setState({ newsItems: c.buildNewsFeed([article()], new Set()), searchItems: c.buildSearchArticles([article()]) });
  c.renderNewsList(); c.setQuery('Example'); c.renderSearchResults();
  for (const selector of ['#news-list', '#game-search-results']) assert.doesNotMatch(elements.get(selector).innerHTML, /game-card-thumb|<img/);
});

test('thumbnail requests are sanitized, deduplicated and capped with safely escaped markup', () => {
  const { c } = harness();
  assert.deepEqual(plain(c.thumbnailFields([first, first + '#same', second, third, first + '?fourth']).thumbnailCandidates), [first, second, third]);
  const html = c.renderSignalThumbnail({ thumbnailCandidates: ['javascript:alert(1)', 'https://example.com/site-logo.png', first, second + '?caption=" onerror="alert(1)'] });
  assert.ok(html.includes(first)); assert.match(html, /&quot;/); assert.doesNotMatch(html, /" onerror="/);
  assert.doesNotMatch(c.renderSignalThumbnail({ thumbnailUrl: 'javascript:alert(1)' }), /<img/);
});

test('hero cards only illustrate concrete content; stat controls get no images', () => {
  const { c } = harness();
  const item = { title: 'Example Quest', label: '本日価格確認', detail: 'Verified report', thumbnailUrl: first, href: '#game-card-steam-123', jumpKey: 'steam-123', highlightKey: 'sale:steam-123' };
  c.setState({ todayHighlights: [item] });
  assert.equal((c.buildHeroCommandCards().match(/<img/g) || []).length, 1);
  c.setState({ todayHighlights: [] });
  assert.doesNotMatch(c.buildHeroCommandCards(), /<img/);
  assert.doesNotMatch(c.renderHeroStat('Sale', '1', 'Info', '#sale-section'), /<img/);
});

test('sale headers reserve the original wide aspect and news metadata keeps its own row', () => {
  assert.match(css, /\.game-sale-card\.game-compact-card\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.game-sale-card\.game-compact-card \.game-card-thumb\s*\{\s*aspect-ratio: 460 \/ 215/);
  assert.match(css, /\.game-sale-card \.game-card-thumb img\s*\{\s*object-fit: contain/);
  assert.match(css, /\.game-news-panel \.game-news-row\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
});
