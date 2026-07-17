import { clusterTopicDocuments } from "./topic-clusterer.mjs";
import { scoreTopicCluster } from "./buzz-score.mjs";
import { attachExternalBuzzSignals } from "./external-buzz-signals.mjs";
import { attachInternalBuzzSignals } from "./internal-buzz-signals.mjs";

async function retryTopExternalSignals(clusters, { fetchImpl = fetch, now = new Date() } = {}) {
  const top = clusters.slice(0, 3);
  const retried = await attachExternalBuzzSignals(top, {
    fetchImpl,
    now,
    cachePath: "data/topic-external-signal-cache-top.json",
    limit: top.length,
    concurrency: 1,
    ttlMinutes: 0,
  });
  const retriedMap = new Map(retried.map((cluster) => [cluster.clusterId, cluster]));
  return clusters.map((cluster) => retriedMap.get(cluster.clusterId) ?? cluster);
}

function buildDeterministicSummary(cluster) {
  const topic = cluster.representativeTopic ?? {};
  const title = topic.title ?? cluster.canonicalEventLabel ?? "今日の話題";
  const sourceNames = [...new Set(cluster.sourceSignals.map((signal) => signal?.sourceName ?? signal?.source).filter(Boolean))];
  const sourceLabel = sourceNames.slice(0, 3).join("、");
  const whatHappened = topic.whatHappened
    ?? topic.summary
    ?? `${title} をめぐる報道や反応が短時間に集まっています。`;
  const whyBuzzing = cluster.whyRanked?.[0]
    ? `${cluster.whyRanked[0]}。${cluster.sourceCount > 1 ? `報道元は${sourceLabel || "複数媒体"}です。` : ""}`.trim()
    : `複数のニュース候補の中で、報道量と勢いのバランスが最も強い話題です。`;
  const netReaction = Number(topic.hotScore ?? 0) >= 65
    ? "SNSや検索で追いかけやすいタイプの話題として反応が集まっています。速報の共有だけでなく、背景や影響を整理する投稿も増えています。"
    : "ネット上では速報共有と要点整理が中心で、今後は続報や公式発表が出ると反応がさらに増える可能性があります。";
  const keyPoints = [
    `${cluster.sourceCount}媒体・${cluster.uniqueDomainCount}ドメインで確認されたトピックです。`,
    `最新更新は${cluster.latestPublishedAt ? new Date(cluster.latestPublishedAt).toLocaleString("ja-JP") : "時刻不明"}です。`,
    cluster.officialSourceCount > 0
      ? "一次情報を含むため、事実確認の軸を置きやすい話題です。"
      : "現時点では報道の出そろい方と勢いを優先して選出しています。",
  ];
  const threeMinuteSummary = [
    whatHappened,
    whyBuzzing,
    netReaction,
  ].join(" ");

  return {
    headline: title,
    whatHappened,
    whyBuzzing,
    netReaction,
    keyPoints,
    watchpoints: [
      "続報で事実関係や影響範囲が更新される可能性があります。",
      "一次情報や公式コメントが追加されたら優先して確認してください。",
    ],
    threeMinuteSummary,
  };
}

function buildRepresentativeArticles(cluster) {
  return cluster.sourceSignals
    .filter((signal) => signal?.url)
    .slice(0, 5)
    .map((signal) => ({
      title: signal.title ?? cluster.representativeTopic?.title ?? "関連記事",
      url: signal.url,
      sourceName: signal.sourceName ?? signal.source ?? "Source",
      publishedAt: signal.publishedAt ?? null,
    }));
}

function clusterToDisplayTopic(cluster, rank = 1) {
  const topic = cluster.representativeTopic ?? {};
  return {
    id: topic.id ?? cluster.clusterId,
    title: topic.title ?? cluster.canonicalEventLabel ?? "今日の話題",
    summary: cluster.summary?.threeMinuteSummary ?? topic.summary ?? topic.briefSummary ?? "",
    briefSummary: cluster.summary?.whatHappened ?? topic.briefSummary ?? topic.summary ?? "",
    whatHappened: cluster.summary?.whatHappened ?? topic.whatHappened ?? "",
    whyHot: cluster.summary?.whyBuzzing ?? topic.whyHot ?? cluster.whyRanked?.[0] ?? "",
    importantPoint: cluster.summary?.keyPoints?.[0] ?? topic.importantPoint ?? "",
    futureOutlook: cluster.summary?.watchpoints?.[0] ?? topic.futureOutlook ?? "",
    category: cluster.category,
    categories: cluster.categories,
    categoryLabel: topic.categoryLabel ?? cluster.category,
    categoryLabels: topic.categoryLabels ?? [],
    thumbnailUrl: topic.thumbnailUrl ?? "",
    sourceSignals: cluster.sourceSignals,
    hotScore: cluster.buzzScore,
    posts: String(cluster.articleCount ?? cluster.sourceSignals.length ?? 1),
    metricLabel: "signals",
    time: topic.time ?? "",
    publishedAt: cluster.latestPublishedAt ?? topic.publishedAt ?? topic.capturedAt ?? null,
    buzzScore: cluster.buzzScore,
    scoreBreakdown: cluster.scoreBreakdown,
    whyRanked: cluster.whyRanked,
    rank,
    summaryPayload: cluster.summary,
    representativeArticles: cluster.representativeArticles,
    externalSignals: cluster.externalSignals,
    externalSignalStats: cluster.externalSignalStats,
    externalSignalErrors: cluster.externalSignals?.errors ?? [],
    internalSignalStats: cluster.internalSignalStats ?? null,
    clusterStats: {
      articleCount: cluster.articleCount,
      sourceCount: cluster.sourceCount,
      uniqueDomainCount: cluster.uniqueDomainCount,
      officialSourceCount: cluster.officialSourceCount,
      latestSourceCount1h: cluster.velocityStats?.recent1h ?? 0,
    },
  };
}

function buildFallbackTopic({ trendItems = [], dailyBriefItems = [] } = {}) {
  const trendCandidate = [...trendItems]
    .filter((item) => Number(item?.hotScore ?? 0) >= 55)
    .sort((left, right) => Number(right?.hotScore ?? 0) - Number(left?.hotScore ?? 0))[0];
  if (trendCandidate) {
    return {
      ...trendCandidate,
      buzzScore: Number(trendCandidate.hotScore ?? 0),
      whyRanked: ["十分な話題集中が検出できないため、既存トレンド上位を表示しています。"],
      summaryPayload: {
        headline: trendCandidate.title ?? "今日のインターネット",
        whatHappened: trendCandidate.whatHappened ?? trendCandidate.summary ?? "現在の主要トピックを整理中です。",
        whyBuzzing: trendCandidate.whyHot ?? "既存トレンド指標で上位だったため暫定採用しています。",
        netReaction: "ネットでの反応を引き続き集計しています。",
        keyPoints: [trendCandidate.importantPoint ?? "続報を確認中です。"],
        watchpoints: ["十分なシグナルが集まり次第、最上位トピックへ自動更新します。"],
        threeMinuteSummary: trendCandidate.summary ?? trendCandidate.whatHappened ?? "現在の主要トピックを整理中です。",
      },
      representativeArticles: (trendCandidate.sourceSignals ?? []).slice(0, 3).map((signal) => ({
        title: signal.title,
        url: signal.url,
        sourceName: signal.sourceName ?? signal.source ?? "Source",
        publishedAt: signal.publishedAt ?? null,
      })),
    };
  }

  const briefCandidate = dailyBriefItems[0];
  if (briefCandidate) {
    return {
      id: briefCandidate.id,
      title: briefCandidate.title,
      category: "general",
      categories: ["general"],
      categoryLabel: briefCandidate.categoryLabel ?? "その他",
      categoryLabels: [briefCandidate.categoryLabel ?? "その他"],
      thumbnailUrl: briefCandidate.thumbnailUrl ?? "",
      publishedAt: briefCandidate.publishedAt ?? null,
      hotScore: 42,
      buzzScore: 42,
      posts: "1",
      metricLabel: "fallback",
      sourceSignals: briefCandidate.primaryLink?.url ? [{
        title: briefCandidate.title,
        url: briefCandidate.primaryLink.url,
        sourceName: briefCandidate.primaryLink.label ?? briefCandidate.categoryLabel ?? "Source",
        publishedAt: briefCandidate.publishedAt ?? null,
      }] : [],
      whyRanked: ["話題性シグナル不足のため、既存重要ニュース上位を表示しています。"],
      summaryPayload: {
        headline: briefCandidate.title,
        whatHappened: briefCandidate.thirtySecondSummary ?? "主要ニュースを整理中です。",
        whyBuzzing: "十分な話題集中は未検出のため、既存重要ニュースを代替表示しています。",
        netReaction: "ネット反応は再取得中です。",
        keyPoints: [briefCandidate.watchpoints ?? "続報確認中です。"],
        watchpoints: ["トピック再集計後に表示内容が更新される場合があります。"],
        threeMinuteSummary: briefCandidate.thirtySecondSummary ?? "主要ニュースを整理中です。",
      },
      representativeArticles: briefCandidate.primaryLink?.url ? [{
        title: briefCandidate.title,
        url: briefCandidate.primaryLink.url,
        sourceName: briefCandidate.primaryLink.label ?? briefCandidate.categoryLabel ?? "Source",
        publishedAt: briefCandidate.publishedAt ?? null,
      }] : [],
    };
  }

  return null;
}

function buildDebugPayload({ scoredTop = [], selectedCluster = null, fallbackUsed = false, now = new Date() } = {}) {
  return {
    generatedAt: new Date(now).toISOString(),
    fallbackUsed,
    selectedClusterId: selectedCluster?.clusterId ?? null,
    selectedTitle: selectedCluster?.representativeTopic?.title ?? selectedCluster?.canonicalEventLabel ?? null,
    candidates: scoredTop.slice(0, 10).map((cluster) => ({
      clusterId: cluster.clusterId,
      title: cluster.representativeTopic?.title ?? cluster.canonicalEventLabel ?? "話題",
      category: cluster.category,
      categories: cluster.categories,
      buzzScore: cluster.buzzScore,
      confidence: cluster.confidence,
      articleCount: cluster.articleCount,
      sourceCount: cluster.sourceCount,
      uniqueDomainCount: cluster.uniqueDomainCount,
      whyRanked: cluster.whyRanked,
      scoreBreakdown: cluster.scoreBreakdown,
      externalSignalStats: cluster.externalSignalStats ?? null,
      internalSignalStats: cluster.internalSignalStats ?? null,
      externalSignalErrors: cluster.externalSignals?.errors ?? [],
    })),
  };
}

export async function buildTodayInternetPayload({ trendItems = [], archiveItems = [], dailyBriefItems = [], now = new Date(), fetchImpl = fetch } = {}) {
  const currentTime = new Date(now);
  const recentItems = [...trendItems, ...archiveItems]
    .filter(Boolean)
    .filter((item) => {
      const categories = Array.isArray(item?.categories) ? item.categories : [item?.category ?? "general"];
      return !categories.includes("adult");
    })
    .filter((item) => {
      const publishedAt = item?.sourceSignals?.[0]?.publishedAt ?? item?.publishedAt ?? item?.capturedAt;
      const timestamp = new Date(publishedAt ?? "").getTime();
      if (Number.isNaN(timestamp)) return false;
      return currentTime.getTime() - timestamp <= 36 * 60 * 60 * 1000;
    });

  const browseItems = trendItems.filter(Boolean);
  const internallyEnrichedClusters = attachInternalBuzzSignals(
    clusterTopicDocuments(recentItems, { now: currentTime }),
    {
      browseItems,
      archiveItems,
      now: currentTime,
    },
  );

  const locallyRankedClusters = internallyEnrichedClusters
    .map((cluster) => scoreTopicCluster(cluster, { now: currentTime }))
    .sort((left, right) => right.buzzScore - left.buzzScore || right.confidence - left.confidence);

  const enrichedCandidates = await attachExternalBuzzSignals(locallyRankedClusters, {
    fetchImpl,
    now: currentTime,
    limit: 5,
    concurrency: 1,
  });

  const clusters = enrichedCandidates
    .map((cluster) => scoreTopicCluster(cluster, { now: currentTime }))
    .sort((left, right) => right.buzzScore - left.buzzScore || right.confidence - left.confidence);

  const retriedClusters = (await retryTopExternalSignals(clusters, {
    fetchImpl,
    now: currentTime,
  }))
    .map((cluster) => scoreTopicCluster(cluster, { now: currentTime }))
    .sort((left, right) => right.buzzScore - left.buzzScore || right.confidence - left.confidence);

  const scoredTop = retriedClusters.slice(0, 5).map((cluster, index) => {
    const summary = buildDeterministicSummary(cluster);
    return {
      ...cluster,
      rank: index + 1,
      summary,
      representativeArticles: buildRepresentativeArticles(cluster),
    };
  });

  let selectedCluster = scoredTop.find((cluster) => {
    const externalUnavailable = !cluster.externalSignalStats?.searchAvailable && !cluster.externalSignalStats?.socialAvailable;
    const confidenceThreshold = externalUnavailable ? 0.28 : 0.45;
    const internetNative = cluster.categories?.some((category) => ["sns", "net-culture", "games", "entertainment", "manga"].includes(category));
    const buzzThreshold = externalUnavailable ? (internetNative ? 40 : 60) : 55;
    return cluster.buzzScore >= buzzThreshold && cluster.confidence >= confidenceThreshold;
  })
    ?? scoredTop[0]
    ?? null;
  let fallbackUsed = false;

  if (!selectedCluster) {
    fallbackUsed = true;
    const fallbackTopic = buildFallbackTopic({ trendItems, dailyBriefItems });
    return {
      generatedAt: currentTime.toISOString(),
      topicVersion: 1,
      selectedTopic: fallbackTopic,
      runnerUps: [],
      fallbackUsed: true,
      debug: buildDebugPayload({ scoredTop, selectedCluster: null, fallbackUsed: true, now: currentTime }),
      dataQuality: {
        externalSignalsAvailable: { search: false, social: false },
        externalSignalErrors: [],
        confidence: 0.2,
      },
    };
  }

  const selectedTopic = clusterToDisplayTopic(selectedCluster, 1);
  const runnerUps = scoredTop
    .slice(1, 4)
    .map((cluster, index) => clusterToDisplayTopic(cluster, index + 2));

  const selectedExternalUnavailable = !selectedCluster.externalSignalStats?.searchAvailable && !selectedCluster.externalSignalStats?.socialAvailable;
  const selectedInternetNative = selectedCluster.categories?.some((category) => ["sns", "net-culture", "games", "entertainment", "manga"].includes(category));
  const minimumAcceptedBuzz = selectedExternalUnavailable
    ? (selectedInternetNative ? 40 : 60)
    : 55;

  if (selectedTopic.buzzScore < minimumAcceptedBuzz) {
    const fallbackTopic = buildFallbackTopic({ trendItems, dailyBriefItems });
    if (fallbackTopic) {
      fallbackUsed = true;
      return {
        generatedAt: currentTime.toISOString(),
        topicVersion: 1,
        selectedTopic: fallbackTopic,
        runnerUps,
        fallbackUsed: true,
        debug: buildDebugPayload({ scoredTop, selectedCluster, fallbackUsed: true, now: currentTime }),
        dataQuality: {
          externalSignalsAvailable: {
            search: Boolean(selectedCluster.externalSignalStats?.searchAvailable),
            social: Boolean(selectedCluster.externalSignalStats?.socialAvailable),
          },
          externalSignalErrors: selectedCluster.externalSignals?.errors ?? [],
          confidence: Math.max(0.2, selectedCluster.confidence),
        },
      };
    }
  }

  return {
    generatedAt: currentTime.toISOString(),
    topicVersion: 1,
    selectedTopic,
    runnerUps,
    fallbackUsed,
    debug: buildDebugPayload({ scoredTop, selectedCluster, fallbackUsed, now: currentTime }),
    dataQuality: {
      externalSignalsAvailable: {
        search: Boolean(selectedCluster.externalSignalStats?.searchAvailable),
        social: Boolean(selectedCluster.externalSignalStats?.socialAvailable),
      },
      externalSignalErrors: selectedCluster.externalSignals?.errors ?? [],
      confidence: selectedCluster.confidence,
    },
  };
}
