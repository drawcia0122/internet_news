// Verified against the original public pages on 2026-10-02. These bounded
// repairs remove previously persisted extraction errors without replacing a
// later valid synopsis. New extraction must establish identity independently.
// https://news.yahoo.co.jp/pickup/6597306 (topicsDetail.detailText)
// https://news.yahoo.co.jp/expert/articles/32e047893c67efce237c3eb2b84fbacbeb2d2b77
import '../news-summary-integrity.js';
export const { repairStoredArticleSummary } = globalThis.NewsSummaryIntegrity;

export function repairArticleSummariesInPayload(value) {
  if (Array.isArray(value)) return value.map(repairArticleSummariesInPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(repairStoredArticleSummary(value))
    .map(([key, child]) => [key, repairArticleSummariesInPayload(child)]));
}
