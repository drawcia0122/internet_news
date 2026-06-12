const listElement = document.querySelector('#news-archive-list');
const countElement = document.querySelector('#news-count');
const updatedElement = document.querySelector('#news-updated');
const queryElement = document.querySelector('#news-query');
const searchButtonElement = document.querySelector('.news-search-button');
const paginationElement = document.querySelector('#trend-pagination');
const PAGE_SIZE = 24;
const RANGE_CONFIG = {
  '24h': { minHours: 0, maxHours: 24, label: '24時間以内', searchWindowDays: 1 },
  '24-3d': { minHours: 24, maxHours: 72, label: '24時間〜3日以内', searchWindowDays: 3 },
  '3-7d': { minHours: 72, maxHours: 168, label: '3日〜7日以内', searchWindowDays: 7 },
  '7-14d': { minHours: 168, maxHours: 336, label: '7日〜14日', searchWindowDays: 14 },
};

let trendItems = [];
let activeCategory = 'all';
let activeRange = '24h';
let currentPage = 1;

document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (!image.classList.contains('trend-thumb')) return;
  const wrapper = image.closest('.trend-thumb-wrap');
  if (wrapper) {
    const card = wrapper.closest('.trend-card');
    if (card) card.classList.add('trend-card-no-thumb');
    wrapper.remove();
  }
}, true);

init();

async function init() {
  try {
    const [archivePayload, currentPayload] = await Promise.all([
      fetchJson('./data/trend-topics-archive.json').catch(() => null),
      fetchJson('./data/trend-topics.json').catch(() => null),
    ]);
    trendItems = dedupeTopics(
      mergeReports(
        (currentPayload?.items ?? []).map(normalizeTopic),
        (archivePayload?.items ?? []).map(normalizeTopic),
      ),
    ).sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
    updatedElement.textContent = currentPayload?.generatedAt || archivePayload?.generatedAt
      ? formatDate(currentPayload?.generatedAt ?? archivePayload?.generatedAt) + ' 更新'
      : '更新時刻不明';
  } catch {
    trendItems = [];
    updatedElement.textContent = '読み込み失敗';
  }

  saveTopicCache(trendItems);
  renderTrendIndex();
}

function normalizeTopic(topic) {
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
    sourceSignals: Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [],
    searchLinks: Array.isArray(topic.searchLinks) ? topic.searchLinks : [],
    thumbnailUrl: pickCardImageUrl(topic),
  };
}

function normalizeLegacyCategory(category) {
  return category === 'fun' ? 'general' : category;
}

function normalizeLegacyCategoryLabel(value, fallbackCategory) {
  if (value === 'ネタ') return categoryLabelFor(fallbackCategory ?? 'general');
  return value ?? categoryLabelFor(fallbackCategory ?? 'general');
}

function renderTrendIndex() {
  const query = queryElement.value.trim().toLowerCase();
  const range = RANGE_CONFIG[activeRange] || RANGE_CONFIG['24h'];
  const filtered = trendItems
    .filter((item) => isWithinRange(item, range))
    .filter((item) => activeCategory === 'all' || hasCategory(item, activeCategory))
    .filter((item) => {
      if (!query) return true;
      return (String(item.title ?? '') + ' ' + String(item.summary ?? '')).toLowerCase().includes(query);
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  countElement.textContent = filtered.length + ' 件';
  updateSearchButton();

  if (!filtered.length) {
    listElement.innerHTML = '<div class="empty-tweets trend-empty"><strong>該当する話題はありません</strong><p>カテゴリやキーワードを変えてもう一度探してみてください。</p></div>';
    renderPagination(0, 0);
    return;
  }

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);
  listElement.innerHTML = pageItems.map((item) => renderTrendCard(item)).join('');
  renderPagination(totalPages, filtered.length);
}

function renderTrendCard(item) {
  const hasThumbnail = Boolean(item.thumbnailUrl);
  const thumbnail = hasThumbnail ? '<img class="trend-thumb" src="' + escapeHtml(item.thumbnailUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' : '';
  const summaryHtml = hasVisibleSummary(item.summary) ? '<p>' + escapeHtml(item.summary ?? '') + '</p>' : '';
  const insightHtml = renderInsightList(item);
  return '<article class="trend-card trend-card-rich' + (hasThumbnail ? ' has-thumb' : ' trend-card-no-thumb') + '">' +
    (thumbnail ? '<div class="trend-thumb-wrap">' + thumbnail + '</div>' : '') +
    '<div><div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(item)) + '</span><time>' + escapeHtml(item.time ?? formatDate(item.capturedAt)) + '</time></div>' +
    '<h3>' + escapeHtml(item.title ?? 'ニュース') + '</h3>' + summaryHtml +
    insightHtml +
    '<div class="trend-footer"><span><strong>' + escapeHtml(String(item.posts ?? 1)) + '</strong> ' + escapeHtml(item.metricLabel ?? 'source') + '</span>' +
    '<a class="detail-link" href="./topic.html?id=' + encodeURIComponent(item.id ?? '') + '">詳しく見る →</a></div></div></article>';
}

function renderInsightList(item) {
  const audience = buildTargetAudience(item).join(' / ') || '関連分野を追う人';
  return '<dl class="trend-reason-list">' +
    '<div><dt>何が起きた？</dt><dd>' + escapeHtml(item.whatHappened ?? shortEventFromTitle(item.title)) + '</dd></div>' +
    '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(item.whyHot ?? buildWhyHotLabel(item)) + '</dd></div>' +
    '<div><dt>なぜ重要？</dt><dd>' + escapeHtml(item.importantPoint ?? buildImportantPoint(item)) + '</dd></div>' +
    '<div><dt>誰向け？</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
  '</dl>';
}

function hasVisibleSummary(summary) {
  const text = String(summary ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return !/に関する話題。?$|が明らかになり、?話題になっている。?$|がきょうの注目話題として取り上げられている。?$|を伝える話題。?$/.test(text);
}

function pickCardImageUrl(item) {
  const candidates = [
    item?.thumbnailUrl,
    item?.thumbnail,
    item?.imageUrl,
    item?.image,
    item?.ogImage,
    item?.twitterImage,
    item?.sourceImage,
    ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals.flatMap((signal) => [
      signal?.thumbnailUrl,
      signal?.thumbnail,
      signal?.imageUrl,
      signal?.image,
      signal?.ogImage,
      signal?.twitterImage,
      signal?.sourceImage,
    ]) : []),
  ];
  for (const candidate of candidates) {
    const normalized = sanitizeCardImageUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function sanitizeCardImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (/(?:^|\/)(?:favicon(?:-\d+x\d+)?|apple-touch-icon|android-chrome-\d+x\d+|mstile-\d+x\d+)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)) return null;
  if (/\/favicon\.ico(?:$|[?#])/i.test(url)) return null;
  if (/(?:google|gstatic)\.[^/]+\/.*(?:favicon|logo|icon)/i.test(url)) return null;
  return url;
}

function updateSearchButton() {
  if (!searchButtonElement) return;
  const text = queryElement.value.trim();
  searchButtonElement.textContent = text
    ? '「' + text + '」でGoogleニュース検索 ↗'
    : (activeCategory === 'all' ? 'Googleニュースで広く探す ↗' : categoryLabelFor(activeCategory) + 'をGoogleニュースで探す ↗');
  searchButtonElement.href = buildGoogleNewsUrl(text || defaultSearchQueryForCategory(activeCategory));
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

function shortEventFromTitle(title = '') {
  const value = String(title ?? '').replace(/^【[^】]+】\s*/u, '').trim();
  if (!value) return '新しい動きが出ています。';
  return value.replace(/[。！？!?].*$/u, '').slice(0, 42);
}

function topicText(topic) {
  return [
    topic.title,
    topic.summary,
    ...(topic.categoryLabels ?? []),
    ...(topic.hotReasons ?? []),
    ...(topic.sourceSignals ?? []).flatMap((signal) => [signal.title, signal.summary, signal.sourceName]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function buildWhyHotLabel(topic) {
  const reasons = Array.isArray(topic.hotReasons) ? topic.hotReasons : [];
  if (reasons.length) return reasons[0];
  if (Number(topic.posts ?? 1) >= 2) return '複数媒体で同じ話題が扱われています。';
  return '直近の話題として確認されています。';
}

function buildImportantPoint(topic) {
  const text = topicText(topic);
  if (/セール|割引|キャンペーン|クーポン/.test(text)) return '終了前の条件確認や購入判断に直結します。';
  if (/ゲーム|任天堂|switch|steam|ps5/.test(text)) return '予約、抽選、購入、プレイ判断に関係します。';
  if (/ai|chatgpt|openai|claude|gemini|生成ai/.test(text)) return '仕事や制作環境の選択に影響する可能性があります。';
  if (/政治|経済|事件|事故|国際|株価|物価/.test(text)) return '生活や社会の判断材料として優先度が高い話題です。';
  return '関連分野の流れを短時間で掴む判断材料になります。';
}

function buildTargetAudience(topic) {
  const text = topicText(topic);
  const values = [];
  if (/ゲーム|任天堂|switch|steam|ps5/.test(text)) values.push('ゲームユーザー');
  if (/ai|chatgpt|openai|claude|gemini|生成ai/.test(text)) values.push('AI利用者');
  if (/セール|割引|キャンペーン|クーポン|fanza|dlsite/.test(text)) values.push('セール好き');
  if (/sns|炎上|バズ|ミーム|ネット文化|2ch|5ch/.test(text)) values.push('ネット文化を追う人');
  if (/株|投資|決算|金利|物価/.test(text)) values.push('投資家');
  if (/政治|国際|事件/.test(text)) values.push('時事ニュースを追う人');
  return [...new Set(values)].slice(0, 4);
}

function defaultSearchQueryForCategory(category) {
  if (category === 'tech') return 'テクノロジー 生成AI 新製品 アップデート';
  if (category === 'business') return '経済 企業 決算 投資 市況';
  if (category === 'politics') return '政治 国会 首相 選挙 与党 野党';
  if (category === 'entertainment') return 'エンタメ 映画 音楽 配信 話題';
  if (category === 'games') return 'ゲーム 任天堂 Switch PS5 Steam eスポーツ 話題';
  if (category === 'manga') return '漫画 マンガ コミック 新刊 連載 話題';
  if (category === 'books') return '本 書籍 小説 文庫 出版 話題';
  if (category === 'sports') return 'スポーツ 試合 結果 移籍 大会';
  if (category === 'sns') return 'X Twitter Bluesky Reddit SNSで話題 バズ投稿';
  if (category === 'net-culture') return 'ネットカルチャー SNS バズ 炎上';
  if (category === 'matome') return '2ch 5ch まとめサイト バズ';
  if (category === 'crime') return '事件 逮捕 送検 詐欺 強盗 裁判';
  if (category === 'adult') return 'グラビア セクシー女優 アダルト 話題';
  if (category === 'world') return '国際 海外 政治 外交 戦況';
  return '主要ニュース 速報 話題';
}

function buildGoogleNewsUrl(query) {
  const rangeDays = RANGE_CONFIG[activeRange]?.searchWindowDays || 1;
  return 'https://news.google.com/search?q=' + encodeURIComponent(query + ' when:' + rangeDays + 'd') + '&hl=ja&gl=JP&ceid=JP:ja';
}

function isWithinRange(item, range) {
  if (!range) return true;
  const time = archiveTimestamp(item);
  if (!time) return true;
  const ageHours = (Date.now() - time) / (60 * 60 * 1000);
  return ageHours > range.minHours && ageHours <= range.maxHours;
}

function archiveTimestamp(item) {
  const dateValue = item.sourceSignals?.[0]?.publishedAt ?? item.publishedAt ?? item.capturedAt ?? item.generatedAt;
  if (!dateValue) return null;
  const time = new Date(dateValue).getTime();
  return Number.isNaN(time) ? null : time;
}

function dedupeTopics(topics) {
  const map = new Map();

  for (const topic of topics) {
    const key = canonicalTopicKey(topic);
    const current = map.get(key);
    if (!current) {
      map.set(key, topic);
      continue;
    }

    const nextSignals = mergeSignals(current.sourceSignals, topic.sourceSignals);
    if (Number(topic.score ?? 0) >= Number(current.score ?? 0)) {
      const categories = normalizeCategories(mergeCategories(current.categories, topic.categories), topic.category ?? current.category);
      map.set(key, {
        ...current,
        ...topic,
        category: topic.category ?? current.category,
        categories,
        categoryLabels: categories.map(categoryLabelFor),
        sourceSignals: nextSignals,
        posts: String(Math.max(Number(current.posts ?? 1), Number(topic.posts ?? 1), nextSignals.length || 1)),
        metricLabel: nextSignals.length > 1 ? 'sources' : (topic.metricLabel ?? current.metricLabel ?? 'source'),
        thumbnailUrl: topic.thumbnailUrl ?? current.thumbnailUrl ?? nextSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
      });
    } else {
      const categories = normalizeCategories(mergeCategories(current.categories, topic.categories), current.category ?? topic.category);
      map.set(key, {
        ...current,
        categories,
        categoryLabels: categories.map(categoryLabelFor),
        sourceSignals: nextSignals,
        posts: String(Math.max(Number(current.posts ?? 1), Number(topic.posts ?? 1), nextSignals.length || 1)),
        metricLabel: nextSignals.length > 1 ? 'sources' : (current.metricLabel ?? 'source'),
        thumbnailUrl: current.thumbnailUrl ?? topic.thumbnailUrl ?? nextSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
      });
    }
  }

  return dedupeTopicsFuzzy([...map.values()]);
}

function mergeSignals(currentSignals = [], nextSignals = []) {
  return [...new Map([...currentSignals, ...nextSignals].map((signal) => [signal.url, signal])).values()];
}

function canonicalTopicKey(topic) {
  const titleSignature = normalizeTopicFingerprint(topic.title ?? '');
  const sourceSignature = canonicalTopicSourceSignature(topic);
  return `${titleSignature}::${sourceSignature}`;
}

function normalizeCategories(categories, fallbackCategory) {
  const values = Array.isArray(categories) ? categories : [];
  const merged = [...new Set([fallbackCategory, ...values].filter(Boolean))];
  return merged.length ? merged : ['general'];
}

function mergeCategories(...groups) {
  return [...new Set(groups.flatMap((group) => Array.isArray(group) ? group : [group]).filter(Boolean))];
}

function canonicalTopicSourceSignature(topic) {
  const firstSignalUrl = Array.isArray(topic.sourceSignals) ? topic.sourceSignals[0]?.url : null;
  const fromSearchLinks = Array.isArray(topic.searchLinks) ? topic.searchLinks[0]?.url : null;
  const normalizedUrl = canonicalUrlForDedup(firstSignalUrl || fromSearchLinks);
  return normalizedUrl ? `url:${normalizedUrl}` : '';
}

function canonicalUrlForDedup(rawUrl) {
  const value = String(rawUrl ?? '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const params = new URLSearchParams(parsed.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'ref', 'src', 'from'].forEach((key) => params.delete(key));
    parsed.search = params.toString();
    return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.toLowerCase()}`.replace(/\/$/, '');
  } catch {
    return value.toLowerCase().replace(/^https?:\/\//, '').replace(/[#?].*$/i, '');
  }
}

function normalizeTopicFingerprint(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b(速報|動画|写真|news|ニュース)\b/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/[【】「」『』]/g, ' ')
    .replace(/（[^）]*?新聞[^）]*?）/g, ' ')
    .replace(/（[^）]*?ニュース[^）]*?）/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[a-z0-9]{8,}\b/g, ' ')
    .replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasCategory(topic, category) {
  return normalizeCategories(topic.categories, topic.category).includes(category);
}

function categoryDisplayLabel(topic) {
  const labels = Array.isArray(topic.categoryLabels) && topic.categoryLabels.length
    ? topic.categoryLabels
    : normalizeCategories(topic.categories, topic.category).map(categoryLabelFor);
  return labels.slice(0, 2).join(' / ');
}

function dedupeTopicsFuzzy(topics) {
  const kept = [];
  for (const topic of topics) {
    const currentKey = canonicalTopicKey(topic);
    const duplicateIndex = kept.findIndex((item) => isNearDuplicateTopic(item, topic, currentKey));
    if (duplicateIndex === -1) {
      kept.push(topic);
      continue;
    }
    kept[duplicateIndex] = mergeDuplicateTopics(kept[duplicateIndex], topic);
  }
  return kept;
}

function isNearDuplicateTopic(current, next, nextKey = canonicalTopicKey(next)) {
  if (!current || !next) return false;
  const currentUrl = canonicalTopicSourceSignature(current);
  const nextUrl = canonicalTopicSourceSignature(next);
  if (currentUrl && nextUrl && currentUrl === nextUrl) return true;
  if (isLikelySameStory(current, next)) return true;
  if (!shareAnyCategory(current, next)) return false;
  const currentKey = canonicalTopicKey(current);
  if (!currentKey || !nextKey) return false;
  if (currentKey.includes(nextKey) || nextKey.includes(currentKey)) {
    return Math.min(currentKey.length, nextKey.length) >= 18;
  }
  const currentTokens = distinctiveTokens(currentKey);
  const nextTokens = distinctiveTokens(nextKey);
  if (currentTokens.length < 3 || nextTokens.length < 3) return false;
  const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
  return overlap >= 3 && overlap / Math.min(currentTokens.length, nextTokens.length) >= 0.78;
}

function distinctiveTokens(value) {
  return [...new Set(String(value ?? '').split(' ').filter((token) => token.length >= 2 && !GENERIC_TOPIC_TOKENS.has(token)))];
}

function shareAnyCategory(left, right) {
  const leftCategories = normalizeCategories(left.categories, left.category);
  const rightCategories = normalizeCategories(right.categories, right.category);
  return leftCategories.some((category) => rightCategories.includes(category));
}

function isLikelySameStory(current, next) {
  if (!current || !next) return false;

  const currentTitle = normalizeTopicFingerprint(current.title ?? "");
  const nextTitle = normalizeTopicFingerprint(next.title ?? "");
  if (!currentTitle || !nextTitle) return false;

  const sameTitle = currentTitle === nextTitle || currentTitle.includes(nextTitle) || nextTitle.includes(currentTitle);
  const currentPublishedAt = topicPublishedAt(current);
  const nextPublishedAt = topicPublishedAt(next);
  if (sameTitle) {
    if (currentPublishedAt == null || nextPublishedAt == null) return true;
    return Math.abs(currentPublishedAt - nextPublishedAt) <= 36 * 60 * 60 * 1000;
  }

  const currentTokens = distinctiveTokens(currentTitle);
  const nextTokens = distinctiveTokens(nextTitle);
  if (currentTokens.length < 4 || nextTokens.length < 4) return false;
  if (!currentPublishedAt || !nextPublishedAt) return false;
  const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
  const overlapRatio = overlap / Math.min(currentTokens.length, nextTokens.length);
  return overlap >= 3 && overlapRatio >= 0.8 && Math.abs(currentPublishedAt - nextPublishedAt) <= 36 * 60 * 60 * 1000;
}

function topicPublishedAt(topic) {
  const value = topic?.sourceSignals?.[0]?.publishedAt ?? topic?.publishedAt ?? topic?.capturedAt ?? topic?.generatedAt;
  const time = new Date(value ?? "").getTime();
  return Number.isNaN(time) ? null : time;
}

function mergeDuplicateTopics(current, next) {
  const currentSignals = Array.isArray(current.sourceSignals) ? current.sourceSignals : [];
  const nextSignals = Array.isArray(next.sourceSignals) ? next.sourceSignals : [];
  const mergedSignals = [...new Map([...currentSignals, ...nextSignals].map((signal) => [signal.url, signal])).values()];
  const winner = Number(next.score ?? 0) >= Number(current.score ?? 0) ? next : current;
  const loser = winner === next ? current : next;
  const categories = normalizeCategories(mergeCategories(current.categories, next.categories), winner.category ?? loser.category);
  return {
    ...loser,
    ...winner,
    category: winner.category ?? loser.category,
    categories,
    categoryLabels: categories.map(categoryLabelFor),
    sourceSignals: mergedSignals,
    posts: String(Math.max(Number(current.posts ?? 1), Number(next.posts ?? 1), mergedSignals.length || 1)),
    metricLabel: mergedSignals.length > 1 ? 'sources' : (winner.metricLabel ?? loser.metricLabel ?? 'source'),
    thumbnailUrl: winner.thumbnailUrl ?? loser.thumbnailUrl ?? mergedSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
  };
}

const GENERIC_TOPIC_TOKENS = new Set(['速報', '公開', '発表', '開始', '決定', '話題', '最新', '本日', 'きょう', '今日', '判明', '疑惑', '意見']);

function renderPagination(totalPages, totalItems) {
  if (!paginationElement) return;
  if (!totalItems || totalPages <= 1) {
    paginationElement.innerHTML = '';
    return;
  }

  const pages = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  for (let page = start; page <= end; page += 1) {
    pages.push('<button class="pagination-button' + (page === currentPage ? ' active' : '') + '" type="button" data-page="' + page + '">' + page + '</button>');
  }

  paginationElement.innerHTML =
    '<button class="pagination-button" type="button" data-page="' + Math.max(1, currentPage - 1) + '"' + (currentPage === 1 ? ' disabled' : '') + '>前へ</button>' +
    '<span class="pagination-status">' + currentPage + ' / ' + totalPages + ' ページ</span>' +
    pages.join('') +
    '<button class="pagination-button" type="button" data-page="' + Math.min(totalPages, currentPage + 1) + '"' + (currentPage === totalPages ? ' disabled' : '') + '>次へ</button>';

  paginationElement.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      currentPage = Number(button.getAttribute('data-page')) || 1;
      renderTrendIndex();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '不明';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}

async function fetchJson(endpoint) {
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch ' + endpoint);
  return await response.json();
}

function mergeReports(...reportGroups) {
  const reports = reportGroups.flat();
  return [...new Map(reports.map((report) => [report.id, report])).values()];
}

function saveTopicCache(topics) {
  try { localStorage.setItem('internet-news-browse-topic-cache', JSON.stringify(topics ?? [])); } catch {}
}

document.querySelectorAll('.news-category-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.news-category-tabs button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeCategory = button.dataset.category;
    currentPage = 1;
    renderTrendIndex();
  });
});

document.querySelectorAll('.news-range-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.news-range-tabs button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeRange = button.dataset.range || '24h';
    currentPage = 1;
    renderTrendIndex();
  });
});

queryElement.addEventListener('input', () => {
  currentPage = 1;
  renderTrendIndex();
});
