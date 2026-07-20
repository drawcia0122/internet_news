import { loadData } from './data-loader.js';
import { buildHomeViewModel, normalizeTitle, validHttpUrl } from './home-mapper.js';

const SECTION_ELEMENTS = Object.freeze({
  keyPoints: {
    list: 'key-points-list',
    meta: 'key-points-meta',
    loading: '今日の要点を読み込んでいます',
    empty: '今日の要点を準備中です',
  },
  mustKnow: {
    list: 'must-know-list',
    meta: 'must-know-meta',
    loading: '必読ニュースを読み込んでいます',
    empty: '必読ニュースを準備中です',
  },
  trending: {
    list: 'trending-list',
    meta: 'trending-meta',
    loading: '急上昇ワードを読み込んでいます',
    empty: '急上昇ワードを準備中です',
  },
});

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function setLoading(sectionName) {
  const config = SECTION_ELEMENTS[sectionName];
  const list = document.getElementById(config.list);
  const meta = document.getElementById(config.meta);
  if (!list || !meta) return;

  list.replaceChildren(createElement('p', 'section-state', config.loading));
  list.setAttribute('aria-busy', 'true');
  meta.replaceChildren();
}

function formatGeneratedAt(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function renderMeta(meta, section) {
  meta.replaceChildren();
  const updateTime = formatGeneratedAt(section.generatedAt);
  if (updateTime) {
    meta.append(createElement('span', '', `更新 ${updateTime}`));
  }
  if (section.stale) {
    meta.append(createElement('span', 'stale-label', '更新が遅れています'));
  }
}

function createSourceLink(item) {
  const href = validHttpUrl(item.sourceUrl);
  if (!href) return null;

  const link = createElement('a', 'source-link', item.sourceName || '出典を確認');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function renderKeyPoint(item) {
  const article = createElement('article', 'key-point-card');
  article.append(createElement('h3', '', item.title));
  article.append(createElement('p', '', item.summary));
  const sourceLink = createSourceLink(item);
  if (sourceLink) article.append(sourceLink);
  return article;
}

function appendDefinition(list, label, value) {
  if (!value) return;
  const row = document.createElement('div');
  row.append(createElement('dt', '', label));
  row.append(createElement('dd', '', value));
  list.append(row);
}

function renderMustKnow(item) {
  const article = createElement('article', 'understanding-card');

  if (item.thumbnail) {
    const image = createElement('img', 'news-thumbnail');
    image.src = item.thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove(), { once: true });
    article.append(image);
  }

  article.append(createElement('h3', '', item.title));
  const list = document.createElement('dl');
  appendDefinition(list, '何が起きた', item.whatHappened);
  appendDefinition(list, 'なぜ重要', item.whyItMatters);
  appendDefinition(list, '次に見る', item.nextStep);
  article.append(list);

  const sourceLink = createSourceLink(item);
  if (sourceLink) article.append(sourceLink);
  return article;
}

function renderTrending(item) {
  const href = validHttpUrl(item.targetUrl);
  const tag = createElement(href ? 'a' : 'div', 'trend-tag');
  if (href) {
    tag.href = href;
    tag.target = '_blank';
    tag.rel = 'noopener noreferrer';
  }
  tag.append(createElement('strong', '', item.label));
  tag.append(createElement('span', '', item.description));

  const category = typeof item.category === 'string' ? item.category.trim() : '';
  const showCategory = category && normalizeTitle(category) !== normalizeTitle(item.label);
  const hasScore = Number.isFinite(item.score);
  if (showCategory || hasScore) {
    const meta = createElement('div', 'trend-tag__meta');
    if (showCategory) {
      meta.append(createElement('span', 'trend-tag__category', category));
    }
    if (hasScore) {
      meta.append(createElement('span', 'trend-tag__score', `注目度 ${Math.round(item.score)}`));
    }
    tag.append(meta);
  }

  return tag;
}

function renderSection(sectionName, section, renderer) {
  const config = SECTION_ELEMENTS[sectionName];
  const list = document.getElementById(config.list);
  const meta = document.getElementById(config.meta);
  if (!list || !meta) return;

  list.replaceChildren();
  list.setAttribute('aria-busy', 'false');
  list.closest('.section-block')?.classList.toggle('is-stale', section.stale);
  renderMeta(meta, section);

  if (section.items.length) {
    list.append(...section.items.map(renderer));
    return;
  }

  const message = section.state === 'error'
    ? '現在データを取得できません。しばらくしてから再度ご確認ください'
    : config.empty;
  list.append(createElement('p', `section-state is-${section.state}`, message));
}

function warnFailures(results) {
  Object.values(results)
    .filter((result) => result && !result.ok)
    .forEach((result) => {
      console.warn('Next data source unavailable', {
        source: result.source,
        type: result.error.type,
        status: result.error.status,
      });
    });
}

async function loadCriticalSections() {
  const settled = await Promise.allSettled([
    loadData('todayInternet'),
    loadData('dailyBrief'),
  ]);
  const results = {
    todayInternet: settled[0].status === 'fulfilled' ? settled[0].value : null,
    dailyBrief: settled[1].status === 'fulfilled' ? settled[1].value : null,
  };

  let viewModel = buildHomeViewModel(results);
  if (viewModel.needsFallback.critical) {
    const fallbackSettled = await Promise.allSettled([
      loadData('homeTopics'),
      loadData('homeNews'),
    ]);
    results.homeTopics = fallbackSettled[0].status === 'fulfilled' ? fallbackSettled[0].value : null;
    results.homeNews = fallbackSettled[1].status === 'fulfilled' ? fallbackSettled[1].value : null;
    viewModel = buildHomeViewModel(results);
  }

  warnFailures(results);
  renderSection('keyPoints', viewModel.keyPoints, renderKeyPoint);
  renderSection('mustKnow', viewModel.mustKnow, renderMustKnow);
  return results;
}

function nextEventLoop() {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(resolve, { timeout: 500 });
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

async function loadTrendingSection(criticalResults) {
  await nextEventLoop();
  const trendTopics = await loadData('trendTopics');
  const results = { ...criticalResults, trendTopics };
  let viewModel = buildHomeViewModel(results);

  if (viewModel.needsFallback.trending && (!results.homeTopics || !results.homeNews)) {
    const fallbackSources = [];
    if (!results.homeTopics) fallbackSources.push('homeTopics');
    if (!results.homeNews) fallbackSources.push('homeNews');
    const fallbackResults = await Promise.allSettled(fallbackSources.map((source) => loadData(source)));
    fallbackSources.forEach((source, index) => {
      results[source] = fallbackResults[index].status === 'fulfilled'
        ? fallbackResults[index].value
        : null;
    });
    viewModel = buildHomeViewModel(results);
  }

  warnFailures({ trendTopics, homeTopics: results.homeTopics, homeNews: results.homeNews });
  renderSection('trending', viewModel.trending, renderTrending);
}

async function initializeNext() {
  document.documentElement.classList.add('next-initialized');
  Object.keys(SECTION_ELEMENTS).forEach(setLoading);

  let criticalResults = {};
  try {
    criticalResults = await loadCriticalSections();
  } catch (error) {
    console.warn('Next critical rendering failed', { type: 'unknown', error });
    const viewModel = buildHomeViewModel({});
    renderSection('keyPoints', { ...viewModel.keyPoints, state: 'error' }, renderKeyPoint);
    renderSection('mustKnow', { ...viewModel.mustKnow, state: 'error' }, renderMustKnow);
  }

  try {
    await loadTrendingSection(criticalResults);
  } catch (error) {
    console.warn('Next trending rendering failed', { type: 'unknown', error });
    const viewModel = buildHomeViewModel({});
    renderSection('trending', { ...viewModel.trending, state: 'error' }, renderTrending);
  }

  console.info('INTERNET NEWS Next initialized');
}

document.addEventListener('DOMContentLoaded', initializeNext, { once: true });
