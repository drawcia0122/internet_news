import { mkdir, readFile, writeFile } from "node:fs/promises";

import { EVENT_SOURCE_CANDIDATES } from "../config/event-sources.mjs";

const EVENTS_PATH = "data/events.json";
const MAX_EVENT_ITEMS = 64;
const MAX_PER_SOURCE = 20;
const AUTO_MANAGED_SOURCES = new Set([
  "SCRAP / リアル脱出ゲーム",
  "アニメイト Gratte",
  "アニメイト オンリーショップ",
  "PokéPark KANTO",
  "ポケットモンスターオフィシャルサイト",
  "よみうりランド",
]);
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const UPCOMING_WINDOW_DAYS = 75;
const STALE_START_WINDOW_DAYS = 180;
const fetchedAt = new Date().toISOString();
const currentPayload = await readJson(EVENTS_PATH, { items: [] });
const manualItems = (Array.isArray(currentPayload?.items) ? currentPayload.items : [])
  .filter((item) => !AUTO_MANAGED_SOURCES.has(String(item?.sourceName ?? "")));
const autoItems = await collectAutoEventItems();
const mergedItems = mergeEventItems(autoItems, manualItems);

const nextPayload = {
  generatedAt: fetchedAt,
  sourceCandidates: EVENT_SOURCE_CANDIDATES.flatMap((source) =>
    source.urls.map((url) => ({
      name: source.name,
      category: source.category,
      priority: source.priority,
      url,
    }))
  ),
  items: limitEventsPerSource(
    mergedItems
      .filter(isEventRelevantWindow)
      .sort((left, right) => collectionEventScore(right) - collectionEventScore(left) || compareEventFreshness(left, right)),
    MAX_PER_SOURCE,
  ).slice(0, MAX_EVENT_ITEMS),
};

await mkdir("data", { recursive: true });
await writeFile(EVENTS_PATH, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf8");

console.log(`Saved ${nextPayload.items.length} event item(s).`);
console.log(`Collected ${autoItems.length} auto event item(s).`);
console.log(`Registered ${nextPayload.sourceCandidates.length} event source candidate(s).`);

async function collectAutoEventItems() {
  const tasks = [
    fetchAnimateOnlyShopItems(),
    fetchAnimateGratteItems(),
    fetchPokeparkItems(),
    fetchPokemonOfficialItems(),
    fetchYomiuriItems(),
    fetchScrapItems(),
  ];
  const settled = await Promise.allSettled(tasks);
  const items = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      items.push(...result.value);
      continue;
    }
    console.warn(`[events] source failed: ${result.reason?.message ?? result.reason}`);
  }

  return items.map((item) => normalizeEventItem(item)).filter(Boolean);
}

async function fetchAnimateOnlyShopItems() {
  const html = await fetchText("https://www.animate.co.jp/onlyshop/");
  return extractAnimateCards(html, {
    kind: "onlyshop",
    baseCategory: "オンリーショップ",
    sourceName: "アニメイト オンリーショップ",
    sourceUrl: "https://www.animate.co.jp/onlyshop/",
  });
}

async function fetchAnimateGratteItems() {
  const html = await fetchText("https://www.animate.co.jp/gratte/");
  return extractAnimateCards(html, {
    kind: "gratte",
    baseCategory: "Gratte",
    sourceName: "アニメイト Gratte",
    sourceUrl: "https://www.animate.co.jp/gratte/",
  });
}

function extractAnimateCards(html, options) {
  const compact = compactHtml(html);
  const linkPattern = new RegExp(`<a class="gr-osCardLink" href="([^"]*\\/${options.kind}\\/[^"]+\\/)" title="([^"]+)"`, "g");
  const matches = [...compact.matchAll(linkPattern)];

  return matches.map((match, index) => {
    const nextIndex = matches[index + 1]?.index ?? compact.length;
    const segment = compact.slice(match.index, Math.min(nextIndex, match.index + 2400));
    const title = decodeHtml(match[2]).trim();
    const detailUrl = absolutizeUrl(match[1], options.sourceUrl);
    const thumbnailUrl = extractFirstMatch(segment, /<img src="([^"]+)"/);
    const storeName = extractFirstMatch(segment, /gr-osCardStoreCategory">\s*(?:<a[^>]*>)?([^<]+)/);
    const periodText = decodeHtml(extractFirstMatch(segment, /gr-osCardPeriod">\s*([^<]+)/) ?? "");
    const period = parseAnimatePeriod(periodText);
    const statusText = decodeHtml(extractFirstMatch(segment, /data-status-text="([^"]+)"/) ?? "");
    const tags = [
      "tokyo",
      options.kind === "gratte" ? "collab-cafe" : "popup",
      options.kind === "gratte" ? "gratte" : "onlyshop",
      statusText.includes("開催中") ? "ongoing" : "",
      statusText.includes("開催予定") ? "upcoming" : "",
      /周年|記念|発売記念/.test(title) ? "sns-buzz" : "",
      inferPrimaryTag(title),
    ].filter(Boolean);

    return {
      id: buildEventId(detailUrl || title),
      title,
      startDate: period.startDate,
      endDate: period.endDate,
      venue: storeName ? `アニメイト${storeName}` : "アニメイト各店",
      location: inferAnimateLocation(storeName),
      category: buildAnimateCategory(title, options.kind),
      description: buildAnimateDescription(title, options.kind, storeName, statusText),
      detailUrl,
      officialUrl: options.sourceUrl,
      sourceName: options.sourceName,
      sourceUrl: options.sourceUrl,
      thumbnailUrl,
      tags,
      recommendationReasons: buildAnimateReasons(title, options.kind, storeName, statusText),
    };
  });
}

async function fetchPokeparkItems() {
  const html = await fetchText("https://www.pokepark-kanto.co.jp/ppark/event/list/index");
  const compact = compactHtml(html);
  const blockPattern = /<div class="col-12 col-md-6 col-lg-3 event-list[\s\S]*?<\/a>\s*<\/div>/g;
  const blocks = [...compact.matchAll(blockPattern)].map((match) => match[0]);

  return blocks.map((segment) => {
    const detailUrl = absolutizeUrl(extractFirstMatch(segment, /<a href="([^"]*\/ppark\/event\/\d+\/detail\/index)"/), "https://www.pokepark-kanto.co.jp/");
    const title = decodeHtml(extractFirstMatch(segment, /<h5 class="contents-title">([\s\S]*?)<\/h5>/) ?? "").trim();
    const description = decodeHtml(extractFirstMatch(segment, /<p class="contents-description">([\s\S]*?)<\/p>/) ?? "").trim();
    const thumbnailUrl = extractFirstMatch(segment, /<img src="([^"]+)" class="card-img-top"/);
    const dateText = decodeHtml(extractFirstMatch(segment, /<p class="contents-date[^"]*">([\s\S]*?)<\/p>/) ?? "").trim();
    const placeBlock = extractFirstMatch(segment, /<p class="contents-place[^"]*">([\s\S]*?)<\/p>/) ?? "";
    const rawPlace = decodeHtml(extractFirstMatch(placeBlock, /<span class="align-middle">([\s\S]*?)<\/span>/) ?? "").trim();
    const place = /\d{1,2}:\d{2}/.test(rawPlace) ? "" : rawPlace;
    const typeLabel = decodeHtml(extractFirstMatch(segment, /<div class="event-type-label[^"]*">([\s\S]*?)<\/div>/) ?? "").trim();
    const period = parseMonthDayYearRange(dateText);
    const titleLower = title.toLowerCase();
    const isPokemonMeet = /meet|greet/i.test(typeLabel);
    const tags = [
      "pokemon",
      "game",
      "nintendo",
      "tokyo",
      period.endDate && parseDate(period.endDate) >= TODAY ? "ongoing" : "",
      /summer/i.test(titleLower) ? "summer" : "",
      /parade|show|meet/i.test(typeLabel.toLowerCase()) ? "show" : "experience",
    ].filter(Boolean);

    return {
      id: buildEventId(detailUrl || title),
      title,
      startDate: period.startDate,
      endDate: period.endDate,
      venue: place ? `${place}（PokéPark KANTO内）` : "PokéPark KANTO",
      location: "東京都稲城市",
      category: buildPokeparkCategory(typeLabel, isPokemonMeet),
      description: description || "PokéPark KANTO の現地イベントです。",
      detailUrl,
      officialUrl: "https://www.pokepark-kanto.co.jp/",
      sourceName: "PokéPark KANTO",
      sourceUrl: "https://www.pokepark-kanto.co.jp/ppark/event/list/index",
      thumbnailUrl,
      tags,
      recommendationReasons: buildPokeparkReasons(title, typeLabel),
    };
  }).filter((item) => item.title && item.detailUrl);
}

async function fetchPokemonOfficialItems() {
  const payload = await fetchJson("https://www.pokemon.co.jp/api/info/index/?limit=120");
  const entries = Array.isArray(payload?.results) ? payload.results : [];
  const items = entries
    .filter((entry) => isPokemonOfficialEventEntry(entry))
    .map((entry) => buildPokemonOfficialItem(entry))
    .filter(Boolean);

  const supplemented = await Promise.all(items.map((item) => supplementPokemonOfficialItemDetails(item)));
  return supplemented.filter(Boolean);
}

async function fetchScrapItems() {
  const payload = await fetchJson("https://api.scrapmagazine.com/public/api/2/events");
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const grouped = new Map();

  for (const event of events) {
    const groupKey = String(event?.event_id ?? "").replace(/^\d+-/, "") || String(event?.event_url ?? "");
    const current = grouped.get(groupKey) ?? [];
    current.push(event);
    grouped.set(groupKey, current);
  }

  return [...grouped.values()]
    .map((group) => buildScrapGroupEvent(group))
    .filter(Boolean);
}

async function fetchYomiuriItems() {
  const html = await fetchText("https://www.yomiuriland.com/event/");
  const compact = compactHtml(html);
  const cardPattern = /<li class="yl-events__item">([\s\S]*?)<\/li>/g;
  const cards = [...compact.matchAll(cardPattern)];
  const selected = cards
    .map((match) => buildYomiuriCard(match[1]))
    .filter(Boolean)
    .filter((item) => isAllowedYomiuriEvent(item));

  return selected;
}

function buildYomiuriCard(itemHtml) {
  const body = compactHtml(itemHtml);
  const href = extractFirstMatch(body, /<a href="([^"]+)"/);
  const title = decodeHtml(extractFirstMatch(body, /<h3 class="yl-events__title">([\s\S]*?)<\/h3>/) ?? "").trim();
  const periodText = decodeHtml(extractFirstMatch(body, /<p class="yl-events__date">([\s\S]*?)<\/p>/) ?? "").trim();
  const thumbnailUrl = extractFirstMatch(body, /<img[^>]+src="([^"]+)"/);
  if (!title) return null;

  const period = parseYomiuriCardPeriod(periodText);
  const detailUrl = absolutizeUrl(href, "https://www.yomiuriland.com/event/");
  const tags = [
    "tokyo",
    /ポケパーク|PokéPark/i.test(title) ? "pokemon" : "",
    /東方|コラボ|×|UNIQLO|ヒロアカ|鬼滅|ちいかわ|アニメ|ゲーム/i.test(title) ? "collaboration" : "",
    /体験|謎|脱出|イマーシブ/i.test(title) ? "experience" : "",
    inferPrimaryTag(title),
  ].filter(Boolean);

  return {
    id: buildEventId(detailUrl || title),
    title,
    startDate: period.startDate,
    endDate: period.endDate,
    venue: "よみうりランド",
    location: "東京都稲城市",
    category: buildYomiuriCategory(title),
    description: buildYomiuriDescription(title),
    detailUrl,
    officialUrl: detailUrl.includes("hakurei-sukeikai.com") ? detailUrl : "https://www.yomiuriland.com/event/",
    sourceName: "よみうりランド",
    sourceUrl: "https://www.yomiuriland.com/event/",
    thumbnailUrl: absolutizeUrl(thumbnailUrl, "https://www.yomiuriland.com/"),
    tags,
    recommendationReasons: buildYomiuriReasons(title, period),
  };
}

function isPokemonOfficialEventEntry(entry) {
  const term = String(entry?.term ?? "").toLowerCase();
  if (!["event", "pokecen"].includes(term)) return false;

  const title = decodeHtml(String(entry?.title ?? "")).trim();
  const teaser = decodeHtml(String(entry?.txt_1 ?? "")).trim();
  const url = String(entry?.full_uniq ?? "");
  const text = `${title} ${teaser} ${url}`;

  if (!title || !url) return false;
  if (/アーカイブ|配信チケット|mv|ミュージックビデオ|就航|デザインが公開|宿泊プラン|予約開始|本人確認|抽選販売|通販|オンライン/i.test(text)) return false;
  if (/無料アップデート|配信決定|発売が決定|参戦|登場！?$|追加コンテンツ|dlc|アプリ/i.test(text)) return false;

  return /開催|オープン|OPEN|リニューアル|コラボ|ポップアップ|POP-UP|POP UP|展|美術館|博物館|カフェ|メニュー|ショー|キャンペーン|チャンピオンシップ|WCS|イオンモール|ストア|センター/i.test(text);
}

function buildScrapGroupEvent(group) {
  const preferred = group
    .filter((entry) => isPreferredScrapRegion(entry))
    .sort((left, right) => scrapRegionRank(left) - scrapRegionRank(right));
  const items = preferred.length ? preferred : group;
  const first = items[0];
  const title = String(first?.event_name ?? "").replace(/^【[^】]+】/, "").trim();
  const detailUrl = first?.event_url ?? "";
  const startDate = items.map((entry) => entry?.starts_on).filter(Boolean).sort()[0] ?? null;
  const endDate = items.map((entry) => entry?.ends_on).filter(Boolean).sort().at(-1) ?? null;
  const venues = [...new Set(items.map((entry) => entry?.place_name).filter(Boolean))];
  const prefs = [...new Set(items.map((entry) => entry?.place_pref).filter(Boolean))];
  const isLikelyCollab = /名探偵コナン|ポケモン|アニメ|アイドル|ゲーム|ハンター|呪術|ヒロアカ|モンハン|東方/i.test(title);
  const tags = [
    "escape",
    "scrap",
    prefs.some((pref) => /東京/.test(pref)) ? "tokyo" : "",
    prefs.some((pref) => /神奈川|千葉|埼玉/.test(pref)) ? "kanto" : "",
    isLikelyCollab ? "collaboration" : "",
    inferPrimaryTag(title),
  ].filter(Boolean);

  return {
    id: buildEventId(detailUrl || title),
    title,
    startDate,
    endDate,
    venue: venues.slice(0, 3).join(" / ") || "SCRAP会場",
    location: prefs.join("・") || String(first?.place_area ?? "関東"),
    category: "体験型 / リアル脱出ゲーム",
    description: buildScrapDescription(title, venues, prefs),
    detailUrl,
    officialUrl: "https://realdgame.jp/",
    sourceName: "SCRAP / リアル脱出ゲーム",
    sourceUrl: "https://api.scrapmagazine.com/public/api/2/events",
    thumbnailUrl: first?.event_image ?? "",
    tags,
    recommendationReasons: buildScrapReasons(title, prefs, venues),
  };
}

function buildPokemonOfficialItem(entry) {
  const title = decodeHtml(String(entry?.title ?? "")).trim();
  const detailUrl = String(entry?.full_uniq ?? "").trim();
  if (!title || !detailUrl) return null;

  const teaser = decodeHtml(String(entry?.txt_1 ?? "")).trim();
  const startDate = normalizeDottedDate(String(entry?.start_date ?? "").trim());
  const period = parsePokemonOfficialPeriod(teaser, startDate);
  const venue = inferPokemonOfficialVenue(title, detailUrl);
  const location = inferPokemonOfficialLocation(title, detailUrl, venue);
  const category = buildPokemonOfficialCategory(title, detailUrl);
  const tags = buildPokemonOfficialTags(title, teaser, detailUrl, location, period);

  return {
    id: buildEventId(detailUrl || title),
    title,
    startDate: period.startDate,
    endDate: period.endDate,
    venue,
    location,
    category,
    description: buildPokemonOfficialDescription(title, teaser, venue),
    detailUrl,
    officialUrl: "https://www.pokemon.co.jp/info/cat_event/",
    sourceName: "ポケットモンスターオフィシャルサイト",
    sourceUrl: "https://www.pokemon.co.jp/info/cat_event/",
    thumbnailUrl: absolutizeUrl(String(entry?.img_1 ?? ""), "https://www.pokemon.co.jp/"),
    tags,
    recommendationReasons: buildPokemonOfficialReasons(title, teaser, location, period, category),
  };
}

async function supplementPokemonOfficialItemDetails(item) {
  if (!item?.detailUrl) return item;

  try {
    const html = await fetchText(item.detailUrl);
    const compact = compactHtml(html);
    const detail = extractPokemonDetailFields(item, compact);
    const nextStartDate = detail.startDate ?? item.startDate;
    const nextEndDate = detail.endDate ?? item.endDate;
    const nextVenue = detail.venue ?? item.venue;
    const nextLocation = detail.location ?? item.location;
    const nextDescription = detail.description ?? item.description;

    return {
      ...item,
      startDate: nextStartDate,
      endDate: nextEndDate,
      venue: nextVenue,
      location: nextLocation,
      description: nextDescription,
      recommendationReasons: buildPokemonOfficialReasons(item.title, detail.teaser ?? "", nextLocation, { startDate: nextStartDate, endDate: nextEndDate }, item.category),
    };
  } catch (error) {
    console.warn(`[events] pokemon detail supplement failed: ${item.detailUrl} (${error?.message ?? error})`);
    return item;
  }
}

function mergeEventItems(primaryItems, fallbackItems) {
  const merged = new Map();
  for (const item of [...primaryItems, ...fallbackItems]) {
    const normalized = normalizeEventItem(item);
    if (!normalized) continue;
    const key = eventMergeKey(normalized);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, normalized);
      continue;
    }
    merged.set(key, {
      ...current,
      ...normalized,
      recommendationReasons: [...new Set([...(current.recommendationReasons ?? []), ...(normalized.recommendationReasons ?? [])])].slice(0, 6),
      tags: [...new Set([...(current.tags ?? []), ...(normalized.tags ?? [])])],
      thumbnailUrl: current.thumbnailUrl || normalized.thumbnailUrl,
      detailUrl: current.detailUrl || normalized.detailUrl,
      officialUrl: current.officialUrl || normalized.officialUrl,
      venue: current.venue?.length >= normalized.venue?.length ? current.venue : normalized.venue,
      location: current.location?.length >= normalized.location?.length ? current.location : normalized.location,
    });
  }
  return [...merged.values()];
}

function normalizeEventItem(item) {
  if (!item?.title) return null;
  const title = decodeHtml(String(item.title)).trim();
  if (!title) return null;
  const normalizedVenue = sanitizeVenue(item.venue, item.sourceName);
  return {
    ...item,
    id: item.id ?? buildEventId(item.detailUrl || title),
    title,
    startDate: normalizeIsoDate(item.startDate),
    endDate: normalizeIsoDate(item.endDate),
    venue: normalizedVenue,
    location: decodeHtml(String(item.location ?? "開催場所未定")).trim(),
    category: decodeHtml(String(item.category ?? "イベント")).trim(),
    description: decodeHtml(String(item.description ?? "イベント情報を整理中です。")).trim(),
    detailUrl: item.detailUrl ? String(item.detailUrl).trim() : "",
    officialUrl: item.officialUrl ? String(item.officialUrl).trim() : "",
    sourceName: decodeHtml(String(item.sourceName ?? "公式サイト")).trim(),
    sourceUrl: item.sourceUrl ? String(item.sourceUrl).trim() : "",
    thumbnailUrl: item.thumbnailUrl ? String(item.thumbnailUrl).trim() : "",
    tags: [...new Set((Array.isArray(item.tags) ? item.tags : []).filter(Boolean).map((tag) => String(tag).toLowerCase()))],
    recommendationReasons: [...new Set((Array.isArray(item.recommendationReasons) ? item.recommendationReasons : []).filter(Boolean).map((reason) => decodeHtml(String(reason)).trim()))].slice(0, 6),
  };
}

function sanitizeVenue(value, sourceName) {
  const venue = decodeHtml(String(value ?? "会場未定")).trim();
  if (/\d{1,2}:\d{2}/.test(venue) && /PokéPark KANTO/.test(String(sourceName ?? ""))) {
    return "PokéPark KANTO";
  }
  return venue;
}

function eventMergeKey(item) {
  const detail = String(item.detailUrl ?? "").trim();
  if (detail) return `url:${detail}`;
  return `title:${titleKey(item.title)}`;
}

function compareEventFreshness(left, right) {
  const leftStart = parseDate(left.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightStart = parseDate(right.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (leftStart !== rightStart) return leftStart - rightStart;
  return String(left.title).localeCompare(String(right.title), "ja");
}

function isEventRelevantWindow(item) {
  const start = parseDate(item.startDate);
  const end = parseDate(item.endDate) ?? start;
  const staleStart = new Date(TODAY);
  staleStart.setDate(staleStart.getDate() - STALE_START_WINDOW_DAYS);
  if (!start && !end) return true;
  const limit = new Date(TODAY);
  limit.setDate(limit.getDate() + UPCOMING_WINDOW_DAYS);
  if (end && end < TODAY) return false;
  if (start && start < staleStart) return false;
  if (start && start > limit) return false;
  if (/オンライン/i.test(String(item.location ?? "")) || /オンライン/i.test(String(item.venue ?? ""))) return false;
  return true;
}

function collectionEventScore(item) {
  const start = parseDate(item.startDate);
  const end = parseDate(item.endDate);
  let score = 0;
  if (start) {
    const diff = Math.round((start.getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= 0 && (!end || end >= TODAY)) score += 80;
    else if (diff <= 7) score += 72;
    else if (diff <= 31) score += 60;
    else score += Math.max(0, 40 - diff);
  }
  if ((item.tags ?? []).includes("pokemon")) score += 30;
  if ((item.tags ?? []).includes("game")) score += 24;
  if ((item.tags ?? []).includes("anime")) score += 18;
  if ((item.tags ?? []).includes("escape")) score += 20;
  if ((item.tags ?? []).includes("collab-cafe")) score += 16;
  if ((item.tags ?? []).includes("tokyo")) score += 20;
  if ((item.tags ?? []).includes("kanto")) score += 10;
  if ((item.tags ?? []).includes("sns-buzz")) score += 8;
  if ((item.tags ?? []).includes("large-scale")) score += 8;
  if (/PokéPark KANTO|アニメイト|ポケットモンスターオフィシャルサイト/.test(String(item.sourceName ?? ""))) score += 12;
  return score;
}

function limitEventsPerSource(items, maxPerSource) {
  const counts = new Map();
  const limited = [];
  for (const item of items) {
    const source = String(item.sourceName ?? "unknown");
    const current = counts.get(source) ?? 0;
    if (current >= maxPerSource) continue;
    counts.set(source, current + 1);
    limited.push(item);
  }
  return limited;
}

function buildAnimateCategory(title, kind) {
  const prefix = inferInterestCategory(title);
  if (kind === "gratte") return `${prefix} / コラボカフェ`;
  return `${prefix} / オンリーショップ`;
}

function buildAnimateDescription(title, kind, storeName, statusText) {
  const storeLabel = storeName ? `アニメイト${storeName}` : "アニメイト各店";
  if (kind === "gratte") return `${storeLabel} を中心に展開される ${title} のコラボカフェ系イベントです。${statusText || "開催情報"}を確認しやすい一覧から取得しています。`;
  return `${storeLabel} を中心に展開される ${title} のポップアップ系イベントです。${statusText || "開催情報"}を確認しやすい一覧から取得しています。`;
}

function buildAnimateReasons(title, kind, storeName, statusText) {
  const reasons = [];
  if (/池袋|秋葉原|渋谷/.test(storeName ?? "")) reasons.push("東京開催");
  if (/開催中/.test(statusText)) reasons.push("開催中");
  if (/開催予定/.test(statusText)) reasons.push("開催予定");
  if (/記念|周年|発売記念/.test(title)) reasons.push("SNSで話題");
  if (kind === "gratte") reasons.push("コラボカフェ好き向け");
  const category = inferInterestCategory(title);
  if (category === "ポケモン") reasons.push("ポケモン好き向け");
  if (category === "ゲーム") reasons.push("ゲーム好き向け");
  if (category === "アニメ") reasons.push("アニメ・漫画好き向け");
  return [...new Set(reasons)].slice(0, 4);
}

function buildPokeparkCategory(typeLabel, isPokemonMeet) {
  if (isPokemonMeet) return "ポケモン / グリーティング";
  if (/show/i.test(typeLabel)) return "ポケモン / ショー";
  if (/parade/i.test(typeLabel)) return "ポケモン / パレード";
  return "ポケモン / 体験型イベント";
}

function buildPokeparkReasons(title, typeLabel) {
  const reasons = ["ポケモン好き向け", "東京開催"];
  if (/summer/i.test(title)) reasons.push("来月スタート");
  if (/show|parade|meet/i.test(typeLabel.toLowerCase())) reasons.push("現地体験が強い");
  return [...new Set(reasons)].slice(0, 4);
}

function buildPokemonOfficialCategory(title, detailUrl) {
  const text = `${title} ${detailUrl}`;
  if (/ポケモンセンター|ポケモンストア|サテライト|キミにあえた/i.test(text)) return "ポケモン / ショップイベント";
  if (/ポケモンカフェ|クレープ|メニュー/i.test(text)) return "ポケモン / コラボカフェ";
  if (/工芸展|天文台|展|美術館|博物館/i.test(text)) return "ポケモン / 展示会";
  if (/チャンピオンシップ|WCS|XP/i.test(text)) return "ポケモン / 大会イベント";
  if (/コンサート|ライブ/i.test(text)) return "ポケモン / ステージイベント";
  if (/ポップアップ|POP-UP|POP UP|ストア/i.test(text)) return "ポケモン / ポップアップストア";
  return "ポケモン / 公式イベント";
}

function buildPokemonOfficialDescription(title, teaser, venue) {
  const lead = teaser ? `${teaser} ` : "";
  return `${lead}${venue} で展開される ${title}。ポケモン公式のお知らせ一覧から「現地で行けるイベント」寄りの情報だけ抽出しています。`.trim();
}

function extractPokemonDetailFields(item, compactHtmlValue) {
  const url = String(item.detailUrl ?? "");
  const metaDescription = decodeHtml(extractFirstMatch(compactHtmlValue, /<meta name="description" content="([^"]+)"/i)).trim();
  const titleText = decodeHtml(extractFirstMatch(compactHtmlValue, /<title>([^<]+)<\/title>/i)).trim();
  const teaser = [metaDescription, titleText].filter(Boolean).join(" ");

  if (/tokyo\.grand\.hyatt\.co\.jp/i.test(url)) {
    const period = parseJapaneseTextDateRange(metaDescription || compactHtmlValue, item.startDate);
    return {
      teaser: metaDescription,
      startDate: period.startDate,
      endDate: period.endDate,
      venue: "グランド ハイアット 東京",
      location: "東京都港区六本木",
      description: metaDescription ? `${metaDescription} ポケモン公式経由で詳細ページの開催情報を補完しています。` : null,
    };
  }

  if (/pokemon-cafe\.jp/i.test(url)) {
    const period = parsePokemonOfficialPeriod(metaDescription || titleText, item.startDate);
    const titleVenue = /TOKYO/i.test(item.title) || /TOKYO/i.test(titleText)
      ? "ポケモンカフェ TOKYO"
      : /OSAKA/i.test(item.title) || /OSAKA/i.test(titleText)
        ? "ポケモンカフェ OSAKA"
        : null;
    const venue = titleVenue
      ?? (/日本橋髙島屋|日本橋二丁目/i.test(compactHtmlValue) && /心斎橋筋|大丸心斎橋/i.test(compactHtmlValue)
        ? "ポケモンカフェ TOKYO / OSAKA"
        : /日本橋髙島屋|日本橋二丁目/i.test(compactHtmlValue)
          ? "ポケモンカフェ TOKYO"
          : /心斎橋筋|大丸心斎橋/i.test(compactHtmlValue)
            ? "ポケモンカフェ OSAKA"
            : item.venue);
    const location = venue === "ポケモンカフェ TOKYO / OSAKA"
      ? "東京都中央区日本橋 / 大阪府大阪市中央区心斎橋"
      : venue === "ポケモンカフェ TOKYO"
        ? "東京都中央区日本橋"
        : venue === "ポケモンカフェ OSAKA"
          ? "大阪府大阪市中央区心斎橋"
          : item.location;
    return {
      teaser: metaDescription || titleText,
      startDate: period.startDate,
      endDate: period.endDate,
      venue,
      location,
      description: metaDescription ? `${metaDescription} ポケモンカフェ公式ページから会場情報を補完しています。` : null,
    };
  }

  if (/hpam\.jp/i.test(url)) {
    const period = parseJapaneseTextDateRange(compactHtmlValue, item.startDate);
    return {
      teaser: metaDescription || titleText,
      startDate: period.startDate,
      endDate: period.endDate,
      venue: "広島県立美術館",
      location: "広島県広島市中区上幟町",
      description: metaDescription ? `${metaDescription} 詳細ページから会期と会場情報を補完しています。` : item.description,
    };
  }

  if (/pokemon\.jp\/special\/nhkso-pokemon2026/i.test(url)) {
    const period = parseJapaneseTextDateRange(compactHtmlValue, item.startDate);
    const venueMatches = [
      ...new Set([
        ...compactHtmlValue.match(/パシフィコ横浜 国立大ホール/g) ?? [],
        ...compactHtmlValue.match(/福岡シンフォニーホール(?:（アクロス福岡）|\(アクロス福岡\))?/g) ?? [],
      ].map((value) => decodeHtml(value).trim())),
    ];
    const locationParts = [];
    if (/パシフィコ横浜 国立大ホール/.test(compactHtmlValue)) locationParts.push("神奈川県横浜市");
    if (/大阪公演|大阪/.test(compactHtmlValue)) locationParts.push("大阪府");
    if (/福岡公演|福岡/.test(compactHtmlValue)) locationParts.push("福岡県福岡市");
    if (/東京公演|東京/.test(compactHtmlValue)) locationParts.push("東京都");
    return {
      teaser: metaDescription || titleText,
      startDate: period.startDate,
      endDate: period.endDate,
      venue: venueMatches.length ? venueMatches.join(" / ") : "全国4会場",
      location: locationParts.length ? [...new Set(locationParts)].join(" / ") : "全国4会場",
      description: metaDescription ? `${metaDescription} 詳細ページから巡回公演の会場情報を補完しています。` : item.description,
    };
  }

  return {
    teaser,
    ...parseJapaneseTextDateRange(`${metaDescription} ${titleText}`, item.startDate),
  };
}

function buildPokemonOfficialReasons(title, teaser, location, period, category) {
  const reasons = ["ポケモン好き向け", "公式一次情報"];
  if (/東京/.test(location)) reasons.push("東京開催");
  else if (/神奈川|千葉|埼玉/.test(location)) reasons.push("関東で行きやすい");
  else if (/広島|北海道|愛知|福岡|大阪/.test(location)) reasons.push("地方大型開催");
  if (isCurrentEventPeriod(period)) reasons.push("開催中");
  else if (period.startDate && isSameMonth(parseDate(period.startDate), TODAY)) reasons.push("今月開催");
  else if (period.startDate && isNextMonth(parseDate(period.startDate), TODAY)) reasons.push("来月開催");
  if (/展示会/.test(category)) reasons.push("展示会好き向け");
  if (/コラボカフェ/.test(category)) reasons.push("コラボカフェ好き向け");
  if (/ショップイベント|ポップアップストア/.test(category)) reasons.push("限定ショップ系");
  if (/チャンピオンシップ|WCS|30周年|POP UP/i.test(`${title} ${teaser}`)) reasons.push("SNSで話題");
  return [...new Set(reasons)].slice(0, 4);
}

function buildScrapDescription(title, venues, prefs) {
  const venueLabel = venues.slice(0, 2).join(" / ") || "SCRAP会場";
  const locationLabel = prefs.join("・") || "関東";
  return `${locationLabel} の ${venueLabel} を中心に展開される ${title}。SCRAP公式の公開イベントAPIから取得しています。`;
}

function buildYomiuriCategory(title) {
  if (/ポケパーク|PokéPark/i.test(title)) return "ポケモン / 大型イベント";
  if (/東方|アニメ|ゲーム|コラボ|×/i.test(title)) return "IPコラボ / 大型イベント";
  return "体験型 / 大型イベント";
}

function buildYomiuriDescription(title) {
  return `よみうりランドで開催される ${title}。IPコラボか大型企画に絞って取得しています。`;
}

function buildYomiuriReasons(title, period) {
  const reasons = ["東京開催"];
  if (/ポケパーク|PokéPark/i.test(title)) reasons.push("ポケモン好き向け");
  if (/東方|アニメ|ゲーム|コラボ|×/i.test(title)) reasons.push("IPコラボ");
  if (period.startDate && parseDate(period.startDate) >= TODAY) reasons.push("開催予定");
  if (period.endDate && parseDate(period.endDate) >= TODAY && parseDate(period.startDate) <= TODAY) reasons.push("開催中");
  return [...new Set(reasons)].slice(0, 4);
}

function buildPokemonOfficialTags(title, teaser, detailUrl, location, period) {
  const text = `${title} ${teaser} ${detailUrl}`;
  const tags = [
    "pokemon",
    /ポケモンセンター|ポケモンカフェ|POP-UP|POP UP|ポップアップ|ストア/i.test(text) ? "collaboration" : "",
    /ポケモンカフェ|クレープ|メニュー/i.test(text) ? "collab-cafe" : "",
    /チャンピオンシップ|WCS|XP/i.test(text) ? "game" : "",
    /工芸展|天文台|展|美術館|博物館/i.test(text) ? "anime" : "",
    /東京/.test(location) ? "tokyo" : "",
    /神奈川|千葉|埼玉/.test(location) ? "kanto" : "",
    /30周年|チャンピオンシップ|WCS|POP-UP|POP UP|ポップアップ/i.test(text) ? "sns-buzz" : "",
    isCurrentEventPeriod(period) ? "ongoing" : "",
    isNextMonth(parseDate(period.startDate), TODAY) ? "next-month" : "",
  ].filter(Boolean);
  return [...new Set(tags)];
}

function isAllowedYomiuriEvent(item) {
  const text = `${item.title} ${item.category} ${item.description}`;
  if (/未就学児|県民|市民|クーポン|LINE|誕生日|ECサイト|待ち時間|マスコット|グッド＆ラッキー|スムースチケット|エクスプレス|会員|登録無料|スタッフ募集|募集中|アシカショー|プールWAI|振替休日/i.test(text)) return false;
  return /ポケパーク|PokéPark|東方|コラボ|×|アニメ|ゲーム|謎|脱出|イマーシブ/i.test(text);
}

function buildScrapReasons(title, prefs, venues) {
  const reasons = ["脱出ゲーム好き向け"];
  if (prefs.some((pref) => /東京/.test(pref))) reasons.push("東京開催");
  if (prefs.some((pref) => /神奈川|千葉|埼玉/.test(pref))) reasons.push("関東で行きやすい");
  if (venues.length > 1) reasons.push("複数会場あり");
  if (/名探偵コナン|ポケモン|アニメ|ゲーム/i.test(title)) reasons.push("コラボ系");
  return [...new Set(reasons)].slice(0, 4);
}

function inferInterestCategory(title) {
  const text = String(title ?? "");
  if (/ポケモン|pokemon|ピカチュウ/i.test(text)) return "ポケモン";
  if (/ゲーム|Identity V|ときめきメモリアル|東方|ヒーローアカデミア|コナン|Nintendo|Switch|Steam/i.test(text)) return "ゲーム";
  return "アニメ";
}

function inferPokemonOfficialVenue(title, detailUrl) {
  const text = `${title} ${detailUrl}`;
  if (/ポケモンセンターで/i.test(text)) return "ポケモンセンター各店";
  const directMatch = text.match(/(ポケモンセンター[^\s「」『』、。！!]+|ポケモンストア[^\s「」『』、。！!]+|ポケモンカフェ TOKYO|ポケモンカフェ OSAKA|ポケモンカフェ|グランド ハイアット 東京|イオンモール[^\s「」『』、。！!]*|[^\s「」『』、。！!]+美術館|[^\s「」『』、。！!]+博物館|東武百貨店[^\s「」『』、。！!]*|けんしん郡山文化センター)/);
  if (directMatch) return directMatch[1].trim();
  if (/チャンピオンシップ|WCS|XP/i.test(text)) return "大会特設会場";
  if (/ポップアップ|POP-UP|POP UP/i.test(text)) return "ポップアップ会場";
  return "イベント会場は詳細ページで確認";
}

function inferPokemonOfficialLocation(title, detailUrl, venue) {
  const text = `${title} ${detailUrl} ${venue}`;
  if (/東京|池袋|日本橋|渋谷|新宿|TOKYO/i.test(text)) return "東京都";
  if (/横浜|神奈川/i.test(text)) return "神奈川県";
  if (/千葉/i.test(text)) return "千葉県";
  if (/埼玉/i.test(text)) return "埼玉県";
  if (/愛知/i.test(text)) return "愛知県";
  if (/大阪|OSAKA/i.test(text)) return "大阪府";
  if (/福岡/i.test(text)) return "福岡県";
  if (/広島/i.test(text)) return "広島県";
  if (/北海道/i.test(text)) return "北海道";
  if (/郡山|福島/i.test(text)) return "福島県";
  return "開催地は詳細ページで確認";
}

function inferPrimaryTag(title) {
  const category = inferInterestCategory(title);
  if (category === "ポケモン") return "pokemon";
  if (category === "ゲーム") return "game";
  return "anime";
}

function inferAnimateLocation(storeName = "") {
  if (/池袋|秋葉原|渋谷|新宿/.test(storeName)) return "東京都";
  if (/横浜/.test(storeName)) return "神奈川県";
  if (/大宮/.test(storeName)) return "埼玉県";
  if (/千葉/.test(storeName)) return "千葉県";
  return "東京都ほか";
}

function isPreferredScrapRegion(item) {
  const pref = String(item?.place_pref ?? "");
  const area = String(item?.place_area ?? "");
  return /東京|神奈川|千葉|埼玉/.test(pref) || /関東/.test(area);
}

function scrapRegionRank(item) {
  const pref = String(item?.place_pref ?? "");
  if (/東京/.test(pref)) return 0;
  if (/神奈川/.test(pref)) return 1;
  if (/千葉/.test(pref)) return 2;
  if (/埼玉/.test(pref)) return 3;
  return 10;
}

function parseAnimatePeriod(value) {
  const text = normalizeDateText(value);
  const match = text.match(/(\d{4})\.(\d{1,2})\.(\d{1,2}).*?〜(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!match) return { startDate: null, endDate: null };
  return {
    startDate: toIsoDate(match[1], match[2], match[3]),
    endDate: toIsoDate(match[4], match[5], match[6]),
  };
}

function parsePokemonOfficialPeriod(teaser, fallbackStartDate) {
  const text = decodeHtml(String(teaser ?? "")).replace(/\s+/g, "");
  const fallbackDate = parseDate(fallbackStartDate);
  const fallbackYear = fallbackDate?.getFullYear() ?? TODAY.getFullYear();
  const sameMonthRange = text.match(/(\d{1,2})月(\d{1,2})日[（(][^）)]+[）)]?[・･]\s*(\d{1,2})日[（(][^）)]+[）)]?に?開催/);
  if (sameMonthRange) {
    return {
      startDate: toIsoDate(fallbackYear, sameMonthRange[1], sameMonthRange[2]),
      endDate: toIsoDate(fallbackYear, sameMonthRange[1], sameMonthRange[3]),
    };
  }

  const startEndRange = text.match(/(\d{1,2})月(\d{1,2})日.*?[~〜-]\s*(?:(\d{1,2})月)?(\d{1,2})日/);
  if (startEndRange) {
    return {
      startDate: toIsoDate(fallbackYear, startEndRange[1], startEndRange[2]),
      endDate: toIsoDate(fallbackYear, startEndRange[3] || startEndRange[1], startEndRange[4]),
    };
  }

  const monthOnly = text.match(/(?:(\d{4})年)?(\d{1,2})月開催/);
  if (monthOnly) {
    const year = Number(monthOnly[1] || fallbackYear);
    const month = Number(monthOnly[2]);
    return {
      startDate: toIsoDate(year, month, 1),
      endDate: toIsoDate(year, month, daysInMonth(year, month)),
    };
  }

  const startOnly = text.match(/(\d{1,2})月(\d{1,2})日.*?(から|より|リニューアル|開始|オープン|OPEN)/i);
  if (startOnly) {
    return {
      startDate: toIsoDate(fallbackYear, startOnly[1], startOnly[2]),
      endDate: null,
    };
  }

  const endOnly = text.match(/(\d{1,2})月(\d{1,2})日.*?まで/);
  if (endOnly) {
    return {
      startDate: fallbackStartDate,
      endDate: toIsoDate(fallbackYear, endOnly[1], endOnly[2]),
    };
  }

  return {
    startDate: fallbackStartDate,
    endDate: null,
  };
}

function parseJapaneseTextDateRange(value, fallbackStartDate) {
  const text = decodeHtml(String(value ?? "")).replace(/\s+/g, " ").trim();
  const fallbackDate = parseDate(fallbackStartDate);
  const fallbackYear = fallbackDate?.getFullYear() ?? TODAY.getFullYear();

  let match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日[^0-9]{0,16}[~〜～\-－][^0-9]{0,8}(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (match) {
    return {
      startDate: toIsoDate(match[1], match[2], match[3]),
      endDate: toIsoDate(match[4], match[5], match[6]),
    };
  }

  match = text.match(/(\d{1,2})月(\d{1,2})日[^0-9]{0,16}(?:から|より|～|〜|-)\s*(\d{1,2})月(\d{1,2})日/);
  if (match) {
    return {
      startDate: toIsoDate(fallbackYear, match[1], match[2]),
      endDate: toIsoDate(fallbackYear, match[3], match[4]),
    };
  }

  match = text.match(/(\d{1,2})月(\d{1,2})日[^0-9]{0,16}[~〜～\-－][^0-9]{0,8}(\d{1,2})日/);
  if (match) {
    return {
      startDate: toIsoDate(fallbackYear, match[1], match[2]),
      endDate: toIsoDate(fallbackYear, match[1], match[3]),
    };
  }

  match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (match) {
    return {
      startDate: toIsoDate(match[1], match[2], match[3]),
      endDate: null,
    };
  }

  match = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (match) {
    return {
      startDate: toIsoDate(fallbackYear, match[1], match[2]),
      endDate: null,
    };
  }

  return {
    startDate: fallbackStartDate,
    endDate: null,
  };
}

function parseMonthDayYearRange(value) {
  const text = normalizeDateText(value);
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:-(\d{1,2})\/(\d{1,2})\/(\d{4}))?/);
  if (!match) return { startDate: null, endDate: null };
  return {
    startDate: toIsoDate(match[3], match[1], match[2]),
    endDate: match[4] ? toIsoDate(match[6], match[4], match[5]) : null,
  };
}

function parseYomiuriCardPeriod(value) {
  const text = decodeHtml(String(value ?? "")).replace(/\s+/g, " ").trim();
  const match = text.match(/(\d{1,2})月\s*(\d{1,2})日\s*[~〜]\s*(?:(\d{1,2})月\s*)?(\d{1,2})日/);
  if (!match) return { startDate: null, endDate: null };
  const currentYear = TODAY.getFullYear();
  const startMonth = Number(match[1]);
  const startDay = Number(match[2]);
  const endMonth = Number(match[3] || match[1]);
  const endDay = Number(match[4]);
  return {
    startDate: toIsoDate(currentYear, startMonth, startDay),
    endDate: toIsoDate(currentYear, endMonth, endDay),
  };
}

function normalizeDateText(value) {
  return decodeHtml(String(value ?? ""))
    .replace(/[年月]/g, ".")
    .replace(/[日（）()祝土火水木金月]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeDottedDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (!match) return null;
  return toIsoDate(match[1], match[2], match[3]);
}

function toIsoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeIsoDate(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isCurrentEventPeriod(period) {
  const start = parseDate(period?.startDate);
  const end = parseDate(period?.endDate) ?? start;
  if (!start) return false;
  if (start > TODAY) return false;
  return !end || end >= TODAY;
}

function isSameMonth(date, anchor) {
  if (!date) return false;
  return date.getFullYear() === anchor.getFullYear() && date.getMonth() === anchor.getMonth();
}

function isNextMonth(date, anchor) {
  if (!date) return false;
  const nextMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  return date.getFullYear() === nextMonth.getFullYear() && date.getMonth() === nextMonth.getMonth();
}

function compactHtml(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ");
}

function buildEventId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "event";
}

function titleKey(value) {
  return decodeHtml(String(value ?? ""))
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[【】「」『』"'“”]/g, "");
}

function extractFirstMatch(value, pattern) {
  return value.match(pattern)?.[1] ?? "";
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function absolutizeUrl(value, base) {
  if (!value) return "";
  try {
    return new URL(value, base).toString();
  } catch {
    return String(value);
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "INTERNET NEWS event collector/1.0 (+local personal use)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return await response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "INTERNET NEWS event collector/1.0 (+local personal use)",
      accept: "application/json,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return await response.json();
}

async function readJson(path, fallbackValue) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallbackValue;
  }
}
