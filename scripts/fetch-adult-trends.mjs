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

const currentItems = aggregateAdultTrendItems(rawItems, { fetchedAt, limit: 80 });
const currentFeatures = aggregateAdultFeatures(currentItems, { fetchedAt });
const archivePayload = await readJson(archivePath, []);
const previousArchiveItems = Array.isArray(archivePayload) ? archivePayload : archivePayload.items ?? [];
const mergedArchiveItems = mergeAdultArchiveItems(previousArchiveItems, currentItems, fetchedAt);

await mkdir("data", { recursive: true });
await writeFile("data/adult-trends.json", `${JSON.stringify(currentItems, null, 2)}\n`, "utf8");
await writeFile("data/adult-features.json", `${JSON.stringify(currentFeatures, null, 2)}\n`, "utf8");
await writeFile(archivePath, `${JSON.stringify(mergedArchiveItems, null, 2)}\n`, "utf8");

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
