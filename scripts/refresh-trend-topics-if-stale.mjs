import { readFile } from "node:fs/promises";

const REFRESH_INTERVAL_MINUTES = 10;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MINUTES * 60 * 1000;

const currentPayload = await readCurrentPayload();
const lastGeneratedAt = currentPayload?.generatedAt ? new Date(currentPayload.generatedAt).getTime() : 0;
const now = Date.now();

if (lastGeneratedAt && now - lastGeneratedAt < REFRESH_INTERVAL_MS) {
  console.log(
    `Skip refresh: last generated ${Math.floor((now - lastGeneratedAt) / 1000)}s ago (< ${REFRESH_INTERVAL_MINUTES}m).`,
  );
  process.exit(0);
}

await import("./fetch-trend-topics.mjs");

async function readCurrentPayload() {
  try {
    return JSON.parse(await readFile("data/trend-topics.json", "utf8"));
  } catch {
    return null;
  }
}
