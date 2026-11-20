import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import '../news-summary-integrity.js';
import '../verified-article-thumbnail.js';
import { isLowResolutionThumbnailUrl, readImageTagAttributes, sanitizeThumbnailUrl } from '../lib/thumbnail-utils.mjs';

const { titlesReferToSameArticle } = globalThis.NewsSummaryIntegrity;
const { yahooUrl, articleImageUrl, getYahooThumbnailOwner, getArticleThumbnail } = globalThis.VerifiedArticleThumbnail;
const HOME_FIRST = 'home-news.json';
const PRIORITY_FILES = ['daily-brief.json', 'today-internet.json', HOME_FIRST];
const HOME_PAGE = /^home-news-page-\d+\.json$/;

function ownerKey(owner) {
  return owner && JSON.stringify([owner.url, owner.title]);
}

export function yahooThumbnailConsumerItems(file, payload) {
  if (!payload) return [];
  if (file === 'today-internet.json') return [payload.selectedTopic, ...(Array.isArray(payload.runnerUps) ? payload.runnerUps : [])].filter(Boolean);
  return Array.isArray(payload.items) ? payload.items : [];
}

async function readConsumers(directory) {
  const all = await readdir(directory);
  const pages = all.filter((file) => HOME_PAGE.test(file)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const selected = [...PRIORITY_FILES.filter((file) => all.includes(file)), ...pages];
  return Promise.all(selected.map(async (file) => {
    const filename = join(directory, file);
    const payload = JSON.parse(await readFile(filename, 'utf8'));
    return { file, filename, payload, items: yahooThumbnailConsumerItems(file, payload) };
  }));
}

function indexPhotos(items, saved = new Map()) {
  for (const item of items) {
    const photo = getArticleThumbnail(item);
    const key = photo && ownerKey(getYahooThumbnailOwner(item));
    if (key) saved.set(key, photo);
  }
  return saved;
}

export async function collectPriorYahooPhotos(directory = 'data') {
  const saved = new Map();
  for (const { items } of await readConsumers(directory)) indexPhotos(items, saved);
  return saved;
}

export function restoreYahooPhotoRecords(items, priorItems) {
  const previous = indexPhotos(priorItems);
  if (!previous.size) return 0;
  let restored = 0;
  for (const item of items) {
    if (!item || getArticleThumbnail(item) || hasUsableStandardImage(item)) continue;
    const photo = previous.get(ownerKey(getYahooThumbnailOwner(item)));
    if (!getArticleThumbnail({ ...item, articleThumbnail: photo })) continue;
    item.articleThumbnail = photo;
    restored++;
  }
  return restored;
}

function headMetadata(html) {
  const head = String(html).match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] || '';
  const withoutScripts = head.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi, '');
  const values = new Map();
  for (const tag of withoutScripts.matchAll(/<(meta|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attr = readImageTagAttributes(tag[0]);
    const key = tag[1].toLowerCase() === 'link' ? attr.rel : attr.property || attr.name;
    const value = tag[1].toLowerCase() === 'link' ? attr.href : attr.content;
    if (!key || !value) continue;
    const names = values.get(key.toLowerCase()) || new Set();
    names.add(value);
    values.set(key.toLowerCase(), names);
  }
  return {
    one: (key) => {
      const matches = values.get(key);
      return matches?.size === 1 ? [...matches][0] : '';
    },
    all: (key) => [...(values.get(key) || [])],
  };
}

function pickupArticle(html, owner) {
  const expectedId = owner.url.split('/').at(-1);
  for (const script of String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const state = script[1].match(/^\s*window\.__PRELOADED_STATE__\s*=\s*([\s\S]*?)\s*;?\s*$/)?.[1];
    if (!state) continue;
    let detail;
    try { detail = JSON.parse(state)?.topicsDetail; } catch { continue; }
    if (String(detail?.id) !== expectedId || yahooUrl(detail?.url, 'pickup') !== owner.url
      || !titlesReferToSameArticle(owner.title, detail?.title)) continue;
    const url = yahooUrl(detail?.article?.url, 'article');
    if (url && String(detail.article?.title ?? '').trim()) return { url, title: detail.article.title };
  }
  return null;
}

export async function findYahooArticlePhoto(owner, { fetchHtml = fetchYahooHtml } = {}) {
  let target = { url: owner.url, title: owner.title };
  if (owner.kind === 'pickup') {
    target = pickupArticle(await fetchHtml(owner.url), owner);
    if (!target) return null;
  }
  const meta = headMetadata(await fetchHtml(target.url));
  const pageTitle = meta.one('og:title');
  const canonicalUrls = [...meta.all('canonical'), ...meta.all('og:url')];
  if (!pageTitle || !titlesReferToSameArticle(target.title, pageTitle)
    || !canonicalUrls.length || canonicalUrls.some((url) => yahooUrl(url, 'article') !== target.url)) return null;
  const imageUrl = articleImageUrl(meta.one('og:image'));
  const dimension = (key) => /^\d{2,5}$/.test(meta.one(key)) ? Number(meta.one(key)) : 0;
  const width = dimension('og:image:width');
  const height = dimension('og:image:height');
  if (!imageUrl || width < 320 || height < 120) return null;
  return {
    ...(owner.kind === 'pickup' ? {
      kind: 'yahoo-main-article-og', pickupUrl: owner.url, pickupTitle: owner.title,
    } : { kind: 'yahoo-direct-article-og', ownerTitle: owner.title }),
    articleUrl: target.url, articleTitle: target.title, imageUrl, width, height,
  };
}

async function fetchYahooHtml(url) {
  // Only our canonical Yahoo article and pickup URLs are requested, without
  // following redirects to arbitrary destinations.
  if (url !== yahooUrl(url, 'pickup') && url !== yahooUrl(url, 'article')) return '';
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'INTERNET NEWS/1.0', accept: 'text/html,application/xhtml+xml' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok && /^(?:text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get('content-type') || '')) {
      return await response.text();
    }
  } catch { /* A missing or inaccessible source should stay text-only. */ }
  return '';
}

function hasUsableStandardImage(item) {
  return [item.thumbnailUrl, item.thumbnail].some((url) =>
    sanitizeThumbnailUrl(url) && !isLowResolutionThumbnailUrl(url));
}

export async function repairYahooArticleThumbnails({
  directory = 'data', previous = new Map(), fetchHtml = fetchYahooHtml, maxLookups = 50,
  now = Date.now(), logger = console,
} = {}) {
  const consumers = await readConsumers(directory);
  const targets = new Map();
  const changed = new Set();
  let restored = 0;
  let repaired = 0;
  for (const consumer of consumers) {
    for (const item of consumer.items) {
      if (!item || getArticleThumbnail(item) || hasUsableStandardImage(item)) continue;
      const owner = getYahooThumbnailOwner(item);
      if (!owner) continue;
      const key = ownerKey(owner);
      const prior = previous.get(key);
      if (getArticleThumbnail({ ...item, articleThumbnail: prior })) {
        item.articleThumbnail = prior;
        changed.add(consumer);
        restored++;
        continue;
      }
      if (!targets.has(key)) targets.set(key, { owner, refs: [], priority: false });
      const target = targets.get(key);
      target.refs.push({ consumer, item });
      target.priority ||= PRIORITY_FILES.includes(consumer.file);
    }
  }

  // Consistently repair the three visible first pages/cards, then rotate over
  // the larger paginated archive instead of re-fetching its first page forever.
  const ranked = [...targets.values()];
  const priority = ranked.filter((target) => target.priority);
  const remaining = ranked.filter((target) => !target.priority);
  const offset = remaining.length ? Math.floor(now / 1800000) * 23 % remaining.length : 0;
  const queue = [...priority, ...remaining.slice(offset), ...remaining.slice(0, offset)].slice(0, maxLookups);
  const attempted = queue.length;
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      const { owner, refs } = queue.shift();
      const photo = await findYahooArticlePhoto(owner, { fetchHtml }).catch(() => null);
      if (!photo) continue;
      for (const { consumer, item } of refs) {
        if (!getArticleThumbnail({ ...item, articleThumbnail: photo })) continue;
        item.articleThumbnail = photo;
        repaired++;
        changed.add(consumer);
      }
    }
  }));
  for (const consumer of changed) {
    const temporary = `${consumer.filename}.${process.pid}.yahoo.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(consumer.payload, null, 2)}\n`, 'utf8');
      await rename(temporary, consumer.filename);
    } finally { await rm(temporary, { force: true }); }
  }
  logger.log(`[thumbnail:yahoo] repaired=${repaired} restored=${restored} looked-up=${attempted} consumers=${changed.size}`);
  return { repaired, restored, attempted };
}
