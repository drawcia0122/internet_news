import assert from 'node:assert/strict';
import test from 'node:test';

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
  succeed() { this.complete = true; this.currentSrc = this.src; this.naturalWidth = 600; }
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
