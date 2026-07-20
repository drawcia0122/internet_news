const LIMITS = Object.freeze({
  keyPoints: 3,
  mustKnow: 4,
  trending: 8,
});

const KNOWN_CATEGORY_TERMS = Object.freeze([
  'ゲーム',
  'テック',
  'テクノロジー',
  'エンタメ',
  'スポーツ',
  '国内',
  '国際',
  '政治',
  '経済',
  '社会',
  'アニメ',
  '漫画',
  'マンガ',
  '映画',
  '音楽',
  'その他',
  'ネットカルチャー',
  'SNS',
  'ニュース',
  'games',
  'game',
  'tech',
  'technology',
  'entertainment',
  'sports',
  'domestic',
  'world',
  'international',
  'politics',
  'business',
  'economy',
  'society',
  'anime',
  'manga',
  'movie',
  'movies',
  'music',
  'general',
  'other',
  'crime',
  'net-culture',
  'sns',
]);

const GENERIC_LABEL_TERMS = Object.freeze([
  'ニュース',
  '話題',
  'トレンド',
  '急上昇',
  '最新',
  '注目',
  '速報',
  '情報',
  '今日',
  '本日',
  '明日',
  '明日まで',
  '今週',
  '期間限定',
  'news',
  'topic',
  'topics',
  'trend',
  'trending',
  'latest',
  'featured',
  'feature',
  'breaking',
  'hot',
]);

const INCOMPLETE_ENGLISH_ENDINGS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'onto',
  'to',
  'with',
  'after',
  'before',
  'during',
  'amid',
  'over',
  'under',
  'via',
  'further',
]);

const INCOMPLETE_ENGLISH_OPENINGS = new Set(
  [...INCOMPLETE_ENGLISH_ENDINGS].filter((word) => word !== 'the'),
);

const ENGLISH_SENTENCE_VERBS = new Set([
  'arrest',
  'arrested',
  'arrests',
  'compete',
  'competed',
  'competes',
  'launch',
  'launched',
  'launches',
  'promise',
  'promised',
  'promises',
  'seek',
  'seeks',
  'sought',
  'sink',
  'sinks',
  'sunk',
  'trade',
  'traded',
  'trades',
]);

const CANDIDATE_SOURCE_PRIORITY = Object.freeze({
  relatedKeyword: 0,
  'source title': 1,
  'search link': 2,
  title: 3,
  fallback: 4,
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

function stringLength(value) {
  return [...value].length;
}

function itemCategoryTerms(item) {
  return [
    item.category,
    item.categoryLabel,
    ...(Array.isArray(item.categories) ? item.categories : []),
    ...(Array.isArray(item.categoryLabels) ? item.categoryLabels : []),
    ...KNOWN_CATEGORY_TERMS,
  ]
    .map(normalizeTitle)
    .filter(Boolean);
}

function isCategoryLikeLabel(value, item) {
  const normalized = normalizeTitle(value);
  if (!normalized) return true;

  const removableTerms = [...new Set([
    ...itemCategoryTerms(item),
    ...GENERIC_LABEL_TERMS.map(normalizeTitle),
  ])].sort((left, right) => right.length - left.length);

  let remainder = normalized;
  for (const term of removableTerms) {
    remainder = remainder.replaceAll(term, '');
  }
  return !remainder;
}

function isMarkupFragment(value) {
  return /<\/?[a-z][^>]*>?/iu.test(value)
    || /^(?:src|width|height|class)\s*=/iu.test(value);
}

function isSearchUtilityLabel(value) {
  return /(?:ニュース|web|google|yahoo|bluesky|reddit|SNS|X).*(?:探す|検索|反応を見る)$/iu.test(value);
}

function englishWords(value) {
  if (!/^[a-z0-9][a-z0-9\s'’&.+–—-]*$/iu.test(value)) return [];
  return value.split(/\s+/u).filter(Boolean);
}

function isIncompleteEnglishLabel(value) {
  const words = englishWords(value);
  if (!words.length) return false;

  const normalizedWords = words.map(
    (word) => word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/gu, ''),
  );
  const firstWord = normalizedWords[0];
  const lastWord = normalizedWords.at(-1);
  if (INCOMPLETE_ENGLISH_OPENINGS.has(firstWord)) return true;
  if (INCOMPLETE_ENGLISH_ENDINGS.has(lastWord)) return true;
  if (/[-–—/:,(\[{\s]$/u.test(value)) return true;
  if (words.length >= 7) return true;
  if (stringLength(value) > 32 && words.length >= 3) return true;
  if (words.length >= 3 && normalizedWords.some((word) => ENGLISH_SENTENCE_VERBS.has(word))) {
    return true;
  }
  if (words.length === 2 && ENGLISH_SENTENCE_VERBS.has(normalizedWords[1])) {
    return true;
  }
  if (words.length === 1 && ENGLISH_SENTENCE_VERBS.has(normalizedWords[0])) return true;
  return false;
}

function isJapaneseSentenceFragment(value) {
  return /(?:が|を|に|で|へ|と|は).*(?:する|した|なる|なった|挑む|期す|決定|開始|発売|配信)/u.test(value)
    || /(?:について|など|ほか|から|まで|にて)$/u.test(value);
}

function validTrendingLabel(value, item) {
  const label = nonEmptyString(value);
  if (!label) return null;
  const length = stringLength(label);
  if (length < 2 || length > 40) return null;
  if (validHttpUrl(label) || /^(?:https?:\/\/|www\.)/iu.test(label)) return null;
  if (isMarkupFragment(label) || isSearchUtilityLabel(label)) return null;
  if (isCategoryLikeLabel(label, item)) return null;
  if (isIncompleteEnglishLabel(label)) return null;
  return label;
}

function cleanupTitle(value) {
  let title = nonEmptyString(value);
  if (!title) return null;

  title = title
    .replace(/\s+/gu, ' ')
    .replace(/\s+(?:-|–|—|\||｜)\s+[^-–—|｜]{2,30}$/u, '')
    .trim();

  const quotePairs = [
    ['「', '」'],
    ['『', '』'],
    ['“', '”'],
    ['"', '"'],
  ];
  for (const [start, end] of quotePairs) {
    if (title.startsWith(start) && title.endsWith(end)) {
      title = title.slice(start.length, -end.length).trim();
      break;
    }
  }
  return title || null;
}

function titleLabelCandidates(value) {
  const title = cleanupTitle(value);
  if (!title) return [];

  const candidates = [];
  if (stringLength(title) <= 40) candidates.push({ value: title, kind: 'cleaned title' });

  for (const match of title.matchAll(/[「『“"]([^」』”"]{2,40})[」』”"]/gu)) {
    candidates.push({ value: match[1].trim(), kind: 'quoted title phrase' });
  }

  const firstClause = title.split(/(?:[。！？!?]|──)/u)[0]?.trim();
  if (firstClause && firstClause !== title) {
    candidates.push({ value: firstClause, kind: 'title clause' });
  }

  return candidates.filter(
    (candidate, index) => candidates.findIndex(
      (current) => normalizeTitle(current.value) === normalizeTitle(candidate.value),
    ) === index,
  );
}

function candidateQualityScore(label, item, kind) {
  const length = stringLength(label);
  const words = englishWords(label);
  const titleLength = stringLength(cleanupTitle(item.title) || '');
  let score = length <= 24 ? 40 : 12;

  if (words.length) {
    score += 10;
    if (words.length >= 2 && words.length <= 4) score += 10;
    if (/[A-Z]/u.test(label)) score += 4;
    if (words.some((word) => /^(?:and|or|but)$/iu.test(word))) score -= 3;
    if (/^[A-Z0-9]+$/u.test(label) && /\d/u.test(label)) score -= 15;
    if (words.length === 1 && words[0].length <= 3 && !/^[A-Z0-9]+$/u.test(words[0])) score -= 20;
  }

  const hasJapanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(label);
  const hasAscii = /[a-z0-9]/iu.test(label);
  if (hasJapanese) score += 10;
  if (hasJapanese && hasAscii) score += 6;
  if (/\d/u.test(label)) score += 4;
  if (titleLength && length < titleLength) score += 5;
  if (/^(?:今日|本日|明日|今週|最新|注目)/u.test(label)) score -= 15;
  if (isJapaneseSentenceFragment(label)) score -= 25;
  if (kind === 'fallback') score -= 40;
  return score;
}

function addLabelCandidate(target, value, source, item, kind = source) {
  const label = validTrendingLabel(value, item);
  if (!label || target.some((candidate) => normalizeTitle(candidate.value) === normalizeTitle(label))) return;
  target.push({
    value: label,
    source,
    kind,
    quality: candidateQualityScore(label, item, kind),
    sourcePriority: CANDIDATE_SOURCE_PRIORITY[source] ?? Number.MAX_SAFE_INTEGER,
    order: target.length,
  });
}

function relatedKeywordPhrases(keywords, item) {
  const phrases = [];
  for (let start = 0; start < keywords.length; start += 1) {
    const first = nonEmptyString(keywords[start]);
    if (!first || isCategoryLikeLabel(first, item) || !/^[a-z0-9'’–—-]+$/iu.test(first)) continue;

    const words = [];
    for (let index = start; index < keywords.length && words.length < 4; index += 1) {
      const value = nonEmptyString(keywords[index]);
      if (!value || isCategoryLikeLabel(value, item) || !/^[a-z0-9'’–—-]+$/iu.test(value)) break;
      words.push(value);
      if (words.length >= 2) phrases.push(words.join(' '));
    }
  }
  return phrases;
}

function trendingLabelCandidates(item) {
  const candidates = [];
  const relatedKeywords = Array.isArray(item.relatedKeywords) ? item.relatedKeywords : [];

  for (const keyword of relatedKeywords) {
    addLabelCandidate(candidates, keyword, 'relatedKeyword', item);
  }
  for (const phrase of relatedKeywordPhrases(relatedKeywords, item)) {
    addLabelCandidate(candidates, phrase, 'relatedKeyword', item, 'related keyword phrase');
  }
  for (const signal of Array.isArray(item.sourceSignals) ? item.sourceSignals : []) {
    if (!isObject(signal)) continue;
    for (const titleCandidate of titleLabelCandidates(signal.title)) {
      addLabelCandidate(
        candidates,
        titleCandidate.value,
        'source title',
        item,
        titleCandidate.kind,
      );
    }
  }
  for (const searchLink of Array.isArray(item.searchLinks) ? item.searchLinks : []) {
    if (isObject(searchLink)) {
      addLabelCandidate(candidates, searchLink.label, 'search link', item);
    }
  }
  for (const titleCandidate of titleLabelCandidates(item.title)) {
    addLabelCandidate(candidates, titleCandidate.value, 'title', item, titleCandidate.kind);
  }
  addLabelCandidate(candidates, item.title, 'title', item, 'raw title');
  addLabelCandidate(candidates, item.categoryLabel, 'fallback', item, 'fallback');
  addLabelCandidate(candidates, item.category, 'fallback', item, 'fallback');
  addLabelCandidate(candidates, '注目トピック', 'fallback', item, 'fallback');

  return candidates.sort((left, right) => (
    right.quality - left.quality
    || left.sourcePriority - right.sourcePriority
    || left.order - right.order
  ));
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
  const labelCandidates = trendingLabelCandidates(item);
  const label = labelCandidates[0]?.value || null;
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
    _labelCandidates: labelCandidates,
    _labelSource: labelCandidates[0]?.source || 'fallback',
    _titleKey: normalizeTitle(item.title),
  };
}

function identityKeys(item) {
  return [
    nonEmptyString(item.id),
    validHttpUrl(item.sourceUrl),
    normalizeTitle(item.title),
    normalizeTitle(item.label),
    nonEmptyString(item._titleKey),
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

function resolveTrendingLabel(candidate, selected) {
  const usedLabels = new Set(selected.map((item) => normalizeTitle(item.label)).filter(Boolean));
  const labelCandidate = candidate._labelCandidates.find(
    (item) => !usedLabels.has(normalizeTitle(item.value)),
  );
  if (!labelCandidate) return null;

  return {
    ...candidate,
    label: labelCandidate.value,
    _labelSource: labelCandidate.source,
  };
}

function selectTrendingCandidates(candidates, limit, maxPerCategory) {
  const selected = [];
  const categoryCounts = new Map();

  const tryAppend = (candidate, enforceCategoryLimit) => {
    if (selected.length >= limit) return;
    const category = candidate.category || 'その他';
    const count = categoryCounts.get(category) || 0;
    if (enforceCategoryLimit && count >= maxPerCategory) return;

    const resolved = resolveTrendingLabel(candidate, selected);
    if (!resolved || isDuplicate(resolved, selected)) return;
    selected.push(resolved);
    categoryCounts.set(category, count + 1);
  };

  candidates.forEach((candidate) => tryAppend(candidate, true));
  if (selected.length < limit) {
    candidates.forEach((candidate) => tryAppend(candidate, false));
  }
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
  const trending = selectTrendingCandidates(freshnessOrdered, LIMITS.trending, 3);

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
