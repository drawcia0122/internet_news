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
  'トピック',
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
  'exchange',
  'exchanged',
  'exchanges',
  'hold',
  'held',
  'holds',
  'launch',
  'launched',
  'launches',
  'raise',
  'raised',
  'raises',
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
  'unveil',
  'unveiled',
  'unveils',
]);

const EVENT_CLAUSE_BOUNDARIES = new Set([
  'after',
  'amid',
  'and',
  'as',
  'at',
  'before',
  'but',
  'during',
  'for',
  'from',
  'in',
  'into',
  'on',
  'onto',
  'or',
  'over',
  'that',
  'to',
  'under',
  'via',
  'when',
  'where',
  'which',
  'while',
  'who',
  'with',
]);

const CANDIDATE_SOURCE_PRIORITY = Object.freeze({
  relatedKeyword: 0,
  'source title': 1,
  'search link': 2,
  title: 3,
  fallback: 4,
});

const DESCRIPTION_SOURCE_PRIORITY = Object.freeze({
  whatHappened: 100,
  briefSummary: 95,
  whyHot: 90,
  importantPoint: 85,
  summary: 80,
  hotReason: 75,
  'source summary': 70,
  'source title': 70,
  title: 65,
  scoreSummary: 0,
});

const OFFER_TERMS_PATTERN = /(?:%|％|[$€£¥]|円|ドル|dollars?|usd|eur|ユーロ|ポイント|off|割引|還元|半額|無料|セール|sale|価格|掲載)/iu;

const ENGLISH_ANCHOR_STOP_WORDS = new Set([
  'after',
  'again',
  'against',
  'alleged',
  'amid',
  'and',
  'announces',
  'are',
  'around',
  'before',
  'being',
  'between',
  'could',
  'during',
  'from',
  'have',
  'into',
  'launches',
  'more',
  'names',
  'over',
  'says',
  'that',
  'their',
  'there',
  'this',
  'under',
  'with',
  'would',
]);

const ENGLISH_SMALL_NUMBERS = Object.freeze({
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
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

function normalizedEnglishWord(value) {
  return value.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/gu, '');
}

function sourceEnglishWords(value) {
  return nonEmptyString(value)?.match(/[a-z0-9]+(?:['’][a-z]+|-[a-z0-9]+)*/giu) || [];
}

function sourceTextFrom(value) {
  if (typeof value === 'string') return nonEmptyString(value) || '';
  return nonEmptyString(value?.title) || '';
}

function candidateRelation(value, sourceText) {
  const candidate = normalizeTitle(value);
  const source = normalizeTitle(sourceText);
  if (!candidate || !source) return 'detached';
  if (candidate === source) return 'exact';
  if (source.startsWith(candidate)) return 'prefix';
  if (source.includes(candidate)) return 'contained';
  return 'detached';
}

function isOfferOnlyLabel(value) {
  const normalized = nonEmptyString(value)?.normalize('NFKC').toLowerCase();
  if (!normalized || !OFFER_TERMS_PATTERN.test(normalized)) return false;

  const remainder = normalized
    .replace(/[$€£¥]?\s*\d+(?:[.,]\d+)?(?:k|m|bn)?\s*(?:%|％|円|ドル|dollars?|usd|eur|ユーロ|ポイント|サイト)?/giu, '')
    .replace(/(?:期間限定|数量限定|限定|最大|今だけ|一律|税込|税抜|価格|特価|販売|掲載|対象|キャンペーン)/gu, '')
    .replace(/(?:ポイント)?(?:還元|付与)|(?:セール|sale)|(?:割引|値引き)|(?:半額|無料)|off/giu, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');

  return !remainder;
}

function isPotentialEnglishEventVerb(word, index, words) {
  const normalized = normalizedEnglishWord(word);
  if (ENGLISH_SENTENCE_VERBS.has(normalized)) return true;

  return index > 0
    && index < words.length - 1
    && word === word.toLowerCase()
    && /^[a-z]{3,}(?:ed|s)$/u.test(normalized)
    && !normalized.endsWith('ss');
}

function hasKnownEnglishEventVerb(words) {
  return words
    .map(normalizedEnglishWord)
    .some((word) => ENGLISH_SENTENCE_VERBS.has(word));
}

function hasPotentialEnglishEventVerb(words) {
  return words.some(isPotentialEnglishEventVerb);
}

function endsAtPotentialEventVerb(value, source) {
  const candidateWords = englishWords(value);
  const titleWords = sourceEnglishWords(sourceTextFrom(source));
  if (!candidateWords.length || candidateWords.length >= titleWords.length) return false;

  const matchesTitlePrefix = candidateWords.every(
    (word, index) => normalizedEnglishWord(word) === normalizedEnglishWord(titleWords[index]),
  );
  if (!matchesTitlePrefix) return false;

  const lastIndex = candidateWords.length - 1;
  return isPotentialEnglishEventVerb(titleWords[lastIndex], lastIndex, titleWords);
}

function isCompleteEnglishEventPhrase(value, source) {
  const candidateWords = englishWords(value);
  const titleWords = sourceEnglishWords(sourceTextFrom(source));
  if (!candidateWords.length || !titleWords.length || !hasKnownEnglishEventVerb(candidateWords)) {
    return false;
  }
  if (candidateWords.length > titleWords.length) return false;

  const matchesTitlePrefix = candidateWords.every(
    (word, index) => normalizedEnglishWord(word) === normalizedEnglishWord(titleWords[index]),
  );
  if (!matchesTitlePrefix) return false;

  if (candidateWords.length >= titleWords.length) return true;

  const lastWord = normalizedEnglishWord(candidateWords.at(-1));
  const nextWord = normalizedEnglishWord(titleWords[candidateWords.length]);
  return !ENGLISH_SENTENCE_VERBS.has(lastWord) && EVENT_CLAUSE_BOUNDARIES.has(nextWord);
}

function isSafeEnglishSourceBoundary(value, source) {
  const candidateWords = englishWords(value);
  const sourceWords = sourceEnglishWords(sourceTextFrom(source));
  if (!candidateWords.length || !sourceWords.length) return true;
  if (candidateWords.length > sourceWords.length) return false;

  const normalizedCandidate = candidateWords.map(normalizedEnglishWord);
  const normalizedSource = sourceWords.map(normalizedEnglishWord);
  const start = normalizedSource.findIndex((word, index) => (
    word === normalizedCandidate[0]
    && normalizedCandidate.every((candidateWord, offset) => (
      normalizedSource[index + offset] === candidateWord
    ))
  ));
  if (start < 0) return false;

  const end = start + candidateWords.length;
  if (start !== 0) return false;
  if (end === sourceWords.length) {
    return !isTruncatedSourceText(sourceTextFrom(source));
  }

  const nextWord = normalizedSource[end];
  return hasKnownEnglishEventVerb(candidateWords)
    && !ENGLISH_SENTENCE_VERBS.has(normalizedCandidate.at(-1))
    && EVENT_CLAUSE_BOUNDARIES.has(nextWord);
}

function isIncompleteEnglishLabel(value, source) {
  if (/[-–—/:,(\[{\s]$/u.test(value)) return true;
  if (/^[‘“"']/u.test(value) && !/[’”"']$/u.test(value)) return true;

  const words = englishWords(value);
  if (!words.length) return false;

  const normalizedWords = words.map(normalizedEnglishWord);
  const firstWord = normalizedWords[0];
  const lastWord = normalizedWords.at(-1);
  if (INCOMPLETE_ENGLISH_OPENINGS.has(firstWord)) return true;
  if (INCOMPLETE_ENGLISH_ENDINGS.has(lastWord)) return true;
  if (words.length > 8 || stringLength(value) > 60) return true;
  if (endsAtPotentialEventVerb(value, source)) return true;
  if (hasKnownEnglishEventVerb(words) && !isCompleteEnglishEventPhrase(value, source)) return true;
  if (!isSafeEnglishSourceBoundary(value, source)) return true;
  return false;
}

function isJapaneseSentenceFragment(value) {
  return /(?:が|を|に|で|へ|と|は).*(?:する|した|なる|なった|挑む|期す|決定|開始|発売|配信)/u.test(value)
    || /(?:について|など|ほか|から|まで|にて)$/u.test(value);
}

function validTrendingLabel(value, item, sourceText = item.title) {
  const label = nonEmptyString(value);
  if (!label) return null;
  const length = stringLength(label);
  if (length < 2 || length > 60) return null;
  if (validHttpUrl(label) || /^(?:https?:\/\/|www\.)/iu.test(label)) return null;
  if (isMarkupFragment(label) || isSearchUtilityLabel(label)) return null;
  if (isCategoryLikeLabel(label, item)) return null;
  if (isOfferOnlyLabel(label)) return null;
  if (isIncompleteEnglishLabel(label, sourceText)) return null;
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
  if (stringLength(title) <= 60) candidates.push({ value: title, kind: 'cleaned title' });

  for (const match of title.matchAll(/[「『“"]([^」』”"]{2,60})[」』”"]/gu)) {
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

function candidateQualityScore(label, item, kind, sourceText) {
  const length = stringLength(label);
  const words = englishWords(label);
  const titleLength = stringLength(cleanupTitle(item.title) || '');
  let score = length <= 24 ? 40 : 12;

  if (words.length) {
    score += 10;
    if (words.length >= 2 && words.length <= 4) score += 10;
    if (words.length >= 5 && words.length <= 8) score += 8;
    if (isCompleteEnglishEventPhrase(label, sourceText)) score += 50;
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

function addLabelCandidate(target, value, source, item, kind = source, provenance = {}) {
  const sourceText = nonEmptyString(provenance.sourceText) || nonEmptyString(item.title) || '';
  const label = validTrendingLabel(value, item, sourceText);
  const signalIndex = Number.isInteger(provenance.signalIndex) ? provenance.signalIndex : null;
  if (!label || target.some((candidate) => (
    normalizeTitle(candidate.value) === normalizeTitle(label)
    && candidate.source === source
    && candidate.signalIndex === signalIndex
    && normalizeTitle(candidate.sourceText) === normalizeTitle(sourceText)
  ))) return;
  target.push({
    value: label,
    source,
    kind,
    sourceText,
    signalIndex,
    contextType: provenance.contextType || 'item',
    relation: candidateRelation(label, sourceText),
    quality: candidateQualityScore(label, item, kind, sourceText),
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
    for (let index = start; index < keywords.length && words.length < 8; index += 1) {
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
    addLabelCandidate(candidates, keyword, 'relatedKeyword', item, 'single keyword', {
      sourceText: item.title,
      contextType: 'item',
    });
  }
  for (const phrase of relatedKeywordPhrases(relatedKeywords, item)) {
    addLabelCandidate(candidates, phrase, 'relatedKeyword', item, 'related keyword phrase', {
      sourceText: item.title,
      contextType: 'item',
    });
  }
  for (const [signalIndex, signal] of (Array.isArray(item.sourceSignals) ? item.sourceSignals : []).entries()) {
    if (!isObject(signal)) continue;
    for (const titleCandidate of titleLabelCandidates(signal.title)) {
      addLabelCandidate(
        candidates,
        titleCandidate.value,
        'source title',
        item,
        titleCandidate.kind,
        {
          sourceText: signal.title,
          signalIndex,
          contextType: 'signal',
        },
      );
    }
  }
  for (const searchLink of Array.isArray(item.searchLinks) ? item.searchLinks : []) {
    if (isObject(searchLink)) {
      addLabelCandidate(candidates, searchLink.label, 'search link', item, 'search link', {
        sourceText: item.title,
        contextType: 'item',
      });
    }
  }
  for (const titleCandidate of titleLabelCandidates(item.title)) {
    addLabelCandidate(candidates, titleCandidate.value, 'title', item, titleCandidate.kind, {
      sourceText: item.title,
      contextType: 'item',
    });
  }
  addLabelCandidate(candidates, item.title, 'title', item, 'raw title', {
    sourceText: item.title,
    contextType: 'item',
  });
  addLabelCandidate(candidates, item.categoryLabel, 'fallback', item, 'fallback', {
    sourceText: item.title,
    contextType: 'item',
  });
  addLabelCandidate(candidates, item.category, 'fallback', item, 'fallback', {
    sourceText: item.title,
    contextType: 'item',
  });
  addLabelCandidate(candidates, '注目トピック', 'fallback', item, 'fallback', {
    sourceText: item.title,
    contextType: 'item',
  });

  return candidates.sort((left, right) => (
    right.quality - left.quality
    || left.sourcePriority - right.sourcePriority
    || left.order - right.order
  ));
}

function isGenericMetricDescription(value) {
  const parts = value
    .split(/\s*(?:\/|・|,|，)\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return false;

  return parts.every((part) => (
    /^\d+サイト掲載$/u.test(part)
    || /^SNS(?:急上昇|で話題)$/iu.test(part)
    || /^(?:注目度|スコア)\s*\d+(?:\.\d+)?$/u.test(part)
    || /^(?:外部|内部)シグナル\s*\d+件$/u.test(part)
    || /^(?:速報性あり|検索関心高め)$/u.test(part)
  ));
}

function isGenericTrendingDescription(value) {
  const description = nonEmptyString(value);
  if (!description) return false;

  return [
    /^(?:SNS(?:やネット上)?|ネット上)(?:で|では)?(?:の)?(?:反応|関心|注目|話題).*(?:広が|集ま|高ま|示|なって|され|やす)/u,
    /^(?:一般ユーザー|多くのユーザー)(?:の|が|には|から).*(?:反応|関心|注目|話題).*(?:集ま|高ま|示|広が|され|やす)/u,
    /^(?:一般ユーザー|多くのユーザー).*(?:関心|注目|話題).*(?:しています|されています|です)[。.!]?$/u,
    /^(?:専門媒体|公式ソース)(?:や(?:専門媒体|公式ソース))?(?:が|で|には).*(?:優先的に)?(?:拾|取り上げ|注目)/u,
    /^(?:SNS|ネット上).*(?:話題|注目|関心).*(?:です|ます)[。.!]?$/iu,
    /(?:判断|理解|把握|考える|掴む).*(?:材料|ため)|(?:材料|うえで).*(?:重要|優先度)/u,
    /^(?:生活|社会|社会動向|今後|評判).*(?:判断材料|理解材料|把握材料|話題|テーマ|材料).*(?:です|ます)[。.!]?$/u,
    /^(?:重要度|優先度).*(?:高い|あります).*(?:話題|テーマ|ニュース)(?:です)?[。.!]?$/u,
    /^(?:購入|予約|抽選|プレイ予定|終了前|開催期間|会場|検索需要|トレンド化|主要ニュースソース|公式発表|複数ソース|直近).*(?:判断|確認|影響|直結|兆し|浮上|話題|情報).*(?:です|ます)[。.!]?$/u,
    /^View our blog at .*schema\.org.*release history/iu,
  ].some((pattern) => pattern.test(description));
}

function isTruncatedSourceText(value) {
  return /(?:…|\.\.\.)$/u.test(value)
    || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][A-Z]$/u.test(value);
}

function isCategoryOnlyDescription(value, item) {
  const normalized = normalizeTitle(value);
  if (!normalized) return true;
  return [
    ...itemCategoryTerms(item),
    ...GENERIC_LABEL_TERMS.map(normalizeTitle),
  ].includes(normalized);
}

function validTrendingDescription(value, item, label) {
  const description = nonEmptyString(value);
  if (!description) return null;
  if (validHttpUrl(description) || /^(?:https?:\/\/|www\.)/iu.test(description)) return null;
  if (isMarkupFragment(description) || isTruncatedSourceText(description)) return null;
  if (normalizeTitle(description) === normalizeTitle(label)) return null;
  if (isCategoryOnlyDescription(description, item)) return null;

  const words = englishWords(description);
  if (words.length > 0 && words.length <= 2 && words.every((word) => (
    GENERIC_LABEL_TERMS.includes(word.toLowerCase())
  ))) return null;
  return description;
}

function descriptionQualityScore(value) {
  const words = englishWords(value);
  let score = 0;
  if (words.length && hasPotentialEnglishEventVerb(words)) score += 2;
  if (stringLength(value) >= 20) score += 5;
  return score;
}

function addDescriptionCandidate(target, value, source, item, label, provenance = {}) {
  const description = validTrendingDescription(value, item, label);
  if (!description || target.some(
    (candidate) => normalizeTitle(candidate.value) === normalizeTitle(description),
  )) return;
  const isGenericMetric = isGenericMetricDescription(description);
  const isGenericDescription = isGenericTrendingDescription(description);
  if (isGenericMetric || isGenericDescription) return;

  const sourceText = nonEmptyString(provenance.sourceText) || nonEmptyString(item.title) || '';
  target.push({
    value: description,
    source,
    sourceText,
    signalIndex: Number.isInteger(provenance.signalIndex) ? provenance.signalIndex : null,
    contextType: provenance.contextType || 'item',
    relation: candidateRelation(description, sourceText),
    priority: DESCRIPTION_SOURCE_PRIORITY[source] ?? 0,
    quality: descriptionQualityScore(description),
    order: target.length,
  });
}

function trendingDescriptionCandidates(item, label) {
  const candidates = [];
  const itemContext = { sourceText: item.title, contextType: 'item' };
  addDescriptionCandidate(candidates, item.whatHappened, 'whatHappened', item, label, itemContext);
  addDescriptionCandidate(candidates, item.briefSummary, 'briefSummary', item, label, itemContext);
  addDescriptionCandidate(candidates, item.whyHot, 'whyHot', item, label, itemContext);
  addDescriptionCandidate(candidates, item.importantPoint, 'importantPoint', item, label, itemContext);
  addDescriptionCandidate(candidates, item.summary, 'summary', item, label, itemContext);
  for (const reason of Array.isArray(item.hotReasons) ? item.hotReasons : []) {
    addDescriptionCandidate(candidates, reason, 'hotReason', item, label, itemContext);
  }
  for (const [signalIndex, signal] of (Array.isArray(item.sourceSignals) ? item.sourceSignals : []).entries()) {
    if (!isObject(signal)) continue;
    const signalContext = {
      sourceText: signal.title,
      signalIndex,
      contextType: 'signal',
    };
    addDescriptionCandidate(candidates, signal.briefSummary, 'source summary', item, label, signalContext);
    addDescriptionCandidate(candidates, signal.summary, 'source summary', item, label, signalContext);
    addDescriptionCandidate(candidates, signal.title, 'source title', item, label, signalContext);
  }
  addDescriptionCandidate(candidates, item.title, 'title', item, label, itemContext);
  addDescriptionCandidate(candidates, item.scoreSummary, 'scoreSummary', item, label, itemContext);

  return candidates.sort((left, right) => (
    right.priority - left.priority
    || right.quality - left.quality
    || left.order - right.order
  ));
}

function numericTokens(value) {
  const normalized = nonEmptyString(value)?.normalize('NFKC').toLowerCase() || '';
  const tokens = new Set(
    [...normalized.matchAll(/\d+(?:[.,]\d+)?/gu)]
      .map((match) => match[0].replaceAll(',', '')),
  );
  for (const [word, number] of Object.entries(ENGLISH_SMALL_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`, 'u').test(normalized)) tokens.add(number);
  }
  return [...tokens];
}

function quotedAnchors(value) {
  const anchors = [];
  for (const match of (nonEmptyString(value) || '').matchAll(/[「『“"]([^」』”"]{2,})[」』”"]/gu)) {
    anchors.push(normalizeTitle(match[1]));
  }
  return anchors.filter(Boolean);
}

function asciiAnchors(value) {
  return sourceEnglishWords(value)
    .map(normalizedEnglishWord)
    .filter((word) => word.length >= 3 && !ENGLISH_ANCHOR_STOP_WORDS.has(word));
}

function japaneseAnchors(value) {
  return (nonEmptyString(value)?.match(/[\p{Script=Han}\p{Script=Katakana}ー]{2,}/gu) || [])
    .map(normalizeTitle)
    .filter((anchor) => anchor.length >= 2);
}

function sharedAnchorDetails(label, description) {
  const labelNormalized = normalizeTitle(label);
  const descriptionNormalized = normalizeTitle(description);
  const anchors = new Set();

  if (
    labelNormalized.length >= 3
    && (descriptionNormalized.includes(labelNormalized) || labelNormalized.includes(descriptionNormalized))
  ) {
    anchors.add(labelNormalized);
  }

  const descriptionAscii = new Set(asciiAnchors(description));
  for (const anchor of asciiAnchors(label)) {
    if (descriptionAscii.has(anchor)) anchors.add(anchor);
  }

  const descriptionJapanese = new Set(japaneseAnchors(description));
  for (const anchor of japaneseAnchors(label)) {
    if (
      descriptionJapanese.has(anchor)
      || [...descriptionJapanese].some((value) => value.includes(anchor) || anchor.includes(value))
    ) {
      anchors.add(anchor);
    }
  }

  const descriptionQuotes = new Set(quotedAnchors(description));
  for (const anchor of quotedAnchors(label)) {
    if (descriptionQuotes.has(anchor) || descriptionNormalized.includes(anchor)) anchors.add(anchor);
  }

  const descriptionNumbers = new Set(numericTokens(description));
  for (const number of numericTokens(label)) {
    if (descriptionNumbers.has(number)) anchors.add(`#${number}`);
  }

  return [...anchors];
}

function sameSourceContext(labelCandidate, descriptionCandidate) {
  if (
    labelCandidate.contextType === 'signal'
    && descriptionCandidate.contextType === 'signal'
  ) {
    return labelCandidate.signalIndex === descriptionCandidate.signalIndex;
  }
  if (
    labelCandidate.contextType === 'item'
    && descriptionCandidate.contextType === 'item'
  ) {
    return true;
  }
  return normalizeTitle(labelCandidate.sourceText)
    === normalizeTitle(descriptionCandidate.sourceText);
}

function hasNumericConflict(label, description) {
  const labelNumbers = numericTokens(label);
  const descriptionNumbers = numericTokens(description);
  if (!labelNumbers.length || !descriptionNumbers.length) return false;
  const descriptionSet = new Set(descriptionNumbers);
  return !labelNumbers.some((number) => descriptionSet.has(number));
}

function promotionIsConsistent(label, description) {
  if (!OFFER_TERMS_PATTERN.test(label)) return true;
  if (!OFFER_TERMS_PATTERN.test(description)) return false;

  const labelNumbers = numericTokens(label);
  if (!labelNumbers.length) return true;
  const descriptionNumbers = new Set(numericTokens(description));
  return labelNumbers.some((number) => descriptionNumbers.has(number));
}

function pairCoherence(labelCandidate, descriptionCandidate) {
  const sharedAnchors = sharedAnchorDetails(
    labelCandidate.value,
    descriptionCandidate.value,
  );
  const sameContext = sameSourceContext(labelCandidate, descriptionCandidate);
  const crossSignal = labelCandidate.contextType === 'signal'
    && descriptionCandidate.contextType === 'signal'
    && labelCandidate.signalIndex !== descriptionCandidate.signalIndex;
  const numericConsistency = !hasNumericConflict(
    labelCandidate.value,
    descriptionCandidate.value,
  );
  const promotionConsistency = promotionIsConsistent(
    labelCandidate.value,
    descriptionCandidate.value,
  );

  if (!numericConsistency || !promotionConsistency) return null;
  if (crossSignal && !sharedAnchors.length) return null;
  if (!sameContext && !sharedAnchors.length) return null;

  const level = sameContext && sharedAnchors.length
    ? labelCandidate.signalIndex !== null
      && labelCandidate.signalIndex === descriptionCandidate.signalIndex
      ? 4
      : 3
    : sharedAnchors.length
      ? 2
      : 1;

  return {
    level,
    sameSourceContext: sameContext,
    sharedAnchors,
    numericConsistency,
    promotionConsistency,
  };
}

function trendingPairCandidates(item) {
  const pairs = [];
  for (const labelCandidate of trendingLabelCandidates(item)) {
    for (const descriptionCandidate of trendingDescriptionCandidates(item, labelCandidate.value)) {
      const coherence = pairCoherence(labelCandidate, descriptionCandidate);
      if (!coherence) continue;

      pairs.push({
        ...labelCandidate,
        description: descriptionCandidate.value,
        descriptionSource: descriptionCandidate.source,
        descriptionSourceText: descriptionCandidate.sourceText,
        descriptionSignalIndex: descriptionCandidate.signalIndex,
        descriptionPriority: descriptionCandidate.priority,
        pairQuality: labelCandidate.quality + descriptionCandidate.quality,
        coherence,
      });
    }
  }
  return pairs.sort((left, right) => (
    right.coherence.level - left.coherence.level
    || right.descriptionPriority - left.descriptionPriority
    || right.pairQuality - left.pairQuality
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
  const labelCandidates = trendingPairCandidates(item);
  const labelCandidate = labelCandidates[0];
  if (!labelCandidate) return null;

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
    label: labelCandidate.value,
    description: labelCandidate.description,
    score: [item.hotScore, item.score].map(Number).find(Number.isFinite)
      ?? Math.max(1, 100 - meta.sourceIndex),
    category: firstString(item.categoryLabel, item.category, 'その他'),
    targetUrl: validHttpUrl(searchLink?.url),
    sourceUrl: validHttpUrl(signal?.url),
    generatedAt: meta.generatedAt,
    _source: meta.source,
    _isOlderThan48Hours: isOlderThan48Hours,
    _labelCandidates: labelCandidates,
    _labelSource: labelCandidate.source,
    _labelSourceText: labelCandidate.sourceText,
    _labelSignalIndex: labelCandidate.signalIndex,
    _labelKind: labelCandidate.kind,
    _labelRelation: labelCandidate.relation,
    _descriptionSource: labelCandidate.descriptionSource,
    _descriptionSourceText: labelCandidate.descriptionSourceText,
    _descriptionSignalIndex: labelCandidate.descriptionSignalIndex,
    _coherence: labelCandidate.coherence,
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
    description: labelCandidate.description,
    _labelSource: labelCandidate.source,
    _labelSourceText: labelCandidate.sourceText,
    _labelSignalIndex: labelCandidate.signalIndex,
    _labelKind: labelCandidate.kind,
    _labelRelation: labelCandidate.relation,
    _descriptionSource: labelCandidate.descriptionSource,
    _descriptionSourceText: labelCandidate.descriptionSourceText,
    _descriptionSignalIndex: labelCandidate.descriptionSignalIndex,
    _coherence: labelCandidate.coherence,
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
