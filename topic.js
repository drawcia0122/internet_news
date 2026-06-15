const {
  buildImportantPoint,
  buildTargetAudience,
  buildWhyHotLabel,
  categoryDisplayLabel,
  categoryLabelFor,
  escapeHtml,
  mergeReports,
  normalizeTopic,
  shortEventFromTitle,
} = window.TopicClientUtils;

const titleElement = document.querySelector('#topic-title');
const summaryElement = document.querySelector('#topic-summary');
const kickerElement = document.querySelector('#topic-kicker');
const metricElement = document.querySelector('#topic-metric');
const timeElement = document.querySelector('#topic-time');
const categoriesElement = document.querySelector('#topic-categories');
const signalSummaryElement = document.querySelector('#topic-signal-summary');
const signalsElement = document.querySelector('#topic-signals');
const linksElement = document.querySelector('#topic-links');
const heroElement = document.querySelector('.topic-hero');
const insightsElement = document.querySelector('#topic-insights');

const topicId = new URLSearchParams(window.location.search).get('id');

init();

async function init() {
  if (!topicId) return renderMissing('話題IDが見つかりませんでした。');
  try {
    const cachedTopics = loadCachedTopics();
    const currentPayload = await fetchTrendPayload().catch(() => null);
    const currentTopics = mergeReports(
      cachedTopics.map(normalizeTrendTopic),
      Array.isArray(currentPayload?.items) ? currentPayload.items : [],
    );
    let topic = currentTopics.find((item) => String(item.id ?? '') === topicId);
    if (!topic) {
      const archivePayload = await fetchTrendArchivePayload().catch(() => null);
      const topics = mergeReports(
        Array.isArray(archivePayload?.items) ? archivePayload.items : [],
        currentTopics,
      ).map(normalizeTrendTopic);
      topic = topics.find((item) => String(item.id ?? '') === topicId);
    }
    if (!topic) return renderMissing('この話題は見つからないか、すでに一覧から外れています。');
    renderTopic(topic);
  } catch {
    renderMissing('話題データの読み込みに失敗しました。');
  }
}

async function fetchTrendPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'topic-current-v2',
    endpoints: ['./data/trend-topics.json'],
    ttlMs: 90 * 1000,
  });
}

async function fetchTrendArchivePayload() {
  return await fetchJsonWithCache({
    cacheKey: 'topic-archive-v2',
    endpoints: ['./data/trend-topics-archive.json', './data/trend-topics.json'],
    ttlMs: 5 * 60 * 1000,
  });
}

function renderTopic(topic) {
  document.title = 'INTERNET NEWS | ' + topic.title;
  kickerElement.textContent = 'TREND DETAIL · ' + categoryDisplayLabel(topic);
  titleElement.textContent = topic.title;
  summaryElement.textContent = buildTopicHeroSummary(topic);
  metricElement.textContent = String(topic.posts ?? 1) + ' ' + (topic.metricLabel ?? 'signals');
  timeElement.textContent = topic.time ?? '直近';
  categoriesElement.innerHTML = renderCategoryChips(topic);
  signalSummaryElement.textContent = buildSignalSummary(topic);
  if (heroElement && topic.thumbnailUrl) {
    heroElement.style.setProperty('--topic-thumb', 'url("' + topic.thumbnailUrl.replace(/"/g, '%22') + '")');
    heroElement.classList.add('topic-hero-has-thumb');
  }
  signalsElement.innerHTML = renderSignalList(topic.sourceSignals, topic);
  linksElement.innerHTML = renderSearchLinks(topic);
  if (insightsElement) insightsElement.innerHTML = renderTopicInsights(topic);
}

function renderMissing(message) {
  titleElement.textContent = '話題を表示できません';
  summaryElement.textContent = message;
  metricElement.textContent = '--';
  timeElement.textContent = '--';
  categoriesElement.innerHTML = '';
  signalSummaryElement.textContent = '掲載状況を表示できません。';
  signalsElement.innerHTML = '<div class="empty-tweets"><strong>データなし</strong><p>' + escapeHtml(message) + '</p></div>';
  linksElement.innerHTML = '';
  if (insightsElement) insightsElement.innerHTML = '';
}

function renderTopicInsights(topic) {
  const insights = buildTopicInsights(topic);
  return [
    ['何が起きた？', insights.whatHappened],
    ['なぜ話題？', insights.whyHot],
    ['何が重要？', insights.importantPoint],
    ['今後どうなる？', insights.futureOutlook],
    ['誰が気にすべき？', insights.targetAudience.join(' / ') || '関連分野を追っている人'],
  ].map(([label, value]) => '<div class="topic-insight-card"><h3>' + escapeHtml(label) + '</h3><p>' + escapeHtml(value) + '</p></div>').join('');
}

function buildTopicInsights(topic) {
  return {
    whatHappened: topic.whatHappened ?? shortEventFromTitle(topic.title),
    whyHot: topic.whyHot ?? buildWhyHotLabel(topic),
    importantPoint: topic.importantPoint ?? buildImportantPoint(topic),
    futureOutlook: topic.futureOutlook ?? buildFutureOutlook(topic),
    targetAudience: Array.isArray(topic.targetAudience) && topic.targetAudience.length ? topic.targetAudience : buildTargetAudience(topic),
  };
}

function renderSignalList(signals = [], topic = null) {
  const dedupedSignals = dedupeRenderSignals(signals, topic);
  if (!dedupedSignals.length) {
    return '<div class="empty-tweets"><strong>記事ページはまだありません</strong><p>この話題に直接つながる記事ページが見つかり次第、ここに表示します。</p></div>';
  }
  return dedupedSignals.map((signal) => {
    const sourceMeta = describeSignalSource(signal, topic);
    const sourceLine = [
      '<span class="signal-list-source">' + escapeHtml(sourceMeta.mediaName) + '</span>',
      sourceMeta.categoryLabel ? '<span class="signal-list-separator">/</span><span class="signal-list-category">' + escapeHtml(sourceMeta.categoryLabel) + '</span>' : '',
    ].join('');
    return '<a class="signal-list-item" href="' + escapeHtml(signal.url ?? '#') + '" target="_blank" rel="noreferrer"><div class="signal-list-meta">' + sourceLine + '</div><div class="signal-list-title">' + escapeHtml(signal.title ?? '記事ページを見る') + '</div></a>';
  }).join('');
}

function renderSearchLinks(topic) {
  const links = [
    ...buildPrimaryArticleLinks(topic),
    ...(Array.isArray(topic?.searchLinks) ? topic.searchLinks : []),
  ];
  if (!links.length) {
    return '<div class="empty-tweets"><strong>追跡リンクなし</strong><p>この話題の外部検索リンクはまだありません。</p></div>';
  }
  return links.map((link) => '<a href="' + escapeHtml(link.url ?? '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(link.label ?? '外部リンク') + ' ↗</a>').join('');
}

function buildPrimaryArticleLinks(topic) {
  const signals = dedupeRenderSignals(topic?.sourceSignals ?? [], topic).filter((signal) => signal?.url).slice(0, 3);
  return signals.map((signal) => ({
    label: `${signal.displayMediaName ?? signal.sourceName ?? signal.source ?? 'Source'}で元記事を見る`,
    url: signal.url,
  }));
}

function renderCategoryChips(topic) {
  const labels = Array.isArray(topic.categoryLabels) && topic.categoryLabels.length
    ? topic.categoryLabels
    : normalizeTrendTopic(topic).categoryLabels;
  return labels.map((label) => '<span class="topic-keyword-chip">' + escapeHtml(label) + '</span>').join('');
}

function topicText(topic) {
  return [
    topic.title,
    topic.summary,
    topic.categoryLabel,
    ...(topic.categoryLabels ?? []),
    ...(topic.hotReasons ?? []),
    ...(topic.relatedKeywords ?? []),
    ...(topic.sourceSignals ?? []).flatMap((signal) => [signal.title, signal.summary, signal.sourceName]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function buildFutureOutlook(topic) {
  const text = topicText(topic);
  if (/セール|キャンペーン|クーポン/.test(text)) return '対象範囲、終了日時、追加キャンペーンの有無。';
  if (/予約|抽選|発売|配信|公開/.test(text)) return '次回受付、在庫、配信日、公式発表の更新。';
  if (/ai|chatgpt|openai|claude|gemini/.test(text)) return '利用条件、料金、競合サービスの追随。';
  if (/逮捕|事件|事故|裁判/.test(text)) return '捜査や発表、関係者コメントの続報。';
  return '追加発表、関連記事、SNS上の反応の広がり。';
}

function dedupeRenderSignals(signals = [], topic = null) {
  const sortedSignals = [...(Array.isArray(signals) ? signals : [])]
    .map((signal) => enrichSignalForDisplay(signal, topic))
    .sort((left, right) => renderSignalQualityScore(right) - renderSignalQualityScore(left) || renderSignalTimestamp(right) - renderSignalTimestamp(left));
  const deduped = [];

  for (const signal of sortedSignals) {
    const duplicateIndex = deduped.findIndex((current) => signalDuplicateReason(current, signal));
    if (duplicateIndex === -1) {
      deduped.push(signal);
      continue;
    }
    deduped[duplicateIndex] = mergeDisplaySignal(deduped[duplicateIndex], signal, topic);
  }

  return deduped.sort((left, right) => renderSignalTimestamp(right) - renderSignalTimestamp(left));
}

function signalDuplicateReason(current, next) {
  if (!current || !next) return '';

  const currentUrl = canonicalSignalUrl(current?.url);
  const nextUrl = canonicalSignalUrl(next?.url);
  if (currentUrl && nextUrl && currentUrl === nextUrl) return 'url';

  const currentTitle = normalizeSignalText(current?.title ?? '');
  const nextTitle = normalizeSignalText(next?.title ?? '');
  if (!currentTitle || !nextTitle) return '';

  const sameTitle = currentTitle === nextTitle || currentTitle.includes(nextTitle) || nextTitle.includes(currentTitle);
  if (sameTitle && isSignalTimeClose(current, next, 72)) return 'title';

  const currentTokens = currentTitle.split(/\s+/).filter((token) => token.length >= 2);
  const nextTokens = nextTitle.split(/\s+/).filter((token) => token.length >= 2);
  if (currentTokens.length < 3 || nextTokens.length < 3) return '';

  const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
  const overlapRatio = overlap / Math.min(currentTokens.length, nextTokens.length);
  if (overlap >= 3 && overlapRatio >= 0.82 && isSignalTimeClose(current, next, 36)) return 'similarity';

  return '';
}

function canonicalSignalUrl(rawUrl) {
  const value = String(rawUrl ?? '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const params = new URLSearchParams(parsed.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'ref', 'src', 'from'].forEach((key) => params.delete(key));
    parsed.search = params.toString();
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function renderSignalTimestamp(signal) {
  const time = new Date(signal?.publishedAt ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isSignalTimeClose(current, next, hours = 36) {
  const currentAt = signalPublishedAt(current);
  const nextAt = signalPublishedAt(next);
  if (currentAt == null || nextAt == null) return true;
  return Math.abs(currentAt - nextAt) <= hours * 60 * 60 * 1000;
}

function signalPublishedAt(signal) {
  const time = new Date(signal?.publishedAt ?? signal?.capturedAt ?? 0).getTime();
  return Number.isNaN(time) ? null : time;
}

function enrichSignalForDisplay(signal, topic = null) {
  if (!signal || typeof signal !== 'object') return signal;
  const sourceMeta = describeSignalSource(signal, topic);
  return {
    ...signal,
    displayMediaName: sourceMeta.mediaName,
    displayCategoryLabel: sourceMeta.categoryLabel,
  };
}

function describeSignalSource(signal, topic = null) {
  const sourceName = String(signal?.sourceName ?? signal?.source ?? '').trim();
  const [rawMediaName, rawCategory] = sourceName.split(/\s*\/\s*/, 2);
  const mediaName = rawMediaName || sourceName || 'Source';
  const sourceCategory = rawCategory?.trim() || signal?.displayCategoryLabel || '';
  const fallbackCategory = signal?.categoryLabel || topic?.categoryLabel || categoryLabelFor(topic?.category ?? 'general');
  return {
    mediaName,
    categoryLabel: sourceCategory || fallbackCategory || '',
  };
}

function renderSignalQualityScore(signal) {
  let score = 0;
  if (!isAggregatorSignal(signal)) score += 20;
  if (signal?.displayCategoryLabel) score += 8;
  if (signal?.summary || signal?.briefSummary) score += 5;
  if (signal?.thumbnailUrl) score += 2;
  if (signal?.displayMediaName) score += 1;
  return score;
}

function isAggregatorSignal(signal) {
  const sourceValue = String(signal?.sourceName ?? signal?.source ?? '').toLowerCase();
  const urlValue = String(signal?.url ?? '').toLowerCase();
  return sourceValue.includes('google news') || urlValue.includes('news.google.com');
}

function mergeDisplaySignal(current, next, topic = null) {
  const preferred = renderSignalQualityScore(next) > renderSignalQualityScore(current)
    || (renderSignalQualityScore(next) === renderSignalQualityScore(current) && renderSignalTimestamp(next) > renderSignalTimestamp(current))
    ? next
    : current;
  const fallback = preferred === current ? next : current;
  const preferredMeta = describeSignalSource(preferred, topic);
  const fallbackMeta = describeSignalSource(fallback, topic);

  return {
    ...fallback,
    ...preferred,
    displayMediaName: preferredMeta.mediaName || fallbackMeta.mediaName,
    displayCategoryLabel: preferredMeta.categoryLabel || fallbackMeta.categoryLabel,
    summary: preferred.summary || fallback.summary || '',
    briefSummary: preferred.briefSummary || fallback.briefSummary || '',
    thumbnailUrl: preferred.thumbnailUrl || fallback.thumbnailUrl || null,
  };
}

function normalizeSignalText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/[【】「」『』]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTrendTopic(topic) {
  const normalizedTopic = normalizeTopic(topic);
  return {
    ...normalizedTopic,
    metricLabel: topic.metricLabel ?? 'posts',
    thumbnailUrl: normalizedTopic.thumbnailUrl ?? null,
    hotScore: Number(topic.hotScore ?? topic.score ?? 0),
    hotReasons: Array.isArray(topic.hotReasons) ? topic.hotReasons : [],
    relatedKeywords: Array.isArray(topic.relatedKeywords) ? topic.relatedKeywords : [],
    socialLinks: Array.isArray(topic.socialLinks) ? topic.socialLinks : [],
  };
}

function loadCachedTopics() {
  try { return JSON.parse(localStorage.getItem('internet-news-browse-topic-cache') ?? '[]'); } catch { return []; }
}


function buildSignalSummary(topic) {
  const dedupedSignals = dedupeRenderSignals(topic.sourceSignals, topic);
  const count = dedupedSignals.length || Number(topic.posts ?? topic.sourceSignals?.length ?? 1);
  const sourceNames = [...new Set(dedupedSignals.map((signal) => signal.displayMediaName ?? signal.sourceName ?? signal.source).filter(Boolean))];
  const parts = [`${count}件の掲載ソースを確認`];
  if (topic.scoreSummary) parts.push(topic.scoreSummary);
  if (sourceNames.length) parts.push(`主なソース: ${sourceNames.slice(0, 3).join(' / ')}`);
  return parts.join('。') + '。';
}


function normalizeSignalSummaryText(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^【[^】]+】/u, '')
    .replace(/^(NHK|BBC|CNN|ロイター|Reuters)[\s:：-]*/iu, '')
    .replace(/^[^、。]{0,12}(?:によると|では|は、)\s*/u, '')
    .replace(/現時点ではこの点が共通して伝えられています。?$/u, '')
    .replace(/共通しているのは、[^。]+です。?$/u, '')
    .replace(/ということで[^。]*$/u, '')
    .replace(/として[^。]*注目されている。?$/u, '')
    .replace(/…+$/u, '')
    .trim();
  if (!text || text.length < 18) return '';
  return ensureSentenceEnding(text);
}

function summarizeSignalForCard(signal, limit = 76) {
  return summarizeExtractedText(signal?.summary || signal?.briefSummary, limit);
}

function buildTopicHeroSummary(topic) {
  return summarizeExtractedText(topic.summary, 96) || 'この話題の要点を整理しています。';
}

function summarizeExtractedText(value, limit = 96) {
  const text = normalizeSignalSummaryText(value);
  if (!text) return '';
  const sentences = text
    .split(/(?<=[。.!！?？])/u)
    .map((part) => normalizeSignalSummaryText(part))
    .filter(Boolean);
  if (!sentences.length) return '';
  const compact = joinCompactSentences(sentences, limit);
  return trimSummaryLength(compact, limit);
}

function trimSummaryLength(value, limit = 118) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  const trimmed = text.slice(0, limit).replace(/[、。,.，\s]+$/u, '');
  return `${trimmed}…`;
}

function summaryFingerprint(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[【】「」『』]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinCompactSentences(sentences, limit) {
  const picked = [];
  for (const sentence of sentences) {
    const next = picked.length ? `${picked.join(' ')} ${sentence}` : sentence;
    if (next.length > limit) break;
    picked.push(sentence);
    if (picked.length >= 2) break;
  }
  return picked.join(' ') || sentences[0];
}

function ensureSentenceEnding(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /[。.!！?？]$/.test(text) ? text : `${text}。`;
}

async function fetchJsonWithCache({ cacheKey, endpoints, ttlMs }) {
  const cached = readSessionPayload(cacheKey, ttlMs);
  if (cached) return cached;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: 'default' });
      if (!response.ok) continue;
      const payload = await response.json();
      writeSessionPayload(cacheKey, payload);
      return payload;
    } catch {}
  }

  throw new Error('Trend payload unavailable');
}

function readSessionPayload(cacheKey, ttlMs) {
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - Number(parsed.savedAt) > ttlMs) return null;
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

function writeSessionPayload(cacheKey, payload) {
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {}
}
