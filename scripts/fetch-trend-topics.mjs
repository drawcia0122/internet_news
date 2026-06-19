import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";

import { buildDailyBrief } from "../lib/daily-brief.mjs";
import { logThumbnailCoverage, resolveThumbnail, sanitizeThumbnailUrl, absolutizeUrl, extractEncodedUrlsFromHtml, hasSuspiciousThumbnailMismatch } from "../lib/thumbnail-utils.mjs";
import { collectTrendTopics } from "../lib/trend-aggregator.mjs";
import { repairItemThumbnail } from "./repair-thumbnails.mjs";

const CATEGORY_LABELS = {
  general: "その他",
  tech: "テック",
  business: "経済",
  politics: "政治",
  entertainment: "エンタメ",
  games: "ゲーム",
  manga: "漫画",
  books: "本",
  sports: "スポーツ",
  "net-culture": "ネットカルチャー",
  matome: "2chまとめ系",
  crime: "犯罪・事件",
  adult: "アダルト系",
  world: "国際",
};

const NEWS_ARCHIVE_ALLOW_SOURCE_PATTERNS = [
  /yahoo!?ニュース/i,
  /nhk/i,
  /日本経済新聞|nikkei/i,
  /朝日新聞|asahi/i,
  /読売新聞|yomiuri/i,
  /毎日新聞|mainichi/i,
  /産経/i,
  /時事/i,
  /共同通信/i,
  /itmedia/i,
  /ねとらぼ/i,
  /j-cast/i,
  /テレ朝news/i,
  /tbs news/i,
  /fnn/i,
  /日テレnews/i,
  /東京新聞/i,
  /神戸新聞/i,
  /中日新聞/i,
  /北海道新聞/i,
  /西日本新聞/i,
  /沖縄タイムス/i,
  /琉球新報/i,
  /bbc news japan|bbc japan/i,
  /reuters japan/i,
  /automaton/i,
  /4gamer/i,
  /gamespark/i,
  /inside/i,
  /ファミ通/i,
  /電ファミ/i,
  /ポケモン公式|pokemon/i,
  /コミックナタリー|comic natalie/i,
  /アニメ！アニメ！|animeanime/i,
  /アニメイトタイムズ/i,
  /mantanweb/i,
  /scrap|リアル脱出ゲーム/i,
  /event checker|イベントチェッカー/i,
  /コラボカフェ/i,
  /kai-you/i,
  /togetter/i,
  /oricon/i,
  /impress/i,
  /watch/i,
];

const NEWS_ARCHIVE_EXCLUDE_SOURCE_PATTERNS = [
  /associated press|ap news/i,
  /cnn(?!.*japan)/i,
  /fox news/i,
  /the guardian/i,
  /new york times|nytimes/i,
  /washington post/i,
  /bloomberg(?!.*japan)/i,
  /financial times/i,
  /al jazeera/i,
  /abc news/i,
  /nbc news/i,
  /cbs news/i,
  /forbes(?!.*japan)/i,
  /techcrunch(?!.*japan)/i,
  /the verge/i,
  /engadget(?!.*japan)/i,
  /gizmodo(?!.*jp)/i,
  /polygon/i,
  /eurogamer/i,
  /ign(?!.*japan)/i,
  /kotaku/i,
  /variety/i,
  /deadline/i,
  /hollywood reporter/i,
  /hypebeast/i,
  /rolling stone(?!.*japan)/i,
  /people\.com/i,
  /tmz/i,
  /\bbbc\b(?!.*japan)/i,
];

const NEWS_ARCHIVE_ALLOW_HOST_PATTERNS = [
  /(?:^|\.)co\.jp$/i,
  /(?:^|\.)or\.jp$/i,
  /(?:^|\.)ne\.jp$/i,
  /(?:^|\.)go\.jp$/i,
  /(?:^|\.)ac\.jp$/i,
  /(?:^|\.)jp$/i,
  /yahoo\.co\.jp$/i,
  /nhk\.or\.jp$/i,
  /gamespark\.jp$/i,
  /inside-games\.jp$/i,
  /automaton-media\.com$/i,
  /animeanime\.jp$/i,
  /kai-you\.net$/i,
  /togetter\.com$/i,
  /itmedia\.co\.jp$/i,
  /j-cast\.com$/i,
  /natalie\.mu$/i,
  /famitsu\.com$/i,
  /4gamer\.net$/i,
  /denfaminicogamer\.jp$/i,
  /mantan-web\.jp$/i,
  /pokemon\.co\.jp$/i,
  /animatetimes\.com$/i,
  /scrapmagazine\.com$/i,
  /realdgame\.jp$/i,
  /event-checker\.info$/i,
  /collabo-cafe\.com$/i,
];

const NEWS_ARCHIVE_EXCLUDE_HOST_PATTERNS = [
  /news\.google\.com$/i,
  /apnews\.com$/i,
  /cnn\.com$/i,
  /foxnews\.com$/i,
  /theguardian\.com$/i,
  /nytimes\.com$/i,
  /washingtonpost\.com$/i,
  /bloomberg\.com$/i,
  /ft\.com$/i,
  /aljazeera\.com$/i,
  /abcnews\.go\.com$/i,
  /nbcnews\.com$/i,
  /cbsnews\.com$/i,
  /forbes\.com$/i,
  /techcrunch\.com$/i,
  /theverge\.com$/i,
  /engadget\.com$/i,
  /gizmodo\.com$/i,
  /polygon\.com$/i,
  /eurogamer\.net$/i,
  /ign\.com$/i,
  /kotaku\.com$/i,
  /variety\.com$/i,
  /deadline\.com$/i,
  /hollywoodreporter\.com$/i,
  /hypebeast\.com$/i,
  /rollingstone\.com$/i,
  /people\.com$/i,
  /tmz\.com$/i,
  /espn\.com$/i,
];

const FALLBACK_SUMMARY_PATTERNS = [
  /^今日の主要ニュースのひとつです。?$/,
  /分野の注目ニュース。?$/,
  /分野の話題を整理。?$/,
  /分野の主要トピック。?$/,
  /掲示板系の話題。?$/,
  /軽めに追えるネタ系トピック。?$/,
  /話題化しているニュース。?$/,
  /本・出版分野の注目トピック。?$/,
];

const GENERIC_TOKENS = new Set(["速報", "公開", "発表", "開始", "決定", "話題", "最新", "本日", "今日", "きょう", "判明", "登場", "配信", "発売", "開催", "疑惑"]);
const MAX_CURRENT_ITEMS = 180;
const MAX_ARCHIVE_ITEMS = 5200;
const DEDUPE_BUCKET_SCAN_LIMIT = 80;
const CURRENT_METADATA_ENRICH_LIMIT = MAX_CURRENT_ITEMS;
const ARCHIVE_METADATA_ENRICH_LIMIT = 320;
const METADATA_ENRICH_CONCURRENCY = 8;
const HOME_TOPIC_LIMIT = 30;
const HOME_SOURCE_MAX = 2;
const HOME_SOURCE_GROUP_MAX = 5;
const HOME_PERSONAL_MIN = 18;
const NEWS_ARCHIVE_MAX_ITEMS = 1500;
const HOME_NEWS_MAX_ITEMS = 200;
const HOME_NEWS_INITIAL_COUNT = 20;
const HOME_NEWS_PAGE_SIZE = 10;
const ADULT_NEWS_MAX_ITEMS = 80;
const BROWSE_24_TO_3D_LIMIT = 360;
const BROWSE_3_TO_7D_LIMIT = 120;
const BROWSE_7_TO_14D_LIMIT = 30;
const FETCH_STAGE_MIN_THUMBNAIL_RATE = 90;
const FETCH_STAGE_REPAIR_CONCURRENCY = 6;
const FETCH_STAGE_REPAIR_LIMIT = 120;
const SUSPICIOUS_DUPLICATE_THUMBNAIL_MIN_COUNT = 8;
const FETCH_STAGE_THUMBNAIL_STRICT = process.env.FETCH_STAGE_THUMBNAIL_STRICT === "1";

const previousCurrentPayload = await readArchivePayload("data/trend-topics.json");
const payload = await collectTrendTopics();
const dedupedItems = dedupeNearDuplicateItems(payload.items ?? []);
const capturedAt = payload.generatedAt ?? new Date().toISOString();
const curatedItems = selectCuratedTrendItems(dedupedItems, MAX_CURRENT_ITEMS);
await enrichItemsWithMetadata(curatedItems, { limit: CURRENT_METADATA_ENRICH_LIMIT });
await ensureFetchStageThumbnailCoverage(curatedItems, "current trend topics", { repairLimit: FETCH_STAGE_REPAIR_LIMIT });
const normalizedCuratedItems = curatedItems.map(normalizeStoredTopic);
const fallbackCurrentItems = Array.isArray(previousCurrentPayload.items)
  ? previousCurrentPayload.items.map(normalizeStoredTopic)
  : [];
const hasFreshCurrentItems = normalizedCuratedItems.length > 0;
const hasFreshArchiveItems = dedupedItems.length > 0;
const previousStableGeneratedAt = pickLatestGeneratedAt([
  previousCurrentPayload.generatedAt,
  payload.generatedAt,
]);
const currentItems = normalizedCuratedItems.length ? normalizedCuratedItems : fallbackCurrentItems;
const currentGeneratedAt = hasFreshCurrentItems
  ? capturedAt
  : previousStableGeneratedAt ?? capturedAt;
const currentPayload = {
  ...payload,
  generatedAt: currentGeneratedAt,
  items: currentItems,
};

const archivePath = "data/trend-topics-archive.json";
const archivePayload = await readArchivePayload(archivePath);
const mergedArchiveItems = dedupeNearDuplicateItems(
  mergeArchiveItems(
    (archivePayload.items ?? []).map(normalizeArchiveItem),
    dedupedItems.map(normalizeArchiveItem),
  ).filter((item) => isWithinArchiveWindow(item, capturedAt) && shouldKeepArchiveItem(item)),
);
await enrichItemsWithMetadata(mergedArchiveItems, { limit: ARCHIVE_METADATA_ENRICH_LIMIT });
const archiveGeneratedAt = hasFreshArchiveItems
  ? capturedAt
  : pickLatestGeneratedAt([
    archivePayload.generatedAt,
    previousCurrentPayload.generatedAt,
  ]) ?? currentGeneratedAt;
const nextArchivePayload = {
  generatedAt: archiveGeneratedAt,
  items: limitArchiveItems(mergedArchiveItems, MAX_ARCHIVE_ITEMS),
};
const derivedGeneratedAt = hasFreshCurrentItems || hasFreshArchiveItems
  ? capturedAt
  : pickLatestGeneratedAt([
    previousCurrentPayload.generatedAt,
    archivePayload.generatedAt,
  ]) ?? currentGeneratedAt;
const dailyBriefPayload = buildDailyBrief({
  currentItems: currentPayload.items,
  archiveItems: mergedArchiveItems,
  generatedAt: derivedGeneratedAt,
});
const browseTopicsPayload = buildBrowseTopicsPayload({
  archiveItems: mergedArchiveItems,
  generatedAt: derivedGeneratedAt,
});
const newsArchivePayload = buildNewsArchivePayload({
  archiveItems: mergedArchiveItems,
  generatedAt: derivedGeneratedAt,
});
const homeNewsPayloads = buildHomeNewsPayloads({
  newsArchivePayload,
  generatedAt: derivedGeneratedAt,
});
const adultNewsPayload = buildAdultNewsPayload({
  archiveItems: mergedArchiveItems,
  generatedAt: derivedGeneratedAt,
});
const homeTopicsPayload = buildHomeTopicsPayload({
  currentItems: currentPayload.items,
  archiveItems: mergedArchiveItems,
  generatedAt: derivedGeneratedAt,
});

if (!hasFreshCurrentItems) {
  console.warn("[trend-topics] no fresh current topics fetched; preserving previous current snapshot timestamp.");
}
if (!hasFreshArchiveItems) {
  console.warn("[trend-topics] no fresh archive topics fetched; preserving previous archive-derived timestamps.");
}

await mkdir("data", { recursive: true });
await writeFile(
  "data/trend-topics.json",
  `${JSON.stringify(currentPayload, null, 2)}\n`,
  "utf8",
);
await writeFile(
  archivePath,
  `${JSON.stringify(nextArchivePayload, null, 2)}\n`,
  "utf8",
);
await writeFile(
  "data/daily-brief.json",
  `${JSON.stringify(dailyBriefPayload, null, 2)}\n`,
  "utf8",
);
await writeFile(
  "data/trend-topics-browse.json",
  `${JSON.stringify(browseTopicsPayload, null, 2)}\n`,
  "utf8",
);
await writeFile(
  "data/news-archive.json",
  `${JSON.stringify(newsArchivePayload, null, 2)}\n`,
  "utf8",
);
await writeFile(
  "data/home-news.json",
  `${JSON.stringify(homeNewsPayloads.initial, null, 2)}\n`,
  "utf8",
);
for (const page of homeNewsPayloads.pages) {
  await writeFile(
    `data/home-news-page-${page.page}.json`,
    `${JSON.stringify(page.payload, null, 2)}\n`,
    "utf8",
  );
}
await removeStaleHomeNewsPages(homeNewsPayloads.pages.map((page) => page.page));
await writeFile(
  "data/adult-news.json",
  `${JSON.stringify(adultNewsPayload, null, 2)}\n`,
  "utf8",
);
await writeFile(
  "data/home-topics.json",
  `${JSON.stringify(homeTopicsPayload, null, 2)}\n`,
  "utf8",
);

logThumbnailCoverage(currentPayload.items);
console.log(`Saved ${currentPayload.items.length} trend topic(s).`);

function pickLatestGeneratedAt(values = []) {
  const timestamps = values
    .map((value) => {
      if (!value) return null;
      const time = new Date(value).getTime();
      if (!Number.isFinite(time) || time <= 0) return null;
      return { value, time };
    })
    .filter(Boolean)
    .sort((left, right) => right.time - left.time);
  return timestamps[0]?.value ?? null;
}

function normalizeStoredTopic(item) {
  const { thumbnail: _thumbnail, ...baseItem } = item;
  const categories = normalizeCategoryList(item.categories);
  const category = categories[0] ?? "general";

  const labelSource = Array.isArray(item.categoryLabels) ? item.categoryLabels : [];
  const categoryLabel = normalizeLegacyCategoryLabel(item.categoryLabel, category);
  const categoryLabels = labelSource.length
    ? labelSource.filter((label) => label !== "ネタ")
    : [CATEGORY_LABELS[category] ?? "その他"];
  const insights = buildStoredTopicInsights({
    ...item,
    category,
    categories,
    categoryLabels,
  });

  return {
    ...baseItem,
    category,
    categories,
    categoryLabel,
    categoryLabels,
    capturedAt: item.capturedAt ?? item.generatedAt ?? capturedAt,
    thumbnailUrl: sanitizeThumbnailUrl(item.thumbnailUrl),
    sourceSignals: sanitizeSourceSignals(item.sourceSignals).map((signal) => ({
      sourceId: signal.sourceId ?? null,
      source: signal.source ?? null,
      sourceName: signal.sourceName ?? null,
      sourceGroup: signal.sourceGroup ?? null,
      sourcePriority: Number(signal.sourcePriority ?? 0),
      official: Boolean(signal.official),
      specialist: Boolean(signal.specialist),
      forPersonal: Boolean(signal.forPersonal),
      sourceTags: Array.isArray(signal.sourceTags) ? signal.sourceTags.slice(0, 6) : [],
      title: signal.title ?? null,
      url: signal.url ?? null,
      canonicalUrl: signal.canonicalUrl ?? signal.url ?? null,
      publishedAt: signal.publishedAt ?? null,
      publishedLabel: signal.publishedLabel ?? null,
      thumbnailUrl: sanitizeThumbnailUrl(signal.thumbnailUrl),
      briefSummary: normalizeBriefSummaryText(signal.briefSummary),
      summary: normalizeSummaryText(signal.summary),
    })),
    briefSummary: normalizeBriefSummaryText(item.briefSummary) || buildStoredBriefSummary(item),
    summary: normalizeSummaryText(item.summary),
    whatHappened: normalizeSummaryText(item.whatHappened) || insights.whatHappened,
    whyHot: normalizeSummaryText(item.whyHot) || insights.whyHot,
    importantPoint: normalizeSummaryText(item.importantPoint) || insights.importantPoint,
    futureOutlook: normalizeSummaryText(item.futureOutlook) || insights.futureOutlook,
    targetAudience: Array.isArray(item.targetAudience) && item.targetAudience.length ? item.targetAudience.slice(0, 4) : insights.targetAudience,
  };
}

function buildHomeTopicsPayload({ currentItems = [], archiveItems = [], generatedAt = new Date().toISOString() }) {
  const sourceItems = dedupeNearDuplicateItems([
    ...currentItems,
    ...archiveItems
      .filter((item) => {
        const ageHours = (Date.now() - archiveTimestamp(item)) / (1000 * 60 * 60);
        return ageHours <= 14 * 24;
      })
      .slice(0, 1200),
  ]);
  const rankedItems = [...sourceItems]
    .sort((left, right) => {
      return homeTopicPriority(right) - homeTopicPriority(left)
        || Number(right.score ?? 0) - Number(left.score ?? 0)
        || archiveTimestamp(right) - archiveTimestamp(left);
    });
  const selectedItems = selectDiverseHomeTopics(rankedItems, HOME_TOPIC_LIMIT);

  return {
    generatedAt,
    items: selectedItems.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary ?? "",
      briefSummary: item.briefSummary ?? "",
      category: item.category,
      categories: Array.isArray(item.categories) ? item.categories : [],
      categoryLabels: Array.isArray(item.categoryLabels) ? item.categoryLabels : [],
      score: Number(item.score ?? 0),
      posts: Number(item.posts ?? 1),
      metricLabel: item.metricLabel ?? "source",
      thumbnailUrl: sanitizeThumbnailUrl(item.thumbnailUrl),
      publishedAt: item.publishedAt ?? item.sourceSignals?.[0]?.publishedAt ?? null,
      capturedAt: item.capturedAt ?? generatedAt,
      time: item.time ?? item.sourceSignals?.[0]?.publishedLabel ?? null,
      hotReasons: Array.isArray(item.hotReasons) ? item.hotReasons.slice(0, 4) : [],
      sourceSignals: sanitizeSourceSignals(item.sourceSignals).slice(0, 3).map((signal) => ({
        sourceId: signal.sourceId ?? null,
        source: signal.source ?? null,
        sourceName: signal.sourceName ?? null,
        sourceGroup: signal.sourceGroup ?? null,
        sourcePriority: Number(signal.sourcePriority ?? 0),
        official: Boolean(signal.official),
        specialist: Boolean(signal.specialist),
        forPersonal: Boolean(signal.forPersonal),
        sourceTags: Array.isArray(signal.sourceTags) ? signal.sourceTags.slice(0, 6) : [],
        title: signal.title ?? null,
        url: signal.url ?? null,
        canonicalUrl: signal.canonicalUrl ?? signal.url ?? null,
        publishedAt: signal.publishedAt ?? null,
        publishedLabel: signal.publishedLabel ?? null,
        thumbnailUrl: sanitizeThumbnailUrl(signal.thumbnailUrl),
        summary: normalizeSummaryText(signal.summary ?? ''),
      })),
      searchLinks: Array.isArray(item.searchLinks) ? item.searchLinks.slice(0, 1) : [],
      whatHappened: item.whatHappened ?? null,
      whyHot: item.whyHot ?? null,
      importantPoint: item.importantPoint ?? null,
      futureOutlook: item.futureOutlook ?? null,
      targetAudience: Array.isArray(item.targetAudience) ? item.targetAudience.slice(0, 4) : [],
    })),
  };
}

function selectDiverseHomeTopics(items, limit = HOME_TOPIC_LIMIT) {
  const primaryPool = items.filter(isHomeDiscoveryFriendly);
  const secondaryPool = items.filter((item) => !isHomeDiscoveryFriendly(item));
  const selected = [];
  const state = createHomeSelectionState();

  fillHomeSelection(selected, state, primaryPool, Math.min(limit, HOME_PERSONAL_MIN), {
    allowSourceOverflow: false,
    allowGroupOverflow: false,
    allowCategoryOverflow: false,
  });

  fillHomeSelection(selected, state, primaryPool, limit, {
    allowSourceOverflow: true,
    allowGroupOverflow: false,
    allowCategoryOverflow: true,
  });

  fillHomeSelection(selected, state, secondaryPool, limit, {
    allowSourceOverflow: false,
    allowGroupOverflow: false,
    allowCategoryOverflow: false,
  });

  fillHomeSelection(selected, state, secondaryPool, limit, {
    allowSourceOverflow: true,
    allowGroupOverflow: true,
    allowCategoryOverflow: true,
  });

  return selected.slice(0, limit);
}

function createHomeSelectionState() {
  return {
    sourceCounts: new Map(),
    sourceGroupCounts: new Map(),
    categoryCounts: new Map(),
    selectedIds: new Set(),
  };
}

function fillHomeSelection(selected, state, items, limit, options = {}) {
  for (const item of items) {
    if (selected.length >= limit) break;
    if (state.selectedIds.has(item.id)) continue;
    if (!canSelectHomeTopic(item, state, options)) continue;

    selected.push(item);
    registerHomeTopicSelection(item, state);
  }
}

function canSelectHomeTopic(item, state, options = {}) {
  const sourceKey = homeTopicPrimarySourceKey(item);
  const groupKey = homeTopicPrimarySourceGroup(item);
  const categoryKey = homeTopicPrimaryCategory(item);
  const sourceCount = state.sourceCounts.get(sourceKey) ?? 0;
  const groupCount = state.sourceGroupCounts.get(groupKey) ?? 0;
  const categoryCount = state.categoryCounts.get(categoryKey) ?? 0;
  const hasStrongScore = homeTopicPriority(item) >= 92;
  const sourceLimit = options.allowSourceOverflow && hasStrongScore ? HOME_SOURCE_MAX + 1 : HOME_SOURCE_MAX;
  const groupLimit = options.allowGroupOverflow ? HOME_SOURCE_GROUP_MAX + 1 : HOME_SOURCE_GROUP_MAX;
  const categoryLimit = options.allowCategoryOverflow ? 10 : 6;

  if (sourceCount >= sourceLimit) return false;
  if (groupCount >= groupLimit) return false;
  if (categoryCount >= categoryLimit && !hasStrongScore) return false;
  return true;
}

function registerHomeTopicSelection(item, state) {
  state.selectedIds.add(item.id);
  const sourceKey = homeTopicPrimarySourceKey(item);
  const groupKey = homeTopicPrimarySourceGroup(item);
  const categoryKey = homeTopicPrimaryCategory(item);
  state.sourceCounts.set(sourceKey, (state.sourceCounts.get(sourceKey) ?? 0) + 1);
  state.sourceGroupCounts.set(groupKey, (state.sourceGroupCounts.get(groupKey) ?? 0) + 1);
  state.categoryCounts.set(categoryKey, (state.categoryCounts.get(categoryKey) ?? 0) + 1);
}

function isHomeDiscoveryFriendly(item) {
  const text = topicText(item);
  const category = homeTopicPrimaryCategory(item);
  const signal = sanitizeSourceSignals(item.sourceSignals).find(Boolean);
  const sourceGroup = String(signal?.sourceGroup ?? "");
  const sourceName = String(signal?.sourceName ?? signal?.source ?? "");

  if (/Google News \/ (スポーツ|政治|経済|国際|犯罪・事件|地域|国内)|Yahoo!ニュース \/ (スポーツ|地域|国内|経済|国際)/.test(sourceName)) {
    return false;
  }
  if (signal?.forPersonal || signal?.specialist) return true;
  if (/games|anime|net-culture|steam|events|pokemon/.test(sourceGroup)) return true;
  if (/AUTOMATON|Game\*Spark|INSIDE|ファミ通|4Gamer|電ファミ|ポケモン公式|アニメ！アニメ！|アニメイトタイムズ|MANTANWEB|コミックナタリー|KAI-YOU|ねとらぼ|Togetter|ITmedia|Steam|SCRAP|リアル脱出ゲーム|Event Checker|コラボカフェ/i.test(sourceName)) return true;
  if (["games", "manga", "entertainment", "sns", "net-culture"].includes(category)) return true;
  if (/ポケモン|pokemon|任天堂|nintendo|switch|steam|ゲーム|漫画|マンガ|アニメ|炎上|バズ|ミーム|セール|割引|脱出ゲーム|リアル脱出ゲーム|scrap|謎解き|イマーシブ|展示会|ポップアップ|コラボカフェ|体験型/.test(text)) return true;
  return false;
}

function homeTopicPrimarySourceKey(item) {
  const signal = sanitizeSourceSignals(item.sourceSignals).find(Boolean);
  return signal?.sourceName ?? signal?.source ?? "unknown-source";
}

function homeTopicPrimarySourceGroup(item) {
  const signal = sanitizeSourceSignals(item.sourceSignals).find(Boolean);
  return signal?.sourceGroup ?? "unknown-group";
}

function homeTopicPrimaryCategory(item) {
  return item?.category ?? item?.categories?.[0] ?? "general";
}

function buildBrowseTopicsPayload({ archiveItems = [], generatedAt = new Date().toISOString() }) {
  const rankedItems = rankBrowseItems(archiveItems.filter((item) => !isMalformedArchiveItem(item)));
  const bucket24to3d = [];
  const bucket3to7d = [];
  const bucket7to14d = [];

  for (const item of rankedItems) {
    const ageHours = (Date.now() - archiveTimestamp(item)) / (1000 * 60 * 60);
    if (ageHours <= 24 || ageHours > 14 * 24) continue;
    if (ageHours < 72) {
      if (bucket24to3d.length < BROWSE_24_TO_3D_LIMIT) bucket24to3d.push(item);
      continue;
    }
    if (ageHours < 168) {
      if (bucket3to7d.length < BROWSE_3_TO_7D_LIMIT) bucket3to7d.push(item);
      continue;
    }
    if (bucket7to14d.length < BROWSE_7_TO_14D_LIMIT) bucket7to14d.push(item);
  }

  const limitedItems = [...bucket24to3d, ...bucket3to7d, ...bucket7to14d];

  return {
    generatedAt,
    items: limitedItems.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary ?? "",
      category: item.category,
      categories: Array.isArray(item.categories) ? item.categories : [],
      categoryLabel: item.categoryLabel ?? null,
      categoryLabels: Array.isArray(item.categoryLabels) ? item.categoryLabels : [],
      score: Number(item.score ?? 0),
      posts: Number(item.posts ?? 1),
      metricLabel: item.metricLabel ?? "source",
      thumbnailUrl: sanitizeThumbnailUrl(item.thumbnailUrl),
      publishedAt: item.publishedAt ?? item.sourceSignals?.[0]?.publishedAt ?? null,
      capturedAt: item.capturedAt ?? generatedAt,
      time: item.time ?? item.sourceSignals?.[0]?.publishedLabel ?? null,
      hotReasons: Array.isArray(item.hotReasons) ? item.hotReasons.slice(0, 2) : [],
      sourceSignals: sanitizeSourceSignals(item.sourceSignals).slice(0, 1).map((signal) => ({
        sourceId: signal.sourceId ?? null,
        source: signal.source ?? null,
        sourceName: signal.sourceName ?? null,
        sourceGroup: signal.sourceGroup ?? null,
        sourcePriority: Number(signal.sourcePriority ?? 0),
        official: Boolean(signal.official),
        specialist: Boolean(signal.specialist),
        forPersonal: Boolean(signal.forPersonal),
        sourceTags: Array.isArray(signal.sourceTags) ? signal.sourceTags.slice(0, 6) : [],
        title: signal.title ?? null,
        url: signal.url ?? null,
        canonicalUrl: signal.canonicalUrl ?? signal.url ?? null,
        publishedAt: signal.publishedAt ?? null,
        publishedLabel: signal.publishedLabel ?? null,
      })),
      whatHappened: item.whatHappened ?? null,
      whyHot: item.whyHot ?? null,
      importantPoint: item.importantPoint ?? null,
      targetAudience: Array.isArray(item.targetAudience) ? item.targetAudience.slice(0, 4) : [],
    })),
  };
}

function buildNewsArchivePayload({ archiveItems = [], generatedAt = new Date().toISOString() }) {
  const domesticItems = archiveItems
    .filter((item) => isWithinArchiveWindow(item, generatedAt))
    .filter((item) => isDomesticNewsArchiveItem(item))
    .filter((item) => !isMalformedArchiveItem(item));

  const sortedItems = [...domesticItems].sort((left, right) => {
    const timeDiff = archiveTimestamp(right) - archiveTimestamp(left);
    if (timeDiff !== 0) return timeDiff;
    return Number(right.score ?? 0) - Number(left.score ?? 0);
  });

  return {
    generatedAt,
    items: sortedItems.slice(0, NEWS_ARCHIVE_MAX_ITEMS).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary ?? "",
      briefSummary: item.briefSummary ?? "",
      category: item.category,
      categories: Array.isArray(item.categories) ? item.categories : [],
      categoryLabel: item.categoryLabel ?? null,
      categoryLabels: Array.isArray(item.categoryLabels) ? item.categoryLabels : [],
      score: Number(item.score ?? 0),
      posts: Number(item.posts ?? 1),
      metricLabel: item.metricLabel ?? "source",
      thumbnailUrl: sanitizeThumbnailUrl(item.thumbnailUrl),
      publishedAt: item.publishedAt ?? item.sourceSignals?.[0]?.publishedAt ?? null,
      capturedAt: item.capturedAt ?? generatedAt,
      time: item.time ?? item.sourceSignals?.[0]?.publishedLabel ?? null,
      sourceName: item.sourceName ?? item.sourceSignals?.[0]?.sourceName ?? item.sourceSignals?.[0]?.source ?? null,
      sourceUrl: chooseBestSourceUrl(item),
      hotReasons: Array.isArray(item.hotReasons) ? item.hotReasons.slice(0, 2) : [],
      sourceSignals: sanitizeSourceSignals(item.sourceSignals).slice(0, 3).map((signal) => ({
        sourceId: signal.sourceId ?? null,
        source: signal.source ?? null,
        sourceName: signal.sourceName ?? null,
        sourceGroup: signal.sourceGroup ?? null,
        sourcePriority: Number(signal.sourcePriority ?? 0),
        official: Boolean(signal.official),
        specialist: Boolean(signal.specialist),
        forPersonal: Boolean(signal.forPersonal),
        sourceTags: Array.isArray(signal.sourceTags) ? signal.sourceTags.slice(0, 6) : [],
        title: signal.title ?? null,
        url: signal.url ?? null,
        canonicalUrl: signal.canonicalUrl ?? signal.url ?? null,
        publishedAt: signal.publishedAt ?? null,
        publishedLabel: signal.publishedLabel ?? null,
        thumbnailUrl: sanitizeThumbnailUrl(signal.thumbnailUrl),
      })),
      whatHappened: item.whatHappened ?? null,
      whyHot: item.whyHot ?? null,
      importantPoint: item.importantPoint ?? null,
      targetAudience: Array.isArray(item.targetAudience) ? item.targetAudience.slice(0, 4) : [],
    })),
  };
}

function buildHomeNewsPayloads({ newsArchivePayload, generatedAt = new Date().toISOString() }) {
  const items = (Array.isArray(newsArchivePayload?.items) ? newsArchivePayload.items : []).slice(0, HOME_NEWS_MAX_ITEMS);
  const totalCount = items.length;
  const categoryCounts = buildHomeNewsCategoryCounts(items);
  const initialItems = items.slice(0, HOME_NEWS_INITIAL_COUNT);
  const remainingItems = items.slice(HOME_NEWS_INITIAL_COUNT);
  const pages = [];

  for (let offset = 0; offset < remainingItems.length; offset += HOME_NEWS_PAGE_SIZE) {
    const pageNumber = pages.length + 2;
    const pageItems = remainingItems.slice(offset, offset + HOME_NEWS_PAGE_SIZE);
    const deliveredCount = HOME_NEWS_INITIAL_COUNT + offset + pageItems.length;
    const hasMore = deliveredCount < totalCount;
    pages.push({
      page: pageNumber,
      payload: {
        generatedAt,
        totalCount,
        categoryCounts,
        hasMore,
        nextPage: hasMore ? pageNumber + 1 : 0,
        items: pageItems,
      },
    });
  }

  return {
    initial: {
      generatedAt,
      totalCount,
      categoryCounts,
      hasMore: totalCount > HOME_NEWS_INITIAL_COUNT,
      nextPage: totalCount > HOME_NEWS_INITIAL_COUNT ? 2 : 0,
      items: initialItems,
    },
    pages,
  };
}

function buildHomeNewsCategoryCounts(items = []) {
  const counts = { all: 0 };
  for (const category of Object.keys(CATEGORY_LABELS)) counts[category] = 0;

  for (const item of items) {
    counts.all += 1;
    if (item?.category === "general") counts.general += 1;
    const categories = [...new Set([
      item?.category,
      ...(Array.isArray(item?.categories) ? item.categories : []),
    ].filter(Boolean))];

    for (const category of categories) {
      if (category === "general") continue;
      if (Object.prototype.hasOwnProperty.call(counts, category)) {
        counts[category] += 1;
      }
    }
  }

  return counts;
}

async function removeStaleHomeNewsPages(activePages = []) {
  const activeSet = new Set(activePages.map((value) => Number(value)).filter((value) => Number.isFinite(value)));
  const entries = await readdir("data").catch(() => []);
  const staleFiles = entries.filter((entry) => {
    const match = entry.match(/^home-news-page-(\d+)\.json$/);
    if (!match) return false;
    return !activeSet.has(Number(match[1]));
  });
  await Promise.all(staleFiles.map((file) => unlink(`data/${file}`).catch(() => {})));
}

function buildAdultNewsPayload({ archiveItems = [], generatedAt = new Date().toISOString() }) {
  const items = archiveItems
    .filter((item) => isWithinArchiveWindow(item, generatedAt))
    .filter((item) => isAdultNewsArchiveItem(item))
    .filter((item) => !isMalformedArchiveItem(item))
    .filter((item) => Boolean(sanitizeThumbnailUrl(item?.thumbnailUrl ?? item?.thumbnail)))
    .sort((left, right) => {
      const timeDiff = archiveTimestamp(right) - archiveTimestamp(left);
      if (timeDiff !== 0) return timeDiff;
      return Number(right.score ?? 0) - Number(left.score ?? 0);
    })
    .slice(0, ADULT_NEWS_MAX_ITEMS);

  return {
    generatedAt,
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary ?? "",
      briefSummary: item.briefSummary ?? "",
      category: item.category,
      categories: Array.isArray(item.categories) ? item.categories : [],
      categoryLabel: item.categoryLabel ?? null,
      categoryLabels: Array.isArray(item.categoryLabels) ? item.categoryLabels : [],
      score: Number(item.score ?? 0),
      hotScore: Number(item.hotScore ?? item.score ?? 0),
      posts: Number(item.posts ?? 1),
      metricLabel: item.metricLabel ?? "source",
      thumbnailUrl: sanitizeThumbnailUrl(item.thumbnailUrl),
      publishedAt: item.publishedAt ?? item.sourceSignals?.[0]?.publishedAt ?? null,
      capturedAt: item.capturedAt ?? generatedAt,
      time: item.time ?? item.sourceSignals?.[0]?.publishedLabel ?? null,
      sourceName: item.sourceName ?? item.sourceSignals?.[0]?.sourceName ?? item.sourceSignals?.[0]?.source ?? null,
      sourceUrl: chooseBestSourceUrl(item),
      hotReasons: Array.isArray(item.hotReasons) ? item.hotReasons.slice(0, 3) : [],
      targetAudience: Array.isArray(item.targetAudience) ? item.targetAudience.slice(0, 4) : [],
    })),
  };
}

function rankBrowseItems(items) {
  return [...items].sort((left, right) => {
    const rightThumb = sanitizeThumbnailUrl(right.thumbnailUrl) ? 1 : 0;
    const leftThumb = sanitizeThumbnailUrl(left.thumbnailUrl) ? 1 : 0;
    const rightDiscovery = isHomeDiscoveryFriendly(right) ? 1 : 0;
    const leftDiscovery = isHomeDiscoveryFriendly(left) ? 1 : 0;
    return rightThumb - leftThumb
      || rightDiscovery - leftDiscovery
      || Number(right.score ?? 0) - Number(left.score ?? 0)
      || archiveTimestamp(right) - archiveTimestamp(left);
  });
}

function isDomesticNewsArchiveItem(item) {
  const sourceName = newsArchiveSourceName(item);
  if (NEWS_ARCHIVE_ALLOW_SOURCE_PATTERNS.some((pattern) => pattern.test(sourceName))) return true;
  if (NEWS_ARCHIVE_EXCLUDE_SOURCE_PATTERNS.some((pattern) => pattern.test(sourceName))) return false;

  const host = newsArchiveSourceHost(item);
  if (host) {
    if (NEWS_ARCHIVE_EXCLUDE_HOST_PATTERNS.some((pattern) => pattern.test(host))) return false;
    if (NEWS_ARCHIVE_ALLOW_HOST_PATTERNS.some((pattern) => pattern.test(host))) return true;
  }

  const locale = String(
    item?.language
      ?? item?.lang
      ?? item?.locale
      ?? item?.sourceSignals?.[0]?.language
      ?? item?.sourceSignals?.[0]?.locale
      ?? ""
  ).toLowerCase();
  if (locale && !/(^ja\b|japan|ja-jp)/.test(locale)) return false;

  return hasJapaneseNewsText(`${item?.title ?? ""} ${item?.summary ?? ""} ${item?.briefSummary ?? ""}`);
}

function isAdultNewsArchiveItem(item) {
  const text = adultNewsText(item);
  if (!text) return false;
  if (/詐欺|被害|未納料金|架空請求|注意喚起|摘発|逮捕|相談急増/.test(text)) return false;
  if (/ランキング|売れ筋|セール開催中|%off|ポイント還元|クーポン/.test(text) && !/セクシー女優|av女優|アダルトビデオ|成人向け|18禁|r-?18/.test(text)) return false;

  const explicitAdult = /fanza|dlsite|dmm|同人音声|エロ漫画|アダルトビデオ|av女優|セクシー女優|成人向け|18禁|r-?18|アダルト作品|アダルト業界/.test(text);
  const gravureAdult = /グラビア|写真集|ランジェリー|水着姿|セクシーショット/.test(text);
  const hasAdultCategory = normalizeCategoryList(item?.categories ?? [item?.category]).includes("adult");
  return explicitAdult || (hasAdultCategory && gravureAdult);
}

function isMalformedArchiveItem(item) {
  const sourceName = String(
    item?.sourceName
      ?? item?.source
      ?? item?.sourceSignals?.[0]?.sourceName
      ?? item?.sourceSignals?.[0]?.source
      ?? ""
  ).toLowerCase();
  const text = [
    item?.title,
    item?.summary,
    item?.briefSummary,
  ].filter(Boolean).join(" ").toLowerCase();
  const thumbnailUrl = String(item?.thumbnailUrl ?? item?.thumbnail ?? "").toLowerCase();

  if (/japanese-tech-writing\/skill|\/skill\.md\b|\/readme\b/.test(text)) return true;
  if (sourceName.includes("はてな") && /githubassets\.com\/assets\/gist-og-image|anond\.hatelabo\.jp\/assets\//.test(thumbnailUrl)) return true;
  return false;
}

function adultNewsText(item) {
  return [
    item?.title,
    item?.summary,
    item?.briefSummary,
    item?.category,
    ...(item?.categories ?? []),
    ...(item?.categoryLabels ?? []),
    item?.sourceName,
    item?.sourceUrl,
    ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals.flatMap((signal) => [
      signal?.sourceName,
      signal?.sourceGroup,
      signal?.title,
      signal?.summary,
      signal?.url,
    ]) : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function newsArchiveSourceName(item) {
  return [
    item?.sourceName,
    item?.source,
    item?.sourceSignals?.[0]?.sourceName,
    item?.sourceSignals?.[0]?.source,
  ].filter(Boolean).join(" / ");
}

function newsArchiveSourceHost(item) {
  const candidates = [
    item?.sourceUrl,
    item?.url,
    item?.link,
    ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals.map((signal) => signal?.url) : []),
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (!value) continue;
    try {
      return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    } catch {}
  }

  return "";
}

function hasJapaneseNewsText(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  if (!text) return true;
  const japaneseCount = (text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  return japaneseCount >= Math.max(8, Math.floor(latinCount * 0.35));
}

function homeTopicPriority(item) {
  const baseScore = Number(item.score ?? 0);
  const freshness = isFreshTopic(item) ? 12 : 0;
  const sourceBonus = Math.min(12, Math.max(0, Number(item.posts ?? 1) - 1) * 4);
  const importance = isHighImportanceText(topicText(item), item.categories ?? [], item.category) ? 24 : 0;
  const discoveryBonus = isHomeDiscoveryFriendly(item) ? 18 : 0;
  const suppressionPenalty = homeTopicSuppressionPenalty(item);
  const penalty = isLowPriorityText(topicText(item)) ? 60 : 0;
  return baseScore + freshness + sourceBonus + importance + discoveryBonus - suppressionPenalty - penalty;
}

function homeTopicSuppressionPenalty(item) {
  const text = topicText(item);
  const category = homeTopicPrimaryCategory(item);
  const sourceName = homeTopicPrimarySourceKey(item);
  let penalty = 0;

  if (category === "sports") penalty += 48;
  if (category === "politics") penalty += 26;
  if (category === "business" && !isHomeDiscoveryFriendly(item)) penalty += 18;
  if (category === "world" && !isHomeDiscoveryFriendly(item)) penalty += 18;
  if (category === "general" && /県内|市内|町内|小学生|中学生|高校生|海水浴場|商店街|観光協会|地域/.test(text)) penalty += 34;
  if (category === "world" && !/ゲーム|アニメ|漫画|sns|ネット|ミーム|ポケモン|switch|steam/.test(text)) penalty += 10;
  if (/Yahoo!ニュース \/ 地域/.test(sourceName)) penalty += 32;
  if (/Yahoo!ニュース \/ スポーツ/.test(sourceName)) penalty += 40;
  if (/Google News \/ スポーツ/.test(sourceName)) penalty += 42;
  if (/Google News \/ 政治/.test(sourceName)) penalty += 26;
  if (/Google News \/ 経済/.test(sourceName)) penalty += 22;
  if (/Google News \/ 国際/.test(sourceName) && !isHomeDiscoveryFriendly(item)) penalty += 18;
  if (/BBC World|BBC Business/.test(sourceName) && !isHomeDiscoveryFriendly(item)) penalty += 12;

  return penalty;
}

function buildStoredTopicInsights(item) {
  return {
    whatHappened: buildWhatHappened(item),
    whyHot: buildWhyHot(item),
    importantPoint: buildImportantPoint(item),
    futureOutlook: buildFutureOutlook(item),
    targetAudience: buildTargetAudience(item),
  };
}

function topicText(item) {
  return [
    item.title,
    item.summary,
    item.briefSummary,
    item.category,
    ...(item.categories ?? []),
    ...(item.categoryLabels ?? []),
    ...(item.hotReasons ?? []),
    ...(item.sourceSignals ?? []).flatMap((signal) => [
      signal.title,
      signal.summary,
      signal.sourceName,
      signal.sourceGroup,
      ...(Array.isArray(signal.sourceTags) ? signal.sourceTags : []),
    ]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildWhatHappened(item) {
  const title = String(item.title ?? "").replace(/^【[^】]+】\s*/u, "").trim();
  if (!title) return "新しい動きが出ています。";
  return trimInsightText(title.replace(/[。！？!?].*$/u, ""), 46) || "新しい動きが出ています。";
}

function buildWhyHot(item) {
  const reasons = Array.isArray(item.hotReasons) ? item.hotReasons.filter(Boolean) : [];
  if (reasons.length) return trimInsightText(reasons[0], 56);
  if (Number(item.posts ?? 1) >= 3) return "複数媒体で関連記事がまとまっており、更新が早い話題です。";
  if (Number(item.posts ?? 1) >= 2) return "複数媒体で同じ話題が扱われています。";
  if (isFreshTopic(item)) return "直近の新しい話題として浮上しています。";
  return "関連分野の流れを追ううえで押さえておきたい話題です。";
}

function buildImportantPoint(item) {
  const text = topicText(item);
  if (/セール|割引|キャンペーン|クーポン|ポイント還元|無料配布/.test(text)) {
    return "終了前の条件確認や購入判断に直結しやすい情報です。";
  }
  if (/脱出ゲーム|リアル脱出ゲーム|scrap|謎解き|イマーシブ|展示会|ポップアップ|コラボカフェ|体験型/.test(text)) {
    return "開催期間、会場、予約条件を早めに押さえたいイベント系の話題です。";
  }
  if (/ゲーム|任天堂|nintendo|switch|steam|ps5|xbox|発売|抽選|予約/.test(text)) {
    return "購入、予約、抽選、プレイ予定の判断に影響しやすい話題です。";
  }
  if (isAiText(text)) {
    return "仕事や制作環境、導入判断に影響する可能性があります。";
  }
  if (/政治|国会|首相|選挙|法案|制度|経済|物価|株価|金利|国際|外交|事件|逮捕|裁判/.test(text)) {
    return "生活や社会の判断材料として優先度が高い話題です。";
  }
  if (/sns|xで話題|バズ|炎上|ミーム|2ch|5ch|まとめ/.test(text)) {
    return "ネット上の空気や評判の変化を早めに掴む材料になります。";
  }
  return "後で追うべきかを短時間で判断する材料になります。";
}

function buildFutureOutlook(item) {
  const text = topicText(item);
  if (/予約|抽選|発売|配信|公開|発表/.test(text)) {
    return "次回発表、受付状況、在庫や公開後の反応が焦点です。";
  }
  if (/セール|キャンペーン|クーポン|割引/.test(text)) {
    return "終了日時、対象範囲、追加施策の有無を確認したい局面です。";
  }
  if (isAiText(text)) {
    return "料金、利用条件、競合各社の追随が次の注目点です。";
  }
  if (/事件|逮捕|送検|起訴|判決|事故/.test(text)) {
    return "捜査の進展や当事者発表などの続報が焦点です。";
  }
  if (/政治|法案|制度|経済|株価|物価|金利/.test(text)) {
    return "追加説明、市場反応、実施時期や影響範囲の見極めが必要です。";
  }
  return "追加発表、関連記事、SNS上の反応の広がりを追う段階です。";
}

function buildTargetAudience(item) {
  const text = topicText(item);
  const values = [];
  if (/ポケモン|pokemon|ポケカ/.test(text)) values.push("ポケモンユーザー");
  if (/ゲーム|任天堂|nintendo|switch|steam|ps5|xbox/.test(text)) values.push("ゲームユーザー");
  if (isAiText(text)) values.push("AI利用者");
  if (/iphone|android|スマホ|ガジェット|pc|gpu|nvidia|apple|google/.test(text)) values.push("ガジェット好き");
  if (/セール|割引|キャンペーン|クーポン|ポイント還元|fanza|dlsite/.test(text)) values.push("セール好き");
  if (/漫画|マンガ|アニメ|声優|コミック/.test(text)) values.push("漫画・アニメ好き");
  if (/sns|炎上|バズ|ミーム|ネット文化|2ch|5ch|まとめ/.test(text)) values.push("ネット文化を追う人");
  if (/脱出ゲーム|リアル脱出ゲーム|scrap|謎解き|イマーシブ|展示会|ポップアップ|コラボカフェ|体験型/.test(text)) values.push("体験型イベント好き");
  if (/株|投資|決算|金利|物価/.test(text)) values.push("投資家");
  if (/政治|事件|国際|外交|裁判/.test(text)) values.push("時事ニュースを追う人");
  return [...new Set(values)].slice(0, 4);
}

function trimInsightText(value, limit = 56) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function isFreshTopic(item) {
  const value = item?.sourceSignals?.[0]?.publishedAt ?? item?.publishedAt ?? item?.capturedAt ?? null;
  const timestamp = new Date(value ?? "").getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= 24 * 60 * 60 * 1000;
}

function isAiText(value) {
  return /(?:^|[^a-z])ai(?:[^a-z]|$)|生成ai|chatgpt|openai|claude|gemini|llm/i.test(value);
}

function isHighImportanceText(value, categories = [], fallbackCategory = "") {
  const categoryList = Array.isArray(categories) ? categories : [fallbackCategory].filter(Boolean);
  if (categoryList.some((category) => ["crime", "politics", "business", "world"].includes(category))) return true;
  return /(地震|大雨|台風|避難|事故|火災|殺人|逮捕|起訴|判決|法案|制度|選挙|関税|物価|株価|決算|iphone|switch|ps5|steam|任天堂|openai|chatgpt|claude|gemini|nvidia|microsoft|google|apple|セール|クーポン|抽選|値上げ)/.test(value);
}

function isLowPriorityText(value) {
  return /(pr times|共同通信prワイヤー|valuepress|＠press|atpress|dream news|ドリームニュース|newscast|プレスリリース|スポンサー|タイアップ|広告)/i.test(value)
    || /(地域対応|エリア対応|正式スタート|サービス開始|提供開始|販売開始|導入開始|参加者募集|受講者募集|開催のお知らせ|来場者募集|観光イベント|ワークショップ|講習会|地域おこし|セミナー|講演会|説明会|体験会|初級クラス)/.test(value)
    || /(地元の魅力をアピール|観光pr|地域pr|やってみた|首長と○○やってみた)/.test(value)
    || /(トークセッションを開催|対談しました|本学の学生|meijo-u\.ac\.jp|大学公式サイト)/i.test(value)
    || /(映画レビュー|の映画レビュー|高市首相の動静|首相の動静|｜エンタメ|エキスパート\b)/.test(value)
    || (/(累計動画|累計導入|導入実績|掲載実績|利用者数|満足度|受賞歴|フォロワー数)/.test(value) && !/(逮捕|事件|決算|法案|選挙|抽選|値上げ|事故)/.test(value));
}

function normalizeCategoryList(categories) {
  const values = Array.isArray(categories) ? categories : [];
  return [...new Set([...(values || []), "general"].filter((category) => category && category !== "fun"))];
}

function normalizeLegacyCategoryLabel(value, fallbackCategory) {
  if (value === "ネタ") return CATEGORY_LABELS[fallbackCategory] ?? "その他";
  return value ?? CATEGORY_LABELS[fallbackCategory] ?? "その他";
}

function normalizeCategory(category) {
  if (category === "fun") return "general";
  return category;
}

function selectCuratedTrendItems(items, maxItems) {
  const seededMatome = items
    .filter(isCuratableMatomeItem)
    .slice(0, Math.min(3, maxItems));
  const seededIds = new Set(seededMatome.map((item) => item.id));
  const remainingItems = items.filter((item) => !seededIds.has(item.id));
  const withThumbnail = remainingItems.filter((item) => sanitizeThumbnailUrl(item.thumbnailUrl ?? item.thumbnail));
  const withoutThumbnail = remainingItems.filter((item) => !sanitizeThumbnailUrl(item.thumbnailUrl ?? item.thumbnail));
  const selectedWithThumbnail = withThumbnail.slice(0, Math.max(0, maxItems - seededMatome.length));
  const maxWithoutThumbnail = Math.min(
    withoutThumbnail.length,
    selectedWithThumbnail.length,
    Math.max(0, maxItems - seededMatome.length - selectedWithThumbnail.length),
  );
  const selectedWithoutThumbnail = withoutThumbnail.slice(0, maxWithoutThumbnail);

  return [...seededMatome, ...selectedWithThumbnail, ...selectedWithoutThumbnail]
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0) || archiveTimestamp(right) - archiveTimestamp(left))
    .slice(0, maxItems);
}

function isCuratableMatomeItem(item) {
  const categories = Array.isArray(item?.categories) ? item.categories : [];
  if (item?.category !== "matome" && !categories.includes("matome")) return false;

  const value = [
    item?.title,
    item?.summary,
    ...(item?.sourceSignals ?? []).flatMap((signal) => [signal?.title, signal?.summary, signal?.sourceName]),
  ].filter(Boolean).join(" ").toLowerCase();

  if (isFalsePositiveMatomeTopic(value)) return false;
  if (/【pr】|\bpr\b|広告|タイアップ|スポンサー/.test(value)) return false;
  return /なんj|なんg|2chまとめ|5chまとめ|2chスレ|5chスレ|反応集|ネットの反応|まとめサイト|まとめブログ|はちま|オタコム|痛いニュース|暇人速報|アルファルファモザイク/.test(value);
}

function isFalsePositiveMatomeTopic(value) {
  const text = String(value ?? "").toLowerCase();
  return /(サウンドバー|スピーカー|ホームシアター|オーディオ|アンプ|テレビ|tv|番組|放送|5ch「|5ch\\b[^まス反]|2chのデジタル・ミキサー|1泊家族|まとめ売り)/.test(text);
}

async function enrichItemsWithMetadata(items, { limit = ARCHIVE_METADATA_ENRICH_LIMIT } = {}) {
  const prioritizedItems = [...items]
    .filter((item) => {
      const thumbnailUrl = sanitizeThumbnailUrl(item.thumbnailUrl);
      return !hasUsefulSummary(item.summary)
        || !thumbnailUrl
        || isWeakThumbnailUrl(thumbnailUrl)
        || hasSuspiciousThumbnailMismatch(thumbnailUrl, item, ...(item.sourceSignals ?? []));
    })
    .sort((left, right) => metadataPriority(right) - metadataPriority(left))
    .slice(0, Math.max(0, limit));
  await mapWithConcurrency(prioritizedItems, METADATA_ENRICH_CONCURRENCY, async (item) => {
    await enrichItemMetadata(item);
  });
}

async function ensureFetchStageThumbnailCoverage(items, label, { repairLimit = FETCH_STAGE_REPAIR_LIMIT } = {}) {
  const initialDuplicateUrls = collectSuspiciousDuplicateThumbnailUrls(items);
  const initial = thumbnailCoverageStats(items, initialDuplicateUrls);
  console.log(`[thumbnail:fetch] ${label} initial=${initial.found}/${initial.total} (${initial.rate.toFixed(1)}%)`);
  if (initial.rate >= FETCH_STAGE_MIN_THUMBNAIL_RATE) return;

  const repairTargets = [...items]
    .filter((item) => !hasAcceptableThumbnail(item, initialDuplicateUrls))
    .sort((left, right) => metadataPriority(right) - metadataPriority(left));
  const limitedRepairTargets = repairTargets.slice(0, Math.max(0, repairLimit));

  await mapWithConcurrency(limitedRepairTargets, FETCH_STAGE_REPAIR_CONCURRENCY, async (item) => {
    await enrichItemMetadata(item, { force: true });
    if (!hasAcceptableThumbnail(item, initialDuplicateUrls)) {
      await repairItemThumbnail(item);
    }
  });

  const finalDuplicateUrls = collectSuspiciousDuplicateThumbnailUrls(items);
  const finalStats = thumbnailCoverageStats(items, finalDuplicateUrls);
  console.log(`[thumbnail:fetch] ${label} repaired=${finalStats.found}/${finalStats.total} (${finalStats.rate.toFixed(1)}%)`);
  if (finalStats.rate < FETCH_STAGE_MIN_THUMBNAIL_RATE) {
    const missingTitles = items
      .filter((item) => !hasAcceptableThumbnail(item, finalDuplicateUrls))
      .slice(0, 10)
      .map((item) => item?.title ?? "(no title)");
    const message = `[thumbnail:fetch] ${label} coverage ${finalStats.rate.toFixed(1)}% below ${FETCH_STAGE_MIN_THUMBNAIL_RATE}%: ${missingTitles.join(" / ")}`;
    if (FETCH_STAGE_THUMBNAIL_STRICT) {
      throw new Error(message);
    }
    console.warn(message);
  }
}

function thumbnailCoverageStats(items, duplicateThumbnailUrls = new Set()) {
  const total = items.length;
  const found = items.filter((item) => hasAcceptableThumbnail(item, duplicateThumbnailUrls)).length;
  const rate = total ? (found / total) * 100 : 100;
  return { total, found, rate };
}

function hasAcceptableThumbnail(item, duplicateThumbnailUrls = new Set()) {
  const thumbnailUrl = sanitizeThumbnailUrl(item?.thumbnailUrl ?? item?.thumbnail);
  if (!thumbnailUrl) return false;
  if (duplicateThumbnailUrls.has(thumbnailUrl)) return false;
  if (isWeakThumbnailUrl(thumbnailUrl)) return false;
  if (hasSuspiciousThumbnailMismatch(thumbnailUrl, item, ...(item?.sourceSignals ?? []))) return false;
  return true;
}

function metadataPriority(item) {
  const thumbnailUrl = sanitizeThumbnailUrl(item.thumbnailUrl);
  let priority = Number(item.score ?? 0);
  if (item.category === "adult" || item.categories?.includes("adult")) priority += 80;
  if (!hasUsefulSummary(item.summary)) priority += 50;
  if (!thumbnailUrl) priority += 20;
  if (isWeakThumbnailUrl(thumbnailUrl)) priority += 35;
  if (hasSuspiciousThumbnailMismatch(thumbnailUrl, item, ...(item.sourceSignals ?? []))) priority += 45;
  return priority;
}

async function enrichItemMetadata(item, { force = false } = {}) {
  const directThumbnail = await resolveThumbnail({ item, sourceUrl: item.sourceSignals?.[0]?.url ?? item.searchLinks?.[0]?.url ?? "" });
  item.thumbnailUrl = directThumbnail.thumbnailUrl;
  item.thumbnail = directThumbnail.thumbnail;
  item.sourceSignals = sanitizeSourceSignals(item.sourceSignals);

  const searchUrls = (item.searchLinks ?? []).map((entry) => entry?.url).filter(Boolean);
  const sourceSignalCanonicalUrls = (item.sourceSignals ?? []).map((entry) => entry?.canonicalUrl).filter(Boolean);
  const sourceSignalUrls = (item.sourceSignals ?? []).map((entry) => entry?.url).filter(Boolean);
  const preferSearchFirst = itemLooksLikeGoogleNews(item);
  const candidateUrls = [
    item.sourceUrl,
    item.url,
    item.link,
    ...(preferSearchFirst ? searchUrls : []),
    item.sourceSignals?.find((entry) => entry?.url)?.url,
    ...sourceSignalCanonicalUrls,
    ...sourceSignalUrls,
    ...(!preferSearchFirst ? searchUrls : []),
  ];
  const uniqueUrls = [...new Set(candidateUrls)].slice(0, 6);
  if (!uniqueUrls.length) return;

  let metadata = null;
  let bestMetadata = null;
  for (const candidateUrl of uniqueUrls) {
    metadata = await fetchPageMetadata(candidateUrl, item.title).catch(() => null);
    if (!metadata) continue;
    bestMetadata = mergeFetchedMetadata(bestMetadata, metadata, item.title);
    const hasThumb = Boolean(bestMetadata?.thumbnailUrl);
    const hasSummary = hasUsefulSummary(bestMetadata?.summary) || Boolean(bestMetadata?.briefSummary) || hasUsefulSummary(item.summary);
    if (hasThumb && (hasSummary || force)) break;
  }
  if (!bestMetadata) return;

  const currentThumbnail = sanitizeThumbnailUrl(item.thumbnailUrl);
  const shouldReplaceItemThumbnail = !currentThumbnail
    || isWeakThumbnailUrl(currentThumbnail)
    || hasSuspiciousThumbnailMismatch(currentThumbnail, item, ...(item.sourceSignals ?? []));
  if (shouldReplaceItemThumbnail && bestMetadata.thumbnailUrl) {
    item.thumbnailUrl = bestMetadata.thumbnailUrl;
    item.thumbnail = bestMetadata.thumbnailUrl;
  }

  if (shouldReplaceSummary(item.summary, bestMetadata.summary)) {
    item.summary = bestMetadata.summary;
  }

  if (shouldReplaceBriefSummary(item.briefSummary, bestMetadata.briefSummary, item.title)) {
    item.briefSummary = bestMetadata.briefSummary;
  }

  if (Array.isArray(item.sourceSignals) && (bestMetadata.thumbnailUrl || bestMetadata.summary || bestMetadata.briefSummary)) {
    item.sourceSignals = item.sourceSignals.map((entry, index) => {
      if (index !== 0) return entry;
      const entryThumbnail = sanitizeThumbnailUrl(entry.thumbnailUrl ?? entry.thumbnail);
      const shouldReplaceEntryThumbnail = !entryThumbnail
        || isWeakThumbnailUrl(entryThumbnail)
        || hasSuspiciousThumbnailMismatch(entryThumbnail, entry, item);
      return {
        ...entry,
        thumbnailUrl: shouldReplaceEntryThumbnail ? (bestMetadata.thumbnailUrl || entryThumbnail || null) : entryThumbnail,
        thumbnail: shouldReplaceEntryThumbnail ? (bestMetadata.thumbnailUrl || entryThumbnail || null) : entryThumbnail,
        summary: entry.summary ?? bestMetadata.summary ?? null,
        briefSummary: entry.briefSummary ?? bestMetadata.briefSummary ?? null,
      };
    });
  }
}

function mergeFetchedMetadata(current, next, title = "") {
  if (!current) {
    return {
      thumbnailUrl: sanitizeThumbnailUrl(next?.thumbnailUrl ?? next?.thumbnail) ?? null,
      summary: next?.summary ?? null,
      briefSummary: next?.briefSummary ?? null,
    };
  }
  const merged = { ...current };
  const nextThumb = sanitizeThumbnailUrl(next?.thumbnailUrl ?? next?.thumbnail);
  if ((!merged.thumbnailUrl || isWeakThumbnailUrl(merged.thumbnailUrl)) && nextThumb) merged.thumbnailUrl = nextThumb;
  if (merged.thumbnailUrl && hasSuspiciousThumbnailMismatch(merged.thumbnailUrl, next) && nextThumb && !hasSuspiciousThumbnailMismatch(nextThumb, next)) {
    merged.thumbnailUrl = nextThumb;
  }
  if (shouldReplaceSummary(merged.summary, next?.summary)) merged.summary = next.summary;
  if (shouldReplaceBriefSummary(merged.briefSummary, next?.briefSummary, title)) merged.briefSummary = next.briefSummary;
  return merged;
}

function itemLooksLikeGoogleNews(item) {
  const values = [
    item?.source,
    item?.sourceName,
    item?.sourceId,
    ...(item?.sourceSignals ?? []).flatMap((entry) => [entry?.source, entry?.sourceName, entry?.url, entry?.canonicalUrl]),
    ...(item?.searchLinks ?? []).map((entry) => entry?.url),
  ].filter(Boolean).join(" ");
  return /google news|news\.google\.com/i.test(values);
}

function collectSuspiciousDuplicateThumbnailUrls(items, minimumCount = SUSPICIOUS_DUPLICATE_THUMBNAIL_MIN_COUNT) {
  const stats = new Map();

  for (const item of items) {
    const thumbnailUrl = sanitizeThumbnailUrl(item?.thumbnailUrl ?? item?.thumbnail);
    if (!thumbnailUrl) continue;

    let entry = stats.get(thumbnailUrl);
    if (!entry) {
      entry = {
        count: 0,
        sources: new Set(),
        categories: new Set(),
      };
      stats.set(thumbnailUrl, entry);
    }

    entry.count += 1;
    entry.sources.add(String(item?.sourceName ?? item?.sourceSignals?.[0]?.sourceName ?? item?.sourceSignals?.[0]?.source ?? ""));
    entry.categories.add(String(item?.category ?? item?.categories?.[0] ?? ""));
  }

  return new Set(
    [...stats.entries()]
      .filter(([url, entry]) => {
        if (entry.count < minimumCount) return false;
        return isSuspiciousDuplicateThumbnailUrl(url)
          || entry.sources.size >= 8
          || entry.categories.size >= 6;
      })
      .map(([url]) => url),
  );
}

function isSuspiciousDuplicateThumbnailUrl(url) {
  const value = String(url ?? "");
  return /(?:^https?:\/\/)(?:lh3\.googleusercontent\.com|newsatcl-pctr\.c\.yimg\.jp|news-pctr\.c\.yimg\.jp|news\.google\.com\/api\/attachments)/i.test(value);
}

function isYahooPickupUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase() === "news.yahoo.co.jp" && /^\/pickup\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isWeakThumbnailUrl(value) {
  const url = sanitizeThumbnailUrl(value);
  if (!url) return true;
  return /news-pctr\.c\.yimg\.jp\/t\/news-topics\/images\/tpc\/|news-topics\/images\/tpc|news-topics\/pickups|\/t\/news-topics\//i.test(url);
}

function shouldFollowNestedArticle(responseUrl, metadata) {
  if (isGoogleNewsUrl(responseUrl)) {
    const thumbnailUrl = metadata?.thumbnailUrl ?? metadata?.thumbnail ?? null;
    return !thumbnailUrl
      || isWeakThumbnailUrl(thumbnailUrl)
      || isAggregatorThumbnailUrl(thumbnailUrl)
      || hasSuspiciousThumbnailMismatch(thumbnailUrl, { url: responseUrl });
  }
  if (isYahooPickupUrl(responseUrl)) return true;
  return false;
}

async function fetchPageMetadata(url, title = "", depth = 0, visited = new Set()) {
  const normalizedUrl = normalizeFetchUrl(url);
  if (!normalizedUrl || visited.has(normalizedUrl) || depth > 1) return null;
  visited.add(normalizedUrl);

  const response = await fetch(normalizedUrl, {
    signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(8000) : undefined,
    headers: {
      "user-agent": "INTERNET NEWS/1.0",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) return null;
  const html = await response.text();
  const responseUrl = normalizeFetchUrl(response.url) ?? normalizedUrl;
  const thumbnailMeta = await resolveThumbnail({
    pageHtml: html,
    sourceUrl: responseUrl,
    item: {
      ogImage: html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? html.match(/<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? "",
      twitterImage: html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? html.match(/<meta[^>]+property=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? "",
    },
  });

  const articleCandidates = extractArticleTextCandidates(html);
  const jsonLdSummary = extractJsonLdSummary(html);
  const summary = pickSummaryCandidate([
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1],
    jsonLdSummary,
    ...articleCandidates.slice(0, 3),
    html.match(/<p\b[^>]*>([\s\S]{40,240}?)<\/p>/i)?.[1],
  ]);
  const paragraphMatches = [...html.matchAll(/<p\b[^>]*>([\s\S]{30,320}?)<\/p>/gi)].map((match) => match[1]);
  const briefSummary = pickBriefSummaryCandidate([
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1],
    jsonLdSummary,
    ...articleCandidates,
    ...paragraphMatches.slice(0, 6),
  ], title);

  const metadata = {
    thumbnailUrl: thumbnailMeta.thumbnailUrl,
    thumbnail: thumbnailMeta.thumbnail,
    summary,
    briefSummary,
  };

  if (shouldFollowNestedArticle(responseUrl, metadata)) {
    const outboundUrls = extractOutboundArticleUrls(html, responseUrl);
    for (const outboundUrl of outboundUrls.slice(0, 8)) {
      const nested = await fetchPageMetadata(outboundUrl, title, depth + 1, visited).catch(() => null);
      if (nested?.thumbnailUrl || nested?.summary || nested?.briefSummary) {
        return mergeFetchedMetadata(metadata, nested, title);
      }
    }
  }

  return metadata;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) continue;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function readArchivePayload(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { generatedAt: null, items: [] };
  }
}

function mergeArchiveItems(previousItems, nextItems) {
  const map = new Map();

  for (const item of [...previousItems, ...nextItems]) {
    const key = archiveKeyFor(item);
    const current = map.get(key);
    if (!current) {
      map.set(key, item);
      continue;
    }

    const currentTime = archiveTimestamp(current);
    const nextTime = archiveTimestamp(item);
    if (nextTime >= currentTime) {
      map.set(key, {
        ...current,
        ...item,
        capturedAt: item.capturedAt ?? current.capturedAt,
      });
    }
  }

  return [...map.values()].sort((left, right) => {
    const timeDiff = archiveTimestamp(right) - archiveTimestamp(left);
    if (timeDiff !== 0) return timeDiff;
    return Number(right.score ?? 0) - Number(left.score ?? 0);
  });
}

function limitArchiveItems(items, limit = MAX_ARCHIVE_ITEMS) {
  return [...items]
    .sort((left, right) => {
      const timeDiff = archiveTimestamp(right) - archiveTimestamp(left);
      if (timeDiff !== 0) return timeDiff;
      return Number(right.score ?? 0) - Number(left.score ?? 0);
    })
    .slice(0, limit);
}

function normalizeArchiveItem(item) {
  const normalizedItem = normalizeStoredTopic(item);

  return {
    ...normalizedItem,
    score: Math.max(1, Number(normalizedItem.score ?? item.score ?? 1) || 1),
    posts: String(item.posts ?? "1"),
  };
}

function normalizeSummaryText(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s*続きを読む.*$/u, " ")
    .replace(/\s*詳細はこちら.*$/u, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldKeepArchiveItem(item) {
  const title = String(item.title ?? "");
  const summary = String(item.summary ?? "");
  const value = `${title} ${summary}`.toLowerCase();

  if (/を楽しむ人たち|参加者募集|教室について|おしらせ|のお知らせ|開催のお知らせ|開催しました|開催されました/.test(title)) {
    return false;
  }

  const softFeaturePattern = /楽しむ|体験|教室|講習会|フェア|イベント|ワークショップ|募集|来場|開催|オープン|特集|コラム|ランキング|キャンペーン|グルメ|観光/;
  const hardNewsPattern = /速報|発表|判明|逮捕|決定|合意|協議|会見|選挙|事故|地震|戦況|決算|株価|生成ai|openai|nvidia|microsoft|google|apple|移籍|優勝|開幕|公開|配信/;

  if (softFeaturePattern.test(title) && !hardNewsPattern.test(value)) {
    return false;
  }

  return true;
}

function archiveKeyFor(item) {
  const stableId = String(item?.id ?? "").trim();
  if (stableId) return stableId;

  const primaryUrl = itemPrimaryUrl(item);
  if (primaryUrl) return primaryUrl;

  return (
    canonicalSignalUrl(item.sourceSignals?.[0]?.url ?? "") ||
    `${item.category ?? "topic"}:${item.title ?? "untitled"}`
  );
}

function archiveTimestamp(item) {
  const value =
    item.sourceSignals?.[0]?.publishedAt ??
    item.publishedAt ??
    item.capturedAt ??
    0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isWithinArchiveWindow(item, nowValue) {
  const now = new Date(nowValue).getTime();
  const time = archiveTimestamp(item);
  if (!time) return true;
  return now - time <= 14 * 24 * 60 * 60 * 1000;
}

function sanitizeSourceSignals(signals) {
  if (!Array.isArray(signals)) return [];
  const sanitized = signals
    .map((signal) => ({
      ...signal,
      thumbnailUrl: sanitizeThumbnailUrl(signal?.thumbnailUrl),
      thumbnail: sanitizeThumbnailUrl(signal?.thumbnail ?? signal?.thumbnailUrl),
      briefSummary: normalizeBriefSummaryText(signal?.briefSummary),
      summary: normalizeSummaryText(signal?.summary),
    }))
    .sort((left, right) => sourceSignalQualityScore(right) - sourceSignalQualityScore(left) || signalPublishedAt(right) - signalPublishedAt(left));
  const deduped = [];

  for (const signal of sanitized) {
    const duplicateIndex = deduped.findIndex((current) => sourceSignalDuplicateReason(current, signal));
    if (duplicateIndex === -1) {
      deduped.push(signal);
      continue;
    }
    deduped[duplicateIndex] = mergeSourceSignals(deduped[duplicateIndex], signal);
  }

  return deduped.sort((left, right) => signalPublishedAt(right) - signalPublishedAt(left));
}

function signalPublishedAt(signal) {
  const time = new Date(signal?.publishedAt ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sourceSignalDuplicateReason(current, next) {
  if (!current || !next) return "";

  const currentUrl = canonicalSignalUrl(current?.url);
  const nextUrl = canonicalSignalUrl(next?.url);
  if (currentUrl && nextUrl && currentUrl === nextUrl) return "url";

  const currentTitle = normalizeSignalIdentityFingerprint(current?.title);
  const nextTitle = normalizeSignalIdentityFingerprint(next?.title);
  if (!currentTitle || !nextTitle) return "";

  const sameTitle = currentTitle === nextTitle || currentTitle.includes(nextTitle) || nextTitle.includes(currentTitle);
  if (sameTitle && isSourceSignalTimeClose(current, next, 72)) return "title";

  const currentTokens = currentTitle.split(/\s+/).filter((token) => token.length >= 2);
  const nextTokens = nextTitle.split(/\s+/).filter((token) => token.length >= 2);
  if (currentTokens.length < 3 || nextTokens.length < 3) return "";

  const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
  const overlapRatio = overlap / Math.min(currentTokens.length, nextTokens.length);
  if (overlap >= 3 && overlapRatio >= 0.82 && isSourceSignalTimeClose(current, next, 36)) return "similarity";

  return "";
}

function canonicalSignalUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const params = new URLSearchParams(parsed.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "ref", "src", "from"].forEach((key) => params.delete(key));
    parsed.search = params.toString();
    parsed.hash = "";
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function isLikelyHomepageUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return true;
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return (path === "/" || /^\/(?:index\.(?:html?|php)|home)?$/i.test(path)) && !parsed.search;
  } catch {
    return false;
  }
}

function scoreSourceUrlCandidate(rawUrl, { canonical = false, sourceName = "" } = {}) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return -1000;

  try {
    const parsed = new URL(value);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    let score = 0;

    if (isGoogleNewsUrl(value)) score -= 120;
    if (isYahooPickupUrl(value)) score -= 90;
    if (isLikelyHomepageUrl(value)) score -= 80;
    else score += 40;

    if (path.split("/").filter(Boolean).length >= 2) score += 18;
    if (/\d{4}\/\d{2}\/\d{2}|\/article\/|\/articles\/|\/news\/|\/entry\/|\/story\/|\/topics?\//i.test(path)) score += 18;
    if (/\.(?:html?|amp)$/i.test(path)) score += 8;
    if (parsed.search) score += 3;
    if (canonical) score += 5;
    if (!String(sourceName ?? "").toLowerCase().includes("google news")) score += 4;

    return score;
  } catch {
    return -1000;
  }
}

function chooseBestSourceUrl(item) {
  const candidates = [];
  const pushCandidate = (url, meta = {}) => {
    const value = String(url ?? "").trim();
    if (!value) return;
    candidates.push({
      url: value,
      score: scoreSourceUrlCandidate(value, meta),
    });
  };

  pushCandidate(item?.sourceUrl, { sourceName: item?.sourceName });
  pushCandidate(item?.url, { sourceName: item?.sourceName });
  pushCandidate(item?.link, { sourceName: item?.sourceName });

  const signals = sanitizeSourceSignals(item?.sourceSignals);
  for (const signal of signals) {
    pushCandidate(signal?.canonicalUrl, { canonical: true, sourceName: signal?.sourceName ?? signal?.source });
    pushCandidate(signal?.url, { sourceName: signal?.sourceName ?? signal?.source });
  }

  const ranked = candidates
    .filter((candidate) => candidate.score > -1000)
    .sort((left, right) => right.score - left.score);

  const direct = ranked.find((candidate) => !isLikelyHomepageUrl(candidate.url) && !isGoogleNewsUrl(candidate.url));
  if (direct) return direct.url;

  const fallback = ranked.find((candidate) => !isGoogleNewsUrl(candidate.url) && !isLikelyHomepageUrl(candidate.url));
  return fallback?.url ?? null;
}

function isSourceSignalTimeClose(current, next, hours = 36) {
  const currentAt = signalPublishedAt(current);
  const nextAt = signalPublishedAt(next);
  if (!currentAt || !nextAt) return true;
  return Math.abs(currentAt - nextAt) <= hours * 60 * 60 * 1000;
}

function sourceSignalQualityScore(signal) {
  let score = 0;
  if (!isGoogleNewsUrl(signal?.url) && !String(signal?.sourceName ?? signal?.source ?? "").toLowerCase().includes("google news")) score += 20;
  if (String(signal?.sourceName ?? "").includes("/")) score += 8;
  if (signal?.summary || signal?.briefSummary) score += 5;
  if (signal?.thumbnailUrl || signal?.thumbnail) score += 2;
  return score;
}

function mergeSourceSignals(current, next) {
  const currentScore = sourceSignalQualityScore(current);
  const nextScore = sourceSignalQualityScore(next);
  const preferred = nextScore > currentScore || (nextScore === currentScore && signalPublishedAt(next) > signalPublishedAt(current))
    ? next
    : current;
  const fallback = preferred === current ? next : current;

  return {
    ...fallback,
    ...preferred,
    sourceName: preferred.sourceName ?? fallback.sourceName ?? preferred.source ?? fallback.source ?? null,
    briefSummary: preferred.briefSummary || fallback.briefSummary || "",
    summary: preferred.summary || fallback.summary || "",
    thumbnailUrl: preferred.thumbnailUrl || fallback.thumbnailUrl || null,
    thumbnail: preferred.thumbnail || fallback.thumbnail || null,
  };
}

function normalizeSignalIdentityFingerprint(value) {
  return stripHtml(String(value ?? ""))
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/[【】「」『』]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/g, " ")
    .replace(/\b[a-z0-9]{8,}\b/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFetchUrl(value) {
  try {
    return new URL(String(value ?? "")).toString();
  } catch {
    return null;
  }
}

function isGoogleNewsUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase() === "news.google.com";
  } catch {
    return false;
  }
}

function pickSummaryCandidate(candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeExtractedSummary(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function pickBriefSummaryCandidate(candidates, title = "") {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeBriefSummaryText(stripHtml(String(candidate ?? ""))))
    .filter(Boolean);
  const ranked = normalizedCandidates
    .map((candidate) => ({ candidate, score: scoreBriefCandidate(candidate, title) }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.candidate ?? null;
}

function normalizeExtractedSummary(value) {
  const text = normalizeSummaryText(stripHtml(String(value ?? "")));
  if (!text) return null;
  if (text.length < 40) return null;
  if (/^comprehensive up-to-date news coverage/i.test(text)) return null;
  if (/^view the latest/i.test(text)) return null;
  if (/^(copyright|advertisement|広告|この記事を|この記事では|このページでは)/i.test(text)) return null;
  return text.slice(0, 150) + (text.length > 150 ? "…" : "");
}

function shouldReplaceSummary(currentSummary, nextSummary) {
  if (!nextSummary) return false;
  if (!hasUsefulSummary(currentSummary)) return true;
  const current = normalizeSummaryText(currentSummary);
  const next = normalizeSummaryText(nextSummary);
  if (!current) return true;
  return next.length >= current.length + 20;
}

function shouldReplaceBriefSummary(currentSummary, nextSummary, title = "") {
  const next = normalizeBriefSummaryText(nextSummary);
  if (!next) return false;
  const current = normalizeBriefSummaryText(currentSummary);
  const titleFingerprint = normalizeContentFingerprint(title);
  const nextFingerprint = normalizeContentFingerprint(next);
  if (!current) return nextFingerprint !== titleFingerprint;
  if (normalizeContentFingerprint(current) === titleFingerprint && nextFingerprint !== titleFingerprint) return true;
  return next.length >= current.length + 24;
}

function hasUsefulSummary(summary) {
  const text = normalizeSummaryText(summary);
  if (!text) return false;
  return !FALLBACK_SUMMARY_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeBriefSummaryText(value) {
  const text = normalizeSummaryText(value)
    .replace(/^Comprehensive up-to-date news coverage, aggregated from sources all over the world by Google News\.?$/iu, "")
    .replace(/^View the latest[^.]+from Google News\.?$/iu, "")
    .replace(/(日本経済新聞|毎日新聞|読売新聞|朝日新聞|産経新聞|共同通信|時事通信|Reuters|ロイター|Yahoo!ニュース|Yahoo!ファイナンス|日経BP|長崎新聞ホームページ)\s*$/u, "")
    .replace(/\s*続きを読む.*$/u, "")
    .replace(/\s*詳細はこちら.*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length < 28) return "";
  return text.slice(0, 180) + (text.length > 180 ? "…" : "");
}

function scoreBriefCandidate(candidate, title = "") {
  const text = normalizeBriefSummaryText(candidate);
  if (!text) return -999;
  let score = 0;
  const length = text.length;
  if (length >= 55 && length <= 150) score += 20;
  else if (length > 150) score += 10;
  else score += 4;

  const sentenceCount = (text.match(/[。！？]/g) || []).length;
  if (sentenceCount >= 2) score += 12;
  else if (sentenceCount === 1) score += 6;

  if (/(警察|政府|発表|確認|捜査|公表|判明|会見|見通し|計画|開始|終了|抽選|発売|配信|影響|被害)/.test(text)) score += 14;
  if (/(ため|ことから|として|受け|により|一方で)/.test(text)) score += 6;
  if (isTitleRewrite(text, title)) score -= 30;
  if (/^(広告|pr|タイアップ|スポンサー)/i.test(text)) score -= 20;
  if (/\b(keidanren\.or\.jp|yahoo!ファイナンス|dream news|pr times)\b/i.test(text)) score -= 16;
  return score;
}

function extractArticleTextCandidates(html) {
  const scopedBlocks = [
    ...matchScopedParagraphs(html, /<article\b[^>]*>([\s\S]*?)<\/article>/gi),
    ...matchScopedParagraphs(html, /<main\b[^>]*>([\s\S]*?)<\/main>/gi),
    ...matchScopedParagraphs(html, /<(section|div)\b[^>]*(class|id)=["'][^"']*(article|content|body|main|entry|post)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi, 4),
  ];
  return [...new Set(scopedBlocks.map((block) => normalizeBriefSummaryText(block)).filter(Boolean))].slice(0, 8);
}

function matchScopedParagraphs(html, pattern, contentIndex = 1) {
  const blocks = [];
  for (const match of html.matchAll(pattern)) {
    const content = match[contentIndex] ?? "";
    for (const paragraph of content.matchAll(/<p\b[^>]*>([\s\S]{30,420}?)<\/p>/gi)) {
      blocks.push(paragraph[1]);
    }
  }
  return blocks;
}

function extractJsonLdSummary(html) {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = match[1];
    const parsed = safeJsonParse(raw);
    const candidates = extractJsonLdTextCandidates(parsed);
    const best = candidates.map((candidate) => normalizeBriefSummaryText(candidate)).find(Boolean);
    if (best) return best;
  }
  return null;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractJsonLdTextCandidates(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(extractJsonLdTextCandidates);
  if (typeof value !== "object") return [];
  const candidates = [];
  if (typeof value.description === "string") candidates.push(value.description);
  if (typeof value.articleBody === "string") candidates.push(value.articleBody);
  if (typeof value.abstract === "string") candidates.push(value.abstract);
  if (value['@graph']) candidates.push(...extractJsonLdTextCandidates(value['@graph']));
  return candidates;
}

function extractOutboundArticleUrls(html, baseUrl) {
  const urls = [];
  const canonicalUrl = absolutizeUrl(
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1],
    baseUrl,
  );
  if (canonicalUrl && !isGoogleNewsUrl(canonicalUrl)) {
    urls.push(canonicalUrl);
  }

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const candidate = absolutizeUrl(match[1], baseUrl);
    if (!candidate) continue;
    if (pushOutboundUrl(urls, candidate)) continue;
  }

  for (const match of html.matchAll(/https?:\/\/[^"'\\\s<>()]+/g)) {
    const candidate = absolutizeUrl(normalizeEmbeddedUrlString(match[0]), baseUrl);
    if (!candidate) continue;
    pushOutboundUrl(urls, candidate);
  }

  for (const raw of extractEncodedUrlsFromHtml(html)) {
    const candidate = absolutizeUrl(normalizeEmbeddedUrlString(raw), baseUrl);
    if (!candidate) continue;
    pushOutboundUrl(urls, candidate);
  }

  return [...new Set(urls)].sort((left, right) => scoreOutboundArticleUrl(right) - scoreOutboundArticleUrl(left));
}

function pushOutboundUrl(urls, candidate) {
  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (hostname === "news.google.com") return false;
    if (hostname.endsWith(".google.com")) return false;
    if (hostname.endsWith("googleusercontent.com")) return false;
    if (hostname.endsWith("gstatic.com")) return false;
    if (hostname.endsWith("google-analytics.com")) return false;
    if (hostname.endsWith("googletagmanager.com")) return false;
    if (hostname.endsWith("fonts.googleapis.com")) return false;
    if (hostname.endsWith("fonts.gstatic.com")) return false;
    if (hostname.endsWith("newsstand.google.com")) return false;
    if (hostname.endsWith("w3.org")) return false;
    if (hostname.endsWith("angular.dev")) return false;
    if (/\/search$|\/preferences$/.test(parsed.pathname)) return false;
    urls.push(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

function normalizeEmbeddedUrlString(value) {
  return String(value ?? "")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\x3d/gi, "=")
    .replace(/\\x26/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");
}

function scoreOutboundArticleUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const combined = `${host}${parsed.pathname}${parsed.search}`.toLowerCase();
    let score = 0;
    if (/\.(?:co\.jp|or\.jp|ne\.jp|go\.jp|ac\.jp|jp)$/.test(host) || host.endsWith(".jp")) score += 40;
    if (/\/articles?\//.test(parsed.pathname)) score += 60;
    if (/\/\d{4}\/\d{2}\/\d{2}\//.test(parsed.pathname)) score += 50;
    if (/\d{6,}|\d{4,}\.html|news\d+|article/i.test(combined)) score += 35;
    if (/yahoo|asahi|nhk|mainichi|nikkei|itmedia|j-cast|4gamer|gamespark|inside|animeanime|oricon|natalie|mantan|reuters|fnn|tbs|tv-asahi|nikkansports|sponichi/i.test(combined)) score += 45;
    if (!isGoogleNewsUrl(value) && !isYahooPickupUrl(value) && !isYahooArticleUrl(value)) score += 35;
    if (isYahooArticleUrl(value)) score -= 55;
    if (/rss|feed|manifest|license|logo|favicon|svg|css|js/.test(combined)) score -= 120;
    return score;
  } catch {
    return -1;
  }
}

function isYahooArticleUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase() === "news.yahoo.co.jp" && /^\/articles\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

function buildStoredBriefSummary(item) {
  const signalSummaries = sanitizeSourceSignals(item.sourceSignals)
    .map((signal) => normalizeBriefSummaryText(signal?.briefSummary || signal?.summary))
    .filter(Boolean);
  const itemBrief = normalizeBriefSummaryText(item.briefSummary);
  const itemSummary = normalizeBriefSummaryText(item.summary);
  const candidate = itemBrief || signalSummaries[0] || itemSummary;
  if (candidate && !isTitleRewrite(candidate, item.title)) {
    return candidate;
  }
  return "";
}

function isTitleRewrite(summary, title) {
  const summaryFp = normalizeContentFingerprint(summary);
  const titleFp = normalizeContentFingerprint(title);
  if (!summaryFp || !titleFp) return false;
  if (summaryFp === titleFp) return true;
  return summaryFp.startsWith(titleFp) && summaryFp.length - titleFp.length < 18;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeNearDuplicateItems(items) {
  const sortedItems = [...items].sort((left, right) => {
    const scoreDiff = Number(right.score ?? 0) - Number(left.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return archiveTimestamp(right) - archiveTimestamp(left);
  });
  const kept = [];
  const bucketMap = new Map();

  for (const item of sortedItems) {
    const candidateIndexes = candidateDuplicateIndexes(item, bucketMap);
    const duplicateIndex = candidateIndexes.find((index) => isNearDuplicateItem(kept[index], item)) ?? -1;
    if (duplicateIndex === -1) {
      const newIndex = kept.push(item) - 1;
      registerDuplicateBuckets(item, newIndex, bucketMap);
      continue;
    }
    kept[duplicateIndex] = mergeDuplicateItems(kept[duplicateIndex], item);
    registerDuplicateBuckets(kept[duplicateIndex], duplicateIndex, bucketMap);
  }

  return kept;
}

function candidateDuplicateIndexes(item, bucketMap) {
  const indexes = [];
  const seen = new Set();
  for (const key of duplicateBucketKeys(item)) {
    const values = bucketMap.get(key);
    if (!values?.length) continue;
    for (const index of values) {
      if (seen.has(index)) continue;
      seen.add(index);
      indexes.push(index);
      if (indexes.length >= DEDUPE_BUCKET_SCAN_LIMIT) return indexes;
    }
  }
  return indexes;
}

function registerDuplicateBuckets(item, index, bucketMap) {
  for (const key of duplicateBucketKeys(item)) {
    const current = bucketMap.get(key);
    if (!current) {
      bucketMap.set(key, [index]);
      continue;
    }
    if (!current.includes(index)) current.unshift(index);
    if (current.length > DEDUPE_BUCKET_SCAN_LIMIT) current.length = DEDUPE_BUCKET_SCAN_LIMIT;
  }
}

function duplicateBucketKeys(item) {
  const keys = new Set();
  const url = itemPrimaryUrl(item);
  if (url) keys.add(`url:${url}`);

  const title = normalizeContentFingerprint(item?.title ?? "");
  if (title) {
    keys.add(`title:${title.slice(0, 64)}`);
    const tokens = fingerprintTokens(title);
    if (tokens.length) {
      keys.add(`token:${tokens.slice(0, 3).join("|")}`);
      keys.add(`token:${tokens.slice(-3).join("|")}`);
    }
  }

  const categories = Array.isArray(item?.categories) && item.categories.length
    ? item.categories
    : [item?.category].filter(Boolean);
  for (const category of categories.slice(0, 3)) {
    keys.add(`category:${category}`);
  }

  return [...keys];
}

function isNearDuplicateItem(left, right) {
  const leftPrimaryUrl = itemPrimaryUrl(left);
  const rightPrimaryUrl = itemPrimaryUrl(right);
  if (leftPrimaryUrl && rightPrimaryUrl && leftPrimaryUrl === rightPrimaryUrl) {
    return true;
  }
  if (isLikelySameTopicItem(left, right)) return true;

  if (!sharesAnyCategory(left, right)) return false;

  const leftTitle = normalizeContentFingerprint(left.title);
  const rightTitle = normalizeContentFingerprint(right.title);
  if (leftTitle && rightTitle) {
    if (leftTitle === rightTitle) return true;
  if ((leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) && Math.min(leftTitle.length, rightTitle.length) >= 24) {
      return true;
    }
  }

  const leftTitleTokens = fingerprintTokens(left.title);
  const rightTitleTokens = fingerprintTokens(right.title);
  if (tokenOverlapRatio(leftTitleTokens, rightTitleTokens) >= 0.9 && Math.min(leftTitleTokens.length, rightTitleTokens.length) >= 5) {
    return true;
  }

  const leftContentTokens = fingerprintTokens(`${left.title ?? ""} ${left.summary ?? ""}`);
  const rightContentTokens = fingerprintTokens(`${right.title ?? ""} ${right.summary ?? ""}`);
  return tokenOverlapRatio(leftContentTokens, rightContentTokens) >= 0.94 && Math.min(leftContentTokens.length, rightContentTokens.length) >= 7;
}

function itemPrimaryUrl(item) {
  const sourceSignals = Array.isArray(item?.sourceSignals) ? item.sourceSignals : [];
  const directSignalUrl = sourceSignals
    .map((signal) => String(signal?.url ?? "").trim())
    .find((url) => url && !isGoogleNewsUrl(url));

  const googleSignalUrl = sourceSignals
    .map((signal) => String(signal?.url ?? "").trim())
    .find(Boolean);

  const searchUrl = String(item?.searchLinks?.[0]?.url ?? "").trim();
  return canonicalSignalUrl(directSignalUrl || googleSignalUrl || searchUrl);
}

function isLikelySameTopicItem(left, right) {
  const leftTitle = normalizeContentFingerprint(left?.title ?? "");
  const rightTitle = normalizeContentFingerprint(right?.title ?? "");
  if (!leftTitle || !rightTitle) return false;

  if (leftTitle === rightTitle || leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) {
    const leftTime = itemPrimaryAt(left);
    const rightTime = itemPrimaryAt(right);
    if (leftTime == null || rightTime == null) return true;
    return Math.abs(leftTime - rightTime) <= 24 * 60 * 60 * 1000;
  }

  const leftTokens = fingerprintTokens(leftTitle);
  const rightTokens = fingerprintTokens(rightTitle);
  const overlap = tokenOverlapRatio(leftTokens, rightTokens);
  if (overlap < 0.95) return false;
  const leftTime = itemPrimaryAt(left);
  const rightTime = itemPrimaryAt(right);
  if (leftTime == null || rightTime == null) return false;
  return Math.abs(leftTime - rightTime) <= 24 * 60 * 60 * 1000;
}

function itemPrimaryAt(item) {
  const value = item?.publishedAt ?? item?.sourceSignals?.[0]?.publishedAt ?? item?.capturedAt ?? item?.generatedAt ?? item?.updatedAt;
  const timestamp = new Date(value ?? "").getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function mergeDuplicateItems(left, right) {
  const winner = Number(right.score ?? 0) > Number(left.score ?? 0) ? right : left;
  const loser = winner === right ? left : right;
  const mergedSignals = [...new Map([...(left.sourceSignals ?? []), ...(right.sourceSignals ?? [])].map((signal) => [signal.url, signal])).values()];
  const mergedLinks = [...new Map([...(left.searchLinks ?? []), ...(right.searchLinks ?? [])].map((link) => [link.url, link])).values()];
  const categories = uniqueValues([...(left.categories ?? [left.category]), ...(right.categories ?? [right.category])]);
  const primaryCategory = categories.includes(winner.category) ? winner.category : categories[0] ?? winner.category ?? loser.category ?? "general";

  return {
    ...loser,
    ...winner,
    category: primaryCategory,
    categoryLabel: CATEGORY_LABELS[primaryCategory] ?? winner.categoryLabel ?? loser.categoryLabel ?? "その他",
    categories,
    categoryLabels: categories.map((category) => CATEGORY_LABELS[category] ?? "その他"),
    briefSummary: pickBetterBriefSummary(left.briefSummary, right.briefSummary),
    summary: pickBetterSummary(left.summary, right.summary),
    sourceSignals: mergedSignals,
    searchLinks: mergedLinks,
    posts: String(Math.max(Number(left.posts ?? 1), Number(right.posts ?? 1), mergedSignals.length || 1)),
    metricLabel: mergedSignals.length > 1 ? "sources" : (winner.metricLabel ?? loser.metricLabel ?? "source"),
    thumbnailUrl: sanitizeThumbnailUrl(winner.thumbnailUrl) ?? sanitizeThumbnailUrl(loser.thumbnailUrl) ?? mergedSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
  };
}

function pickBetterBriefSummary(leftSummary, rightSummary) {
  const left = normalizeBriefSummaryText(leftSummary);
  const right = normalizeBriefSummaryText(rightSummary);
  if (left && !right) return left;
  if (right && !left) return right;
  return right.length > left.length ? right : left;
}

function pickBetterSummary(leftSummary, rightSummary) {
  const left = normalizeSummaryText(leftSummary);
  const right = normalizeSummaryText(rightSummary);
  const leftUseful = hasUsefulSummary(left);
  const rightUseful = hasUsefulSummary(right);
  if (leftUseful && !rightUseful) return left;
  if (rightUseful && !leftUseful) return right;
  return right.length > left.length ? right : left;
}

function normalizeContentFingerprint(value) {
  return stripHtml(String(value ?? ""))
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/[【】「」『』]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/g, " ")
    .replace(/\b[a-z0-9]{8,}\b/g, " ")
    .replace(/\b(速報|動画|写真|news|ニュース|独自|判明|配信開始|登場)\b/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprintTokens(value) {
  return [...new Set(
    normalizeContentFingerprint(value)
      .split(" ")
      .filter((token) => token.length >= 2 && !GENERIC_TOKENS.has(token)),
  )];
}

function tokenOverlapRatio(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) return 0;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
}

function sharesAnyCategory(left, right) {
  const leftCategories = new Set(left.categories ?? [left.category]);
  return (right.categories ?? [right.category]).some((category) => leftCategories.has(category));
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}
