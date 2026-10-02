// Small, source-specific adapters. Never infer an event date from its publication date.
export const PARCO_ART_SOURCE = { name: "PARCO ART", url: "https://art.parco.jp/" };
export const PARCO_CAFE_SOURCE = { name: "PARCO CAFE", url: "https://cafe.parco.jp/" };
export const MIRAIKAN_SOURCE = { name: "日本科学未来館", url: "https://www.miraikan.jst.go.jp/events/" };

export function plainText(value) {
  return String(value ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, name) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " })[name])
    .replace(/\s+/g, " ").trim();
}

function safeUrl(value, base, sameOrigin = false) {
  try {
    const url = new URL(plainText(value), base);
    if (!value || !["https:", "http:"].includes(url.protocol)) return "";
    if (sameOrigin && url.origin !== new URL(base).origin) return "";
    return url.href;
  } catch { return ""; }
}

function field(html, className, tag = "p") {
  return html.match(new RegExp(`<${tag}\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
}

export function validEventDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isoDate(year, month, day) {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validEventDate(value) ? value : null;
}

// The start year must be printed on the card. A missing end year may cross New Year.
export function parseExplicitEventRange(value) {
  const text = plainText(value).normalize("NFKC").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
  const match = text.match(/^(\d{4})[./年](\d{1,2})[./月](\d{1,2})日?[～〜~－–—-](?:(\d{4})[./年])?(\d{1,2})[./月](\d{1,2})日?$/);
  if (!match) return null;
  const [, sy, sm, sd, ey, em, ed] = match;
  const endYear = ey || (Number(em) < Number(sm) ? Number(sy) + 1 : sy);
  const startDate = isoDate(sy, sm, sd);
  const endDate = isoDate(endYear, em, ed);
  return startDate && endDate && startDate <= endDate ? { startDate, endDate } : null;
}

function parcoLocation(venue) {
  // Venue names are supplied by the official cards, not inferred from an event brand.
  // Named Tokyo venues verified at art.parco.jp/access/ and cafe.parco.jp/access/.
  if (/^PARCO MUSEUM TOKYO$|^GALLERY X BY PARCO$|渋谷PARCO/i.test(venue)) return "東京都渋谷区";
  if (/^PARCO FACTORY\s*\(IKEBUKURO\)$|池袋PARCO/i.test(venue)) return "東京都豊島区";
  if (/TOKYO/i.test(venue)) return "東京都";
  if (/NAGOYA|名古屋/i.test(venue)) return "愛知県名古屋市";
  if (/SHINSAIBASHI|心斎橋/i.test(venue)) return "大阪府大阪市";
  if (/SHIZUOKA|静岡/i.test(venue)) return "静岡県静岡市";
  if (/HIROSHIMA|広島/i.test(venue)) return "広島県広島市";
  if (/SENDAI|仙台/i.test(venue)) return "宮城県仙台市";
  if (/SAPPORO|札幌/i.test(venue)) return "北海道札幌市";
  if (/FUKUOKA|福岡/i.test(venue)) return "福岡県福岡市";
  return "";
}

function interestTags(title) {
  const tags = [];
  if (/ポケモン|ポケットモンスター|Pok[eé]mon|ピカチュウ/i.test(title)) tags.push("pokemon", "game");
  if (/ゲーム|SONIC|ソニック|KOJIMA PRODUCTIONS|PARCO GAMES|Nintendo|ペルソナ|PERSONA|ときめきメモリアル/i.test(title)) tags.push("game");
  if (/アニメ|漫画|呪術廻戦|EVANGELION|エヴァンゲリオン|BLEACH|ちいかわ|ヒーローアカデミア|野崎くん|WIND BREAKER|しゅごキャラ|パンダコパンダ/i.test(title)) tags.push("anime");
  return [...new Set(tags)];
}

function officialItem({ title, period, venue, location, detailUrl, thumbnailUrl, source, category, tags, description }) {
  if (!title || !period || !venue || !location || !detailUrl) return null;
  return {
    title, ...period, venue, location, category, detailUrl,
    officialUrl: detailUrl, sourceName: source.name, sourceUrl: source.url, thumbnailUrl,
    description: description || `${venue}で開催される${category}です。開催日程・内容・入場条件は公式ページをご確認ください。`,
    tags: [...new Set([...tags, ...interestTags(title), ...(location.startsWith("東京都") ? ["tokyo"] : [])])],
    recommendationReasons: [category, ...(location.startsWith("東京都") ? ["東京開催"] : []), "公式開催情報"],
  };
}

export function extractParcoArtItems(html) {
  if (!/slide__content__time/.test(html)) throw new Error("PARCO ART event-card markup not found");
  const items = [];
  for (const [, href, body] of String(html).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!/slide__content__time/.test(body)) continue;
    const detailUrl = safeUrl(href, PARCO_ART_SOURCE.url, true);
    if (!detailUrl || !/\/detail\/\?id=\d+$/.test(detailUrl)) continue;
    const title = plainText(field(body, "slide__content__intro"));
    const period = parseExplicitEventRange(field(body, "slide__content__time"));
    const venue = plainText(field(body, "slide__content__place"));
    const location = parcoLocation(venue);
    // "その他" does not establish an actual place; a news/sales notice is not an exhibition.
    if (!location || /通販|オンライン販売|販売のお知らせ|中止|開催中止/.test(title)) continue;
    const popup = /POP[ -]?UP|ポップアップ|STRAND STORE|期間限定ショップ/i.test(title);
    const performance = /ART NIGHT|上映|ライブ|トークセッション/i.test(title);
    const category = popup ? "ポップアップ" : performance ? "アート・カルチャーイベント" : "展覧会・展示";
    const item = officialItem({ title, period, venue, location, detailUrl,
      thumbnailUrl: safeUrl(body.match(/<img\b[^>]*src="([^"]+)"/i)?.[1], PARCO_ART_SOURCE.url),
      source: PARCO_ART_SOURCE, category, tags: [popup ? "popup" : performance ? "art" : "exhibition"],
    });
    if (item) items.push(item);
  }
  return [...new Map(items.map((item) => [item.detailUrl, item])).values()];
}

export function extractParcoCafeItems(html) {
  if (!/area__container/.test(html)) throw new Error("PARCO CAFE area markup not found");
  const items = [];
  for (const [, section] of String(html).matchAll(/<section\b[^>]*class="area__container[^\"]*"[^>]*>([\s\S]*?)<\/section>/gi)) {
    const venue = plainText(field(section, "area__ttl", "h2"));
    const location = parcoLocation(venue);
    for (const [, href, body] of section.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const detailUrl = safeUrl(href, PARCO_CAFE_SOURCE.url, true);
      if (!detailUrl || !new URL(detailUrl).pathname.startsWith("/event/")) continue;
      const date = body.match(/<div class="date">([\s\S]*?)<\/div>/i)?.[1] ?? "";
      const period = parseExplicitEventRange(plainText(date).replace(/^開催日程\s*/, ""));
      // Long-running restaurants and undated openings are intentionally not limited events.
      const title = plainText(field(body, "ttl", "h3"));
      const item = officialItem({ title, period, venue, location, detailUrl,
        thumbnailUrl: safeUrl(body.match(/<img\b[^>]*src="([^"]+)"/i)?.[1], PARCO_CAFE_SOURCE.url),
        source: PARCO_CAFE_SOURCE, category: "コラボカフェ", tags: ["collab-cafe", "collaboration"],
      });
      if (item) items.push(item);
    }
  }
  return [...new Map(items.map((item) => [item.detailUrl, item])).values()];
}

export function japanToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isEventInCollectionWindow(item, { today = japanToday(), upcomingDays = 75, staleStartDays = 180 } = {}) {
  if (/オンライン/i.test(`${item.location ?? ""} ${item.venue ?? ""}`)) return false;
  const start = validEventDate(item.startDate) ? item.startDate : null;
  const end = validEventDate(item.endDate) ? item.endDate : start;
  const shift = (days) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  if (end && end < today) return false;
  if (start && (start < shift(-staleStartDays) || start > shift(upcomingDays))) return false;
  return true;
}

export function selectMiraikanEntries(payload, today = japanToday(), windowDays = 75) {
  if (!Array.isArray(payload)) throw new Error("Miraikan event JSON must be an array");
  if (payload.some((entry) => !entry?.title || !entry?.permalink || !validEventDate(entry.start) || !validEventDate(entry.end))) {
    throw new Error("Miraikan event JSON record shape changed");
  }
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + windowDays);
  const endLimit = limit.toISOString().slice(0, 10);
  return payload.filter((entry) => {
    const url = safeUrl(entry?.permalink, MIRAIKAN_SOURCE.url, true);
    // Do not silently label external partner events as being held at Miraikan.
    return url && /\/events\/\d+\.html$/.test(url)
      && ![true, 1, "1"].includes(entry.isOnline)
      && validEventDate(entry.start) && validEventDate(entry.end)
      && entry.start <= entry.end && entry.end >= today && entry.start <= endLimit;
  }).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 12);
}

export function buildMiraikanItem(entry, detailHtml, today = japanToday()) {
  const title = plainText(entry.title);
  const heading = plainText(detailHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  if (heading !== title) throw new Error(`Miraikan detail identity mismatch: ${entry.permalink}`);
  const venueField = detailHtml.match(/<dt\b[^>]*>\s*開催場所\s*<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/i);
  if (!venueField) throw new Error(`Miraikan venue markup not found: ${entry.permalink}`);
  const venue = plainText(venueField[1]);
  if (!venue || /オンライン|YouTube|ニコニコ|Zoom/i.test(venue)) return null;
  // Address on the site footer is not evidence for an off-site event's location.
  const location = venue.match(/((?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)[^\s（）()、,]*)/)?.[1]
    || (/日本科学未来館/.test(venue) ? "東京都江東区" : "");
  if (!location) return null;
  let period = { startDate: entry.start, endDate: entry.end };
  if (Array.isArray(entry.anotherRange) && entry.anotherRange.length) {
    const nextDate = entry.anotherRange.filter(validEventDate).filter((date) => date >= today).sort()[0];
    if (!nextDate) return null;
    // A sparse schedule is represented by its next session, never a continuous run.
    period = { startDate: nextDate, endDate: nextDate };
  }
  const requireBooking = [true, 1, "1"].includes(entry.apply?.isRequire);
  const dateNote = plainText(entry.anotherDate);
  const item = officialItem({ title, period, venue, location,
    detailUrl: safeUrl(entry.permalink, MIRAIKAN_SOURCE.url, true),
    thumbnailUrl: safeUrl(entry.imagePc, MIRAIKAN_SOURCE.url), source: MIRAIKAN_SOURCE,
    category: "体験型 / 科学・ワークショップ", tags: ["experience", "science", ...(requireBooking ? ["reservation-required"] : []), ...(location.startsWith("埼玉県") ? ["kanto"] : [])],
    description: [plainText(entry.subtitle), dateNote ? `開催日程：${dateNote}。` : "", requireBooking ? "事前申込が必要です。" : "", "対象・参加条件・各回の申込状況は公式ページでご確認ください。"].filter(Boolean).join(" "),
  });  if (!item) return null;
  const fee = detailHtml.match(/<dt\b[^>]*>\s*参加費\s*<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/i);
  const feeText = fee ? plainText(fee[1]) : "";
  const attendance = { sourceUrl: item.officialUrl };
  if (feeText && feeText.length <= 300) {
    attendance.feeText = feeText;
    // A free registration, child ticket or admission requiring a separate fee is not free entry.
    attendance.isFree = /^(無料|0円)$/.test(feeText.normalize("NFKC"));
  }
  if (requireBooking) {
    attendance.reservationRequired = true;
    attendance.reservationClosed = [true, 1, "1"].includes(entry.apply?.isClosed);
    const end = String(entry.apply?.end ?? "");
    // A feed-level deadline may cover a later session. Do not attach it to the next one.
    const hasMultipleSessions = Array.isArray(entry.anotherRange) && entry.anotherRange.length > 1;
    if (!hasMultipleSessions && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(end)
      && validEventDate(end.slice(0, 10)) && Number.isFinite(Date.parse(end)) && end.slice(0, 10) <= period.endDate) attendance.deadlineAt = end;
  }
  if (Object.keys(attendance).length > 1) item.attendance = attendance;
  return item;
}

// Preserve only the failing source's snapshot; a success replaces that source, so removed events expire.
export async function collectSourcesWithFallback(sources, previousItems, { normalize = (item) => item, checkedAt = new Date().toISOString() } = {}) {
  const settled = await Promise.allSettled(sources.map(async (source) => {
    const collected = await source.collect();
    if (!Array.isArray(collected)) throw new Error("Source did not return an event array");
    const items = collected.map(normalize).filter(Boolean);
    if (!items.length && !source.allowEmpty) throw new Error("Source returned no recognizable event items");
    return items.map((item) => ({ ...item, sourceCheckedAt: checkedAt }));
  }));
  const items = [], diagnostics = [];
  for (const [index, result] of settled.entries()) {
    const name = sources[index].name;
    if (result.status === "fulfilled") {
      items.push(...result.value);
      diagnostics.push({ name, status: "ok", collected: result.value.length });
    } else {
      const preserved = previousItems.filter((item) => item.sourceName === name).map(normalize).filter(Boolean);
      items.push(...preserved);
      diagnostics.push({ name, status: "failed", preserved: preserved.length, error: String(result.reason?.message ?? result.reason) });
    }
  }
  return { items, diagnostics, allFailed: diagnostics.every((source) => source.status === "failed") };
}

// Round robin within score-ordered source buckets prevents one provider taking the global cutoff.
export function isPreferredEventRegion(item) {
  return /東京|埼玉|\btokyo\b|\bsaitama\b/i.test(String(item?.location ?? ""));
}

export function balanceEventsBySource(sortedItems, maxItems = 64, maxPerSource = 20) {
  const buckets = new Map();
  // Stable region-first ordering preserves scores within each region and the
  // round-robin source quota. Nationwide events remain eligible for every source.
  const regionOrdered = [...sortedItems].sort((left, right) => Number(isPreferredEventRegion(right)) - Number(isPreferredEventRegion(left)));
  for (const item of regionOrdered) {
    const key = item.sourceName || "unknown";
    if (!buckets.has(key)) buckets.set(key, []);
    if (buckets.get(key).length < maxPerSource) buckets.get(key).push(item);
  }
  const result = [];
  for (let round = 0; round < maxPerSource && result.length < maxItems; round++) {
    for (const bucket of buckets.values()) {
      if (bucket[round]) result.push(bucket[round]);
      if (result.length === maxItems) break;
    }
  }
  return result;
}

export function isPureSalesCampaign(title) {
  return /駐車場|駐車料金|(?:チケット|年間パス|半年パス).*(?:割引|キャンペーン)|(?:割引|お得な|おトクな).*チケット|円引き.*パック.*販売|セール|クーポン|ポイント還元|通販|オンライン販売|お買い得|プレゼントキャンペーン/i.test(String(title ?? ""));
}

// An event page can have several venue/ticket-code rows. Choose an intact row,
// never a longest venue, prefecture, dates, or tags from different locations.
// Exact shop names/addresses verified at https://realdgame.jp/shop/ on 2026-10-02.
// This is a venue directory, never an event-title-to-location mapping.
const SCRAP_VENUE_PREFECTURES = Object.freeze({
  "リアル脱出ゲーム札幌店": "北海道",
  "リアル脱出ゲーム仙台店": "宮城県",
  "東京ミステリーサーカス": "東京都",
  "リアル脱出ゲーム池袋店": "東京都",
  "リアル脱出ゲーム渋谷店": "東京都",
  "リアル脱出ゲーム原宿店": "東京都",
  "リアル脱出ゲーム吉祥寺店": "東京都",
  "リアル脱出ゲームCROSSING 浅草店": "東京都",
  "リアル脱出ゲーム CROSSING 浅草店": "東京都", // Official API spacing variant of the same named shop.
  "リアル脱出ゲーム横浜店": "神奈川県",
  "リアル脱出ゲーム名古屋店": "愛知県",
  "リアル脱出ゲーム京都店": "京都府",
  "リアル脱出ゲーム大阪心斎橋店": "大阪府",
  "リアル脱出ゲーム大阪恵美須町店": "大阪府",
  "リアル脱出ゲーム大阪南堀江店": "大阪府",
  "リアル脱出ゲーム岡山店": "岡山県",
  "リアル脱出ゲーム福岡店": "福岡県",
});

function verifiedScrapPrefecture(venue) {
  return Object.hasOwn(SCRAP_VENUE_PREFECTURES, venue) ? SCRAP_VENUE_PREFECTURES[venue] : null;
}

export function preferAtomicScrapItem(current, incoming) {
  const scrap = [current, incoming].filter((item) => item?.sourceName === "SCRAP / リアル脱出ゲーム");
  return scrap.find((item) => item.sourceEventId) || scrap[0] || null;
}

export function normalizeScrapEventGeography(item) {
  if (item?.sourceName !== "SCRAP / リアル脱出ゲーム") return item;
  const venue = plainText(item.venue);
  const verified = verifiedScrapPrefecture(venue);
  // Pre-fix snapshots lack an atomic source identity and may contain cross-venue merges.
  // Unknown legacy venues must not inherit Tokyo from a title, old tag, or broad area.
  const location = verified || (item.sourceEventId ? item.location : "開催場所未確認");
  const regionTags = location === "東京都" ? ["tokyo"] : location === "埼玉県" ? ["saitama", "kanto"] : /^(神奈川|千葉)県$/.test(location) ? ["kanto"] : [];
  const tags = [...new Set([...(item.tags ?? []).filter((tag) => !["tokyo", "saitama", "kanto"].includes(String(tag).toLowerCase().trim())), ...regionTags])];
  const reasons = (item.recommendationReasons ?? []).map(plainText).filter((reason) => !["東京開催", "埼玉開催", "関東で行きやすい"].includes(reason));
  if (location === "東京都") reasons.push("東京開催");
  else if (location === "埼玉県") reasons.push("埼玉開催");
  else if (/^(神奈川|千葉)県$/.test(location)) reasons.push("関東で行きやすい");
  const description = location !== item.location || !item.sourceEventId
    ? `${location}の${venue}で開催される${plainText(item.title)}。開催日程・内容は公式ページをご確認ください。`
    : item.description;
  return { ...item, location, tags, recommendationReasons: [...new Set(reasons)], description };
}

export function selectScrapVenueRecords(events, { today = japanToday(), upcomingDays = 75 } = {}) {
  if (!Array.isArray(events)) throw new Error("SCRAP events must be an array");
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + upcomingDays);
  const limitDate = limit.toISOString().slice(0, 10);
  const groups = new Map();
  const uniqueOccurrences = new Map();
  for (const entry of events) {
    if (!entry?.event_id) continue;
    // The API repeats some identical occurrences as a no-URL language variant.
    // Prefer the complete source row, without merging its attributes.
    const identity = JSON.stringify([entry.event_id, entry.place_name, entry.starts_on, entry.ends_on]);
    const previous = uniqueOccurrences.get(identity);
    if (!previous || (!safeUrl(previous.event_url, "https://realdgame.jp/") && safeUrl(entry.event_url, "https://realdgame.jp/"))) {
      uniqueOccurrences.set(identity, entry);
    }
  }
  for (const rawEntry of uniqueOccurrences.values()) {
    const knownPref = verifiedScrapPrefecture(plainText(rawEntry?.place_name));
    const entry = knownPref ? { ...rawEntry, place_pref: knownPref } : rawEntry;
    if (!entry?.event_id || !entry.event_name || !entry.place_name) continue;
    // Exact structured prefecture is evidence; event titles and broad area labels are not.
    if (!/^(?:東京都|北海道|大阪府|京都府|.{2,3}県)$/.test(String(entry.place_pref ?? ""))) continue;
    if (!validEventDate(entry.starts_on) || !validEventDate(entry.ends_on)) continue;
    if (entry.starts_on > entry.ends_on || entry.ends_on < today || entry.starts_on > limitDate) continue;
    const url = safeUrl(entry.event_url, "https://realdgame.jp/");
    // No-URL rows keep their source identity instead of being combined by a stripped title.
    const key = url ? `url:${url}` : `id:${entry.event_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const regionRank = (entry) => ({ 東京都: 0, 埼玉県: 1, 神奈川県: 2, 千葉県: 3 })[entry.place_pref] ?? 10;
  const compare = (left, right) => {
    const region = regionRank(left) - regionRank(right);
    if (region) return region;
    const leftFuture = left.starts_on > today, rightFuture = right.starts_on > today;
    if (leftFuture !== rightFuture) return Number(leftFuture) - Number(rightFuture);
    const start = leftFuture ? left.starts_on.localeCompare(right.starts_on) : right.starts_on.localeCompare(left.starts_on);
    return start || left.place_name.localeCompare(right.place_name, "ja") || String(left.event_id).localeCompare(String(right.event_id));
  };
  return [...groups.values()].map((rows) => [...rows].sort(compare)[0]);
}
