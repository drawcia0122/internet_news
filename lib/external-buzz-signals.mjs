import { readFile, writeFile } from "node:fs/promises";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function availabilityCount(externalSignals) {
  if (!externalSignals) return 0;
  return [
    externalSignals?.search?.available,
    externalSignals?.reddit?.available,
    externalSignals?.bluesky?.available,
  ].filter(Boolean).length;
}

function scoreCount(externalSignals) {
  if (!externalSignals) return 0;
  return Number(externalSignals?.search?.score ?? 0)
    + Number(externalSignals?.reddit?.score ?? 0)
    + Number(externalSignals?.bluesky?.score ?? 0);
}

function pickBetterExternalSignals(currentExternalSignals, nextExternalSignals) {
  if (!currentExternalSignals) return nextExternalSignals;
  if (!nextExternalSignals) return currentExternalSignals;

  const currentAvailability = availabilityCount(currentExternalSignals);
  const nextAvailability = availabilityCount(nextExternalSignals);
  if (currentAvailability !== nextAvailability) {
    return nextAvailability > currentAvailability ? nextExternalSignals : currentExternalSignals;
  }

  const currentScore = scoreCount(currentExternalSignals);
  const nextScore = scoreCount(nextExternalSignals);
  if (currentScore !== nextScore) {
    return nextScore > currentScore ? nextExternalSignals : currentExternalSignals;
  }

  const currentErrors = Array.isArray(currentExternalSignals?.errors) ? currentExternalSignals.errors.length : 0;
  const nextErrors = Array.isArray(nextExternalSignals?.errors) ? nextExternalSignals.errors.length : 0;
  return nextErrors <= currentErrors ? nextExternalSignals : currentExternalSignals;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  try {
    await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
  } catch (error) {
    console.warn(`[topic-external-signals] failed to write ${path}: ${error?.message ?? error}`);
  }
}

function normalizeQuery(cluster) {
  const title = String(cluster?.representativeTopic?.title ?? cluster?.canonicalEventLabel ?? "")
    .replace(/[【】「」『』]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title.slice(0, 120);
}

function createTimeoutSignal(ms = 6000) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 INTERNET-NEWS/1.0",
      accept: "text/html,application/json",
    },
    redirect: "follow",
    signal: createTimeoutSignal(),
  });
  if (!response.ok) throw new Error(`http ${response.status} ${response.statusText}`.trim());
  return await response.text();
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 INTERNET-NEWS/1.0",
      accept: "application/json,text/plain",
    },
    redirect: "follow",
    signal: createTimeoutSignal(),
  });
  if (!response.ok) throw new Error(`http ${response.status} ${response.statusText}`.trim());
  return await response.json();
}

function scoreGoogleNewsHtml(html = "") {
  const articleMatches = new Set(html.match(/\.\/read\/[^"'\\\s<>()]+/g) ?? []);
  const count = articleMatches.size;
  return {
    count,
    score: clamp((count / 60) * 100, 0, 100),
    available: count > 0,
  };
}

function scoreRedditJson(payload) {
  const posts = Array.isArray(payload?.data?.children) ? payload.data.children : [];
  const count = posts.length;
  return {
    count,
    score: clamp((count / 20) * 100, 0, 100),
    available: true,
  };
}

function scoreBlueskyJson(payload) {
  const posts = Array.isArray(payload?.posts) ? payload.posts : [];
  const count = posts.length;
  return {
    count,
    score: clamp((count / 20) * 100, 0, 100),
    available: true,
  };
}

async function fetchClusterExternalSignals(cluster, { fetchImpl = fetch } = {}) {
  const query = normalizeQuery(cluster);
  if (!query) {
    return {
      query,
      search: { available: false, score: 0, count: 0 },
      reddit: { available: false, score: 0, count: 0 },
      bluesky: { available: false, score: 0, count: 0 },
      errors: ["empty query"],
    };
  }

  const googleNewsUrl = cluster?.representativeTopic?.searchLinks?.[0]?.url
    ?? `https://news.google.com/search?q=${encodeURIComponent(`${query} when:2d`)}&hl=ja&gl=JP&ceid=JP:ja`;
  const redditUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
  const blueskyUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=20&sort=latest`;

  const [searchResult, redditResult, blueskyResult] = await Promise.allSettled([
    fetchText(fetchImpl, googleNewsUrl).then(scoreGoogleNewsHtml),
    fetchText(fetchImpl, redditUrl).then((html) => {
      if (/whoa there, pardner!/i.test(html) || /request has been blocked due to a network policy/i.test(html)) {
        throw new Error("blocked by reddit anti-bot");
      }
      return scoreRedditJson({ data: { children: [...(html.match(/search-result-link/g) ?? [])].map(() => ({})) } });
    }),
    fetchJson(fetchImpl, blueskyUrl).then(scoreBlueskyJson),
  ]);

  return {
    query,
    search: searchResult.status === "fulfilled" ? searchResult.value : { available: false, score: 0, count: 0 },
    reddit: redditResult.status === "fulfilled" ? redditResult.value : { available: false, score: 0, count: 0 },
    bluesky: blueskyResult.status === "fulfilled" ? blueskyResult.value : { available: false, score: 0, count: 0 },
    errors: [
      searchResult.status === "rejected" ? `search:${searchResult.reason?.message ?? String(searchResult.reason)}` : null,
      redditResult.status === "rejected" ? `reddit:${redditResult.reason?.message ?? String(redditResult.reason)}` : null,
      blueskyResult.status === "rejected" ? `bluesky:${blueskyResult.reason?.message ?? String(blueskyResult.reason)}` : null,
    ].filter(Boolean),
  };
}

function cacheKeyForCluster(cluster) {
  const title = normalizeQuery(cluster);
  const latest = cluster?.latestPublishedAt ?? "";
  return `${title}::${latest}`.slice(0, 240);
}

export async function attachExternalBuzzSignals(
  clusters,
  {
    fetchImpl = fetch,
    cachePath = "data/topic-external-signal-cache.json",
    now = new Date(),
    ttlMinutes = 20,
    limit = 4,
    concurrency = 4,
  } = {},
) {
  const cache = await readJson(cachePath, { items: {} });
  const cacheItems = cache?.items ?? {};
  const nowTime = new Date(now).getTime();
  const ttlMs = ttlMinutes * 60 * 1000;

  const targets = clusters.slice(0, limit);
  const updates = [];
  for (let index = 0; index < targets.length; index += concurrency) {
    const batch = targets.slice(index, index + concurrency);
    const batchUpdates = await Promise.all(batch.map(async (cluster) => {
      const key = cacheKeyForCluster(cluster);
      const cached = cacheItems[key];
      if (cached?.fetchedAt) {
        const cachedTime = new Date(cached.fetchedAt).getTime();
        const hasErrorShape = Array.isArray(cached?.externalSignals?.errors);
        if (!Number.isNaN(cachedTime) && nowTime - cachedTime <= ttlMs && hasErrorShape) {
          return { key, externalSignals: cached.externalSignals };
        }
      }

      const fetchedExternalSignals = await fetchClusterExternalSignals(cluster, { fetchImpl });
      const externalSignals = pickBetterExternalSignals(cluster.externalSignals, fetchedExternalSignals);
      return { key, externalSignals };
    }));
    updates.push(...batchUpdates);
  }

  for (const update of updates) {
    cacheItems[update.key] = {
      fetchedAt: new Date(now).toISOString(),
      externalSignals: update.externalSignals,
    };
  }

  await writeJson(cachePath, {
    generatedAt: new Date(now).toISOString(),
    items: cacheItems,
  });

  return clusters.map((cluster, index) => {
    if (index >= limit) return { ...cluster, externalSignals: null };
    const key = cacheKeyForCluster(cluster);
    const cachedExternalSignals = cacheItems[key]?.externalSignals ?? null;
    return {
      ...cluster,
      externalSignals: pickBetterExternalSignals(cluster.externalSignals, cachedExternalSignals),
    };
  });
}
