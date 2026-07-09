import {
  buildBlockingKeys,
  buildTopicDocument,
  entityOverlap,
  tokenJaccard,
} from "./topic-normalizer.mjs";

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array(size).fill(0);
  }

  find(value) {
    if (this.parent[value] !== value) {
      this.parent[value] = this.find(this.parent[value]);
    }
    return this.parent[value];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (this.rank[leftRoot] < this.rank[rightRoot]) {
      this.parent[leftRoot] = rightRoot;
      return;
    }
    if (this.rank[leftRoot] > this.rank[rightRoot]) {
      this.parent[rightRoot] = leftRoot;
      return;
    }
    this.parent[rightRoot] = leftRoot;
    this.rank[leftRoot] += 1;
  }
}

function computeTimeProximity(left, right) {
  if (!left.timestamp || !right.timestamp) return 0.4;
  const diffHours = Math.abs(left.timestamp - right.timestamp) / (1000 * 60 * 60);
  if (diffHours <= 3) return 1;
  if (diffHours <= 6) return 0.8;
  if (diffHours <= 12) return 0.6;
  if (diffHours <= 24) return 0.35;
  if (diffHours <= 48) return 0.15;
  return 0;
}

function computeCategoryConsistency(left, right) {
  if (left.category === right.category) return 1;
  const leftSpecific = left.categories.filter((category) => category && category !== "general");
  const rightSpecific = right.categories.filter((category) => category && category !== "general");
  const overlap = leftSpecific.filter((category) => rightSpecific.includes(category)).length;
  return overlap > 0 ? 0.5 : 0;
}

function computeSimilarity(left, right) {
  const titleLexical = tokenJaccard(new Set(left.titleTokens), new Set(right.titleTokens));
  const lexical = tokenJaccard(left.tokenSet, right.tokenSet);
  const entities = entityOverlap(left.entitySet, right.entitySet);
  const numberOverlap = tokenJaccard(left.numberSet, right.numberSet);
  const time = computeTimeProximity(left, right);
  const category = computeCategoryConsistency(left, right);

  return {
    titleLexical,
    lexical,
    entities,
    numberOverlap,
    time,
    category,
    score: titleLexical * 0.38 + lexical * 0.18 + entities * 0.24 + numberOverlap * 0.1 + time * 0.06 + category * 0.04,
  };
}

function shouldMerge(left, right, similarity) {
  const samePrimaryCategory = left.category === right.category;
  const sharedSpecificCategory = left.categories
    .filter((category) => category && category !== "general")
    .some((category) => right.categories.includes(category));
  const hasEntityAnchor = similarity.entities >= 0.55;
  const strongLexical = similarity.titleLexical >= 0.72;
  const numberConflict = left.numberSet.size && right.numberSet.size && similarity.numberOverlap === 0;
  const hardNewsCategory = ["sports", "business", "politics", "world", "crime"].includes(left.category) || ["sports", "business", "politics", "world", "crime"].includes(right.category);
  const sameSourceSignal = String(left.topic?.title ?? "") === String(right.topic?.title ?? "");
  if (sameSourceSignal && similarity.score >= 0.55) return true;
  if (numberConflict && hardNewsCategory && similarity.titleLexical < 0.88) return false;
  if (!samePrimaryCategory && !sharedSpecificCategory && !strongLexical) return false;
  if (strongLexical && similarity.time >= 0.35) return true;
  if (left.category === "sports" && right.category === "sports" && similarity.entities < 0.45 && similarity.numberOverlap === 0) return false;
  if (left.category === "business" && right.category === "business" && similarity.entities < 0.45) return false;
  if (samePrimaryCategory && similarity.titleLexical >= 0.62 && similarity.time >= 0.35) return true;
  if (hasEntityAnchor && similarity.titleLexical >= 0.42 && similarity.time >= 0.35 && (samePrimaryCategory || sharedSpecificCategory)) return true;
  if (
    hasEntityAnchor
    && similarity.numberOverlap >= 0.85
    && similarity.time >= 0.35
    && (samePrimaryCategory || sharedSpecificCategory)
  ) return true;
  if (similarity.score >= 0.8 && (samePrimaryCategory || hasEntityAnchor)) return true;
  return false;
}

function buildCanonicalLabel(docs = []) {
  const sorted = [...docs].sort((left, right) => {
    const leftSources = Array.isArray(left.topic?.sourceSignals) ? left.topic.sourceSignals.length : Number(left.topic?.posts ?? 1);
    const rightSources = Array.isArray(right.topic?.sourceSignals) ? right.topic.sourceSignals.length : Number(right.topic?.posts ?? 1);
    return rightSources - leftSources || right.timestamp - left.timestamp;
  });
  return sorted[0]?.title ?? "今日の話題";
}

export function clusterTopicDocuments(items, { now = new Date() } = {}) {
  const docs = items.map((item) => buildTopicDocument(item));
  const unionFind = new UnionFind(docs.length);
  const blockingIndex = new Map();

  docs.forEach((doc, index) => {
    const keys = buildBlockingKeys(doc);
    for (const key of keys) {
      const bucket = blockingIndex.get(key) ?? [];
      for (const candidateIndex of bucket) {
        const similarity = computeSimilarity(doc, docs[candidateIndex]);
        if (shouldMerge(doc, docs[candidateIndex], similarity)) {
          unionFind.union(index, candidateIndex);
        }
      }
      bucket.push(index);
      blockingIndex.set(key, bucket);
    }
  });

  const grouped = new Map();
  docs.forEach((doc, index) => {
    const root = unionFind.find(index);
    const list = grouped.get(root) ?? [];
    list.push(doc);
    grouped.set(root, list);
  });

  return [...grouped.values()].map((clusterDocs, index) => {
    const topics = clusterDocs.map((doc) => doc.topic);
    const sourceSignals = topics.flatMap((topic) => Array.isArray(topic?.sourceSignals) ? topic.sourceSignals : []);
    const publishedTimestamps = clusterDocs.map((doc) => doc.timestamp).filter(Boolean).sort((left, right) => left - right);
    const latestTimestamp = publishedTimestamps[publishedTimestamps.length - 1] ?? 0;
    const firstTimestamp = publishedTimestamps[0] ?? 0;
    const uniqueSources = new Set(sourceSignals.map((signal) => signal?.sourceName ?? signal?.source).filter(Boolean));
    const uniqueDomains = new Set(sourceSignals.map((signal) => {
      try {
        return new URL(signal?.url ?? signal?.canonicalUrl ?? "").hostname;
      } catch {
        return "";
      }
    }).filter(Boolean));
    const uniqueGroups = new Set(sourceSignals.map((signal) => signal?.sourceGroup).filter(Boolean));
    const officialSourceCount = sourceSignals.filter((signal) => signal?.official).length;
    const clusterCategories = [...new Set(topics.flatMap((topic) => Array.isArray(topic?.categories) ? topic.categories : [topic?.category]).filter(Boolean))];
    const category = clusterCategories[0] ?? "general";

    return {
      clusterId: `today-cluster-${index + 1}`,
      canonicalEventLabel: buildCanonicalLabel(clusterDocs),
      category,
      categories: clusterCategories,
      docs: clusterDocs,
      topics,
      sourceSignals,
      articleCount: Math.max(topics.length, sourceSignals.length || topics.length),
      sourceCount: uniqueSources.size,
      uniqueDomainCount: uniqueDomains.size,
      sourceGroupCount: uniqueGroups.size,
      officialSourceCount,
      firstPublishedAt: firstTimestamp ? new Date(firstTimestamp).toISOString() : null,
      latestPublishedAt: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
      ageHours: latestTimestamp ? Math.max(0, (new Date(now).getTime() - latestTimestamp) / (1000 * 60 * 60)) : 999,
      timeSpanHours: firstTimestamp && latestTimestamp ? Math.max(0, (latestTimestamp - firstTimestamp) / (1000 * 60 * 60)) : 0,
      representativeTopic: topics
        .slice()
        .sort((left, right) => Number(right?.hotScore ?? 0) - Number(left?.hotScore ?? 0) || Number(right?.posts ?? 1) - Number(left?.posts ?? 1))[0] ?? null,
    };
  });
}
