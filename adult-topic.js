const titleElement = document.querySelector('#adult-topic-title');
const summaryElement = document.querySelector('#adult-topic-summary');
const kickerElement = document.querySelector('#adult-topic-kicker');
const scoreElement = document.querySelector('#adult-topic-score');
const sourceElement = document.querySelector('#adult-topic-source');
const rankElement = document.querySelector('#adult-topic-rank');
const categoriesElement = document.querySelector('#adult-topic-categories');
const makerElement = document.querySelector('#adult-topic-maker');
const reasonsElement = document.querySelector('#adult-topic-reasons');
const linksElement = document.querySelector('#adult-topic-links');
const tagsElement = document.querySelector('#adult-topic-tags');
const relatedElement = document.querySelector('#adult-topic-related');
const heroElement = document.querySelector('.adult-topic-hero');
const thumbWrapElement = document.querySelector('#adult-topic-thumb-wrap');
const thumbElement = document.querySelector('#adult-topic-thumb');
const insightsElement = document.querySelector('#adult-topic-insights');

const topicId = new URLSearchParams(window.location.search).get('id');

init();

async function init() {
  if (!topicId) return renderMissing('トレンドIDが見つかりませんでした。');
  try {
    const currentPayload = await fetchAdultTrendPayload().catch(() => null);
    const archivePayload = await fetchAdultTrendArchivePayload().catch(() => null);
    const items = dedupeAdultReports([
      ...payloadItems(currentPayload),
      ...payloadItems(archivePayload),
      ...loadCachedAdultTrends(),
    ].map(normalizeAdultTrendItem));
    const topic = items.find((item) => String(item.routeId ?? item.id ?? '') === topicId || String(item.id ?? '') === topicId);
    if (!topic) return renderMissing('このアダルトトレンドは見つからないか、一覧から外れています。');
    renderTopic(topic);
  } catch {
    renderMissing('アダルトトレンドデータの読み込みに失敗しました。');
  }
}

async function fetchAdultTrendPayload() {
  return await fetchJsonWithCache({
    cacheKey: 'adult-topic-current',
    endpoints: ['./data/adult-trends.json'],
    ttlMs: 90 * 1000,
  });
}

async function fetchAdultTrendArchivePayload() {
  return await fetchJsonWithCache({
    cacheKey: 'adult-topic-archive',
    endpoints: ['./data/adult-trends-archive.json', './data/adult-trends.json'],
    ttlMs: 5 * 60 * 1000,
  });
}

function renderTopic(topic) {
  document.title = 'INTERNET NEWS | ' + topic.title;
  kickerElement.textContent = 'ADULT TREND DETAIL · ' + categoryDisplayLabel(topic);
  titleElement.textContent = topic.title;
  summaryElement.textContent = topic.summary || 'ランキング、セール、更新状況をもとに抽出したアダルトトレンド候補です。';
  scoreElement.textContent = `HOT ${topic.adultHotScore ?? 0}`;
  sourceElement.textContent = topic.sourceName ?? 'Source';
  rankElement.textContent = topic.rankLabel ?? '注目候補';
  categoriesElement.innerHTML = renderCategoryChips(topic);
  makerElement.textContent = topic.maker || topic.genre || '取得でき次第表示します。';
  reasonsElement.innerHTML = renderReasons(topic.trendReasons);
  linksElement.innerHTML = renderSourceLinks(topic);
  tagsElement.innerHTML = renderTags(topic.tags, topic);
  relatedElement.innerHTML = renderRelatedWorks(topic.relatedWorks);
  if (insightsElement) insightsElement.innerHTML = renderAdultTopicInsights(topic);

  if (heroElement && topic.thumbnailUrl) {
    heroElement.style.setProperty('--topic-thumb', 'url("' + topic.thumbnailUrl.replace(/"/g, '%22') + '")');
    heroElement.classList.add('topic-hero-has-thumb');
  }
  if (thumbWrapElement && thumbElement && topic.thumbnailUrl) {
    thumbElement.src = topic.thumbnailUrl;
    thumbWrapElement.hidden = false;
  }
}

function payloadItems(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
}

function renderMissing(message) {
  titleElement.textContent = 'トレンドを表示できません';
  summaryElement.textContent = message;
  scoreElement.textContent = '--';
  sourceElement.textContent = '--';
  rankElement.textContent = '--';
  categoriesElement.innerHTML = '';
  makerElement.textContent = '表示できません。';
  reasonsElement.innerHTML = '<div class="empty-tweets"><strong>データなし</strong><p>' + escapeHtml(message) + '</p></div>';
  linksElement.innerHTML = '';
  tagsElement.innerHTML = '';
  relatedElement.innerHTML = '';
  if (insightsElement) insightsElement.innerHTML = '';
  if (thumbWrapElement) thumbWrapElement.hidden = true;
}

function renderAdultTopicInsights(topic) {
  const reasons = Array.isArray(topic.trendReasons) && topic.trendReasons.length ? topic.trendReasons : ['ランキングやセール情報をもとに抽出'];
  const tags = Array.isArray(topic.tags) && topic.tags.length ? topic.tags.slice(0, 4).join(' / ') : categoryDisplayLabel(topic);
  const values = [
    ['何が起きた？', `${topic.sourceName ?? topic.source ?? 'ソース'}で「${topic.title}」がトレンド候補として検出されています。`],
    ['なぜ話題？', reasons.slice(0, 3).join('、')],
    ['何が重要？', buildAdultImportantPoint(topic)],
    ['今後どうなる？', buildAdultFuturePoint(topic)],
    ['誰が気にすべき？', tags],
  ];
  return values.map(([label, value]) => '<div class="topic-insight-card"><h3>' + escapeHtml(label) + '</h3><p>' + escapeHtml(value) + '</p></div>').join('');
}

function buildAdultImportantPoint(topic) {
  const text = `${topic.title ?? ''} ${(topic.tags ?? []).join(' ')} ${(topic.categoryLabels ?? []).join(' ')} ${(topic.trendReasons ?? []).join(' ')}`;
  if (/セール|割引|キャンペーン|クーポン|ポイント/.test(text)) return '割引条件や終了日時によって購入判断に直結します。';
  if (/音声|ASMR|声優/.test(text)) return '同人音声の売れ筋や人気シチュエーションを掴む材料になります。';
  if (/AI|生成/.test(text)) return 'AI作品の比率や売れ筋変化を見る材料になります。';
  if (/漫画|コミック/.test(text)) return '成人向け漫画の売れ筋や出版社・作家の動きを確認できます。';
  return '今日の売れ筋ジャンルや伸びている作品傾向を判断できます。';
}

function buildAdultFuturePoint(topic) {
  const text = `${topic.title ?? ''} ${(topic.tags ?? []).join(' ')} ${(topic.trendReasons ?? []).join(' ')}`;
  if (/セール|割引|キャンペーン|クーポン/.test(text)) return '終了日時、追加セール、対象作品の入れ替わり。';
  if (/ランキング/.test(text)) return '順位の継続、関連作品や同ジャンルの伸び。';
  return 'ランキング推移、レビュー数、同ジャンル作品の増加。';
}

function renderReasons(reasons = []) {
  const values = Array.isArray(reasons) && reasons.length ? reasons : ['ランキングやセール情報をもとに抽出'];
  return values.map((reason) => '<span>' + escapeHtml(reason) + '</span>').join('');
}

function renderSourceLinks(topic) {
  const links = [
    topic.sourceUrl ? { label: `${topic.sourceName ?? 'Source'}で見る`, url: topic.sourceUrl } : null,
  ].filter(Boolean);
  if (!links.length) {
    return '<div class="empty-tweets"><strong>ソースなし</strong><p>ソースリンクを取得できませんでした。</p></div>';
  }
  return links.map((link) => '<a href="' + escapeHtml(link.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(link.label) + ' ↗</a>').join('');
}

function renderTags(tags = [], topic) {
  const values = Array.isArray(tags) && tags.length ? tags : topic.categories?.map(adultCategoryLabelFor) ?? [];
  if (!values.length) return '<span class="topic-keyword-chip">タグ未取得</span>';
  return values.map((tag) => '<span class="topic-keyword-chip">' + escapeHtml(tag) + '</span>').join('');
}

function renderRelatedWorks(works = []) {
  if (!Array.isArray(works) || !works.length) {
    return '<div class="empty-tweets"><strong>関連作品は集計中です</strong><p>ランキング履歴が増えると、同一ジャンルや同一ソースの関連作品を表示できます。</p></div>';
  }
  return works.map((work) => '<a class="adult-related-card" href="' + escapeHtml(work.url ?? '#') + '" target="_blank" rel="noreferrer"><strong>' + escapeHtml(work.title ?? '関連作品') + '</strong><span>' + escapeHtml(work.sourceName ?? 'Source') + ' ↗</span></a>').join('');
}

function renderCategoryChips(topic) {
  const labels = Array.isArray(topic.categoryLabels) && topic.categoryLabels.length
    ? topic.categoryLabels
    : topic.categories?.map(adultCategoryLabelFor) ?? [];
  return labels.map((label) => '<span class="topic-keyword-chip">' + escapeHtml(label) + '</span>').join('');
}

function categoryDisplayLabel(topic) {
  const labels = Array.isArray(topic.categoryLabels) && topic.categoryLabels.length
    ? topic.categoryLabels
    : topic.categories?.map(adultCategoryLabelFor) ?? [];
  return labels.slice(0, 3).join(' / ') || 'アダルトトレンド';
}

function normalizeAdultTrendItem(item) {
  const categories = Array.isArray(item.categories) && item.categories.length ? item.categories : normalizeCategoryLabels(item.category);
  return {
    ...item,
    routeId: buildAdultRouteId(item),
    categories,
    categoryLabels: Array.isArray(item.categoryLabels) && item.categoryLabels.length
      ? item.categoryLabels
      : Array.isArray(item.category) && item.category.length ? item.category : categories.map(adultCategoryLabelFor),
    sourceName: item.sourceName ?? item.source ?? 'Source',
    thumbnailUrl: item.thumbnailUrl ?? item.thumbnail ?? null,
    adultHotScore: Number(item.adultHotScore ?? item.score ?? 0),
    trendReasons: Array.isArray(item.trendReasons) ? item.trendReasons : Array.isArray(item.hotReasons) ? item.hotReasons : [],
    tags: Array.isArray(item.tags) ? item.tags : [],
    relatedWorks: Array.isArray(item.relatedWorks) ? item.relatedWorks : [],
  };
}

function normalizeCategoryLabels(values) {
  const labels = Array.isArray(values) ? values : values ? [values] : [];
  const categories = labels.flatMap((label) => {
    if (label === 'AV') return ['av'];
    if (label === '同人') return ['doujin'];
    if (label === '同人音声' || label === '音声') return ['voice', 'doujin'];
    if (label === 'AI作品') return ['ai'];
    if (label === 'エロ漫画') return ['manga'];
    if (label === 'セール') return ['sale'];
    if (label === '業界ニュース' || label === '業界') return ['industry'];
    return [String(label || 'industry')];
  });
  return categories.length ? [...new Set(categories)] : ['industry'];
}

function adultCategoryLabelFor(category) {
  if (category === 'av') return 'AV';
  if (category === 'doujin') return '同人';
  if (category === 'voice') return '音声';
  if (category === 'ai') return 'AI作品';
  if (category === 'manga') return 'エロ漫画';
  if (category === 'sale') return 'セール';
  if (category === 'industry') return '業界';
  return 'その他';
}

function loadCachedAdultTrends() {
  try {
    const cached = JSON.parse(sessionStorage.getItem('internet-news-adult-trend-cache') ?? '[]');
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

function dedupeAdultReports(reports) {
  return [...new Map(reports.map((report) => [report.routeId ?? report.id, report])).values()];
}

function buildAdultRouteId(item) {
  const raw = [
    item?.sourceKey,
    item?.sourceName ?? item?.source,
    item?.sourceUrl,
    item?.title,
    item?.rank,
  ].filter(Boolean).join('::');
  return slugifyAdultRoutePart(raw || String(item?.id ?? 'adult-topic'));
}

function slugifyAdultRoutePart(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[【】「」『』"'“”]/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'adult-topic';
}

async function fetchJsonWithCache({ cacheKey, endpoints, ttlMs }) {
  const cached = readSessionPayload(cacheKey, ttlMs);
  if (cached?.state === 'fresh') return cached.payload;
  const stalePayload = cached?.state === 'stale' ? cached.payload : null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: 'default' });
      if (!response.ok) continue;
      const payload = await response.json();
      writeSessionPayload(cacheKey, payload);
      return payload;
    } catch {
      continue;
    }
  }

  if (stalePayload) return stalePayload;
  throw new Error('JSON unavailable');
}

function readSessionPayload(cacheKey, ttlMs) {
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.payload) return null;
    if (!parsed.savedAt) return { state: 'stale', payload: parsed.payload };
    const age = Date.now() - Number(parsed.savedAt);
    return { state: age <= ttlMs ? 'fresh' : 'stale', payload: parsed.payload };
  } catch {
    return null;
  }
}

function writeSessionPayload(cacheKey, payload) {
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {}
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}
