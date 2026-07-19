const LIMITS = Object.freeze({
  keyPoints: 3,
  mustKnow: 4,
  trending: 8,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstString(...values) {
  return values.map(nonEmptyString).find(Boolean) || null;
}

function firstArrayString(value) {
  return Array.isArray(value) ? value.map(nonEmptyString).find(Boolean) || null : null;
}

export function validHttpUrl(value) {
  const input = nonEmptyString(value);
  if (!input) return null;

  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeTitle(value) {
  const title = nonEmptyString(value);
  if (!title) return '';
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function sourceItems(result) {
  if (!result?.ok) return [];
  if (result.source === 'todayInternet') {
    return [result.data.selectedTopic, ...result.data.runnerUps].filter(isObject);
  }
  return Array.isArray(result.data.items) ? result.data.items.filter(isObject) : [];
}

function candidateMeta(result, item, index) {
  return {
    source: result.source,
    generatedAt: result.generatedAt,
    sourceIndex: index,
    raw: item,
  };
}

function getPrimarySource(item) {
  const signal = Array.isArray(item.sourceSignals) && isObject(item.sourceSignals[0])
    ? item.sourceSignals[0]
    : null;
  const article = Array.isArray(item.representativeArticles) && isObject(item.representativeArticles[0])
    ? item.representativeArticles[0]
    : null;
  const primaryLink = isObject(item.primaryLink) ? item.primaryLink : null;
  return { signal, article, primaryLink };
}

function mapMustKnowCandidate(item, meta) {
  const { signal, article, primaryLink } = getPrimarySource(item);
  const title = nonEmptyString(item.title);
  const whatHappened = firstString(item.whatHappened, item.briefSummary, item.summary);
  const whyItMatters = firstString(
    item.importantPoint,
    item.whyHot,
    firstArrayString(item.hotReasons),
    item.summary,
  );

  if (!title || !whatHappened || !whyItMatters) return null;

  const rank = Number.isFinite(Number(item.rank)) ? Number(item.rank) : meta.sourceIndex + 1;
  const importance = [item.rank, item.buzzScore, item.hotScore, item.score]
    .map(Number)
    .find(Number.isFinite) ?? Math.max(1, 100 - meta.sourceIndex);

  return {
    id: firstString(item.id, `${meta.source}-${meta.sourceIndex}`),
    title,
    whatHappened,
    whyItMatters,
    nextStep: firstString(
      item.futureOutlook,
      firstArrayString(item.whyRanked),
      firstArrayString(item.watchpoints),
      item.watchpoints,
    ),
    sourceUrl: validHttpUrl(signal?.url)
      || validHttpUrl(article?.url)
      || validHttpUrl(item.sourceUrl)
      || validHttpUrl(primaryLink?.url),
    sourceName: firstString(signal?.sourceName, article?.sourceName, item.sourceName, primaryLink?.label),
    thumbnail: validHttpUrl(item.thumbnailUrl)
      || validHttpUrl(signal?.thumbnailUrl)
      || validHttpUrl(article?.thumbnailUrl),
    category: firstString(item.categoryLabel, item.category, 'その他'),
    publishedAt: firstString(item.publishedAt, signal?.publishedAt, article?.publishedAt),
    generatedAt: meta.generatedAt,
    importance,
    rank,
    _source: meta.source,
  };
}

function mapKeyPointCandidate(item, meta) {
  const { signal, primaryLink } = getPrimarySource(item);
  const title = nonEmptyString(item.title);
  const summary = firstString(
    item.thirtySecondSummary,
    item.briefSummary,
    item.whatHappened,
    item.summary,
  );
  if (!title || !summary) return null;

  const importance = [item.rank, item.buzzScore, item.hotScore, item.score]
    .map(Number)
    .find(Number.isFinite) ?? Math.max(1, 100 - meta.sourceIndex);

  return {
    id: firstString(item.id, `${meta.source}-${meta.sourceIndex}`),
    title,
    summary,
    category: firstString(item.categoryLabel, item.category, 'その他'),
    sourceUrl: validHttpUrl(primaryLink?.url)
      || validHttpUrl(item.sourceUrl)
      || validHttpUrl(signal?.url),
    sourceName: firstString(primaryLink?.label, item.sourceName, signal?.sourceName),
    publishedAt: firstString(item.publishedAt, item.capturedAt),
    generatedAt: meta.generatedAt,
    importance,
    _source: meta.source,
  };
}

function mapTrendingCandidate(item, meta, now) {
  const keyword = Array.isArray(item.relatedKeywords) ? nonEmptyString(item.relatedKeywords[0]) : null;
  const validKeyword = keyword
    && keyword.length >= 2
    && keyword.length <= 30
    && !validHttpUrl(keyword)
    ? keyword
    : null;
  const label = firstString(validKeyword, item.title, item.categoryLabel);
  const description = firstString(
    item.scoreSummary,
    firstArrayString(item.hotReasons),
    item.whyHot,
    item.summary,
  );
  if (!label || !description) return null;

  const signal = Array.isArray(item.sourceSignals) && isObject(item.sourceSignals[0])
    ? item.sourceSignals[0]
    : null;
  const searchLink = Array.isArray(item.searchLinks) && isObject(item.searchLinks[0])
    ? item.searchLinks[0]
    : null;
  const itemDate = firstString(item.capturedAt, item.publishedAt);
  const itemTime = itemDate ? Date.parse(itemDate) : Number.NaN;
  const isOlderThan48Hours = Number.isFinite(itemTime) && now.getTime() - itemTime > 48 * 60 * 60 * 1000;

  return {
    id: firstString(item.id, `${meta.source}-${meta.sourceIndex}`),
    label,
    description,
    score: [item.hotScore, item.score].map(Number).find(Number.isFinite)
      ?? Math.max(1, 100 - meta.sourceIndex),
    category: firstString(item.categoryLabel, item.category, 'その他'),
    targetUrl: validHttpUrl(searchLink?.url),
    sourceUrl: validHttpUrl(signal?.url),
    generatedAt: meta.generatedAt,
    _source: meta.source,
    _isOlderThan48Hours: isOlderThan48Hours,
  };
}

function identityKeys(item) {
  return [
    nonEmptyString(item.id),
    validHttpUrl(item.sourceUrl),
    normalizeTitle(item.title || item.label),
  ].filter(Boolean);
}

function isDuplicate(item, selected) {
  const keys = new Set(identityKeys(item));
  return selected.some((current) => identityKeys(current).some((key) => keys.has(key)));
}

function appendUnique(target, candidates, limit, excluded = []) {
  for (const candidate of candidates) {
    if (target.length >= limit) break;
    if (isDuplicate(candidate, target) || isDuplicate(candidate, excluded)) continue;
    target.push(candidate);
  }
}

function selectDiverse(candidates, limit, maxPerCategory) {
  const selected = [];
  const categoryCounts = new Map();

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const category = candidate.category || 'その他';
    const count = categoryCounts.get(category) || 0;
    if (count >= maxPerCategory || isDuplicate(candidate, selected)) continue;
    selected.push(candidate);
    categoryCounts.set(category, count + 1);
  }

  appendUnique(selected, candidates, limit);
  return selected;
}

function mappedCandidates(result, mapper, ...args) {
  return sourceItems(result)
    .map((item, index) => mapper(item, candidateMeta(result, item, index), ...args))
    .filter(Boolean);
}

function oldestGeneratedAt(items) {
  const validTimes = items
    .map((item) => Date.parse(item.generatedAt))
    .filter(Number.isFinite);
  if (!validTimes.length) return null;
  return new Date(Math.min(...validTimes)).toISOString();
}

function sectionState(items, attemptedResults, now) {
  const generatedAt = oldestGeneratedAt(items);
  const generatedTime = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const stale = Number.isFinite(generatedTime)
    && now.getTime() - generatedTime >= 24 * 60 * 60 * 1000;
  const attempted = attemptedResults.filter(Boolean);

  return {
    state: items.length ? 'ready' : attempted.length && attempted.every((result) => !result.ok) ? 'error' : 'empty',
    generatedAt,
    stale,
  };
}

function publicItem(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => !key.startsWith('_')),
  );
}

export function buildHomeViewModel(results, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();

  const primaryMustKnow = results.todayInternet?.ok
    ? mappedCandidates(results.todayInternet, mapMustKnowCandidate)
    : [];
  const mustKnow = [];
  const mustSources = [
    results.todayInternet,
    results.homeTopics,
    results.homeNews,
    results.dailyBrief,
  ];
  for (const result of mustSources) {
    if (!result?.ok) continue;
    appendUnique(
      mustKnow,
      mappedCandidates(result, mapMustKnowCandidate),
      LIMITS.mustKnow,
    );
  }

  const keyPointCandidates = [];
  const keySources = [results.dailyBrief, results.todayInternet, results.homeTopics];
  for (const result of keySources) {
    if (!result?.ok) continue;
    keyPointCandidates.push(...mappedCandidates(result, mapKeyPointCandidate));
  }
  const keyPoints = [];
  const availableKeyPoints = keyPointCandidates.filter((item) => !isDuplicate(item, mustKnow));
  appendUnique(
    keyPoints,
    selectDiverse(availableKeyPoints, LIMITS.keyPoints, 1),
    LIMITS.keyPoints,
    mustKnow,
  );

  const trendingCandidates = [];
  const trendingSources = [results.trendTopics, results.todayInternet, results.homeTopics];
  for (const result of trendingSources) {
    if (!result?.ok) continue;
    trendingCandidates.push(...mappedCandidates(result, mapTrendingCandidate, now));
  }
  const freshnessOrdered = [
    ...trendingCandidates.filter((item) => !item._isOlderThan48Hours),
    ...trendingCandidates.filter((item) => item._isOlderThan48Hours),
  ];
  const trending = selectDiverse(freshnessOrdered, LIMITS.trending, 3);

  return {
    keyPoints: {
      items: keyPoints.map(publicItem),
      ...sectionState(keyPoints, keySources, now),
    },
    mustKnow: {
      items: mustKnow.map(publicItem),
      ...sectionState(mustKnow, mustSources, now),
    },
    trending: {
      items: trending.map(publicItem),
      ...sectionState(trending, trendingSources, now),
    },
    needsFallback: {
      critical: primaryMustKnow.length < LIMITS.mustKnow || keyPoints.length < LIMITS.keyPoints,
      trending: trending.length < LIMITS.trending,
    },
  };
}

export { LIMITS };
