// Separate, bounded enrichment. Article prose discovers app identities only;
// every displayed amount comes from the official Japanese Steam app response.
export const GAME_PRICE_FRESH_MS = 6 * 60 * 60 * 1000;
export const GAME_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ARTICLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLISHERS = new Set(['automaton-media.com', 'news.denfaminicogamer.jp']);
const SALE = /セール|割引|オフ|\bOFF\b/iu;
const FUTURE_SALE = /(?:セール|割引).{0,16}(?:予定|予告|開催決定)|(?:明日|来週|来月).{0,16}(?:開始|開催)|(?:\d+月\d+日|\d+日).{0,4}(?:から|より).{0,12}(?:セール|開催|開始)/u;
const NON_BASE = /\b(?:DLC|bundle|deluxe|ultimate|soundtrack|season pass)\b|デラックス|アルティメット|サウンドトラック|シーズンパス|バンドル|追加コンテンツ/iu;

function fail(code) { throw Object.assign(new Error(code), { code }); }
function decode(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (_, entity) => {
    if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity.toLowerCase()];
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
function text(value) { return decode(value).replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim(); }
function attr(tag, name) { return decode(tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'iu'))?.[2] ?? ''); }
function timestamp(value) { const n = Date.parse(value); return Number.isFinite(n) ? n : NaN; }
function ageWithin(value, now, maximum) { const age = now - timestamp(value); return Number.isFinite(age) && age >= 0 && age <= maximum; }
function normalizeTitle(value) { return text(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function headlineFeatures(article, title) {
  const normalized = normalizeTitle(title);
  if (normalizeTitle(article.title).includes(normalized)) return true;
  return [...String(article.title).matchAll(/『([^』]+)』/gu)].some((m) => {
    const named = normalizeTitle(m[1]);
    return named.length >= 4 && normalized.includes(named);
  });
}

export function canonicalSaleArticleUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !PUBLISHERS.has(url.hostname) || url.port || url.username || url.password) return '';
    if (url.hostname === 'automaton-media.com' && !/^\/articles\/newsjp\/[^/]+\/?$/u.test(url.pathname)) return '';
    if (url.hostname === 'news.denfaminicogamer.jp' && !/^\/news\/[^/]+\/?$/u.test(url.pathname)) return '';
    // These publisher paths identify an article without query parameters.
    // Ignore tracking only; reject meaningful queries rather than silently
    // assigning a page/edition variant to the canonical article.
    if ([...url.searchParams.keys()].some((key) => !/^(?:utm_.+|fbclid|gclid)$/iu.test(key))) return '';
    return `${url.origin}${url.pathname.replace(/\/$/u, '')}`;
  } catch { return ''; }
}

export function selectSaleArticles(topics, { now = new Date(), limit = 8 } = {}) {
  const articles = new Map();
  for (const topic of topics ?? []) {
    if (topic?.category !== 'games' && !topic?.categories?.includes('games')) continue;
    for (const source of topic.sourceSignals ?? []) {
      const title = String(source.title || topic.title || '');
      const evidence = `${title} ${source.summary || topic.summary || ''}`;
      const url = canonicalSaleArticleUrl(source.canonicalUrl || source.url);
      const sourceUrl = canonicalSaleArticleUrl(source.url);
      if (source.canonicalUrl && source.url && sourceUrl && sourceUrl !== url) continue;
      if (!url || !/\bSteam\b/iu.test(evidence) || !SALE.test(title) || FUTURE_SALE.test(title)
          || !ageWithin(source.publishedAt, now.getTime(), ARTICLE_MAX_AGE_MS)) continue;
      const article = { url, title, publishedAt: source.publishedAt, topicId: String(topic.id || '') };
      if (!articles.has(url) || timestamp(article.publishedAt) > timestamp(articles.get(url).publishedAt)) articles.set(url, article);
    }
  }
  return [...articles.values()].sort((a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt)).slice(0, limit);
}

function elementContents(html, start, tagName) {
  const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'giu');
  tags.lastIndex = start;
  let depth = 0;
  let contentStart;
  for (let match; (match = tags.exec(html));) {
    if (match[0].startsWith('</')) {
      if (--depth === 0) return html.slice(contentStart, match.index);
    } else if (!match[0].endsWith('/>')) {
      if (depth++ === 0) contentStart = tags.lastIndex;
    }
  }
  return '';
}

function articleBody(html, articleUrl) {
  const clean = html.replace(/<(script|style|aside|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/giu, '');
  const canonicalTag = [...clean.matchAll(/<link\b[^>]*>/giu)].find((m) => attr(m[0], 'rel').toLowerCase() === 'canonical');
  if (!canonicalTag || canonicalSaleArticleUrl(attr(canonicalTag[0], 'href')) !== canonicalSaleArticleUrl(articleUrl)) fail('article_identity_mismatch');
  const host = new URL(articleUrl).hostname;
  for (const match of clean.matchAll(/<(section|div)\b[^>]*>/giu)) {
    const isBody = host === 'automaton-media.com' ? attr(match[0], 'class').split(/\s/u).includes('maintext') : attr(match[0], 'id') === 'articleBody';
    if (isBody) return elementContents(clean, match.index, match[1]);
  }
  fail('article_body_missing');
}

export function steamAppId(value) {
  try {
    const url = new URL(decode(value));
    if (url.protocol !== 'https:' || url.hostname !== 'store.steampowered.com' || url.port || url.username || url.password) return null;
    const id = Number(url.pathname.match(/^\/app\/(\d+)(?:\/|$)/u)?.[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

export function extractArticleSteamApps(html, article) {
  const body = articleBody(html, article.url);
  const candidates = new Map();
  // Each paragraph is its own identity/price boundary. Never use the roundup
  // headline, sibling paragraphs, related stories or a nearby image as proof.
  for (const paragraph of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)) {
    const localText = text(paragraph[1]);
    if (!/(?:[\d,]+\s*円|セール|割引|オフ|\bOFF\b)/iu.test(localText) || FUTURE_SALE.test(localText)) continue;
    const links = [...paragraph[1].matchAll(/<a\b[^>]*>/giu)].map((m) => steamAppId(attr(m[0], 'href'))).filter(Boolean);
    const appIds = [...new Set(links)];
    if (appIds.length !== 1) continue;
    const strongTitles = [...paragraph[1].matchAll(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/giu)]
      .map((m) => text(m[1])).filter((s) => s.length > 1 && s.length <= 150 && !/^[\d,\s円%％→]+$/u.test(s));
    const quoted = [...localText.matchAll(/『([^』]{2,150})』/gu)].map((m) => m[1].trim());
    const articleGameTitle = strongTitles[0] || quoted[0];
    if (!articleGameTitle || NON_BASE.test(articleGameTitle)) continue;
    const appId = appIds[0];
    if (!candidates.has(appId)) candidates.set(appId, { appId, articleGameTitle });
  }
  // Prefer the explicit games from a roundup's title before its other entries.
  return [...candidates.values()].sort((a, b) => Number(headlineFeatures(article, b.articleGameTitle)) - Number(headlineFeatures(article, a.articleGameTitle)));
}

export function steamPriceSourceUrl(appId) {
  return `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp&l=japanese`;
}
function officialImage(value, appId) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/(?:^|\.)(?:steamstatic\.com|steamcdn-a\.akamaihd\.net)$/iu.test(url.hostname)
        || !url.pathname.includes(`/apps/${appId}/`)) return null;
    return url.href;
  } catch { return null; }
}

export function parseSteamPrice(payload, appId, { now = new Date(), articles = [] } = {}) {
  const entry = payload?.[String(appId)];
  if (!entry?.success || !entry.data) fail('steam_unavailable');
  const data = entry.data;
  if (data.steam_appid !== appId || data.type !== 'game' || data.release_date?.coming_soon !== false || !String(data.name || '').trim()) fail('steam_identity_or_edition');
  const price = data.price_overview;
  if (!price || price.currency !== 'JPY') fail('steam_no_jpy_price');
  if (![price.initial, price.final].every((n) => Number.isSafeInteger(n) && n > 0 && n % 100 === 0)
      || price.final > price.initial || !Number.isInteger(price.discount_percent) || price.discount_percent < 0 || price.discount_percent >= 100
      || (price.discount_percent === 0) !== (price.initial === price.final)
      || Math.abs(100 * (1 - price.final / price.initial) - price.discount_percent) > 1) fail('steam_invalid_price');
  const checkedAt = now.toISOString();
  return {
    id: `steam:${appId}`, appId, title: data.name.trim(), edition: 'base-game', store: 'Steam', platform: 'PC',
    storeUrl: `https://store.steampowered.com/app/${appId}/?cc=jp&l=japanese`,
    regularPrice: price.initial / 100, salePrice: price.final / 100, discountPercent: price.discount_percent,
    currency: 'JPY', country: 'JP', checkedAt,
    freshUntil: new Date(now.getTime() + GAME_PRICE_FRESH_MS).toISOString(),
    priceValidUntil: new Date(now.getTime() + GAME_PRICE_MAX_AGE_MS).toISOString(),
    status: price.discount_percent ? 'verified' : 'ended',
    priceSource: { url: steamPriceSourceUrl(appId), kind: 'steam-appdetails' },
    thumbnailUrl: officialImage(data.header_image, appId),
    articleUrls: articles.map((a) => a.url), articles,
    featuredInArticle: articles.some((a) => headlineFeatures(a, a.gameTitle || data.name)),
  };
}

function retainedPrice(item, now) {
  if (!item || !Number.isSafeInteger(item.appId) || item.appId <= 0 || item.id !== `steam:${item.appId}`
      || item.currency !== 'JPY' || item.country !== 'JP' || item.edition !== 'base-game'
      || item.priceSource?.url !== steamPriceSourceUrl(item.appId) || item.priceSource?.kind !== 'steam-appdetails'
      || !ageWithin(item.checkedAt, now, GAME_PRICE_MAX_AGE_MS)
      || timestamp(item.freshUntil) !== timestamp(item.checkedAt) + GAME_PRICE_FRESH_MS
      || timestamp(item.priceValidUntil) !== timestamp(item.checkedAt) + GAME_PRICE_MAX_AGE_MS
      || !['verified', 'cached', 'stale', 'ended'].includes(item.status)
      || (item.status === 'ended') !== (item.discountPercent === 0)
      || typeof item.regularPrice !== 'number' || typeof item.salePrice !== 'number'
      || item.store !== 'Steam' || item.storeUrl !== `https://store.steampowered.com/app/${item.appId}/?cc=jp&l=japanese`) return false;
  const initial = item.regularPrice * 100;
  const final = item.salePrice * 100;
  try {
    parseSteamPrice({ [item.appId]: { success: true, data: { steam_appid: item.appId, type: 'game', name: item.title,
      release_date: { coming_soon: false }, price_overview: { initial, final, currency: item.currency, discount_percent: item.discountPercent } } } }, item.appId);
    return true;
  } catch { return false; }
}

async function fetchText(fetchImpl, url, { signal, timeoutMs, maxBytes }) {
  const response = await fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), redirect: 'error',
    headers: { 'user-agent': 'InternetNewsGamePrices/1.0 (public Steam JP sale verification)', accept: 'application/json,text/html' } });
  if (!response.ok) fail(`http_${response.status}`);
  if (response.url && new URL(response.url).hostname !== new URL(url).hostname) fail('unexpected_redirect');
  if (Number(response.headers?.get?.('content-length')) > maxBytes) fail('response_too_large');
  if (!response.body?.getReader) {
    const value = await response.text();
    if (Buffer.byteLength(value) > maxBytes) fail('response_too_large');
    return value;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) fail('response_too_large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
async function concurrentMap(values, concurrency, task) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) { const i = cursor++; output[i] = await task(values[i]); }
  }));
  return output;
}

export async function collectGameSaleOffers({ topics = [], previous = {}, fetchImpl = fetch, now = new Date(),
  maxArticles = 8, maxApps = 32, concurrency = 3, timeoutMs = 10000, budgetMs = 90000, force = false } = {}) {
  const started = now.getTime();
  const signal = AbortSignal.timeout(budgetMs);
  const articles = selectSaleArticles(topics, { now, limit: Math.min(maxArticles, 12) });
  const oldItems = new Map((previous.items ?? []).filter((item) => retainedPrice(item, started)).map((item) => [item.appId, item]));
  const oldSources = new Map((previous.sources ?? []).filter((s) => s.kind === 'article').map((s) => [s.url, s]));
  const articleResults = await concurrentMap(articles, concurrency, async (article) => {
    const previousSource = oldSources.get(article.url);
    const canRetain = Array.isArray(previousSource?.candidates) && ageWithin(previousSource.checkedAt, started, GAME_PRICE_MAX_AGE_MS);
    if (!force && canRetain && ageWithin(previousSource.checkedAt, started, GAME_PRICE_FRESH_MS)) {
      return { article, candidates: previousSource.candidates, source: { ...previousSource, status: 'cached' } };
    }
    try {
      // Canonical identity intentionally omits the slash for joins, while the
      // publisher's slash URL avoids a normal same-site WordPress redirect.
      const requestUrl = new URL(article.url).hostname === 'automaton-media.com' ? `${article.url}/` : article.url;
      const html = await fetchText(fetchImpl, requestUrl, { signal, timeoutMs, maxBytes: 2 * 1024 * 1024 });
      const candidates = extractArticleSteamApps(html, article);
      return { article, candidates, source: { kind: 'article', url: article.url, checkedAt: now.toISOString(), status: 'ok', candidates } };
    } catch (error) {
      return { article, candidates: canRetain ? previousSource.candidates : [], source: { kind: 'article', url: article.url,
        checkedAt: previousSource?.checkedAt || null, attemptedAt: now.toISOString(), status: 'error', error: String(error.code || error.name || error.message).slice(0, 100),
        candidates: canRetain ? previousSource.candidates : [] } };
    }
  });
  const candidates = new Map();
  for (const result of articleResults) {
    for (const candidate of result.candidates) {
      if (!Number.isSafeInteger(candidate.appId) || candidate.appId <= 0) continue;
      const existing = candidates.get(candidate.appId) || { appId: candidate.appId, articles: [] };
      existing.articles.push({ ...result.article, gameTitle: candidate.articleGameTitle });
      candidates.set(candidate.appId, existing);
    }
  }
  const appResults = await concurrentMap([...candidates.values()].slice(0, Math.min(maxApps, 40)), concurrency, async ({ appId, articles: associated }) => {
    const old = oldItems.get(appId);
    if (!force && old && ageWithin(old.checkedAt, started, GAME_PRICE_FRESH_MS)) {
      return { item: { ...old, articleUrls: associated.map((a) => a.url), articles: associated, status: old.discountPercent ? 'cached' : 'ended',
        featuredInArticle: associated.some((a) => headlineFeatures(a, a.gameTitle || old.title)) },
        source: { kind: 'steam', appId, url: steamPriceSourceUrl(appId), checkedAt: old.checkedAt, status: 'cached' } };
    }
    let responded = false;
    try {
      const raw = await fetchText(fetchImpl, steamPriceSourceUrl(appId), { signal, timeoutMs, maxBytes: 1024 * 1024 });
      const payload = JSON.parse(raw);
      // A valid official non-sale/unavailable response supersedes historical
      // discounts. Only network/HTTP/invalid-JSON failures may retain an offer.
      responded = typeof payload?.[String(appId)]?.success === 'boolean';
      const item = parseSteamPrice(payload, appId, { now, articles: associated });
      return { item, source: { kind: 'steam', appId, url: steamPriceSourceUrl(appId), checkedAt: item.checkedAt,
        status: 'ok', discounted: item.discountPercent > 0, articleUrls: item.articleUrls } };
    } catch (error) {
      const item = !responded && old ? { ...old, articleUrls: associated.map((a) => a.url), articles: associated, status: old.discountPercent ? 'stale' : 'ended',
        featuredInArticle: associated.some((a) => headlineFeatures(a, a.gameTitle || old.title)) } : null;
      return { item, source: { kind: 'steam', appId, url: steamPriceSourceUrl(appId), checkedAt: item?.checkedAt || null,
        attemptedAt: now.toISOString(), status: responded ? 'unavailable' : 'error', error: String(error.code || error.name || error.message).slice(0, 100),
        articleUrls: associated.map((a) => a.url), retained: Boolean(item) } };
    }
  });
  const items = appResults.map((r) => r.item).filter(Boolean);
  const sources = [...articleResults.map((r) => r.source), ...appResults.map((r) => r.source)];
  return { schemaVersion: 1, generatedAt: now.toISOString(), country: 'JP', currency: 'JPY',
    status: sources.some((s) => s.status === 'error') ? items.length ? 'partial' : 'unavailable' : 'ok',
    items, sources };
}
