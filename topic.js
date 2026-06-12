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
  signalsElement.innerHTML = renderSignalList(topic.sourceSignals);
  linksElement.innerHTML = renderSearchLinks(topic.searchLinks);
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

function renderSignalList(signals = []) {
  const dedupedSignals = dedupeRenderSignals(signals);
  if (!dedupedSignals.length) {
    return '<div class="empty-tweets"><strong>記事ページはまだありません</strong><p>この話題に直接つながる記事ページが見つかり次第、ここに表示します。</p></div>';
  }
  return dedupedSignals.map((signal) => {
    const summary = summarizeSignalForCard(signal);
    const summaryHtml = summary ? '<p class="signal-card-summary">' + escapeHtml(summary) + '</p>' : '';
    return '<a class="signal-card" href="' + escapeHtml(signal.url ?? '#') + '" target="_blank" rel="noreferrer"><strong>' + escapeHtml(signal.sourceName ?? signal.source ?? 'Source') + '</strong><span>' + escapeHtml(signal.title ?? '記事ページを見る') + '</span>' + summaryHtml + '<small>' + escapeHtml(signal.publishedLabel ?? '時刻不明') + ' ・ 記事ページを開く ↗</small></a>';
  }).join('');
}

function renderSearchLinks(links = []) {
  if (!links.length) {
    return '<div class="empty-tweets"><strong>追跡リンクなし</strong><p>この話題の外部検索リンクはまだありません。</p></div>';
  }
  return links.map((link) => '<a href="' + escapeHtml(link.url ?? '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(link.label ?? '外部リンク') + ' ↗</a>').join('');
}

function renderSocialLinks(topic) {
  const links = Array.isArray(topic.socialLinks) && topic.socialLinks.length ? topic.socialLinks : buildDefaultSocialLinks(topic.title);
  return links.map((link) => '<a href="' + escapeHtml(link.url ?? '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(link.label ?? 'SNSで探す') + ' ↗</a>').join('');
}

function renderKeywordList(keywords = [], topic) {
  const values = Array.isArray(keywords) && keywords.length ? keywords : buildFallbackKeywords(topic);
  if (!values.length) {
    return '<div class="empty-tweets"><strong>関連キーワードなし</strong><p>キーワードを抽出できませんでした。</p></div>';
  }
  return values.map((keyword) => '<span class="topic-keyword-chip">' + escapeHtml(keyword) + '</span>').join('');
}

function renderCategoryChips(topic) {
  const labels = Array.isArray(topic.categoryLabels) && topic.categoryLabels.length
    ? topic.categoryLabels
    : normalizeCategories(topic.categories, topic.category).map(categoryLabelFor);
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

function shortEventFromTitle(title = '') {
  const value = String(title ?? '').replace(/^【[^】]+】\s*/u, '').trim();
  if (!value) return '新しい動きが出ています。';
  return value.replace(/[。！？!?].*$/u, '').slice(0, 44);
}

function buildWhyHotLabel(topic) {
  const reasons = Array.isArray(topic.hotReasons) ? topic.hotReasons : [];
  if (reasons.length) return reasons[0];
  if (Number(topic.posts ?? 1) >= 2) return '複数媒体で同じ話題が扱われています。';
  return '直近のニュースとして確認されています。';
}

function buildImportantPoint(topic) {
  const text = topicText(topic);
  if (/セール|割引|キャンペーン|クーポン/.test(text)) return '終了前に条件を確認すると損を避けやすい情報です。';
  if (/ポケモン|pokemon|任天堂|switch|steam|ゲーム/.test(text)) return '購入、予約、プレイ予定の判断に関係します。';
  if (/ai|chatgpt|openai|claude|gemini|生成ai/.test(text)) return '仕事や制作環境の選択に影響する可能性があります。';
  if (/炎上|sns|xで話題|バズ|拡散/.test(text)) return 'ネット上の空気や評判の変化を掴めます。';
  if (/逮捕|事件|事故|判決|政治|選挙|物価|株価/.test(text)) return '生活や社会の判断材料として優先度が高い話題です。';
  return '後で追うべきかを判断する材料になります。';
}

function buildFutureOutlook(topic) {
  const text = topicText(topic);
  if (/セール|キャンペーン|クーポン/.test(text)) return '対象範囲、終了日時、追加キャンペーンの有無。';
  if (/予約|抽選|発売|配信|公開/.test(text)) return '次回受付、在庫、配信日、公式発表の更新。';
  if (/ai|chatgpt|openai|claude|gemini/.test(text)) return '利用条件、料金、競合サービスの追随。';
  if (/逮捕|事件|事故|裁判/.test(text)) return '捜査や発表、関係者コメントの続報。';
  return '追加発表、関連記事、SNS上の反応の広がり。';
}

function buildTargetAudience(topic) {
  const text = topicText(topic);
  const values = [];
  if (/ポケモン|pokemon|ポケカ/.test(text)) values.push('ポケモンユーザー');
  if (/ゲーム|任天堂|switch|steam|ps5/.test(text)) values.push('ゲームユーザー');
  if (/ai|chatgpt|openai|claude|gemini/.test(text)) values.push('AI利用者');
  if (/iphone|android|ガジェット|スマホ|nvidia|gpu/.test(text)) values.push('ガジェット好き');
  if (/セール|割引|キャンペーン|クーポン|fanza|dlsite/.test(text)) values.push('セール好き');
  if (/漫画|マンガ|アニメ|声優/.test(text)) values.push('漫画・アニメ好き');
  if (/sns|炎上|バズ|ミーム|ネット文化/.test(text)) values.push('ネット文化を追う人');
  if (/株|投資|決算|金利|物価/.test(text)) values.push('投資家');
  return [...new Set(values)].slice(0, 4);
}

function dedupeRenderSignals(signals = []) {
  const deduped = [];
  for (const signal of Array.isArray(signals) ? signals : []) {
    const duplicateIndex = deduped.findIndex((current) => isNearDuplicateSignal(current, signal));
    if (duplicateIndex === -1) {
      deduped.push(signal);
      continue;
    }
    if (renderSignalTimestamp(signal) > renderSignalTimestamp(deduped[duplicateIndex])) {
      deduped[duplicateIndex] = signal;
    }
  }
  return deduped.sort((left, right) => renderSignalTimestamp(right) - renderSignalTimestamp(left));
}

function renderSignalKey(signal) {
  const source = String(signal?.sourceName ?? signal?.source ?? '').toLowerCase().trim();
  const normalizedUrl = canonicalSignalUrl(signal?.url);
  const title = normalizeSignalText(signal?.title);
  return `${source}::${normalizedUrl || title || String(signal?.url ?? '').toLowerCase().trim()}`;
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

function isNearDuplicateSignal(current, next) {
  if (!current || !next) return false;

  const currentSource = String(current?.sourceName ?? current?.source ?? '').toLowerCase().trim();
  const nextSource = String(next?.sourceName ?? next?.source ?? '').toLowerCase().trim();
  if (!currentSource || !nextSource || currentSource !== nextSource) return false;

  if (renderSignalKey(current) === renderSignalKey(next)) return true;

  const currentTitle = normalizeSignalText(current?.title ?? '');
  const nextTitle = normalizeSignalText(next?.title ?? '');
  if (!currentTitle || !nextTitle) return false;

  const sameTitle = currentTitle === nextTitle || currentTitle.includes(nextTitle) || nextTitle.includes(currentTitle);
  if (sameTitle) {
    const currentAt = signalPublishedAt(current);
    const nextAt = signalPublishedAt(next);
    if (currentAt == null || nextAt == null) return true;
    return Math.abs(currentAt - nextAt) <= 36 * 60 * 60 * 1000;
  }

  const currentTokens = currentTitle.split(/\s+/).filter((token) => token.length >= 2);
  const nextTokens = nextTitle.split(/\s+/).filter((token) => token.length >= 2);
  if (currentTokens.length < 3 || nextTokens.length < 3) return false;

  const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
  const overlapRatio = overlap / Math.min(currentTokens.length, nextTokens.length);
  if (overlap < 3 || overlapRatio < 0.82) return false;

  const currentAt = signalPublishedAt(current);
  const nextAt = signalPublishedAt(next);
  if (currentAt == null || nextAt == null) return false;
  return Math.abs(currentAt - nextAt) <= 36 * 60 * 60 * 1000;
}

function signalPublishedAt(signal) {
  const time = new Date(signal?.publishedAt ?? signal?.capturedAt ?? 0).getTime();
  return Number.isNaN(time) ? null : time;
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
  const categories = normalizeCategories(topic.categories, topic.category);
  const normalizedCategories = categories.map(normalizeLegacyCategory);
  const category = normalizedCategories[0] ?? 'general';
  const labelSource = topic.categoryLabels;
  return {
    ...topic,
    category,
    categories: [...new Set(normalizedCategories)],
    categoryLabel: normalizeLegacyCategoryLabel(topic.categoryLabel, category),
    categoryLabels: Array.isArray(labelSource) && labelSource.length ? labelSource.filter((label) => label !== 'ネタ') : [categoryLabelFor(category)],
    metricLabel: topic.metricLabel ?? 'posts',
    thumbnailUrl: topic.thumbnailUrl ?? null,
    hotScore: Number(topic.hotScore ?? topic.score ?? 0),
    hotReasons: Array.isArray(topic.hotReasons) ? topic.hotReasons : [],
    relatedKeywords: Array.isArray(topic.relatedKeywords) ? topic.relatedKeywords : [],
    socialLinks: Array.isArray(topic.socialLinks) ? topic.socialLinks : [],
    searchLinks: Array.isArray(topic.searchLinks) ? topic.searchLinks : [],
    sourceSignals: Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [],
  };
}

function normalizeLegacyCategory(category) {
  return category === 'fun' ? 'general' : category;
}

function normalizeLegacyCategoryLabel(value, fallbackCategory) {
  if (value === 'ネタ') return categoryLabelFor(fallbackCategory ?? 'general');
  return value ?? categoryLabelFor(fallbackCategory ?? 'general');
}

function categoryLabelFor(category) {
  if (category === 'general') return 'その他';
  if (category === 'tech') return 'テック';
  if (category === 'business') return '経済';
  if (category === 'politics') return '政治';
  if (category === 'entertainment') return 'エンタメ';
  if (category === 'games') return 'ゲーム';
  if (category === 'manga') return '漫画';
  if (category === 'books') return '本';
  if (category === 'sports') return 'スポーツ';
  if (category === 'sns') return 'SNS';
  if (category === 'net-culture') return 'ネットカルチャー';
  if (category === 'matome') return '2chまとめ系';
  if (category === 'crime') return '犯罪・事件';
  if (category === 'adult') return 'アダルト系';
  if (category === 'world') return '国際';
  return '総合';
}

function loadCachedTopics() {
  try { return JSON.parse(localStorage.getItem('internet-news-browse-topic-cache') ?? '[]'); } catch { return []; }
}

function mergeReports(...reportGroups) {
  const reports = reportGroups.flat();
  return [...new Map(reports.map((report) => [report.id, report])).values()];
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}

function normalizeCategories(categories, fallbackCategory) {
  const values = Array.isArray(categories) ? categories : [];
  const merged = [...new Set([fallbackCategory, ...values].filter(Boolean))];
  return merged.length ? merged : ['general'];
}

function categoryDisplayLabel(topic) {
  const labels = Array.isArray(topic.categoryLabels) && topic.categoryLabels.length
    ? topic.categoryLabels
    : normalizeCategories(topic.categories, topic.category).map(categoryLabelFor);
  return labels.slice(0, 3).join(' / ');
}

function buildNewsSummary(topic) {
  const summaries = collectSignalSummaries(topic);
  const primary = summarizeExtractedText(topic.summary, 88);
  const candidates = [primary, ...summaries.map((summary) => squeezeSummary(summary))]
    .filter(Boolean)
    .filter((summary, index, values) => values.indexOf(summary) === index);

  if (!candidates.length) return '関連ニュースの要約はまだ十分に集まっていません。';
  if (candidates.length === 1) return candidates[0];

  const first = candidates[0];
  const second = candidates.find((candidate) => !isTooSimilarSummary(candidate, first));
  if (!second) return first;
  return joinSummaryParts(first, second);
}

function buildSignalSummary(topic) {
  const count = Number(topic.posts ?? topic.sourceSignals?.length ?? 1);
  const sourceNames = [...new Set((topic.sourceSignals ?? []).map((signal) => signal.sourceName ?? signal.source).filter(Boolean))];
  const parts = [`${count}件の掲載ソースを確認`];
  if (topic.scoreSummary) parts.push(topic.scoreSummary);
  if (sourceNames.length) parts.push(`主なソース: ${sourceNames.slice(0, 3).join(' / ')}`);
  return parts.join('。') + '。';
}

function buildImpact(topic) {
  const labels = categoryDisplayLabel(topic);
  const title = String(topic.title ?? '');
  if (/地震|大雨|台風|避難|災害/.test(title)) {
    return '交通、物流、避難行動などに直結しやすく、地域住民の判断や生活動線に影響する可能性があります。';
  }
  if ((topic.categories ?? []).includes('sns') || /SNS|掲示板/.test(labels)) {
    return 'SNSや掲示板での拡散が続くと、認知の広がりや評判形成の速度がさらに上がる可能性があります。';
  }
  if ((topic.categories ?? []).includes('crime')) {
    return '捜査の進展や関係者の説明次第で受け止め方が変わりやすく、安全意識や再発防止の議論につながる可能性があります。';
  }
  if ((topic.categories ?? []).includes('business') || (topic.categories ?? []).includes('politics')) {
    return '制度変更、価格動向、企業判断などを通じて、家計や仕事、経済判断に波及する可能性があります。';
  }
  if ((topic.categories ?? []).includes('sports')) {
    return '試合結果や当事者のコメント次第で受け止め方が変わりやすく、ファンや周辺報道の関心が続く可能性があります。';
  }
  if ((topic.categories ?? []).includes('games') || (topic.categories ?? []).includes('tech')) {
    return '製品動向や追加発表しだいで、購入判断やサービス利用の関心に影響する可能性があります。';
  }
  return `${labels}の文脈で関連話題が派生しやすく、関心の広がり方や次の報道内容に影響する可能性があります。`;
}

function collectSignalSummaries(topic) {
  return (topic.sourceSignals ?? [])
    .map((signal) => summarizeSignalForCard(signal, 92))
    .filter(Boolean)
    .filter((summary, index, values) => values.indexOf(summary) === index)
    .slice(0, 3);
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

function squeezeSummary(value) {
  return summarizeExtractedText(value, 118);
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

function isTooSimilarSummary(left, right) {
  const leftKey = summaryFingerprint(left);
  const rightKey = summaryFingerprint(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  return leftKey.includes(rightKey) || rightKey.includes(leftKey);
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

function joinSummaryParts(first, second) {
  const base = String(first ?? '').trim();
  const next = String(second ?? '').trim();
  if (!base) return next;
  if (!next) return base;
  return trimSummaryLength(`${base} ${next}`, 138);
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

function buildWhyTrending(topic) {
  const hotReasons = Array.isArray(topic.hotReasons) ? topic.hotReasons.filter(Boolean) : [];
  if (hotReasons.length) {
    return hotReasons.slice(0, 3).join(' ');
  }
  const count = Number(topic.posts ?? topic.sourceSignals?.length ?? 1);
  const sourceNames = [...new Set((topic.sourceSignals ?? []).map((signal) => signal.sourceName ?? signal.source).filter(Boolean))];
  const parts = [];
  parts.push(`${count}件の関連記事を確認しています。`);
  if (sourceNames.length >= 2) {
    parts.push(`${sourceNames.slice(0, 3).join('、')}など複数ソースで扱われています。`);
  }
  if (topic.scoreSummary) {
    parts.push(`急上昇判定では「${topic.scoreSummary}」を強いシグナルとして見ています。`);
  }
  return parts.join(' ');
}

function buildDefaultSocialLinks(title) {
  const query = encodeURIComponent(title ?? '話題');
  return [
    { label: 'Xで反応を見る', url: `https://x.com/search?q=${query}&src=typed_query&f=live` },
    { label: 'Blueskyで探す', url: `https://bsky.app/search?q=${query}` },
    { label: 'Redditで探す', url: `https://www.reddit.com/search/?q=${query}` },
  ];
}

function buildFallbackKeywords(topic) {
  const values = new Set();
  normalizeCategories(topic.categories, topic.category).map(categoryLabelFor).forEach((label) => values.add(label));
  String(topic.title ?? '')
    .split(/[\s/・,、。!！?？:：]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 18)
    .slice(0, 6)
    .forEach((token) => values.add(token));
  return [...values].slice(0, 8);
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
