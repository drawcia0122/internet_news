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
// Editorial fields, IDs, scores and timestamps are left unchanged.
export function repairArticleSourcesInPayload(value) {
  if (Array.isArray(value)) return value.map(repairArticleSourcesInPayload);
  if (!value || typeof value !== 'object') return value;
  const corrected = repairStoredArticleSource(value);
  return Object.fromEntries(Object.entries(corrected).map(([key, child]) => [key, repairArticleSourcesInPayload(child)]));
}
