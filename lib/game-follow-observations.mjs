// Optional evidence for browser-local follows. No account, notification service,
// title-based news joins, price state, or additional game-discovery requests.
// Steam documents the public, unauthenticated per-app news feed here:
// https://partner.steamgames.com/doc/webapi/ISteamNews#GetNewsForApp
// Live verified 2026-10-06: newsitem.gid is NOT an announcement ID. Its official
// externalpost URL redirects to /ogg/{appid}/announcements/detail/{announcementId}.
// Never manufacture a /news/app/{appid}/view/{newsitem.gid} link.
export const GAME_FOLLOW_FRESH_MS = 6 * 60 * 60 * 1000;
export const GAME_FOLLOW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NEWS_COUNT = 5;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_TIMEOUT_MS = 10000;
const NEWS_FEED = 'steam_community_announcements';

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(code) { throw Object.assign(new Error(code), { code }); }
function plain(value) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/gu, '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 200) : '';
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return NaN;
  const date = Date.parse(value);
  return Number.isFinite(date) && date >= 0 && new Date(date).toISOString() === value ? date : NaN;
}
function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash ? url : null;
  } catch { return null; }
}
function appId(value) { return Number.isInteger(value) && value > 0 && value <= 0xffffffff; }
function appdetailsUrl(id) { return `https://store.steampowered.com/api/appdetails?appids=${id}&cc=jp&l=japanese`; }
function validItem(item) {
  return record(item) && appId(item.appId) && item.id === `steam:${item.appId}` && item.store === 'Steam'
    && item.country === 'JP' && item.currency === 'JPY' && item.edition === 'base-game'
    && typeof item.title === 'string' && item.title.trim().length > 0
    && item.priceSource?.kind === 'steam-appdetails' && item.priceSource.url === appdetailsUrl(item.appId)
    && Number.isFinite(timestamp(item.checkedAt));
}
function base(item, kind) {
  return { identity: { kind: 'steam', appId: item.appId }, kind, checkedAt: item.checkedAt,
    freshUntil: new Date(timestamp(item.checkedAt) + GAME_FOLLOW_FRESH_MS).toISOString() };
}
function releaseDay(value) {
  if (typeof value !== 'string') return null;
  // Localized seasons, quarters, years, numeric slash dates and "coming soon"
  // are deliberately unknown. Only explicit, unambiguous calendar days count.
  const match = value.trim().match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/u)
    || value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return null;
  const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const date = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(date) && date >= 0 && new Date(date).toISOString().slice(0, 10) === day ? day : null;
}

/** Reuse the current exact per-app response; no additional release-date fetch. */
export function parseSteamReleaseObservation(payload, item) {
  if (!validItem(item)) return null;
  const entry = payload?.[String(item.appId)];
  const data = entry?.data;
  if (entry?.success !== true || data?.steam_appid !== item.appId || data.type !== 'game'
    || typeof data.name !== 'string' || data.name.trim() !== item.title.trim()
    || typeof data.release_date?.coming_soon !== 'boolean') return null;
  const date = releaseDay(data.release_date.date);
  const status = data.release_date.coming_soon ? 'scheduled' : 'released';
  if (!date || (status === 'released' && date > new Date(timestamp(item.checkedAt) + 9 * 3600000).toISOString().slice(0, 10))) return null;
  return { ...base(item, 'release'), date, status,
    source: { kind: 'steam-appdetails', url: appdetailsUrl(item.appId), verified: true } };
}

export function steamUpdateSourceUrl(id) {
  if (!appId(id)) return null;
  return `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${id}&count=${NEWS_COUNT}&maxlength=300&feeds=${NEWS_FEED}&format=json`;
}
function announcementUrl(value, id) {
  const url = httpsUrl(value);
  if (!url || url.search) return null;
  const community = url.hostname === 'steamcommunity.com'
    && new RegExp(`^/(?:ogg|games)/${id}/announcements/detail/([1-9][0-9]{0,19})/?$`, 'u').exec(url.pathname);
  const store = url.hostname === 'store.steampowered.com'
    && new RegExp(`^/news/app/${id}/view/([1-9][0-9]{0,19})/?$`, 'u').exec(url.pathname);
  const match = community || store;
  return match ? { url: url.href, id: match[1] } : null;
}
function externalpostUrl(value, gid) {
  const url = httpsUrl(value);
  return url && !url.search && ['steamstore-a.akamaihd.net', 'store.steampowered.com'].includes(url.hostname)
    && url.pathname === `/news/externalpost/${NEWS_FEED}/${gid}` ? url.href : null;
}
function latestPatch(payload, item) {
  if (!validItem(item) || payload?.appnews?.appid !== item.appId || !Array.isArray(payload.appnews.newsitems)) return null;
  const checked = timestamp(item.checkedAt);
  return payload.appnews.newsitems.slice(0, NEWS_COUNT).filter((entry) => {
    if (!record(entry) || entry.appid !== item.appId || entry.feedname !== NEWS_FEED || entry.feed_type !== 1
      || typeof entry.gid !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(entry.gid)
      || !Array.isArray(entry.tags) || !entry.tags.includes('patchnotes') || !plain(entry.title)
      || !Number.isSafeInteger(entry.date) || entry.date <= 0 || entry.date * 1000 > checked) return false;
    return Boolean(announcementUrl(entry.url, item.appId) || externalpostUrl(entry.url, entry.gid));
  }).sort((left, right) => right.date - left.date || left.gid.localeCompare(right.gid))[0] || null;
}

/** announcementUrl must be the verified one-hop Location, not a guessed ID. */
export function parseSteamUpdateObservations(payload, item, { announcementUrl: resolvedUrl } = {}) {
  const entry = latestPatch(payload, item);
  if (!entry) return [];
  const source = announcementUrl(entry.url, item.appId) || announcementUrl(resolvedUrl, item.appId);
  if (!source) return [];
  return [{ ...base(item, 'update'), eventId: `steam-announcement-${source.id}`,
    date: new Date(entry.date * 1000).toISOString(), title: plain(entry.title), eventType: 'release-notes',
    source: { kind: 'official-game', gameKey: item.id, url: source.url, verified: true } }];
}

/** Sanitize cached/fallback evidence without moving either event or check dates. */
export function retainedSteamFollowObservations(observations, item, { now = new Date() } = {}) {
  if (!validItem(item) || !Number.isFinite(now.getTime())) return [];
  const seen = new Set();
  const result = [];
  for (const entry of (Array.isArray(observations) ? observations : []).slice(0, 8)) {
    const checked = timestamp(entry?.checkedAt);
    const age = now.getTime() - checked;
    if (!record(entry) || !['release', 'update'].includes(entry.kind) || seen.has(entry.kind)
      || entry.identity?.kind !== 'steam' || entry.identity.appId !== item.appId || !Number.isFinite(age)
      || age < 0 || age >= GAME_FOLLOW_MAX_AGE_MS || checked > timestamp(item.checkedAt)
      || timestamp(entry.freshUntil) !== checked + GAME_FOLLOW_FRESH_MS || entry.source?.verified !== true) continue;
    const common = { ...base({ ...item, checkedAt: entry.checkedAt }, entry.kind) };
    if (entry.kind === 'release') {
      const date = releaseDay(entry.date);
      if (!date || !['scheduled', 'released'].includes(entry.status) || (entry.status === 'released' && date > new Date(checked + 9 * 3600000).toISOString().slice(0, 10))
        || entry.source.kind !== 'steam-appdetails' || entry.source.url !== appdetailsUrl(item.appId)) continue;
      result.push({ ...common, date, status: entry.status,
        source: { kind: 'steam-appdetails', url: entry.source.url, verified: true } });
    } else {
      const source = announcementUrl(entry.source.url, item.appId);
      const date = timestamp(entry.date);
      if (!source || entry.source.kind !== 'official-game' || entry.source.gameKey !== item.id
        || entry.eventId !== `steam-announcement-${source.id}` || entry.eventType !== 'release-notes'
        || !Number.isFinite(date) || date > checked || !plain(entry.title)) continue;
      result.push({ ...common, date: entry.date, eventId: entry.eventId, title: plain(entry.title), eventType: 'release-notes',
        source: { kind: 'official-game', gameKey: item.id, url: source.url, verified: true } });
    }
    seen.add(entry.kind);
  }
  return result;
}

function requestOptions(signal, timeoutMs, extra = {}) {
  const timeout = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.floor(timeoutMs))) : MAX_TIMEOUT_MS;
  return { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    redirect: 'error', headers: { accept: 'application/json', 'user-agent': 'InternetNewsGameFollows/1.0 (official per-app release notes)' }, ...extra };
}
function sameResponseUrl(response, requested) {
  if (response.url && response.url !== requested) fail('unexpected_redirect');
}
async function fetchNews(fetchImpl, url, { signal, timeoutMs }) {
  const response = await fetchImpl(url, requestOptions(signal, timeoutMs));
  if (!response.ok) fail(`http_${response.status}`);
  sameResponseUrl(response, url);
  if (Number(response.headers?.get?.('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel?.().catch(() => {});
    fail('response_too_large');
  }
  let raw;
  if (!response.body?.getReader) {
    raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) fail('response_too_large');
  } else {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) fail('response_too_large');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  return JSON.parse(raw);
}
async function resolveAnnouncement(fetchImpl, entry, item, { signal, timeoutMs }) {
  const direct = announcementUrl(entry.url, item.appId);
  if (direct) return direct.url;
  const url = externalpostUrl(entry.url, entry.gid);
  if (!url) fail('invalid_announcement_source');
  // HEAD fetches no page content. Inspect one redirect without following it.
  // Unknown hosts, wrong-app redirects and redirect chains stay unavailable.
  const response = await fetchImpl(url, requestOptions(signal, timeoutMs, { method: 'HEAD', redirect: 'manual' }));
  sameResponseUrl(response, url);
  if (![301, 302, 303, 307, 308].includes(response.status)) fail('announcement_redirect_missing');
  const target = announcementUrl(response.headers?.get?.('location'), item.appId);
  if (!target) fail('announcement_identity_mismatch');
  return target.url;
}

/**
 * Call inside the price collector's existing per-app concurrency and total
 * budget, after price validation. Max 1 news GET + 1 official redirect HEAD.
 * An optional-source failure never throws or invalidates a verified price.
 * No Steam account/API key is needed; untagged announcements are not patches.
 */
export async function collectSteamFollowObservations({ appdetails, item, fetchImpl = fetch, signal, timeoutMs = MAX_TIMEOUT_MS,
  previousObservations = [], now = new Date() } = {}) {
  if (!validItem(item) || !Number.isFinite(now.getTime()) || timestamp(item.checkedAt) > now.getTime()) {
    return { observations: [], updateStatus: 'unknown' };
  }
  const release = parseSteamReleaseObservation(appdetails, item);
  const observations = release ? [release] : [];
  try {
    if (signal?.aborted) fail('budget_expired');
    const payload = await fetchNews(fetchImpl, steamUpdateSourceUrl(item.appId), { signal, timeoutMs });
    if (payload?.appnews?.appid !== item.appId || !Array.isArray(payload.appnews.newsitems)) fail('news_identity_or_shape');
    const entry = latestPatch(payload, item);
    if (!entry) return { observations, updateStatus: 'none' };
    const url = await resolveAnnouncement(fetchImpl, entry, item, { signal, timeoutMs });
    observations.push(...parseSteamUpdateObservations(payload, item, { announcementUrl: url }));
    return { observations, updateStatus: observations.some((entry) => entry.kind === 'update') ? 'verified' : 'unknown' };
  } catch {
    observations.push(...retainedSteamFollowObservations(previousObservations, item, { now }).filter((entry) => entry.kind === 'update'));
    return { observations, updateStatus: 'unavailable' };
  }
}
