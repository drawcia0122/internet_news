// Historical RSS repair, verified 2026-10-02 against the publisher's embedded
// data-ytid and YouTube's oEmbed title/official channel. No title/channel guessing.
// https://news.denfaminicogamer.jp/news/2610012r
// https://www.youtube.com/watch?v=Hs1AlE91RYQ
const VERIFIED_VIDEO = Object.freeze({
  title: 'TVアニメ『新 美味しんぼ』ティザーPV',
  originalUrl: 'https://www.youtube.com/c/Oishinbo?sub_confirmation=1',
  canonicalUrl: 'https://www.youtube.com/watch?v=Hs1AlE91RYQ',
  thumbnailUrl: 'https://i.ytimg.com/vi/Hs1AlE91RYQ/hqdefault.jpg',
});
const URL_FIELDS = ['url', 'sourceUrl', 'canonicalUrl', 'link'];

// Reverified 2026-10-04: the publisher above still embeds Hs1AlE91RYQ;
// YouTube oEmbed identifies it as the Oishinbo official-channel teaser.
// RZwFB0BJCtw is Aniplex's unrelated Biblia PV. The path-only URL key merged
// their retained records at d4e6ede; e0737ad preserves the original timestamp.
// Match that exact persisted collision, never a title/channel alone.
const RETAINED_COLLISION = Object.freeze({
  id: 'auto-anime-tvアニメ-新-美味しんぼ-ティザーpv-youtube.com/c/oishinbo',
  publishedAt: '2026-10-01T09:12:36.000Z',
  otherTitle: 'TVアニメ『ビブリア古書堂の事件手帖』本PV第１弾｜2027年4月より放送開始',
  otherUrl: 'https://www.youtube.com/watch?v=RZwFB0BJCtw',
  otherPublishedAt: '2026-10-03T13:24:04.000Z',
});

function retainedCollisionSignal(item) {
  if (item?.id !== RETAINED_COLLISION.id || item?.title !== VERIFIED_VIDEO.title
    || item?.publishedAt !== RETAINED_COLLISION.publishedAt
    || item?.thumbnailUrl !== VERIFIED_VIDEO.thumbnailUrl
    || item?.sourceSignals?.length !== 1
    || URL_FIELDS.some((field) => item[field] && ![VERIFIED_VIDEO.originalUrl, VERIFIED_VIDEO.canonicalUrl, RETAINED_COLLISION.otherUrl].includes(item[field]))) return null;
  const signal = item.sourceSignals[0];
  return signal?.sourceId === 'hatena-hotentry'
    && signal?.title === RETAINED_COLLISION.otherTitle
    && signal?.url === RETAINED_COLLISION.otherUrl
    && signal?.canonicalUrl === RETAINED_COLLISION.otherUrl
    && signal?.publishedAt === RETAINED_COLLISION.otherPublishedAt ? signal : null;
}

function restoreKnownCollision(item) {
  const signal = retainedCollisionSignal(item);
  if (!signal) return item;
  const restoredSignal = {
    ...signal, title: item.title, url: VERIFIED_VIDEO.canonicalUrl,
    canonicalUrl: VERIFIED_VIDEO.canonicalUrl, publishedAt: item.publishedAt,
    publishedLabel: '10/1 09:12', thumbnailUrl: VERIFIED_VIDEO.thumbnailUrl,
    summary: item.summary ?? '', briefSummary: item.briefSummary ?? '',
  };
  if (Object.hasOwn(signal, 'thumbnail')) restoredSignal.thumbnail = VERIFIED_VIDEO.thumbnailUrl;
  const restored = { ...item, sourceUrl: VERIFIED_VIDEO.canonicalUrl, sourceSignals: [restoredSignal],
    posts: typeof item.posts === 'number' ? 1 : '1', metricLabel: 'source' };
  if (typeof item.scoreSummary === 'string') restored.scoreSummary = item.scoreSummary.replace(/^2サイト掲載/, '1サイト掲載');
  const multiSourceClaim = '複数ソースで同じ話題が確認されています。';
  if (Array.isArray(item.hotReasons)) restored.hotReasons = item.hotReasons.filter((reason) => reason !== multiSourceClaim);
  if (item.whyHot === multiSourceClaim) restored.whyHot = '';
  // 本 was introduced only by the collided Biblia record (compare e0737ad).
  if (Array.isArray(item.categories)) restored.categories = item.categories.filter((category) => category !== 'books');
  if (Array.isArray(item.categoryLabels)) restored.categoryLabels = item.categoryLabels.filter((label) => label !== '本');
  for (const field of URL_FIELDS) {
    if (restored[field] === RETAINED_COLLISION.otherUrl) restored[field] = VERIFIED_VIDEO.canonicalUrl;
  }
  if (item.primaryLink?.url === RETAINED_COLLISION.otherUrl) {
    restored.primaryLink = restoreCollisionReference(item.primaryLink, item);
  }
  if (Array.isArray(item.representativeArticles)) restored.representativeArticles = item.representativeArticles
    .filter((article) => !(article?.title === RETAINED_COLLISION.otherTitle
      && URL_FIELDS.some((field) => article[field] === RETAINED_COLLISION.otherUrl)))
    .map((article) => article?.title === item.title && URL_FIELDS.some((field) => article[field] === RETAINED_COLLISION.otherUrl)
      ? restoreCollisionReference(article, item) : article);
  // These generated discovery links belonged to the other video after merging.
  // Keep this article's links and metadata; never invent replacement searches.
  if (Array.isArray(item.searchLinks)) restored.searchLinks = item.searchLinks.filter((link) => {
    try {
      const url = new URL(link?.url);
      return ![...url.searchParams.values()].some((value) => value.includes(RETAINED_COLLISION.otherTitle));
    } catch { return true; }
  });
  return restored;
}

function restoreCollisionReference(reference, original) {
  const restored = { ...reference };
  for (const field of URL_FIELDS) {
    if (restored[field] === RETAINED_COLLISION.otherUrl) restored[field] = VERIFIED_VIDEO.canonicalUrl;
  }
  if (restored.title === RETAINED_COLLISION.otherTitle) restored.title = original.title;
  if (restored.publishedAt === RETAINED_COLLISION.otherPublishedAt) restored.publishedAt = original.publishedAt;
  if (restored.publishedLabel === '10/3 13:24') restored.publishedLabel = '10/1 09:12';
  for (const field of ['thumbnailUrl', 'thumbnail']) {
    if (restored[field] === 'https://i.ytimg.com/vi/RZwFB0BJCtw/hqdefault.jpg') restored[field] = VERIFIED_VIDEO.thumbnailUrl;
  }
  // A primary-link wrapper must not retain the other video's synopsis.
  if ([original.title, RETAINED_COLLISION.otherTitle].includes(reference.title)) {
    for (const field of ['summary', 'briefSummary']) if (Object.hasOwn(restored, field)) restored[field] = original[field] ?? '';
  }
  return restored;
}

// Recover the unrelated source before repairing the damaged representative.
// Run only on the retained trend archive before the normal archive merge and
// payload builders, so counts/pagination are regenerated together. A later
// fresh article with this URL takes precedence through normal archive merging.
export function recoverRetainedSourceArticles(items) {
  const recovered = [];
  for (const item of items) {
    const signal = retainedCollisionSignal(item);
    if (!signal || [...items, ...recovered].some((candidate) => candidate.title === signal.title
      && URL_FIELDS.some((field) => candidate[field] === signal.url))) continue;
    recovered.push({
      id: 'recovered-youtube-RZwFB0BJCtw', title: signal.title,
      sourceUrl: signal.url, sourceName: signal.sourceName ?? signal.source,
      sourceSignals: [signal], publishedAt: signal.publishedAt,
      thumbnailUrl: signal.thumbnailUrl ?? null,
      summary: signal.summary ?? '', briefSummary: signal.briefSummary ?? '',
      category: 'anime', categories: ['anime'], categoryLabel: 'アニメ', categoryLabels: ['アニメ'],
      score: 1, posts: '1', metricLabel: 'source',
    });
  }
  return [...items, ...recovered];
}

function hasOriginalUrl(item) {
  return URL_FIELDS.some((field) => item?.[field] === VERIFIED_VIDEO.originalUrl);
}

function correctSource(item) {
  if (item?.title !== VERIFIED_VIDEO.title || !hasOriginalUrl(item)) return item;
  const corrected = { ...item };
  for (const field of URL_FIELDS) {
    if (corrected[field] === VERIFIED_VIDEO.originalUrl) corrected[field] = VERIFIED_VIDEO.canonicalUrl;
  }
  if (!corrected.thumbnailUrl || /\/favicon[-_]\d+x\d+\.png(?:$|[?#])/i.test(corrected.thumbnailUrl)) {
    corrected.thumbnailUrl = VERIFIED_VIDEO.thumbnailUrl;
    if (Object.hasOwn(corrected, 'thumbnail')) corrected.thumbnail = VERIFIED_VIDEO.thumbnailUrl;
  }
  return corrected;
}

export function repairStoredArticleSource(item) {
  item = restoreKnownCollision(item);
  if (item?.title !== VERIFIED_VIDEO.title) return item;
  const originalSignals = Array.isArray(item.sourceSignals) ? item.sourceSignals : [];
  const signals = originalSignals.map(correctSource);
  const changedSignal = signals.some((signal, index) => signal !== originalSignals[index]);
  let corrected = correctSource(item);
  if (!changedSignal && corrected === item) return item;
  corrected = { ...corrected };
  if (Array.isArray(item.sourceSignals)) corrected.sourceSignals = signals;
  if (Array.isArray(item.representativeArticles)) corrected.representativeArticles = item.representativeArticles.map(correctSource);
  if (item.primaryLink?.url === VERIFIED_VIDEO.originalUrl) corrected.primaryLink = { ...item.primaryLink, url: VERIFIED_VIDEO.canonicalUrl };
  if (!corrected.thumbnailUrl || /\/favicon[-_]\d+x\d+\.png(?:$|[?#])/i.test(corrected.thumbnailUrl)) {
    corrected.thumbnailUrl = VERIFIED_VIDEO.thumbnailUrl;
    if (Object.hasOwn(corrected, 'thumbnail')) corrected.thumbnail = VERIFIED_VIDEO.thumbnailUrl;
  }
  return corrected;
}

// Used for already-generated small consumer snapshots as well as migration tests.
// Only exact verified historical errors are repaired; IDs, scores and the
// original article publication/collection timestamps are preserved.
export function repairArticleSourcesInPayload(value) {
  if (Array.isArray(value)) return value.map(repairArticleSourcesInPayload);
  if (!value || typeof value !== 'object') return value;
  const corrected = repairStoredArticleSource(value);
  return Object.fromEntries(Object.entries(corrected).map(([key, child]) => [key, repairArticleSourcesInPayload(child)]));
}
