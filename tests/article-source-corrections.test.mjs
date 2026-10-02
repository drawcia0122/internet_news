import assert from 'node:assert/strict';
import test from 'node:test';
import { repairStoredArticleSource, repairArticleSourcesInPayload } from '../lib/article-source-corrections.mjs';
process.env.TREND_FETCH_SKIP_MAIN_FOR_TESTS = '1';
const { normalizeStoredTopic } = await import('../scripts/fetch-trend-topics.mjs');
const title = 'TVアニメ『新 美味しんぼ』ティザーPV';
const originalUrl = 'https://www.youtube.com/c/Oishinbo?sub_confirmation=1';
const canonicalUrl = 'https://www.youtube.com/watch?v=Hs1AlE91RYQ';
const thumbnailUrl = 'https://i.ytimg.com/vi/Hs1AlE91RYQ/hqdefault.jpg';
const item = () => ({ id: 'legacy-id', title, sourceUrl: originalUrl, category: 'anime', categories: ['anime'], publishedAt: '2026-10-01T09:12:36Z', sourceSignals: [{ title, url: originalUrl, canonicalUrl: originalUrl }] });

test('verified correction requires exact title and exact original URL and preserves editorial metadata', () => {
  const input = item(), result = repairStoredArticleSource(input);
  assert.equal(result.sourceUrl, canonicalUrl);
  assert.equal(result.sourceSignals[0].url, canonicalUrl);
  assert.equal(result.sourceSignals[0].canonicalUrl, canonicalUrl);
  assert.equal(result.thumbnailUrl, thumbnailUrl);
  assert.equal(result.id, input.id);
  assert.equal(result.publishedAt, input.publishedAt);
  assert.deepEqual(result.categories, input.categories);
  assert.equal(input.sourceUrl, originalUrl);
  assert.deepEqual(repairStoredArticleSource(result), result);
  for (const title of ['TVアニメ『新 美味しんぼ』新PV', '美味しんぼ公式チャンネル開設', '別アニメのティザーPV']) {
    const other = { ...input, title };
    assert.equal(repairStoredArticleSource(other), other);
  }
  const other = { ...input, sourceUrl: 'https://www.youtube.com/c/Other?sub_confirmation=1', sourceSignals: [] };
  assert.equal(repairStoredArticleSource(other), other);
});

test('current consumers and future stored-topic normalization use the same correction', () => {
  const grouped = { ...item(), sourceUrl: undefined, thumbnailUrl: '', primaryLink: { url: originalUrl }, representativeArticles: [{ title, url: originalUrl }] };
  const payload = { generatedAt: '2026-10-02T00:00:00Z', runnerUps: [grouped] };
  const result = repairArticleSourcesInPayload(payload);
  assert.equal(result.runnerUps[0].primaryLink.url, canonicalUrl);
  assert.equal(result.runnerUps[0].representativeArticles[0].url, canonicalUrl);
  assert.equal(result.runnerUps[0].thumbnailUrl, thumbnailUrl);
  assert.deepEqual(repairArticleSourcesInPayload(result), result);
  assert.equal(result.generatedAt, payload.generatedAt);
  const normalized = normalizeStoredTopic(item());
  assert.equal(normalized.sourceUrl, canonicalUrl);
  assert.equal(normalized.sourceSignals[0].url, canonicalUrl);
});

test('an already correct watch URL and a different video are not rewritten', () => {
  for (const url of [canonicalUrl, 'https://www.youtube.com/watch?v=abcdefghijk']) {
    const input = { ...item(), sourceUrl: url, sourceSignals: [{ title, url }] };
    assert.equal(repairStoredArticleSource(input), input);
  }
});
