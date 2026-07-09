function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function recencyScore(ageHours) {
  if (ageHours <= 1) return 10;
  if (ageHours <= 3) return 8.5;
  if (ageHours <= 6) return 7;
  if (ageHours <= 12) return 5.5;
  if (ageHours <= 24) return 3.5;
  if (ageHours <= 36) return 1.5;
  return 0;
}

function computeVelocity(cluster, now) {
  const nowTime = new Date(now).getTime();
  const timestamps = cluster.sourceSignals
    .map((signal) => new Date(signal?.publishedAt ?? "").getTime())
    .filter((value) => !Number.isNaN(value))
    .sort((left, right) => left - right);
  if (!timestamps.length) return { recent1h: 0, recent3h: 0, previous3h: 0, score: 0 };
  const recent1h = timestamps.filter((value) => nowTime - value <= 60 * 60 * 1000).length;
  const recent3h = timestamps.filter((value) => nowTime - value <= 3 * 60 * 60 * 1000).length;
  const previous3h = timestamps.filter((value) => {
    const diff = nowTime - value;
    return diff > 3 * 60 * 60 * 1000 && diff <= 6 * 60 * 60 * 1000;
  }).length;
  const surgeRatio = (recent3h + 1) / (previous3h + 1);
  const score = clamp((recent1h / 4) * 6 + clamp(surgeRatio - 1, 0, 3) / 3 * 8, 0, 14);
  return { recent1h, recent3h, previous3h, surgeRatio, score };
}

function computeAuthority(cluster) {
  const representative = cluster.representativeTopic ?? {};
  const officialBonus = cluster.officialSourceCount > 0 ? 3 : 0;
  const majorCoverageBonus = cluster.sourceCount >= 4 ? 2 : cluster.sourceCount >= 2 ? 1 : 0;
  const hotSignalBonus = Number(representative.hotScore ?? 0) >= 70 ? 1.5 : 0;
  return clamp(officialBonus + majorCoverageBonus + hotSignalBonus, 0, 6.5);
}

function computeExternalSignals(cluster) {
  const searchScore = Number(cluster?.externalSignals?.search?.score ?? 0);
  const redditScore = Number(cluster?.externalSignals?.reddit?.score ?? 0);
  const blueskyScore = Number(cluster?.externalSignals?.bluesky?.score ?? 0);
  const redditCount = Number(cluster?.externalSignals?.reddit?.count ?? 0);
  const blueskyCount = Number(cluster?.externalSignals?.bluesky?.count ?? 0);
  const socialScore = clamp(redditScore * 0.45 + blueskyScore * 0.55, 0, 100);
  const searchAvailable = Boolean(cluster?.externalSignals?.search?.available);
  const redditAvailable = Boolean(cluster?.externalSignals?.reddit?.available) && redditCount > 0;
  const blueskyAvailable = Boolean(cluster?.externalSignals?.bluesky?.available) && blueskyCount > 0;
  return {
    searchScore,
    socialScore,
    searchAvailable,
    socialAvailable: redditAvailable || blueskyAvailable,
  };
}

function computeInternalSignals(cluster) {
  const internalSearchScore = Number(cluster?.internalSignalStats?.internalSearchScore ?? 0);
  const internalSocialScore = Number(cluster?.internalSignalStats?.internalSocialScore ?? 0);
  return {
    searchScore: internalSearchScore,
    socialScore: internalSocialScore,
    browseMatchCount: Number(cluster?.internalSignalStats?.browseMatchCount ?? 0),
    archiveMatchCount: Number(cluster?.internalSignalStats?.archiveMatchCount ?? 0),
  };
}

function computePenalty(cluster) {
  let penalty = 0;
  const categories = new Set(cluster.categories ?? []);
  const hotScore = Number(cluster.representativeTopic?.hotScore ?? 0);
  const internetBuzzFriendly = categories.has("sns") || categories.has("net-culture") || categories.has("matome") || categories.has("games") || categories.has("entertainment") || categories.has("manga");
  if (cluster.sourceCount <= 1) {
    penalty += internetBuzzFriendly && hotScore >= 78 ? 3 : 10;
  }
  if (cluster.uniqueDomainCount <= 1 && cluster.articleCount >= 3) penalty += 5;
  if (cluster.ageHours > 24 && cluster.articleCount <= 2) penalty += 6;
  const title = String(cluster.representativeTopic?.title ?? "");
  if (/(まとめ|反応集|ゆっくり解説|ランキングだけ|おすすめ\d+選)/.test(title)) penalty += 4;
  if ((categories.has("politics") || categories.has("business") || categories.has("world") || categories.has("crime")) && hotScore < 72) {
    penalty += 7;
  }
  return penalty;
}

function normalizeCategoryBias(cluster) {
  const categories = new Set(cluster.categories ?? []);
  let bias = 0;
  if (categories.has("sns") || categories.has("net-culture") || categories.has("matome")) bias += 8;
  if (categories.has("games") || categories.has("entertainment") || categories.has("manga") || categories.has("tech")) bias += 5;
  if (categories.has("sports")) bias += 3;
  if (categories.has("general")) bias += 1;
  if (categories.has("politics") || categories.has("business") || categories.has("world") || categories.has("crime")) bias -= 5;
  return bias;
}

export function scoreTopicCluster(cluster, { now = new Date() } = {}) {
  const representative = cluster.representativeTopic ?? {};
  const coverage = clamp((cluster.articleCount / 10) * 18, 0, 18);
  const sourceDiversity = clamp((cluster.sourceCount / 6) * 9 + (cluster.uniqueDomainCount / 6) * 5, 0, 14);
  const trendSignal = clamp((Number(representative.hotScore ?? 0) / 100) * 22, 0, 22);
  const internetNativeBoost = (
    (cluster.categories ?? []).includes("sns")
    || (cluster.categories ?? []).includes("net-culture")
    || (cluster.categories ?? []).includes("games")
    || (cluster.categories ?? []).includes("entertainment")
  ) && Number(representative.hotScore ?? 0) >= 78 ? 8 : 0;
  const external = computeExternalSignals(cluster);
  const internal = computeInternalSignals(cluster);
  const searchBaseScore = Math.max(external.searchScore, internal.searchScore * 0.8);
  const socialBaseScore = Math.max(external.socialScore, internal.socialScore * 0.8);
  const search = clamp((searchBaseScore / 100) * 16, 0, 16);
  const social = clamp((socialBaseScore / 100) * 16, 0, 16);
  const freshness = recencyScore(cluster.ageHours);
  const velocity = computeVelocity(cluster, now);
  const authority = computeAuthority(cluster);
  const categoryBias = normalizeCategoryBias(cluster);
  const penalty = computePenalty(cluster);
  const raw = coverage + sourceDiversity + trendSignal + internetNativeBoost + search + social + freshness + velocity.score + authority + categoryBias - penalty;
  const buzzScore = clamp(Math.round(raw * 10) / 10, 0, 100);
  const cohesion = cluster.docs.length <= 1
    ? 0.7
    : clamp(0.45 + Math.min(cluster.docs.length, 5) * 0.08, 0, 0.92);
  const confidence = clamp(
    0.25 * (coverage / 18)
      + 0.2 * (sourceDiversity / 14)
      + 0.2 * (trendSignal / 22)
      + 0.15 * (velocity.score / 14)
      + 0.05 * (freshness / 10)
      + 0.05 * cohesion
      + 0.03 * Number(external.searchAvailable || internal.browseMatchCount > 0)
      + 0.02 * Number(external.socialAvailable || internal.archiveMatchCount > 0),
    0,
    1,
  );

  const whyRanked = [];
  if (cluster.sourceCount >= 3) whyRanked.push(`主要${cluster.sourceCount}媒体で同一話題を確認`);
  if (velocity.recent1h >= 2 || velocity.surgeRatio >= 1.8) whyRanked.push("直近数時間で関連記事が増加");
  if (Number(representative.hotScore ?? 0) >= 65) whyRanked.push("既存トレンド指標でも反応が強い");
  if (search >= 8) whyRanked.push("検索面でも関連話題の広がりを確認");
  if (social >= 8) whyRanked.push("海外SNSでも関連投稿が増加");
  if (internal.browseMatchCount >= 2) whyRanked.push("内部ブラウズ候補でも繰り返し浮上");
  if (internal.archiveMatchCount >= 2) whyRanked.push("アーカイブ上でも近い話題が連続出現");
  if (cluster.officialSourceCount > 0) whyRanked.push("公式または一次情報を含む");
  if (!whyRanked.length) whyRanked.push("複数の話題候補の中で最も総合スコアが高い");

  return {
    ...cluster,
    buzzScore,
    confidence: Math.round(confidence * 100) / 100,
    scoreBreakdown: {
      coverage: Math.round(coverage * 10) / 10,
      sourceDiversity: Math.round(sourceDiversity * 10) / 10,
      trend: Math.round(trendSignal * 10) / 10,
      internetNativeBoost: Math.round(internetNativeBoost * 10) / 10,
      search: Math.round(search * 10) / 10,
      social: Math.round(social * 10) / 10,
      velocity: Math.round(velocity.score * 10) / 10,
      freshness: Math.round(freshness * 10) / 10,
      authority: Math.round(authority * 10) / 10,
      categoryBias: Math.round(categoryBias * 10) / 10,
      penalty: -Math.round(penalty * 10) / 10,
    },
    whyRanked,
    velocityStats: velocity,
    externalSignalStats: external,
    internalSignalStats: cluster.internalSignalStats ?? null,
  };
}
