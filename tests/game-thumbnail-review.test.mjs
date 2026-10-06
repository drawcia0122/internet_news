import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Independent review: exercise production parsing before any presentation dedupe,
// and model browser image state transitions rather than invoking retry blindly.
const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const NOW = '2026-10-06T04:00:00Z';
const URL_A = 'https://example.com/articles/Alpha?id=ONE';
const URL_B = 'https://example.com/articles/Alpha?id=TWO';
const TITLE = '『Example Quest』Steamで50%オフの1,000円、10月5日から10月8日まで';
const A = 'https://images.example.com/photos/a.jpg';
const B = 'https://images.example.com/photos/b.jpg';
const C = 'https://images.example.com/photos/c.jpg';
const D = 'https://images.example.com/photos/d.jpg';
const plain = (value) => JSON.parse(JSON.stringify(value));
const escape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const classes = (...values) => {
  const set = new Set(values);
  return { contains: (value) => set.has(value), add: (value) => set.add(value) };
};

class FakeImage {
  constructor({ primary = A, candidates = [B, C], raw } = {}) {
    this.classList = classes('game-card-image');
    this.isConnected = true;
    this.attributes = new Map([['data-game-image-candidates', raw ?? JSON.stringify(candidates)]]);
    this._src = primary;
    this.requested = [primary];
    this.complete = true;
    this.naturalWidth = 0;
    this.currentSrc = primary;
    this.wrapper = {
      classList: classes('game-card-thumb'), swaps: 0, attributes: new Map(),
      getAttribute: (key) => key === 'data-game-image-fallback' ? '💸' : null,
      setAttribute: (key, value) => this.wrapper.attributes.set(key, value),
      replaceChildren: (child) => { this.wrapper.child = child; this.wrapper.swaps += 1; this.isConnected = false; },
    };
  }
  get src() { return this._src; }
  set src(value) { this._src = new URL(value).href; this.requested.push(this._src); this.complete = false; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  closest(selector) { return selector === '.game-card-thumb' ? this.wrapper : null; }
  fail(c) { this.complete = true; this.currentSrc = this.src; this.naturalWidth = 0; c.handleGameImageError({ target: this }); }
}

function harness() {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return new Date(NOW).getTime(); }
  }
  const elements = new Map();
  const c = { console, URL, Intl, Date: FixedDate, HTMLImageElement: FakeImage, document: {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { innerHTML: '', querySelectorAll: () => [], addEventListener() {} });
      return elements.get(selector);
    },
    createElement() { return {
      set innerHTML(value) { this.value = value; }, get innerHTML() { return escape(this.textContent ?? this.value); }, value: '',
    }; },
    addEventListener() {},
  } };
  c.window = c;
  c.HomeDataUtils = {};
  vm.createContext(c);
  vm.runInContext(UTILS, c);
  let imageReads = 0;
  const readCandidates = c.TopicClientUtils.getCardImageCandidates;
  c.TopicClientUtils.getCardImageCandidates = (...args) => { imageReads += 1; return readCandidates(...args); };
  let source = SOURCE.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const names = [...source.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((match) => match[1]);
  source = source.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${names.join(',')}, setState: (state) => { dashboardState = state; } });})();`);
  vm.runInContext(source, c);
  return { c, elements, imageReads: () => imageReads };
}

function article(extra = {}) {
  return {
    id: 'example', title: TITLE, sourceUrl: URL_A, categories: ['games'], publishedAt: '2026-10-06T02:00:00Z',
    sourceSignals: [{ title: TITLE, url: URL_A, sourceName: 'Game source' }], ...extra,
  };
}
function prepare(c, items) {
  return c.prepareGameSourcePayload({ articles: true, file: 'fixture.json' }, { items }).items;
}
function offer(extra = {}) {
  return {
    appId: 123, title: 'Example Quest', store: 'Steam', country: 'JP', currency: 'JPY', edition: 'base-game',
    regularPrice: 2000, salePrice: 1000, discountPercent: 50,
    storeUrl: 'https://store.steampowered.com/app/123/?cc=jp&l=japanese',
    priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=123&cc=jp' },
    articleUrls: [URL_A], checkedAt: '2026-10-06T03:00:00Z', freshUntil: '2026-10-06T09:00:00Z',
    priceValidUntil: '2026-10-07T03:00:00Z', status: 'verified', ...extra,
  };
}

test('review: source preparation snapshots ownership before generic normalization borrows a sibling image', () => {
  const { c } = harness();
  const raw = article({ sourceSignals: [
    { title: 'Unrelated game article', url: URL_B, thumbnailUrl: B },
    { title: TITLE, url: URL_A },
  ] });
  const [prepared] = prepare(c, [raw]);
  assert.equal(prepared.thumbnailUrl, B, 'generic normalization still inherits the other image');
  assert.deepEqual(plain(c.articleImageCandidates(prepared)), [], 'game renderers ignore that inherited image');
  assert.equal(c.buildSearchArticles([prepared])[0].thumbnailUrl, null);
  assert.equal(c.buildSteamSales([prepared])[0].thumbnailUrl, null);
});

test('review: matching named-article image can follow an unrelated cluster image without contamination', () => {
  const { c } = harness();
  const [prepared] = prepare(c, [article({ sourceSignals: [
    { title: 'Unrelated game article', url: URL_B, thumbnailUrl: D },
    { title: TITLE, url: URL_A + '&utm_source=rss', thumbnailUrl: A, image: B },
  ] })]);
  assert.deepEqual(plain(c.articleImageCandidates(prepared)), [A, B]);
  assert.equal(c.buildSearchArticles([prepared])[0].url, URL_A);
});

test('review: absent top-level identity trusts only the exact-headline signal, not unowned cluster art', () => {
  const { c } = harness();
  const [prepared] = prepare(c, [article({ sourceUrl: undefined, thumbnailUrl: D, sourceSignals: [
    { title: 'Unrelated game article', url: URL_B, thumbnailUrl: C },
    { title: TITLE, url: URL_A, thumbnailUrl: A, image: B },
  ] })]);
  assert.deepEqual(plain(c.articleImageCandidates(prepared)), [A, B]);
});

test('review: meaningful URL query and path case differences cannot donate images', () => {
  const { c } = harness();
  const [prepared] = prepare(c, [article({ sourceSignals: [
    { title: TITLE, url: URL_B, thumbnailUrl: B },
    { title: TITLE, url: URL_A.replace('/Alpha', '/alpha'), thumbnailUrl: C },
    { title: TITLE, url: URL_A, thumbnailUrl: A },
  ] })]);
  assert.deepEqual(plain(c.articleImageCandidates(prepared)), [A]);
});

test('review: fuzzy grouping preserves the winner image snapshot even when the loser supplies art', () => {
  const { c } = harness();
  const inputs = prepare(c, [
    article({ id: 'loser', thumbnailUrl: B, score: 1, sourceUrl: URL_B, sourceSignals: [{ title: TITLE, url: URL_B }] }),
    article({ id: 'winner', score: 100 }),
  ]);
  const grouped = c.TopicClientUtils.dedupeTopics(inputs);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, 'winner');
  assert.equal(grouped[0].thumbnailUrl, B, 'generic grouping borrows loser art');
  assert.deepEqual(plain(c.articleImageCandidates(grouped[0])), []);
  assert.equal(c.buildSearchArticles(inputs).length, 2, 'article corpus remains ungrouped');
});

test('review: stale snapshot identity is discarded if the displayed article destination changes', () => {
  const { c } = harness();
  const [prepared] = prepare(c, [article({ thumbnailUrl: A })]);
  assert.deepEqual(plain(c.articleImageCandidates({ ...prepared, sourceUrl: URL_B })), []);
});

test('review: canonical mirrors can contribute art and search text only to their own article result', () => {
  const { c } = harness();
  const inputs = prepare(c, [
    article(),
    article({ id: 'mirror', sourceUrl: URL_A + '&utm_campaign=mail', thumbnailUrl: A, summary: 'Unique mirror wording' }),
    article({ id: 'other', sourceUrl: URL_B, thumbnailUrl: B, sourceSignals: [{ title: TITLE, url: URL_B }] }),
  ]);
  const results = c.buildSearchArticles(inputs);
  assert.equal(results.length, 2);
  const primary = results.find((item) => item.url === URL_A);
  assert.deepEqual(plain(primary.thumbnailCandidates), [A]);
  assert.match(primary.searchText, /unique mirror wording/);
  assert.deepEqual(plain(results.find((item) => item.url === URL_B).thumbnailCandidates), [B]);
});

test('review: roundup action cards do not assign a shared article image to one named game', () => {
  const { c } = harness();
  const title = '『Example Quest』と『Other Quest』がSteamセール中';
  const [prepared] = prepare(c, [article({ title, thumbnailUrl: A, sourceSignals: [{ title, url: URL_A }] })]);
  assert.equal(c.actionCardBase(prepared, { title: 'Example Quest', claim: 'roundup', url: URL_A, multipleSubjects: true }).thumbnailUrl, null);
});

test('review: mixed quote styles cannot turn a two-game roundup into a single-game image', () => {
  const { c } = harness();
  const title = '『Example Quest』と「Other Quest」がSteamで無料配布';
  const summary = '『Example Quest』がSteamで無料配布。';
  const [prepared] = prepare(c, [article({ title, summary, thumbnailUrl: A, sourceSignals: [{ title, summary, url: URL_A }] })]);
  const cards = c.buildFreeGames([prepared]);
  assert.equal(cards.length, 1, 'an individually scoped claim still produces its existing action card');
  assert.equal(cards[0].title, 'Example Quest');
  assert.equal(cards[0].thumbnailUrl, null, 'mixed quotation conventions do not establish which game is pictured');
});

test('review: a single featured game keeps its image when secondary quotation marks name its patch', () => {
  const { c } = harness();
  const title = '『Example Quest』大型アップデート「Frozen Roads」を配信';
  const [prepared] = prepare(c, [article({ title, thumbnailUrl: A, sourceSignals: [{ title, url: URL_A }] })]);
  assert.equal(c.actionCardBase(prepared, { title: 'Example Quest', claim: 'patch', url: URL_A, multipleSubjects: true }).thumbnailUrl, A);
  assert.equal(c.actionCardBase(prepared, { title: 'Other Quest', claim: 'mismatched', url: URL_A, multipleSubjects: true }).thumbnailUrl, null);
});

test('review: pain-limit description preserves its featured game image but unknown quotations do not', () => {
  const { c } = harness();
  for (const [title, expected] of [
    ['『脱毛サロンシミュレーター』で「痛みの限界」を見極めるSteamゲーム', A],
    ['『脱毛サロンシミュレーター』で「痛みの限界」を見極める。「Other Quest」も紹介', null],
  ]) {
    const [prepared] = prepare(c, [article({ title, thumbnailUrl: A, sourceSignals: [{ title, url: URL_A }] })]);
    assert.equal(c.actionCardBase(prepared, { title: '脱毛サロンシミュレーター', claim: 'game description', url: URL_A, multipleSubjects: true }).thumbnailUrl, expected);
  }
});

test('review: one recognized patch quote does not excuse a second unknown game quote', () => {
  const { c } = harness();
  const title = '『Example Quest』大型アップデート「Frozen Roads」と「Other Quest」の話題';
  const [prepared] = prepare(c, [article({ title, thumbnailUrl: A, sourceSignals: [{ title, url: URL_A }] })]);
  assert.equal(c.actionCardBase(prepared, { title: 'Example Quest', claim: 'mixed roundup', url: URL_A, multipleSubjects: true }).thumbnailUrl, null);
});

test('review: official sale candidates require HTTPS approved Steam host and exact app path', () => {
  const { c } = harness();
  const valid = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/hash/header.jpg';
  for (const invalid of [
    'http://cdn.akamai.steamstatic.com/steam/apps/123/header.jpg',
    'https://cdn.akamai.steamstatic.com/steam/apps/1234/header.jpg',
    'https://cdn.akamai.steamstatic.com/steam/apps/999/header.jpg',
    'https://steamstatic.com.attacker.example/steam/apps/123/header.jpg',
    'https://user:pass@cdn.akamai.steamstatic.com/steam/apps/123/header.jpg',
    'https://cdn.akamai.steamstatic.com:9443/steam/apps/123/header.jpg',
    'https://cdn.akamai.steamstatic.com/steam/apps/123/../999/header.jpg',
    A, null, {},
  ]) {
    const card = c.verifiedSaleCard(offer({ thumbnailUrl: invalid, thumbnailCandidates: [valid] }), [article({ thumbnailUrl: D })]);
    assert.ok(card, 'invalid image does not remove a valid price');
    assert.deepEqual(plain(card.thumbnailCandidates), [valid], String(invalid));
    assert.equal(card.regularPrice, 2000);
    assert.equal(card.salePrice, 1000);
  }
});

test('review: renderer validates, caps and encodes candidates with reserved lazy decorative image dimensions', () => {
  const { c } = harness();
  const html = c.renderSignalThumbnail({ thumbnailCandidates: [A, A + '#same', 'javascript:alert(1)', B, C, D] }, '💸');
  assert.match(html, /alt="" width="460" height="259" loading="lazy" decoding="async" referrerpolicy="no-referrer"/);
  assert.match(html, /data-game-image-candidates="\[&quot;https:\/\/images.example.com\/photos\/b.jpg&quot;,&quot;https:\/\/images.example.com\/photos\/c.jpg&quot;\]"/);
  assert.doesNotMatch(html, /javascript:|photos\/d.jpg|#same/);
  const quoted = c.renderSignalThumbnail({ thumbnailCandidates: [A, 'https://images.example.com/photos/b.jpg?caption=\" onerror=\"alert(1)'] }, '\" onclick=\"alert(1)');
  assert.doesNotMatch(quoted, /\" onerror=\"|\" onclick=\"/);
  assert.match(quoted, /&quot;/);
  const unsafe = c.renderSignalThumbnail({ thumbnailCandidates: ['https://example.com/site-logo.png'] });
  assert.doesNotMatch(unsafe, /<img/);
});

test('review: image exhaustion is bounded at three requests and preserves a stable decorative frame', () => {
  const { c } = harness();
  const image = new FakeImage({ candidates: [A + '#same', B, B, C, D] });
  for (let n = 0; n < 10; n += 1) image.fail(c);
  assert.deepEqual(image.requested, [A, B, C]);
  assert.equal(image.wrapper.swaps, 1);
  assert.equal(image.wrapper.child.textContent, '💸');
  assert.equal(image.wrapper.attributes.get('aria-hidden'), 'true');
  assert.equal(image.wrapper.classList.contains('game-card-thumb-fallback'), true);
});

test('review: pending, stale, successful, detached and unrelated error events never consume a candidate', () => {
  const { c } = harness();
  const image = new FakeImage();
  image.fail(c);
  for (let n = 0; n < 5; n += 1) c.handleGameImageError({ target: image });
  assert.deepEqual(image.requested, [A, B]);
  image.complete = true; // Previous source can still be exposed during a transition.
  c.handleGameImageError({ target: image });
  assert.deepEqual(image.requested, [A, B]);
  image.currentSrc = image.src;
  image.naturalWidth = 460;
  c.handleGameImageError({ target: image });
  assert.deepEqual(image.requested, [A, B]);
  image.naturalWidth = 0;
  image.isConnected = false;
  image.fail(c);
  assert.deepEqual(image.requested, [A, B]);
  c.handleGameImageError({ target: {} });
  const other = new FakeImage();
  other.classList = classes('other-image');
  other.fail(c);
  assert.deepEqual(other.requested, [A]);
});

test('review: invalid fallback markup terminates with one request and no exception', () => {
  const { c } = harness();
  for (const raw of ['{broken', 'null', '{}', '[1,{},null]', '["javascript:alert(1)","data:image/png;base64,x"]']) {
    const image = new FakeImage({ raw });
    image.fail(c);
    assert.deepEqual(image.requested, [A]);
    assert.equal(image.wrapper.swaps, 1);
  }
});

test('review: a rejected cached primary still counts toward the maximum of three requests', () => {
  const { c } = harness();
  const primary = 'https://example.com/site-logo.png';
  const image = new FakeImage({ primary, candidates: [A, B, C, D] });
  for (let n = 0; n < 10; n += 1) image.fail(c);
  assert.ok(image.requested.length <= 3, `made ${image.requested.length} image requests: ${image.requested.join(', ')}`);
  assert.equal(image.wrapper.swaps, 1);
});


test('review: lazy provenance resolves once from unchanged raw JSON and discards the retained reference', () => {
  const { c, imageReads } = harness();
  const raw = article({ thumbnailUrl: A, imageUrl: B, rawOnlyMarker: 'must stay internal' });
  Object.freeze(raw.sourceSignals[0]);
  Object.freeze(raw.sourceSignals);
  Object.freeze(raw);
  const before = JSON.stringify(raw);
  const [prepared] = prepare(c, [raw]);
  assert.equal(imageReads(), 0, 'preparation does not eagerly resolve image candidates');
  assert.equal(prepared.gameArticleImages.article, raw);
  const sibling = { ...prepared };
  assert.deepEqual(plain(c.articleImageCandidates(prepared)), [A, B]);
  const resolvedReads = imageReads();
  assert.ok(resolvedReads > 0);
  assert.equal(Object.hasOwn(prepared.gameArticleImages, 'article'), false);
  assert.deepEqual(plain(c.articleImageCandidates(sibling)), [A, B]);
  assert.equal(imageReads(), resolvedReads, 'dedupe/shallow clones share the resolved provenance cache');
  assert.equal(JSON.stringify(raw), before, 'snapshot resolution never changes raw input');
  const dashboard = c.buildDashboardState([prepared], [], { generatedAt: NOW });
  assert.doesNotMatch(JSON.stringify(dashboard), /gameArticleImages|rawOnlyMarker|must stay internal/);
});

test('review: validated candidate arrays are cached without sharing retry mutation', () => {
  const { c, imageReads } = harness();
  const input = Object.freeze([A, B, C, D]);
  const fields = c.thumbnailFields(input);
  const reads = imageReads();
  assert.equal(c.thumbnailFields(input), fields);
  assert.equal(c.thumbnailFields(fields.thumbnailCandidates), fields);
  assert.equal(imageReads(), reads, 'lifecycle reuse skips repeated sanitization');
  const image = new FakeImage({ candidates: fields.thumbnailCandidates.slice(1) });
  image.fail(c); image.fail(c); image.fail(c);
  assert.deepEqual(plain(fields.thumbnailCandidates), [A, B, C], 'fallback shifts a separate remaining list');
  assert.deepEqual(input, [A, B, C, D]);
  assert.deepEqual(image.requested, [A, B, C]);
});


test('review: URL validation cache remains bounded and does not confer article ownership', () => {
  const { c, imageReads } = harness();
  assert.equal(c.thumbnailFields([A]).thumbnailUrl, A);
  const firstReads = imageReads();
  assert.equal(c.thumbnailFields([A]).thumbnailUrl, A);
  assert.equal(imageReads(), firstReads, 'equal URLs in different arrays reuse URL-only validation');
  const [prepared] = prepare(c, [article({ sourceSignals: [
    { title: TITLE, url: URL_A },
    { title: 'Other article', url: URL_B, thumbnailUrl: A },
  ] })]);
  assert.deepEqual(plain(c.articleImageCandidates(prepared)), [], 'cached validity never permits a sibling to donate art');
  for (let index = 0; index < 1025; index += 1) c.thumbnailFields([`https://images.example.com/photos/cache-${index}.jpg`]);
  const afterEviction = imageReads();
  assert.equal(c.thumbnailFields([A]).thumbnailUrl, A);
  assert.equal(imageReads(), afterEviction + 1, 'bounded cache eventually evicts old validation entries');
});
