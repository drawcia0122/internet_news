import { createHash } from 'node:crypto';
import { MATOME_SOURCES, MATOME_RETENTION_DAYS, MATOME_MAX_PER_SOURCE } from '../config/matome-sources.mjs';

const MAX_FEED_BYTES = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const CATEGORIES = new Set(['game', 'anime', 'chat', 'neta']);
const EXCLUDED_CONTENT = /エロ|アダルト|ポルノ|AV女優|セックス|性交|シコ|オナニ|巨乳|爆乳|パンチラ|下着姿|ヌード|裸体|R-?18|閲覧注意|グロ画像|グロ動画|死体|惨殺|拷問動画|自殺方法|殺害予告|個人情報晒|住所晒/iu;
const PROMOTION = /セール情報|セール|％OFF|%\s*OFF|予約受付|予約開始|発売決定|アフィリエイト|PR記事|スポンサー/u;
const REAL_HARM = /逮捕|容疑者|殺人|殺害|死刑執行|死亡事故|不倫|性加害|性的暴行|強姦|誹謗中傷/u;
const GAME = /ゲーム|ゲーマー|ゲーセン|任天堂|Nintendo|Switch|Steam|PlayStation|ファミコン|スーファミ|プレステ|ソシャゲ|ネトゲ|RPG|FF\d|ドラクエ|ドラゴンクエスト|モンハン|ポケモン|カプコン|スクエニ|ゲームボーイ|ロックマン|アークザラッド|サルゲッチュ|グラビティデイズ|スト[2２]/iu;
const ANIME = /アニメ|漫画|マンガ|コミック|ジャンプ|声優|劇場版|ドラゴンボール|ワンピース|ONE\s*PIECE|NARUTO|ナルト|BLEACH|呪術廻戦|フリーレン|ガンダム|鬼滅|ハンターハンター|HUNTER|チェンソーマン/iu;
const HUMOUR = /爆笑|吹いた|笑える|おもしろ|面白画像|コピペ|大喜利|ボケて|ワロタ|シュール|珍回答|ネタ(?!バレ)|[wｗ]{3,}/iu;

function errorWithCode(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (match, entity) => {
    if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity.toLowerCase()];
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

function cleanText(value, maxLength = 300) {
  return decodeEntities(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
    .replace(/<[^>]*>/gu, '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}

// A bounded XML reader: no DTD/entity expansion, no HTML fallback, no content scraping.
function readXml(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_FEED_BYTES || /<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw errorWithCode('invalid_feed');
  }
  const document = { name: '', children: [], text: '', parts: [] };
  const stack = [document];
  let cursor = 0;
  let nodes = 0;
  const tokens = /<!--[\s\S]*?-->|<\?[^?]*(?:\?(?!>)[^?]*)*\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/gu;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== cursor) throw errorWithCode('invalid_feed');
    const token = match[0];
    cursor += token.length;
    const current = stack.at(-1);
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { current.text += token.slice(9, -3); current.parts.push(token.slice(9, -3)); continue; }
    if (token.startsWith('</')) {
      if (stack.length === 1 || token.slice(2, -1).trim() !== current.name) throw errorWithCode('invalid_feed');
      stack.pop();
    } else if (token.startsWith('<')) {
      const name = token.match(/^<([A-Za-z_][\w:.-]*)(?=[\s/>])/u)?.[1];
      if (!name || ++nodes > 10000 || stack.length > 32) throw errorWithCode('invalid_feed');
      const attributes = Object.create(null);
      let tail = token.slice(name.length + 1, token.endsWith('/>') ? -2 : -1);
      while (tail.trim()) {
        const attribute = tail.match(/^\s+([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/u);
        if (!attribute || Object.hasOwn(attributes, attribute[1]) || attribute[3].includes('<')) throw errorWithCode('invalid_feed');
        attributes[attribute[1]] = decodeEntities(attribute[3]);
        tail = tail.slice(attribute[0].length);
      }
      const node = { name, localName: name.split(':').at(-1).toLowerCase(), attributes, children: [], text: '', parts: [] };
      current.children.push(node);
      current.parts.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else {
      current.text += token;
      current.parts.push(token);
    }
  }
  if (cursor !== xml.length || stack.length !== 1 || document.children.length !== 1 || document.text.trim()) throw errorWithCode('invalid_feed');
  const root = document.children[0];
  if (!['rss', 'rdf', 'feed'].includes(root.localName)) throw errorWithCode('invalid_feed');
  if (root.localName === 'rss' && childrenByName(root, 'channel').length !== 1) throw errorWithCode('invalid_feed');
  return root;
}

function textOf(node) {
  return node ? node.parts.map((part) => typeof part === 'string' ? part : textOf(part)).join('') : '';
}

function childrenByName(node, name) {
  return node.children.filter((child) => child.localName === name);
}

function firstText(node, names) {
  for (const name of names) {
    const text = textOf(childrenByName(node, name)[0]).trim();
    if (text) return text;
  }
  return '';
}

export function canonicalMatomeUrl(value, source) {
  try {
    const url = new URL(decodeEntities(value), source.siteUrl);
    const publisher = new URL(source.siteUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== publisher.hostname || url.port || url.username || url.password) return '';
    if (!/^\/archives\/\d+(?:\.html)?\/?$/u.test(url.pathname)) return '';
    url.protocol = 'https:';
    url.search = '';
    url.hash = '';
    return url.href.replace(/\/$/u, '');
  } catch { return ''; }
}

export function classifyMatomeCategories(title, feedCategories, source) {
  const articleEvidence = `${title} ${feedCategories.join(' ')}`;
  const result = [];
  const game = GAME.test(articleEvidence);
  const anime = ANIME.test(articleEvidence);
  if (game) result.push('game');
  if (anime) result.push('anime');
  if (!result.length && ['game', 'anime'].includes(source.defaultCategory)) result.push(source.defaultCategory);
  if (HUMOUR.test(articleEvidence)) result.push('neta');
  if (!result.length) result.push('chat');
  return [...new Set(result)];
}

function eligibleTitle(title, feedCategories, source) {
  const text = `${title} ${feedCategories.join(' ')}`;
  if (!title || EXCLUDED_CONTENT.test(text) || PROMOTION.test(text) || REAL_HARM.test(text)) return false;
  if (source.allowedCategory && !source.allowedCategory.test(feedCategories.join(' '))) return false;
  return true;
}

function validDate(value, nowMs) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u);
  const rss = text.match(/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(?:GMT|UTC|UT|[+-]\d{4})$/iu);
  if (!iso && !rss) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const [year, month, day, hour, minute, second] = iso
    ? iso.slice(1, 7).map(Number)
    : [Number(rss[3]), months.indexOf(rss[2].toLowerCase()) + 1, Number(rss[1]), ...rss.slice(4, 7).map(Number)];
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || timestamp > nowMs + FUTURE_TOLERANCE_MS || timestamp < nowMs - MATOME_RETENTION_DAYS * DAY_MS) return null;
  return new Date(timestamp).toISOString();
}

export function parseMatomeFeed(xml, source, { now = new Date() } = {}) {
  const root = readXml(xml);
  const nodes = root.localName === 'rss' ? childrenByName(root, 'channel')[0]?.children ?? [] : root.children;
  const entries = nodes.filter((node) => ['item', 'entry'].includes(node.localName));
  const nowMs = new Date(now).getTime();
  const parsed = [];
  const rejectedUrls = new Set();
  for (const entry of entries) {
    const title = cleanText(firstText(entry, ['title']));
    const feedCategories = entry.children.filter((node) => ['category', 'subject'].includes(node.localName))
      .map((node) => cleanText(node.attributes.term || textOf(node), 100)).filter(Boolean);
    const links = childrenByName(entry, 'link');
    const link = links.find((node) => node.attributes.href && (!node.attributes.rel || node.attributes.rel === 'alternate'));
    const url = canonicalMatomeUrl(link?.attributes.href || links.map(textOf).find((value) => value.trim()) || firstText(entry, ['guid']), source);
    const publishedAt = validDate(firstText(entry, ['pubdate', 'published', 'date', 'updated']), nowMs);
    if (!url) continue;
    if (!publishedAt || !eligibleTitle(title, feedCategories, source)) {
      rejectedUrls.add(url);
      continue;
    }
    parsed.push({
      id: `matome-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
      title, url, sourceId: source.id, sourceName: source.name, sourceUrl: source.siteUrl,
      categories: classifyMatomeCategories(title, feedCategories, source),
      // Keep only classification evidence, never feed excerpts, images, or thread bodies.
      feedCategories, publishedAt,
    });
  }
  return { items: parsed.filter((item) => !rejectedUrls.has(item.url)), rejectedUrls: [...rejectedUrls], entryCount: entries.length };
}

async function readBoundedBody(response) {
  if (Number(response.headers?.get('content-length')) > MAX_FEED_BYTES) throw errorWithCode('feed_too_large');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_FEED_BYTES) throw errorWithCode('feed_too_large');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_FEED_BYTES) throw errorWithCode('feed_too_large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}

function diagnostic(error) {
  if (error.httpStatus) return `http_${error.httpStatus}`;
  if (/timeout|abort/iu.test(`${error.name} ${error.message}`)) return 'timeout';
  return error.code || 'network_error';
}

async function fetchSource(source, { fetchImpl, now, timeoutMs, sleepImpl }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(source.feedUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'user-agent': 'INTERNET NEWS/1.0 (+https://drawcia0122.github.io/internet_news/)' },
      });
      if (!response.ok) throw Object.assign(new Error('feed_http_error'), { httpStatus: response.status });
      if (response.url && new URL(response.url).hostname !== new URL(source.feedUrl).hostname) throw errorWithCode('unexpected_redirect');
      return { ...parseMatomeFeed(await readBoundedBody(response), source, { now }), attempts: attempt + 1 };
    } catch (error) {
      const kind = diagnostic(error);
      if (attempt === 0 && (kind === 'timeout' || kind === 'network_error' || /^http_(?:408|429|5\d\d)$/u.test(kind))) {
        await sleepImpl(400);
        continue;
      }
      throw Object.assign(error, { diagnostic: kind });
    }
  }
}

function sanitizePrevious(item, source, nowMs) {
  const url = canonicalMatomeUrl(item?.url, source);
  const publishedAt = validDate(item?.publishedAt, nowMs);
  const title = cleanText(item?.title ?? '');
  const feedCategories = Array.isArray(item?.feedCategories) ? item.feedCategories.filter((value) => typeof value === 'string').map((value) => cleanText(value, 100)) : [];
  if (!url || !publishedAt || !eligibleTitle(title, feedCategories, source)) return null;
  const capturedAt = [item.fetchedAt, item.firstSeenAt].find((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= nowMs);
  if (!capturedAt) return null;
  return {
    id: `matome-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
    title, url, sourceId: source.id, sourceName: source.name, sourceUrl: source.siteUrl,
    categories: classifyMatomeCategories(title, feedCategories, source).filter((category) => CATEGORIES.has(category)),
    feedCategories, publishedAt,
    firstSeenAt: validDate(item.firstSeenAt, nowMs) || new Date(capturedAt).toISOString(),
    fetchedAt: new Date(capturedAt).toISOString(), cached: false,
  };
}

export async function collectMatomeThreads({
  sources = MATOME_SOURCES, previous = {}, now = new Date(), fetchImpl = fetch,
  timeoutMs = 15000, sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const checkedAt = new Date(now).toISOString();
  const nowMs = Date.parse(checkedAt);
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) previous = {};
  const items = [];
  const reports = [];
  let successes = 0;
  // Only three small publisher feeds: serial requests avoid bursts and bound load.
  for (const source of sources) {
    const previousSource = (Array.isArray(previous.sources) ? previous.sources : []).find((entry) => entry?.id === source.id);
    const retained = (Array.isArray(previous.items) ? previous.items : [])
      .filter((item) => item?.sourceId === source.id).map((item) => sanitizePrevious(item, source, nowMs)).filter(Boolean);
    const merged = new Map(retained.map((item) => [item.url, item]));
    const priorSuccess = typeof previousSource?.lastSuccessAt === 'string' ? Date.parse(previousSource.lastSuccessAt) : NaN;
    const report = { id: source.id, name: source.name, siteUrl: source.siteUrl, feedUrl: source.feedUrl, status: 'ok', lastSuccessAt: Number.isFinite(priorSuccess) && priorSuccess <= nowMs ? new Date(priorSuccess).toISOString() : null, error: null, itemCount: 0, retainedCount: 0 };
    try {
      const result = await fetchSource(source, { fetchImpl, now, timeoutMs, sleepImpl });
      successes++;
      report.lastSuccessAt = checkedAt;
      report.itemCount = result.items.length;
      report.entryCount = result.entryCount;
      // An entry absent from a rolling feed may be retained. An explicitly rejected
      // current entry must not survive through its older, apparently benign title.
      for (const url of result.rejectedUrls) merged.delete(url);
      for (const item of result.items) {
        const old = merged.get(item.url);
        merged.set(item.url, { ...item, firstSeenAt: old?.firstSeenAt ?? checkedAt, fetchedAt: checkedAt, cached: false });
      }
    } catch (error) {
      report.status = 'error';
      report.error = error.diagnostic || diagnostic(error);
      for (const item of merged.values()) item.cached = true;
    }
    const selected = [...merged.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.url.localeCompare(b.url)).slice(0, MATOME_MAX_PER_SOURCE);
    report.retainedCount = selected.length;
    items.push(...selected);
    reports.push(report);
  }
  const priorGenerated = typeof previous.generatedAt === 'string' ? Date.parse(previous.generatedAt) : NaN;
  const generatedAt = successes ? checkedAt : (Number.isFinite(priorGenerated) && priorGenerated <= nowMs ? new Date(priorGenerated).toISOString() : null);
  return {
    schemaVersion: 1, generatedAt, checkedAt,
    status: successes === sources.length ? 'ok' : successes ? 'partial' : 'unavailable',
    sources: reports,
    items: [...new Map(items.map((item) => [item.url, item])).values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.url.localeCompare(b.url)),
  };
}
