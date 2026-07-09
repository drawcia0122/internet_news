import { tokenizeTopicText } from "./topic-normalizer.mjs";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tokenJaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeTopicSignature(item) {
  const title = String(item?.title ?? "").trim();
  const category = item?.category ?? item?.categories?.[0] ?? "general";
  const categories = Array.isArray(item?.categories) ? item.categories : [category];
  const tokens = tokenizeTopicText(title).slice(0, 12);
  const tokenSet = new Set(tokens);
  const timestamp = new Date(item?.publishedAt ?? item?.capturedAt ?? "").getTime();
  return {
    title,
    category,
    categories,
    hotScore: Number(item?.hotScore ?? item?.score ?? 0),
    tokenSet,
    timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
  };
}

function isLikelySameTopic(cluster, candidate) {
  const representative = cluster.representativeTopic ?? {};
  const representativeSig = normalizeTopicSignature(representative);
  const candidateSig = normalizeTopicSignature(candidate);
  const lexical = tokenJaccard(representativeSig.tokenSet, candidateSig.tokenSet);
  const sameCategory = representativeSig.category === candidateSig.category;
  const sharedCategory = representativeSig.categories.some((category) => candidateSig.categories.includes(category) && category !== "general");
  if (lexical >= 0.74) return true;
  if ((sameCategory || sharedCategory) && lexical >= 0.56) return true;
  return false;
}

function recentWeight(nowTime, timestamp) {
  if (!timestamp) return 0.2;
  const diffHours = Math.max(0, (nowTime - timestamp) / (1000 * 60 * 60));
  if (diffHours <= 3) return 1;
  if (diffHours <= 6) return 0.85;
  if (diffHours <= 12) return 0.7;
  if (diffHours <= 24) return 0.5;
  if (diffHours <= 48) return 0.3;
  return 0.15;
}

function buildInternalSignalStats(cluster, browseItems, archiveItems, now) {
  const nowTime = new Date(now).getTime();
  const browseMatches = browseItems.filter((item) => isLikelySameTopic(cluster, item));
  const archiveMatches = archiveItems.filter((item) => isLikelySameTopic(cluster, item));
  const uniqueCategoryCount = new Set(
    [...browseMatches, ...archiveMatches].flatMap((item) => Array.isArray(item?.categories) ? item.categories : [item?.category ?? "general"]),
  ).size;
  const weightedBrowse = browseMatches.reduce((sum, item) => sum + recentWeight(nowTime, new Date(item?.publishedAt ?? item?.capturedAt ?? "").getTime()), 0);
  const weightedArchive = archiveMatches.reduce((sum, item) => sum + recentWeight(nowTime, new Date(item?.publishedAt ?? item?.capturedAt ?? "").getTime()), 0);
  const maxArchiveHot = archiveMatches.reduce((max, item) => Math.max(max, Number(item?.hotScore ?? item?.score ?? 0)), 0);
  const repeatedAppearanceScore = clamp(weightedBrowse * 18 + weightedArchive * 6, 0, 100);
  const crossCategoryScore = clamp((uniqueCategoryCount / 5) * 100, 0, 100);
  const archiveHeatScore = clamp(maxArchiveHot, 0, 100);

  return {
    browseMatchCount: browseMatches.length,
    archiveMatchCount: archiveMatches.length,
    repeatedAppearanceScore: Math.round(repeatedAppearanceScore * 10) / 10,
    crossCategoryScore: Math.round(crossCategoryScore * 10) / 10,
    archiveHeatScore: Math.round(archiveHeatScore * 10) / 10,
    internalSearchScore: Math.round(clamp(repeatedAppearanceScore * 0.65 + archiveHeatScore * 0.35, 0, 100) * 10) / 10,
    internalSocialScore: Math.round(clamp(repeatedAppearanceScore * 0.45 + crossCategoryScore * 0.55, 0, 100) * 10) / 10,
  };
}

export function attachInternalBuzzSignals(clusters, { browseItems = [], archiveItems = [], now = new Date() } = {}) {
  return clusters.map((cluster) => ({
    ...cluster,
    internalSignalStats: buildInternalSignalStats(cluster, browseItems, archiveItems, now),
  }));
}
