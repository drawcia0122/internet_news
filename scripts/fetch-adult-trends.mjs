import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  aggregateAdultFeatures,
  aggregateAdultTrendItems,
  collectAdultTrendRawItems,
  mergeAdultArchiveItems,
} from "../lib/adult-trend-aggregator.mjs";
import { logThumbnailCoverage } from "../lib/thumbnail-utils.mjs";

const fetchedAt = new Date().toISOString();
const archivePath = "data/adult-trends-archive.json";
const rankHistoryPath = "data/adult-rank-history.json";

const rawItems = await collectAdultTrendRawItems({
  fetchText,
  fetchJson,
  fanzaApi: {
    apiId: process.env.FANZA_API_ID,
    affiliateId: process.env.FANZA_AFFILIATE_ID,
    hits: Number(process.env.FANZA_API_HITS ?? 20),
  },
  manualItems: await readManualItems("data/adult-trend-sources.json"),
  fetchedAt,
});

const baseCurrentItems = aggregateAdultTrendItems(rawItems, { fetchedAt, limit: 80 });
const archivePayload = await readJson(archivePath, []);
const previousArchiveItems = Array.isArray(archivePayload) ? archivePayload : archivePayload.items ?? [];
const previousRankHistory = await readJson(rankHistoryPath, {});
const { items: currentItems, history: nextRankHistory } = applyAdultTrendHistory(baseCurrentItems, previousRankHistory, fetchedAt);
const currentFeatures = aggregateAdultFeatures(currentItems, { fetchedAt });
const mergedArchiveItems = mergeAdultArchiveItems(previousArchiveItems, currentItems, fetchedAt);

await mkdir("data", { recursive: true });
await writeFile("data/adult-trends.json", `${JSON.stringify(currentItems, null, 2)}\n`, "utf8");
await writeFile("data/adult-features.json", `${JSON.stringify(currentFeatures, null, 2)}\n`, "utf8");
await writeFile(archivePath, `${JSON.stringify(mergedArchiveItems, null, 2)}\n`, "utf8");
await writeFile(rankHistoryPath, `${JSON.stringify(nextRankHistory, null, 2)}\n`, "utf8");

logThumbnailCoverage(currentItems);
console.log(`Saved ${currentItems.length} adult trend item(s).`);
console.log(`Saved ${currentFeatures.length} adult feature item(s).`);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "INTERNET NEWS adult trend collector/1.1 (+local personal use)",
      accept: "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      cookie: "age_check_done=1; ckcy=1; locale=ja; adultchecked=1",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return await response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "INTERNET NEWS adult trend collector/1.1 (+local personal use)",
      accept: "application/json,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return await response.json();
}

async function readManualItems(path) {
  const payload = await readJson(path, []);
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.items) ? payload.items : [];
}

async function readJson(path, fallbackValue) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function applyAdultTrendHistory(items, rawHistory, fetchedAt) {
  const previousHistory = normalizeRankHistory(rawHistory);
  const hadHistorySnapshot = Object.keys(previousHistory).length > 0;
  const nextHistory = structuredClone(previousHistory);

  const enrichedItems = items.map((item) => {
    const historyKey = item.historyKey || item.id;
    const entries = Array.isArray(previousHistory[historyKey]) ? previousHistory[historyKey] : [];
    const currentRank = normalizeNullableNumber(item.rank ?? item.ranking);
    const previousRank = findPreviousRank(entries, currentRank);
    const rankDelta = previousRank && currentRank ? previousRank - currentRank : 0;
    const adultTrendScore = calculateAdultTrendScore({
      item,
      currentRank,
      previousRank,
      rankDelta,
      hadHistorySnapshot,
      hasPriorEntries: entries.length > 0,
    });
    const trendReasons = buildAdultTrendReasons({
      item,
      currentRank,
      previousRank,
      rankDelta,
      hadHistorySnapshot,
      hasPriorEntries: entries.length > 0,
    });

    const nextEntry = {
      rank: currentRank,
      source: item.sourceName ?? item.source ?? "Source",
      rankingType: item.rankingType ?? item.sourceKey ?? item.trendType ?? "trend",
      fetchedAt,
    };

    nextHistory[historyKey] = dedupeRankHistory([
      ...entries,
      nextEntry,
    ]);

    return {
      ...item,
      previousRank,
      rankDelta,
      rankChange: rankDelta,
      adultTrendScore,
      trendReasons,
      history: dedupeItemHistory([...(item.history ?? []), nextEntry]).slice(0, 24),
    };
  });

  return {
    items: enrichedItems,
    history: nextHistory,
  };
}

function normalizeRankHistory(rawHistory) {
  if (!rawHistory || typeof rawHistory !== "object" || Array.isArray(rawHistory)) return {};
  return Object.fromEntries(
    Object.entries(rawHistory).map(([key, entries]) => [key, dedupeRankHistory(entries)])
  );
}

function dedupeRankHistory(entries) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const fetched = String(entry?.fetchedAt ?? "").trim();
    const rank = normalizeNullableNumber(entry?.rank);
    if (!fetched || rank === null) continue;
    map.set(`${fetched}::${rank}`, {
      rank,
      source: String(entry?.source ?? "Source"),
      rankingType: String(entry?.rankingType ?? "trend"),
      fetchedAt: fetched,
    });
  }
  return [...map.values()]
    .sort((left, right) => new Date(left.fetchedAt).getTime() - new Date(right.fetchedAt).getTime())
    .slice(-30);
}

function dedupeItemHistory(entries) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const fetched = String(entry?.fetchedAt ?? "").trim();
    const rank = normalizeNullableNumber(entry?.rank);
    if (!fetched || rank === null) continue;
    map.set(`${fetched}::${rank}`, {
      fetchedAt: fetched,
      rank,
      adultHotScore: normalizeNullableNumber(entry?.adultHotScore) ?? null,
      source: String(entry?.source ?? "Source"),
      rankingType: String(entry?.rankingType ?? "trend"),
    });
  }
  return [...map.values()].sort((left, right) => new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime());
}

function findPreviousRank(entries, currentRank) {
  if (!currentRank) return null;
  const sorted = [...(Array.isArray(entries) ? entries : [])].sort((left, right) => new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime());
  for (const entry of sorted) {
    const rank = normalizeNullableNumber(entry?.rank);
    if (rank && rank !== currentRank) return rank;
  }
  return null;
}

function calculateAdultTrendScore({ item, currentRank, previousRank, rankDelta, hadHistorySnapshot, hasPriorEntries }) {
  if (!isDlsiteTrendEligible(item)) return 0;
  const hasComparableHistory = Boolean(previousRank) || (hadHistorySnapshot && !hasPriorEntries);
  const rankJumpScore = Math.max(0, rankDelta) * 2;
  const currentRankBoost = currentRank ? Math.max(0, 100 - currentRank) : 0;
  const newEntryScore = !previousRank && hadHistorySnapshot && !hasPriorEntries
    ? currentRank <= 10 ? 80
      : currentRank <= 30 ? 50
      : currentRank <= 100 ? 25
      : 0
    : 0;
  const discountRate = normalizeNullableNumber(item.discountRate) ?? 0;
  const saleBoost = discountRate >= 70 ? 40 : discountRate >= 50 ? 30 : discountRate >= 30 ? 15 : 0;
  const multiRankingBoost = /ranking/i.test(String(item.sourceKey ?? "")) ? 8 : 0;
  const genreBoost = /同人音声|ASMR|音声/i.test(String(item.adultPrimaryGenre ?? item.genre ?? ""))
    ? 12
    : /同人ゲーム|ゲーム/i.test(String(item.adultPrimaryGenre ?? item.genre ?? ""))
      ? 10
      : /エロ漫画|漫画/i.test(String(item.adultPrimaryGenre ?? item.genre ?? ""))
        ? 8
        : /AI作品|AI/i.test(String(item.adultPrimaryGenre ?? item.genre ?? ""))
          ? 6
          : 0;
  const sourceBoost = String(item.sourceName ?? item.source ?? "").toLowerCase() === "dlsite" ? 6 : 0;
  const baseScore = hasComparableHistory
    ? rankJumpScore + currentRankBoost + newEntryScore + saleBoost + multiRankingBoost + genreBoost + sourceBoost
    : Math.round(saleBoost * 0.5 + genreBoost + sourceBoost);
  return Math.min(100, Math.round(baseScore));
}

function buildAdultTrendReasons({ item, currentRank, previousRank, rankDelta, hadHistorySnapshot, hasPriorEntries }) {
  if (!isDlsiteTrendEligible(item)) {
    return Array.isArray(item.trendReasons) ? [...new Set(item.trendReasons.map((reason) => String(reason).trim()).filter(Boolean))].slice(0, 6) : [];
  }
  const reasons = [];
  if (previousRank && currentRank && rankDelta > 0) {
    reasons.push(`前回${previousRank}位から${currentRank}位へ上昇`);
    reasons.push(`ランキング+${rankDelta}上昇`);
  } else if (!previousRank && hadHistorySnapshot && !hasPriorEntries && currentRank && currentRank <= 100) {
    reasons.push(currentRank <= 10 ? "新規でランキング上位入り" : "新規でランキング圏内入り");
  }

  const discountRate = normalizeNullableNumber(item.discountRate);
  if (discountRate !== null && discountRate > 0) {
    reasons.push(`${discountRate}%OFFセール対象`);
  }

  if (currentRank && currentRank <= 10) {
    const genreLabel = String(item.adultPrimaryGenre ?? item.genre ?? "").trim();
    if (genreLabel && !/^(セール|業界ニュース|未分類)$/.test(genreLabel)) reasons.push(`${genreLabel}カテゴリで上位`);
  }

  if (String(item.sourceName ?? item.source ?? "").toLowerCase() === "dlsite" && /ranking|new/i.test(String(item.sourceKey ?? ""))) {
    reasons.push("DLsiteランキングに登場");
  }

  for (const reason of Array.isArray(item.trendReasons) ? item.trendReasons : []) {
    if (!reason) continue;
    reasons.push(String(reason));
  }

  return [...new Set(reasons)].slice(0, 6);
}

function normalizeNullableNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function isDlsiteTrendEligible(item) {
  const sourceName = String(item?.sourceName ?? item?.source ?? "").trim().toLowerCase();
  if (sourceName !== "dlsite") return false;

  const rankingType = String(item?.rankingType ?? item?.rankingKind ?? item?.trendType ?? item?.type ?? "").trim().toLowerCase();
  if (rankingType === "creator-update") return false;

  const sourceKey = String(item?.sourceKey ?? "").trim().toLowerCase();
  return /ranking|new/.test(rankingType) || /ranking|new/.test(sourceKey);
}
