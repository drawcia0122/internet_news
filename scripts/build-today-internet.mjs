import { readFile, writeFile } from "node:fs/promises";

import { buildTodayInternetPayload } from "../lib/today-internet-selector.mjs";

async function readJson(path, fallback = null) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function compactHistoryEntry(payload) {
  return {
    generatedAt: payload.generatedAt,
    fallbackUsed: Boolean(payload.fallbackUsed),
    confidence: Number(payload?.dataQuality?.confidence ?? 0),
    selectedTopic: payload?.selectedTopic ? {
      id: payload.selectedTopic.id ?? payload.selectedTopic.topicId ?? null,
      title: payload.selectedTopic.title ?? payload.selectedTopic.summaryPayload?.headline ?? "今日の話題",
      category: payload.selectedTopic.category ?? "general",
      buzzScore: Number(payload.selectedTopic.buzzScore ?? payload.selectedTopic.hotScore ?? 0),
      whyRanked: Array.isArray(payload.selectedTopic.whyRanked) ? payload.selectedTopic.whyRanked.slice(0, 3) : [],
    } : null,
  };
}

const trendPayload = await readJson("data/trend-topics.json", { items: [] });
const archivePayload = await readJson("data/trend-topics-archive.json", { items: [] });
const dailyBriefPayload = await readJson("data/daily-brief.json", { items: [] });
const historyPayload = await readJson("data/today-internet-history.json", { items: [] });

const payload = await buildTodayInternetPayload({
  trendItems: Array.isArray(trendPayload?.items) ? trendPayload.items : [],
  archiveItems: Array.isArray(archivePayload?.items) ? archivePayload.items : [],
  dailyBriefItems: Array.isArray(dailyBriefPayload?.items) ? dailyBriefPayload.items : [],
  now: new Date(),
});

const nextHistoryItems = [
  compactHistoryEntry(payload),
  ...(Array.isArray(historyPayload?.items) ? historyPayload.items : []),
].slice(0, 28);

await writeJson("data/today-internet.json", payload);
await writeJson("data/today-internet-debug.json", payload?.debug ?? {
  generatedAt: payload.generatedAt,
  fallbackUsed: payload.fallbackUsed,
  candidates: [],
});
await writeJson("data/today-internet-history.json", {
  generatedAt: payload.generatedAt,
  items: nextHistoryItems,
});

console.log(`[today-internet] generated topic="${payload?.selectedTopic?.title ?? "none"}" fallback=${payload.fallbackUsed} confidence=${payload?.dataQuality?.confidence ?? 0}`);
