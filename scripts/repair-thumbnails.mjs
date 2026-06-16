import fs from "node:fs/promises";
import path from "node:path";

import { resolveThumbnail, sanitizeThumbnailUrl, extractEncodedUrlsFromHtml, isWeakThumbnailUrl } from "../lib/thumbnail-utils.mjs";

const DEFAULT_DATA_FILES = [
  "data/news-archive.json",
  "data/trend-topics.json",
  "data/trend-topics-archive.json",
  "data/trend-topics-browse.json",
  "data/home-topics.json",
  "data/daily-brief.json",
  "data/adult-news.json",
];

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 15000;

async function main() {
  const selectedFiles = process.argv.slice(2);
  const dataFiles = selectedFiles.length ? selectedFiles : DEFAULT_DATA_FILES;
  for (const relativeFile of dataFiles) {
    const absoluteFile = path.resolve(relativeFile);
    const raw = await fs.readFile(absoluteFile, "utf8");
    const payload = JSON.parse(raw);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const targets = items.filter(needsThumbnailRepair);
    if (!targets.length) {
      console.log(`${relativeFile}: no repair needed`);
      continue;
    }

    let repaired = 0;
    let failed = 0;
    await mapWithConcurrency(targets, CONCURRENCY, async (item) => {
      const thumbnailUrl = await resolveBestThumbnail(item);
      if (!thumbnailUrl) {
        failed += 1;
        return;
      }
      applyThumbnail(item, thumbnailUrl);
      repaired += 1;
    });

    payload.items = items;
    await fs.writeFile(absoluteFile, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`${relativeFile}: repaired=${repaired} failed=${failed} total=${targets.length}`);
  }
}

function needsThumbnailRepair(item) {
  if (!sanitizeThumbnailUrl(item?.thumbnailUrl)) return true;
  if (isWeakThumbnailUrl(item?.thumbnailUrl)) return true;
  if (hasSuspiciousThumbnailMismatch(item?.thumbnailUrl, item)) return true;
  return Array.isArray(item?.sourceSignals) && item.sourceSignals.some((signal) => {
    const value = signal?.thumbnailUrl;
    return !sanitizeThumbnailUrl(value) || isWeakThumbnailUrl(value) || hasSuspiciousThumbnailMismatch(value, signal, item);
  });
}

async function resolveBestThumbnail(item) {
  for (const sourceUrl of candidateSourceUrls(item)) {
    const html = await fetchPageHtml(sourceUrl);
    if (!html) continue;
    const directThumbnailUrl = await resolveThumbnailFromHtml(html, sourceUrl);
    if (directThumbnailUrl) return directThumbnailUrl;

    for (const nestedUrl of extractNestedArticleUrls(html, sourceUrl)) {
      const nestedHtml = await fetchPageHtml(nestedUrl);
      if (!nestedHtml) continue;
      const nestedThumbnailUrl = await resolveThumbnailFromHtml(nestedHtml, nestedUrl);
      if (nestedThumbnailUrl) return nestedThumbnailUrl;
    }
  }
  return null;
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
  if (thumbnailUrl && !isWeakThumbnailUrl(thumbnailUrl)) return thumbnailUrl;
  return null;
}

function candidateSourceUrls(item) {
  const values = [
    ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals.map((signal) => signal?.url) : []),
    item?.primaryLink?.url,
    item?.sourceUrl,
    item?.url,
    item?.link,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);

  const unique = [...new Set(values)];
  const direct = unique.filter((value) => !isAggregatorUrl(value));
  const fallback = unique.filter((value) => isAggregatorUrl(value));
  return [...direct, ...fallback];
}

function isAggregatorUrl(value) {
  return /news\.yahoo\.co\.jp|news\.google\.com/i.test(String(value ?? ""));
}

function extractNestedArticleUrls(html, baseUrl) {
  const rawUrls = new Set();
  for (const match of String(html ?? "").matchAll(/https?:\/\/[^"'\\\s<>()]+/g)) {
    rawUrls.add(match[0]);
  }
  for (const url of extractEncodedUrlsFromHtml(html)) {
    rawUrls.add(url);
  }

  return [...rawUrls]
    .map((value) => {
      try {
        return new URL(value, baseUrl).toString();
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .filter((value) => !isAggregatorUrl(value))
    .filter((value) => !/\.(?:png|jpe?g|webp|gif|svg)(?:$|[?#])/i.test(value))
    .sort((left, right) => scoreArticleUrl(right) - scoreArticleUrl(left))
    .slice(0, 12);
}

function scoreArticleUrl(url) {
  const value = String(url ?? "").toLowerCase();
  let score = 0;
  if (/\/article\/|\/articles\/|\/news\/|\/games\/|\/entertainment\/|\/anime\//.test(value)) score += 40;
  if (/4gamer|gamespark|inside-games|animeanime|denfaminicogamer|nhk|nikkei|asahi|yahoo/.test(value)) score += 30;
  if (/news\.yahoo\.co\.jp\/articles\//.test(value)) score += 60;
  if (/[\w-]+\.(?:co\.jp|jp)\//.test(value)) score += 10;
  return score;
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
    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function applyThumbnail(item, thumbnailUrl) {
  item.thumbnail = thumbnailUrl;
  item.thumbnailUrl = thumbnailUrl;
  if (!Array.isArray(item.sourceSignals)) return;
  for (const signal of item.sourceSignals) {
    if (!signal) continue;
    if (!sanitizeThumbnailUrl(signal.thumbnailUrl) || isWeakThumbnailUrl(signal.thumbnailUrl) || hasSuspiciousThumbnailMismatch(signal.thumbnailUrl, signal, item)) {
      signal.thumbnailUrl = thumbnailUrl;
    }
  }
}

function hasSuspiciousThumbnailMismatch(thumbnailUrl, ...contexts) {
  const thumbnailHost = hostnameFor(thumbnailUrl);
  if (!thumbnailHost) return false;
  if (!/(?:^|\.)yimg\.jp$|newsatcl-pctr\.c\.yimg\.jp$/i.test(thumbnailHost)) return false;

  const articleHosts = contexts
    .flatMap((context) => [
      context?.url,
      context?.canonicalUrl,
      context?.sourceUrl,
      context?.primaryLink?.url,
      context?.link,
    ])
    .map((value) => hostnameFor(value))
    .filter(Boolean)
    .filter((host) => !/news\.yahoo\.co\.jp$|news\.google\.com$|(?:^|\.)yimg\.jp$/i.test(host));

  return articleHosts.length > 0;
}

function hostnameFor(value) {
  try {
    return new URL(String(value ?? "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
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

await main();
