import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
await import('../shared-topic-utils.js');
await import('../home-render-utils.js');

const { buildCardThumbnail, getCardImageCandidates, handleCardImageError, pickCardImageUrl } = globalThis.TopicClientUtils;
const first = 'https://images.example.com/photos/first.jpg';
const second = 'https://images.example.com/photos/second.jpg';
const third = 'https://images.example.com/photos/third.jpg';
const article = 'https://example.com/articles/one';

function classes(...values) {
  const set = new Set(values);
  return { contains: (value) => set.has(value), add: (value) => set.add(value), remove: (value) => set.delete(value) };
}

class FakeImage {
  constructor({ fallbacks = [second], cardClass = 'trend-card' } = {}) {
    this.classList = classes('trend-thumb');
    this.card = { classList: classes(cardClass, 'has-thumb') };
    this.wrapper = {
      removed: 0,
      closest: (selector) => selector.split(', ').includes(`.${cardClass}`) ? this.card : null,
      remove: () => { this.wrapper.removed += 1; this.isConnected = false; },
    };
    this.attributes = new Map([['data-thumbnail-fallbacks', JSON.stringify(fallbacks)]]);
    this.requested = [first];
    this._src = first;
    this.currentSrc = first;
    this.complete = true;
    this.naturalWidth = 0;
    this.isConnected = true;
  }
  get src() { return this._src; }
  set src(value) { this._src = new URL(value).href; this.requested.push(this._src); this.complete = false; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  closest(selector) { return selector === '.trend-thumb-wrap' && this.isConnected ? this.wrapper : null; }
  fail() { this.complete = true; this.currentSrc = this.src; this.naturalWidth = 0; handleCardImageError({ target: this }); }
  loaded(width, height) {
    this.complete = true;
    this.currentSrc = this.src;
    this.naturalWidth = width;
    this.naturalHeight = height;
    handleCardImageError({ target: this, type: 'load' });
  }
  succeed() { this.loaded(600, 300); }
}
globalThis.HTMLImageElement = FakeImage;

test('keeps the primary choice and only retries images of the same article', () => {
  const item = {
    sourceUrl: article, thumbnailUrl: first,
    sourceSignals: [
      { url: 'https://example.com/articles/other', thumbnailUrl: third },
      { url: article + '?utm_source=rss', thumbnailUrl: second },
    ],
  };
  assert.equal(pickCardImageUrl(item), first);
  assert.deepEqual(getCardImageCandidates(item), [first, second]);
});

test('signal-owned primary retains its own article provenance and URL path case', () => {
  const item = { sourceSignals: [
    { url: article, thumbnailUrl: first, image: second },
    { url: 'https://example.com/articles/One', thumbnailUrl: third },
  ] };
  assert.deepEqual(getCardImageCandidates(item), [first, second]);
  assert.deepEqual(getCardImageCandidates({ thumbnailUrl: first, sourceSignals: [{ thumbnailUrl: second }] }), [first]);
});

test('candidate lists are sanitized, deduplicated and capped at three total requests', () => {
  assert.deepEqual(getCardImageCandidates({
    ogImage: first, twitterImage: first + '#duplicate', thumbnailUrl: second,
    imageUrl: third, image: 'https://images.example.com/photos/fourth.jpg',
  }), [first, second, third]);
  assert.deepEqual(getCardImageCandidates({
    ogImage: 'javascript:alert(1)', twitterImage: 'https://example.com/articles/not-an-image',
    thumbnailUrl: 'https://example.com/site-logo.png', image: second,
  }), [second]);
});

test('a failed primary retries the next real candidate and keeps a successful image', () => {
  const image = new FakeImage();
  image.fail();
  assert.deepEqual(image.requested, [first, second]);
  assert.equal(image.wrapper.removed, 0);
  assert.equal(image.attributes.has('data-thumbnail-fallbacks'), false);
  image.succeed();
  handleCardImageError({ target: image });
  assert.equal(image.wrapper.removed, 0);
  assert.equal(image.card.classList.contains('has-thumb'), true);
});

for (const cardClass of ['trend-card', 'topic-cluster-card', 'priority-card', 'must-read-card-shell']) {
  test(`exhausted images leave clean no-image layout for ${cardClass}`, () => {
    const image = new FakeImage({ cardClass, fallbacks: [second, third, 'https://example.com/photos/fourth.jpg'] });
    image.fail(); image.fail(); image.fail();
    for (let i = 0; i < 10; i += 1) image.fail();
    assert.deepEqual(image.requested, [first, second, third]);
    assert.equal(image.wrapper.removed, 1);
    assert.equal(image.card.classList.contains('has-thumb'), false);
    assert.equal(image.card.classList.contains('trend-card-no-thumb'), true);
  });
}

test('repeated pending/stale errors do not skip candidates or restart requests', () => {
  const image = new FakeImage({ fallbacks: [first, first + '#duplicate', second, second, third] });
  image.fail();
  for (let i = 0; i < 10; i += 1) handleCardImageError({ target: image });
  assert.deepEqual(image.requested, [first, second]);
  image.complete = true; // A late event for the old currentSrc is also ignored.
  handleCardImageError({ target: image });
  assert.deepEqual(image.requested, [first, second]);
  image.fail();
  assert.deepEqual(image.requested, [first, second, third]);
});

test('malformed or unsafe fallback attributes terminate without network retries', () => {
  for (const raw of ['{broken', 'null', '{}', '["javascript:alert(1)","data:image/png;base64,a"]']) {
    const image = new FakeImage();
    image.attributes.set('data-thumbnail-fallbacks', raw);
    image.fail();
    assert.deepEqual(image.requested, [first]);
    assert.equal(image.wrapper.removed, 1);
  }
});

test('detached images and unrelated errors never start requests', () => {
  const image = new FakeImage();
  image.isConnected = false;
  image.fail();
  assert.deepEqual(image.requested, [first]);
  handleCardImageError({ target: {} });
  const other = new FakeImage();
  other.classList = classes('event-thumb');
  other.fail();
  assert.deepEqual(other.requested, [first]);
});

test('home renderer retains lazy loading and safely encodes fallback attributes', () => {
  const item = { sourceUrl: article, thumbnailUrl: first, image: 'https://example.com/photos/second.jpg?caption=" onerror="alert(1)' };
  const html = globalThis.HomeRenderUtils.buildTrendCardThumb(item, { buildCardThumbnail });
  assert.match(html, /loading="lazy" referrerpolicy="no-referrer"/);
  assert.match(html, /data-thumbnail-fallbacks=/);
  assert.match(html, /&quot;/);
  assert.doesNotMatch(html, /" onerror="/);
  assert.equal(buildCardThumbnail({ thumbnailUrl: 'https://example.com/site-logo.png' }), '');
});

test('legacy underscored favicon thumbnails are rejected in card rendering', () => {
  assert.equal(globalThis.TopicClientUtils.buildCardThumbnail({ thumbnailUrl: 'https://www.youtube.com/s/desktop/2b888666/img/favicon_32x32.png' }), '');
});

test('a cached already-complete 1×1 load tries the next candidate and retains a real image', () => {
  const image = new FakeImage();
  image.loaded(1, 1);
  assert.deepEqual(image.requested, [first, second]);
  handleCardImageError({ target: image, type: 'load' }); // earlier load while replacement pending
  image.complete = true; // stale load whose currentSrc is still the old URL
  handleCardImageError({ target: image, type: 'load' });
  assert.deepEqual(image.requested, [first, second]);
  image.loaded(640, 480);
  assert.equal(image.wrapper.removed, 0);
  assert.equal(image.card.classList.contains('has-thumb'), true);
});

test('1×1 loads and failed replacements share the same bounded fallback and no-image layout', () => {
  const image = new FakeImage({ fallbacks: [second, third] });
  image.loaded(1, 1);
  image.fail();
  image.loaded(1, 1);
  assert.deepEqual(image.requested, [first, second, third]);
  assert.equal(image.wrapper.removed, 1);
  assert.equal(image.card.classList.contains('trend-card-no-thumb'), true);
  const unrelated = new FakeImage();
  unrelated.classList = classes('event-thumb');
  unrelated.loaded(1, 1);
  assert.deepEqual(unrelated.requested, [first]);
});

test('both news entry points capture load and error before appending image markup', async () => {
  for (const file of ['app.js', 'news.js']) {
    const s = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(s, /document\.addEventListener\('error', handleCardImageError, true\);/);
    assert.match(s, /document\.addEventListener\('load', handleCardImageError, true\);/);
  }
});

test('opted-in missing photos render an explicitly labelled non-image tile', () => {
  const item = { categoryLabel: '<スポーツ>', thumbnailUrl: 'https://example.com/site-logo.png' };
  const html = buildCardThumbnail(item, { placeholder: true });
  assert.match(html, /trend-thumb-placeholder/);
  assert.match(html, /&lt;スポーツ&gt;/);
  assert.match(html, /記事画像なし/);
  assert.doesNotMatch(html, /<img/);
  assert.equal(buildCardThumbnail(item), '');
  assert.match(buildCardThumbnail({}, { placeholder: true }), /<strong>ニュース<\/strong>/);
  assert.match(buildCardThumbnail({ thumbnailUrl: first, categoryLabel: 'スポーツ' }, { placeholder: true }), /data-thumbnail-placeholder="スポーツ".*<img/);
});

test('1×1 then exhausted candidates replace the image with its labelled tile', (t) => {
  const prev = globalThis.document;
  globalThis.document = {
    createElement: (tag) => ({ tag, append(...children) { this.children = children; } }),
  };
  t.after(() => { globalThis.document = prev; });
  const image = new FakeImage();
  image.wrapper.getAttribute = (name) => name === 'data-thumbnail-placeholder' ? '経済' : null;
  image.wrapper.replaceChildren = (tile) => { image.wrapper.tile = tile; image.isConnected = false; };
  image.loaded(1, 1);
  assert.equal(image.wrapper.tile, undefined);
  image.fail();
  assert.deepEqual(image.requested, [first, second]);
  assert.equal(image.wrapper.removed, 0);
  assert.equal(image.wrapper.tile.className, 'trend-thumb-placeholder');
  assert.deepEqual(image.wrapper.tile.children.map((el) => el.textContent), ['経済', '記事画像なし']);
  assert.equal(image.card.classList.contains('has-thumb'), true);
});
