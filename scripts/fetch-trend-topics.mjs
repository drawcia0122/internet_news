import { mkdir, readFile, writeFile } from "node:fs/promises";

import { buildDailyBrief } from "../lib/daily-brief.mjs";
import { logThumbnailCoverage, resolveThumbnail, sanitizeThumbnailUrl, absolutizeUrl } from "../lib/thumbnail-utils.mjs";
import { collectTrendTopics } from "../lib/trend-aggregator.mjs";

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

const payload = await collectTrendTopics();
await enrichItemsWithMetadata(payload.items ?? []);
const dedupedItems = dedupeNearDuplicateItems(payload.items ?? []);
const capturedAt = payload.generatedAt ?? new Date().toISOString();
const curatedItems = selectCuratedTrendItems(dedupedItems, MAX_CURRENT_ITEMS);
const currentPayload = {
  ...payload,
  items: curatedItems.map(normalizeStoredTopic),
};

const archivePath = "data/trend-topics-archive.json";
const archivePayload = await readArchivePayload(archivePath);
const mergedArchiveItems = mergeArchiveItems(
  (archivePayload.items ?? []).map(normalizeArchiveItem),
  dedupedItems.map(normalizeArchiveItem),
).filter((item) => isWithinArchiveWindow(item, capturedAt) && shouldKeepArchiveItem(item));
const nextArchivePayload = {
  generatedAt: capturedAt,
  items: mergedArchiveItems,
};
const dailyBriefPayload = buildDailyBrief({
  currentItems: currentPayload.items,
  archiveItems: mergedArchiveItems,
  generatedAt: capturedAt,
});
const browseTopicsPayload = buildBrowseTopicsPayload({
  archiveItems: mergedArchiveItems,
  generatedAt: capturedAt,
});
const homeTopicsPayload = buildHomeTopicsPayload({
  currentItems: currentPayload.items,
  archiveItems: mergedArchiveItems,
  generatedAt: capturedAt,
});

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
  "data/home-topics.json",
  `${JSON.stringify(homeTopicsPayload, null, 2)}\n`,
  "utf8",
);

logThumbnailCoverage(currentPayload.items);
console.log(`Saved ${currentPayload.items.length} trend topic(s).`);

function normalizeStoredTopic(item) {
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
    ...item,
    category,
    categories,
    categoryLabel,
    categoryLabels,
    capturedAt: item.capturedAt ?? item.generatedAt ?? capturedAt,
    thumbnailUrl: sanitizeThumbnailUrl(item.thumbnailUrl),
    thumbnail: sanitizeThumbnailUrl(item.thumbnail ?? item.thumbnailUrl),
    sourceSignals: sanitizeSourceSignals(item.sourceSignals),
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
  const sourceItems = currentItems.length ? currentItems : archiveItems;
  const rankedItems = [...sourceItems]
    .sort((left, right) => {
      return homeTopicPriority(right) - homeTopicPriority(left)
        || Number(right.score ?? 0) - Number(left.score ?? 0)
        || archiveTimestamp(right) - archiveTimestamp(left);
    })
    .slice(0, 30);

  return {
    generatedAt,
    items: rankedItems.map((item) => ({
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
      thumbnail: sanitizeThumbnailUrl(item.thumbnail ?? item.thumbnailUrl),
      publishedAt: item.publishedAt ?? item.sourceSignals?.[0]?.publishedAt ?? null,
      capturedAt: item.capturedAt ?? generatedAt,
      time: item.time ?? item.sourceSignals?.[0]?.publishedLabel ?? null,
      hotReasons: Array.isArray(item.hotReasons) ? item.hotReasons.slice(0, 4) : [],
      sourceSignals: sanitizeSourceSignals(item.sourceSignals).slice(0, 3).map((signal) => ({
        source: signal.source ?? null,
        sourceName: signal.sourceName ?? null,
        title: signal.title ?? null,
        url: signal.url ?? null,
        publishedAt: signal.publishedAt ?? null,
        publishedLabel: signal.publishedLabel ?? null,
        thumbnailUrl: sanitizeThumbnailUrl(signal.thumbnailUrl),
        thumbnail: sanitizeThumbnailUrl(signal.thumbnail ?? signal.thumbnailUrl),
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

function buildBrowseTopicsPayload({ archiveItems = [], generatedAt = new Date().toISOString() }) {
  const rankedItems = [...archiveItems]
    .filter((item) => {
      const ageHours = (Date.now() - archiveTimestamp(item)) / (1000 * 60 * 60);
      return ageHours > 24 && ageHours <= 14 * 24;
    })
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0) || archiveTimestamp(right) - archiveTimestamp(left))
    .slice(0, 4200);

  return {
    generatedAt,
    items: rankedItems.map((item) => ({
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
      thumbnail: sanitizeThumbnailUrl(item.thumbnail ?? item.thumbnailUrl),
      publishedAt: item.publishedAt ?? item.sourceSignals?.[0]?.publishedAt ?? null,
      capturedAt: item.capturedAt ?? generatedAt,
      time: item.time ?? item.sourceSignals?.[0]?.publishedLabel ?? null,
      hotReasons: Array.isArray(item.hotReasons) ? item.hotReasons.slice(0, 2) : [],
      sourceSignals: sanitizeSourceSignals(item.sourceSignals).slice(0, 1).map((signal) => ({
        source: signal.source ?? null,
        sourceName: signal.sourceName ?? null,
        title: signal.title ?? null,
        url: signal.url ?? null,
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

function homeTopicPriority(item) {
  const baseScore = Number(item.score ?? 0);
  const freshness = isFreshTopic(item) ? 12 : 0;
  const sourceBonus = Math.min(12, Math.max(0, Number(item.posts ?? 1) - 1) * 4);
  const importance = isHighImportanceText(topicText(item), item.categories ?? [], item.category) ? 24 : 0;
  const penalty = isLowPriorityText(topicText(item)) ? 60 : 0;
  return baseScore + freshness + sourceBonus + importance - penalty;
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
    ...(item.sourceSignals ?? []).flatMap((signal) => [signal.title, signal.summary, signal.sourceName]),
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
  const withThumbnail = items.filter((item) => sanitizeThumbnailUrl(item.thumbnailUrl ?? item.thumbnail));
  const withoutThumbnail = items.filter((item) => !sanitizeThumbnailUrl(item.thumbnailUrl ?? item.thumbnail));
  const selectedWithThumbnail = withThumbnail.slice(0, maxItems);
  const maxWithoutThumbnail = Math.min(withoutThumbnail.length, selectedWithThumbnail.length, Math.max(0, maxItems - selectedWithThumbnail.length));
  const selectedWithoutThumbnail = withoutThumbnail.slice(0, maxWithoutThumbnail);

  return [...selectedWithThumbnail, ...selectedWithoutThumbnail]
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0) || archiveTimestamp(right) - archiveTimestamp(left))
    .slice(0, maxItems);
}

async function enrichItemsWithMetadata(items) {
  const prioritizedItems = [...items]
    .sort((left, right) => metadataPriority(right) - metadataPriority(left));
  await Promise.all(prioritizedItems.map((item) => enrichItemMetadata(item)));
}

function metadataPriority(item) {
  let priority = Number(item.score ?? 0);
  if (item.category === "adult" || item.categories?.includes("adult")) priority += 80;
  if (!hasUsefulSummary(item.summary)) priority += 50;
  if (!sanitizeThumbnailUrl(item.thumbnailUrl)) priority += 20;
  return priority;
}

async function enrichItemMetadata(item) {
  const directThumbnail = await resolveThumbnail({ item, sourceUrl: item.sourceSignals?.[0]?.url ?? item.searchLinks?.[0]?.url ?? "" });
  item.thumbnailUrl = directThumbnail.thumbnailUrl;
  item.thumbnail = directThumbnail.thumbnail;
  item.sourceSignals = sanitizeSourceSignals(item.sourceSignals);

  const candidateUrls = [
    item.sourceSignals?.find((entry) => entry?.url)?.url,
    ...(item.sourceSignals ?? []).map((entry) => entry?.url).filter(Boolean),
  ];
  const uniqueUrls = [...new Set(candidateUrls)].slice(0, 4);
  if (!uniqueUrls.length) return;

  let metadata = null;
  for (const candidateUrl of uniqueUrls) {
    metadata = await fetchPageMetadata(candidateUrl, item.title).catch(() => null);
    if (metadata?.thumbnailUrl || metadata?.summary || metadata?.briefSummary) break;
  }
  if (!metadata) return;

  if (!item.thumbnailUrl && metadata.thumbnailUrl) {
    item.thumbnailUrl = metadata.thumbnailUrl;
    item.thumbnail = metadata.thumbnailUrl;
  }

  if (shouldReplaceSummary(item.summary, metadata.summary)) {
    item.summary = metadata.summary;
  }

  if (shouldReplaceBriefSummary(item.briefSummary, metadata.briefSummary, item.title)) {
    item.briefSummary = metadata.briefSummary;
  }

  if (Array.isArray(item.sourceSignals) && (metadata.thumbnailUrl || metadata.summary || metadata.briefSummary)) {
    item.sourceSignals = item.sourceSignals.map((entry, index) => {
      if (index !== 0) return entry;
      const entryThumbnail = sanitizeThumbnailUrl(entry.thumbnailUrl ?? entry.thumbnail);
      return {
        ...entry,
        thumbnailUrl: entryThumbnail || metadata.thumbnailUrl || null,
        thumbnail: entryThumbnail || metadata.thumbnailUrl || null,
        summary: entry.summary ?? metadata.summary ?? null,
        briefSummary: entry.briefSummary ?? metadata.briefSummary ?? null,
      };
    });
  }
}

async function fetchPageMetadata(url, title = "", depth = 0, visited = new Set()) {
  const normalizedUrl = normalizeFetchUrl(url);
  if (!normalizedUrl || visited.has(normalizedUrl) || depth > 1) return null;
  visited.add(normalizedUrl);

  const response = await fetch(normalizedUrl, {
    headers: {
      "user-agent": "INTERNET NEWS/1.0",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) return null;
  const html = await response.text();
  const responseUrl = normalizeFetchUrl(response.url) ?? normalizedUrl;
  const thumbnailMeta = await resolveThumbnail({ pageHtml: html, sourceUrl: responseUrl });

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

  if (!metadata.thumbnailUrl && isGoogleNewsUrl(responseUrl)) {
    const outboundUrls = extractOutboundArticleUrls(html, responseUrl);
    for (const outboundUrl of outboundUrls.slice(0, 3)) {
      const nested = await fetchPageMetadata(outboundUrl, title, depth + 1, visited).catch(() => null);
      if (nested?.thumbnailUrl || nested?.summary || nested?.briefSummary) {
        return nested;
      }
    }
  }

  return metadata;
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
  return (
    item.sourceSignals?.[0]?.url ??
    item.id ??
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
  const sanitized = signals.map((signal) => ({
    ...signal,
    thumbnailUrl: sanitizeThumbnailUrl(signal?.thumbnailUrl),
    thumbnail: sanitizeThumbnailUrl(signal?.thumbnail ?? signal?.thumbnailUrl),
    briefSummary: normalizeBriefSummaryText(signal?.briefSummary),
    summary: normalizeSummaryText(signal?.summary),
  }));
  const deduped = new Map();

  for (const signal of sanitized) {
    const key = signalIdentityKey(signal);
    const current = deduped.get(key);
    if (!current || signalPublishedAt(signal) > signalPublishedAt(current)) {
      deduped.set(key, signal);
    }
  }

  return [...deduped.values()].sort((left, right) => signalPublishedAt(right) - signalPublishedAt(left));
}

function signalIdentityKey(signal) {
  const source = String(signal?.sourceName ?? signal?.source ?? "").toLowerCase().trim();
  const title = normalizeSignalIdentityFingerprint(signal?.title);
  const summary = normalizeSignalIdentityFingerprint(signal?.summary);
  return `${source}::${title || summary || String(signal?.url ?? "").toLowerCase().trim()}`;
}

function signalPublishedAt(signal) {
  const time = new Date(signal?.publishedAt ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
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
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.toLowerCase();
      if (!/^https?:$/.test(parsed.protocol)) continue;
      if (hostname === "news.google.com") continue;
      if (hostname.endsWith(".google.com")) continue;
      if (hostname.endsWith("googleusercontent.com")) continue;
      if (/\/search$|\/preferences$/.test(parsed.pathname)) continue;
      urls.push(parsed.toString());
    } catch {
      continue;
    }
  }

  return [...new Set(urls)];
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

function synthesizeStoredBriefSummary(item) {
  const title = String(item.title ?? "").replace(/^【[^】]+】\s*/u, "").trim();
  const value = `${title} ${item.summary ?? ""}`.toLowerCase();
  const categories = item.categories ?? [item.category];

  if (categories.includes("crime") || item.category === "crime") {
    if (/遺体|死亡/.test(title)) return "遺体が見つかり、警察が事件と事故の両面から状況確認を進めている。";
    if (/逮捕|送検|起訴/.test(title)) return "警察の捜査が進み、逮捕や送検など新しい動きが出ている。";
    if (/詐欺|投資詐欺|ロマンス詐欺/.test(value)) return "詐欺被害や捜査の進展が報じられており、被害の実態や手口に関心が集まっている。";
    if (/事故|火災|強盗|殺人|不明/.test(value)) return "重大事件や事故に関する新しい情報が出ており、被害状況や経緯の確認が進められている。";
    return "事件や捜査に関する新しい情報が出ており、事実関係の確認が進められている。";
  }

  if (categories.includes("politics") || item.category === "politics") {
    if (/法案|制度|規制|改正/.test(value)) return "制度やルールに関わる新しい動きがあり、施行時期や影響範囲に注目が集まっている。";
    if (/首相|与党|野党|国会|選挙/.test(value)) return "政権や国会をめぐる新しい動きがあり、今後の説明や判断に注目が集まっている。";
    return "政府や与野党の動きに新しい展開があり、今後の説明や判断に注目が集まっている。";
  }

  if (categories.includes("business") || item.category === "business") {
    if (/決算|株価|市況/.test(value)) return "企業業績や市場動向に新しい材料が出ており、相場への影響が注目されている。";
    if (/上場|ipo|ロックアップ/.test(value)) return "上場や資金調達に関する新しい情報が出ており、市場の反応が注目されている。";
    if (/値上げ|価格|物価|関税|補助金/.test(value)) return "価格や政策コストに関わる新しい動きがあり、家計や企業活動への影響が注目されている。";
    if (/詐欺|被害/.test(value)) return "金銭被害や投資トラブルに関する情報が出ており、被害の広がりや手口に関心が集まっている。";
    return "企業や経済に関する新しい発表があり、今後の影響が注目されている。";
  }

  if (categories.includes("tech") || item.category === "tech") {
    if (/半導体|ai|生成ai|gpu|データセンター/.test(value)) return "AIや半導体をめぐる新しい動きがあり、関連業界や競争環境への影響が注目されている。";
    if (/iphone|android|スマホ|アプリ|アップデート/.test(value)) return "製品やサービスの新しい動きがあり、利用者への影響や使い勝手の変化が注目されている。";
    return "技術開発や製品動向に新しい進展があり、関連業界や利用者への影響が注目されている。";
  }

  if (categories.includes("games") || item.category === "games") {
    if (/switch|ps5|steam|任天堂|抽選|倍率|発売/.test(value)) return "人気ゲーム機やタイトルに新しい情報が出ており、入手難易度や発売動向に関心が集まっている。";
    return "ゲームや関連サービスをめぐる新しい発表があり、ユーザーの反応が広がっている。";
  }

  if (categories.includes("sports") || item.category === "sports") {
    if (/大谷|ドジャース|mlb|代表|w杯|日本代表/.test(value)) return "注目選手や代表をめぐる新しい動きがあり、試合結果や起用判断への関心が高まっている。";
    if (/優勝|敗戦|逆転|炎上/.test(value)) return "試合結果やプレー内容が大きな反響を呼び、ファンの間で議論が広がっている。";
    return "試合結果や選手・代表をめぐる新しい動きがあり、ファンの関心が集まっている。";
  }

  if (categories.includes("entertainment") || categories.includes("manga") || categories.includes("books")) {
    if (/アニメ化|映画化|ドラマ化|キャスト発表|放送/.test(value)) return "作品の映像化や出演情報に新しい発表があり、ファンの期待が高まっている。";
    if (/新刊|連載|受賞|ランキング/.test(value)) return "作品や出版動向に新しい情報が出ており、読者やファンの反応が広がっている。";
    return "作品や出演者をめぐる新しい発表があり、ファンや読者の反応が広がっている。";
  }

  if (categories.includes("sns") || categories.includes("net-culture") || item.category === "sns") {
    if (/炎上|拡散|バズ|トレンド入り/.test(value)) return "SNSでの拡散や反響が大きく、ネット上で一気に注目が集まっている。";
    if (/話題|反応|コメント/.test(value)) return "SNSやネット上で反応が広がっており、共感や驚きの声が集まっている。";
    return "ネット上で反応が広がっており、短時間で注目を集めている話題だ。";
  }

  if (categories.includes("adult") || item.category === "adult") {
    if (/セール|キャンペーン|割引|クーポン/.test(value)) return "大型セールや割引情報が出ており、対象作品や条件に関心が集まっている。";
    if (/逮捕|摘発|送検/.test(value)) return "関連業界や配信をめぐる事件性のある話題として、ネット上で大きく注目されている。";
    return "関連コンテンツや人物をめぐる話題が広がっており、ネット上で反応が集まっている。";
  }

  return "新しい発表や動きがあり、詳細確認のために注目されている。";
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

  for (const item of sortedItems) {
    const duplicateIndex = kept.findIndex((current) => isNearDuplicateItem(current, item));
    if (duplicateIndex === -1) {
      kept.push(item);
      continue;
    }
    kept[duplicateIndex] = mergeDuplicateItems(kept[duplicateIndex], item);
  }

  return kept;
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
    if ((leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) && Math.min(leftTitle.length, rightTitle.length) >= 18) {
      return true;
    }
  }

  const leftTitleTokens = fingerprintTokens(left.title);
  const rightTitleTokens = fingerprintTokens(right.title);
  if (tokenOverlapRatio(leftTitleTokens, rightTitleTokens) >= 0.82 && Math.min(leftTitleTokens.length, rightTitleTokens.length) >= 4) {
    return true;
  }

  const leftContentTokens = fingerprintTokens(`${left.title ?? ""} ${left.summary ?? ""}`);
  const rightContentTokens = fingerprintTokens(`${right.title ?? ""} ${right.summary ?? ""}`);
  return tokenOverlapRatio(leftContentTokens, rightContentTokens) >= 0.88 && Math.min(leftContentTokens.length, rightContentTokens.length) >= 6;
}

function itemPrimaryUrl(item) {
  const signalUrl = item?.sourceSignals?.[0]?.url;
  const searchUrl = item?.searchLinks?.[0]?.url;
  const rawUrl = String(signalUrl || searchUrl || "").trim();
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    const params = new URLSearchParams(parsed.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "ref", "src", "from"].forEach((key) => params.delete(key));
    parsed.search = params.toString();
    return `${parsed.hostname.replace(/^www\./, "").toLowerCase()}${parsed.pathname.toLowerCase()}`.replace(/\/$/, "");
  } catch {
    return rawUrl.toLowerCase().replace(/^https?:\/\//, "").replace(/[#?].*$/i, "");
  }
}

function isLikelySameTopicItem(left, right) {
  const leftTitle = normalizeContentFingerprint(left?.title ?? "");
  const rightTitle = normalizeContentFingerprint(right?.title ?? "");
  if (!leftTitle || !rightTitle) return false;

  if (leftTitle === rightTitle || leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) {
    const leftTime = itemPrimaryAt(left);
    const rightTime = itemPrimaryAt(right);
    if (leftTime == null || rightTime == null) return true;
    return Math.abs(leftTime - rightTime) <= 36 * 60 * 60 * 1000;
  }

  const leftTokens = fingerprintTokens(leftTitle);
  const rightTokens = fingerprintTokens(rightTitle);
  const overlap = tokenOverlapRatio(leftTokens, rightTokens);
  if (overlap < 0.9) return false;
  const leftTime = itemPrimaryAt(left);
  const rightTime = itemPrimaryAt(right);
  if (leftTime == null || rightTime == null) return false;
  return Math.abs(leftTime - rightTime) <= 36 * 60 * 60 * 1000;
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
