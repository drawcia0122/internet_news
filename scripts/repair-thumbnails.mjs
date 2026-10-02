import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveThumbnail, sanitizeThumbnailUrl, readImageTagAttributes, isWeakThumbnailUrl, hasSuspiciousThumbnailMismatch, isAggregatorThumbnailUrl, isLowResolutionThumbnailUrl } from "../lib/thumbnail-utils.mjs";

import "../news-summary-integrity.js";
const { canonicalArticleUrl, titlesReferToSameArticle } = globalThis.NewsSummaryIntegrity;

const DEFAULT_DATA_FILES = [
  "data/news-archive.json",
  "data/trend-topics.json",
  "data/trend-topics-archive.json",
  "data/trend-topics-browse.json",
  "data/home-topics.json",
  "data/daily-brief.json",
  "data/adult-news.json",
];

const CONCURRENCY = 1;
const FETCH_TIMEOUT_MS = 15000;

async function main() {
  const selectedFiles = process.argv.slice(2);
  return repairThumbnails(selectedFiles);
}

export async function repairThumbnails(selectedFiles = []) {
  const dataFiles = selectedFiles.length ? selectedFiles : DEFAULT_DATA_FILES;
  for (const relativeFile of dataFiles) {
    const absoluteFile = path.resolve(relativeFile);
    const raw = await fs.readFile(absoluteFile, "utf8");
    const payload = JSON.parse(raw);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const duplicateThumbnailUrls = collectOverusedThumbnailUrls(items);
    const targets = items.filter((item) => needsThumbnailRepair(item, duplicateThumbnailUrls));
    if (!targets.length) {
      console.log(`${relativeFile}: no repair needed`);
      continue;
    }

    let repaired = 0;
    let failed = 0;
    await mapWithConcurrency(targets, CONCURRENCY, async (item) => {
      const repairedItem = await repairItemThumbnail(item);
      if (!repairedItem) {
        // A transient publisher failure must not erase an otherwise usable image.
        if (!sanitizeThumbnailUrl(item.thumbnailUrl)) clearInvalidThumbnail(item);
        failed += 1;
        return;
      }
      repaired += 1;
    });

    payload.items = items;
    await fs.writeFile(absoluteFile, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`${relativeFile}: repaired=${repaired} failed=${failed} total=${targets.length}`);
  }
  const archiveFile = dataFiles.find((file) => path.basename(file) === "news-archive.json");
  if (archiveFile) await synchronizeThumbnailConsumers(path.dirname(path.resolve(archiveFile)));
}

// Home/news pages are generated before the final repair stage. Copy only thumbnail
// fields for the exact same article, keeping order, pagination, dates and categories.
export async function synchronizeThumbnailConsumers(dataDirectory = path.resolve("data")) {
  const archive = JSON.parse(await fs.readFile(path.join(dataDirectory, "news-archive.json"), "utf8"));
  const byId = new Map((archive.items || []).map((item) => [item.id, item]));
  const files = (await fs.readdir(dataDirectory)).filter((name) => /^home-news(?:-page-\d+)?\.json$/.test(name));
  let updated = 0;
  for (const file of files) {
    const filename = path.join(dataDirectory, file);
    const payload = JSON.parse(await fs.readFile(filename, "utf8"));
    let changed = false;
    const changes = restoreArchivedThumbnails(payload.items || [], [...byId.values()]);
    updated += changes;
    changed = changes > 0;
    if (changed) await fs.writeFile(filename, `${JSON.stringify(payload, null, 2)}\n`);
  }
  console.log(`[thumbnail:sync] consumers updated=${updated}`);
  return updated;
}

export function restoreArchivedThumbnails(items, archivedItems) {
  const byId = new Map(archivedItems.map((item) => [item.id, item]));
  let updated = 0;
  for (const item of items) {
    const repaired = byId.get(item.id);
    if (!repaired || !sameArticle(item, repaired)) continue;
    let changed = false;
    const shouldRestore = (current, previous) => {
      const saved = sanitizeThumbnailUrl(previous);
      const active = sanitizeThumbnailUrl(current);
      return saved && saved !== active && (!active || (isLowResolutionThumbnailUrl(active) && !isLowResolutionThumbnailUrl(saved)));
    };
    const thumbnailUrl = sanitizeThumbnailUrl(repaired.thumbnailUrl);
    // An already usable new-feed image remains authoritative.
    if (shouldRestore(item.thumbnailUrl, thumbnailUrl)) {
      item.thumbnailUrl = thumbnailUrl;
      if (Object.hasOwn(item, "thumbnail")) item.thumbnail = thumbnailUrl;
      changed = true;
    }
    for (const signal of item.sourceSignals || []) {
      const repairedSignal = (repaired.sourceSignals || []).find((candidate) => sameArticle(signal, candidate));
      const signalImage = sanitizeThumbnailUrl(repairedSignal?.thumbnailUrl);
      if (shouldRestore(signal.thumbnailUrl, signalImage)) {
        signal.thumbnailUrl = signalImage;
        if (Object.hasOwn(signal, "thumbnail")) signal.thumbnail = signalImage;
        changed = true;
      }
    }
    if (changed) updated += 1;
  }
  return updated;
}

function directArticleKeys(item) {
  const direct = [item?.sourceUrl, item?.canonicalUrl, item?.url, item?.link, item?.primaryLink?.url].filter(Boolean);
  if (direct.length) return direct.map(canonicalArticleUrl);
  // Raw trend-archive topics only store URLs in signals. Pick the matching
  // primary article, not every related article in the cluster.
  const primary = (item?.sourceSignals || []).find((signal) => titlesReferToSameArticle(item?.title, signal?.title));
  return [primary?.canonicalUrl, primary?.url].filter(Boolean).map(canonicalArticleUrl);
}

function sameArticle(left, right) {
  const rightKeys = new Set(directArticleKeys(right));
  return directArticleKeys(left).some((key) => rightKeys.has(key));
}

export async function repairItemThumbnail(item, { fetchHtml = fetchPageHtml } = {}) {
  const resolved = await resolveBestThumbnail(item, fetchHtml);
  if (!resolved) return null;
  applyThumbnail(item, resolved.thumbnailUrl, resolved.sourceUrl);
  return resolved.thumbnailUrl;
}

function needsThumbnailRepair(item, duplicateThumbnailUrls = new Set()) {
  if (duplicateThumbnailUrls.has(String(item?.thumbnailUrl ?? "").trim())) return true;
  if (!sanitizeThumbnailUrl(item?.thumbnailUrl)) return true;
  if (isWeakThumbnailUrl(item?.thumbnailUrl)) return true;
  if (isLowResolutionThumbnailUrl(item?.thumbnailUrl)) return true;
  if (hasSuspiciousThumbnailMismatch(item?.thumbnailUrl, item)) return true;
  return Array.isArray(item?.sourceSignals) && item.sourceSignals.some((signal) => {
    const value = signal?.thumbnailUrl;
    return duplicateThumbnailUrls.has(String(value ?? "").trim())
      || !sanitizeThumbnailUrl(value)
      || isWeakThumbnailUrl(value)
      || isLowResolutionThumbnailUrl(value)
      || hasSuspiciousThumbnailMismatch(value, signal, item);
  });
}

async function resolveBestThumbnail(item, fetchHtml) {
  for (const sourceUrl of candidateSourceUrls(item).slice(0, 4)) {
    // An asset accidentally saved as an article URL is not HTML or new provenance.
    if (/\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(sourceUrl)) continue;
    const html = await fetchHtml(sourceUrl);
    if (!html) continue;
    const pageTitle = extractPageTitle(html);
    const sourceTitle = (item.sourceSignals || []).find((signal) => sameArticle(signal, { url: sourceUrl }))?.title || item.title;
    if (pageTitle && !titlesReferToSameArticle(pageTitle, sourceTitle)) continue;
    const thumbnailUrl = await resolveThumbnailFromHtml(html, sourceUrl);
    if (thumbnailUrl) return { thumbnailUrl, sourceUrl };
    // Never scrape unrelated outbound stories to fill a missing thumbnail.
  }
  return null;
}

function extractPageTitle(html) {
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = readImageTagAttributes(match[0]);
    if ((attrs.property || attrs.name || "").toLowerCase() === "og:title") return attrs.content || "";
  }
  return String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
}

async function resolveThumbnailFromHtml(html, sourceUrl) {
  const resolved = await resolveThumbnail({
    item: {
      thumbnailUrl: null,
      thumbnail: null,
    },
    pageHtml: html,
    sourceUrl,
  });
  const thumbnailUrl = sanitizeThumbnailUrl(resolved?.thumbnailUrl || resolved?.thumbnail, sourceUrl);
  if (thumbnailUrl && !isWeakThumbnailUrl(thumbnailUrl) && !isLowResolutionThumbnailUrl(thumbnailUrl) && !isAggregatorThumbnailUrl(thumbnailUrl)) return thumbnailUrl;
  return null;
}

function candidateSourceUrls(item) {
  const values = [
    item?.sourceUrl,
    item?.url,
    item?.link,
    item?.primaryLink?.url,
    ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals
      .filter((signal) => sameArticle(item, signal) || titlesReferToSameArticle(item.title, signal.title))
      .map((signal) => signal?.url) : []),
  ].map((value) => String(value ?? "").trim()).filter(Boolean);

  const unique = [...new Set(values)];
  const direct = unique.filter((value) => !isAggregatorUrl(value));
  const fallback = unique.filter((value) => isAggregatorUrl(value));
  return [...direct, ...fallback];
}

function isAggregatorUrl(value) {
  return /news\.yahoo\.co\.jp|news\.google\.com|b\.hatena\.ne\.jp/i.test(String(value ?? ""));
}

async function fetchPageHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "INTERNET NEWS/1.0",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) return "";
    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function applyThumbnail(item, thumbnailUrl, sourceUrl) {
  item.thumbnail = thumbnailUrl;
  item.thumbnailUrl = thumbnailUrl;
  if (!Array.isArray(item.sourceSignals)) return;
  for (const signal of item.sourceSignals) {
    if (!signal || !sameArticle(signal, { url: sourceUrl })) continue;
    if (!sanitizeThumbnailUrl(signal.thumbnailUrl) || isWeakThumbnailUrl(signal.thumbnailUrl) || isLowResolutionThumbnailUrl(signal.thumbnailUrl) || hasSuspiciousThumbnailMismatch(signal.thumbnailUrl, signal, item)) {
      signal.thumbnailUrl = thumbnailUrl;
      signal.thumbnail = thumbnailUrl;
    }
  }
}

function clearInvalidThumbnail(item) {
  item.thumbnail = null;
  item.thumbnailUrl = null;
  if (!Array.isArray(item.sourceSignals)) return;
  for (const signal of item.sourceSignals) {
    if (!signal || sanitizeThumbnailUrl(signal.thumbnailUrl)) continue;
    signal.thumbnail = null;
    signal.thumbnailUrl = null;
  }
}

function collectOverusedThumbnailUrls(items) {
  const counts = new Map();
  for (const item of items) {
    const value = String(item?.thumbnailUrl ?? "").trim();
    if (!value) continue;
    let entry = counts.get(value);
    if (!entry) {
      entry = { count: 0, sources: new Set(), categories: new Set() };
      counts.set(value, entry);
    }
    entry.count += 1;
    entry.sources.add(String(item?.sourceName ?? item?.sourceSignals?.[0]?.sourceName ?? item?.sourceSignals?.[0]?.source ?? ""));
    entry.categories.add(String(item?.category ?? item?.categories?.[0] ?? ""));
  }

  return new Set(
    [...counts.entries()]
      .filter(([url, entry]) => {
        if (entry.count < 3) return false;
        return isWeakThumbnailUrl(url)
          || /(?:^https?:\/\/lh3\.googleusercontent\.com\/|newsatcl-pctr\.c\.yimg\.jp\/t\/amd-img\/|news-pctr\.c\.yimg\.jp\/|news\.google\.com\/api\/attachments)/i.test(url)
          || entry.sources.size >= 8
          || entry.categories.size >= 6;
      })
      .map(([url]) => url),
  );
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await main();
}
