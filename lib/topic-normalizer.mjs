const JAPANESE_STOPWORDS = new Set([
  "こと", "ため", "よう", "これ", "それ", "もの", "さん", "する", "した", "して", "いる", "ある", "なる",
  "発表", "公開", "決定", "開始", "更新", "判明", "速報", "続報", "最新", "ニュース", "話題", "映像", "記事",
  "今日", "きょう", "今", "今後", "直近", "ネット", "インターネット", "で", "に", "を", "が", "は", "へ", "と",
]);

const ENGLISH_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "by", "from", "is", "are", "was", "were",
  "be", "been", "will", "this", "that", "these", "those", "news", "update", "breaking", "live", "today",
]);

const NOISE_PATTERNS = [
  /【[^】]+】/g,
  /\([^)]*(?:速報|続報|更新|ライブ|随時更新|動画|画像)[^)]*\)/gi,
  /[【】［］\[\]「」『』（）()]/g,
  /[:：|｜]/g,
  /\b(?:速報|続報|更新|判明|発表|公開|決定|配信開始|発売決定)\b/gi,
];

const ENTITY_PATTERNS = [
  /[A-Z][A-Za-z0-9.+-]{2,}/g,
  /[\u30a1-\u30ff]{3,}/g,
  /[\u4e00-\u9fff]{2,}(?:社|省|庁|党|県|市|大会|選手権|代表|内閣|政府|議会|カップ|戦|版|法案)?/g,
  /#?[A-Za-z0-9_\u3040-\u30ff\u4e00-\u9fff]{3,}/g,
];

const TOKEN_ALIAS_MAP = new Map([
  ["playstation", "ps"],
  ["playstationstore", "psstore"],
  ["psstore", "psstore"],
  ["playstationstoreに関するお知らせ", "psstore"],
  ["sony", "ソニー"],
  ["sie", "ソニー"],
  ["steam", "steam"],
  ["epicgames", "epic"],
  ["epic", "epic"],
]);

function safeLower(value) {
  return String(value ?? "").toLowerCase();
}

function canonicalizeToken(token = "") {
  const compact = String(token ?? "")
    .normalize("NFKC")
    .replace(/[®™]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!compact) return "";
  const lower = safeLower(compact);
  return TOKEN_ALIAS_MAP.get(lower) ?? compact;
}

export function normalizeTopicTitle(title = "") {
  let normalized = String(title ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

  for (const pattern of NOISE_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }

  normalized = normalized
    .replace(/[!！?？。,、…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

export function tokenizeTopicText(text = "") {
  const normalized = normalizeTopicTitle(text);
  const rawTokens = normalized
    .split(/[^A-Za-z0-9\u3040-\u30ff\u4e00-\u9fff]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  return rawTokens.filter((token) => {
    const canonical = canonicalizeToken(token);
    const lower = safeLower(canonical);
    if (canonical.length <= 1) return false;
    if (JAPANESE_STOPWORDS.has(canonical)) return false;
    if (ENGLISH_STOPWORDS.has(lower)) return false;
    if (/^\d+$/.test(canonical)) return false;
    return true;
  }).map(canonicalizeToken);
}

export function extractEntitiesFromText(text = "") {
  const entities = new Set();
  const normalized = normalizeTopicTitle(text);
  for (const pattern of ENTITY_PATTERNS) {
    for (const match of normalized.match(pattern) ?? []) {
      const value = canonicalizeToken(match.replace(/^#/, "").trim());
      if (!value || value.length <= 1) continue;
      if (JAPANESE_STOPWORDS.has(value) || ENGLISH_STOPWORDS.has(safeLower(value))) continue;
      entities.add(value);
    }
  }
  return [...entities].slice(0, 12);
}

export function extractNumberTokens(text = "") {
  const normalized = normalizeTopicTitle(text);
  return [...new Set(
    (normalized.match(/\b\d+(?:\.\d+)?\b/g) ?? [])
      .map((value) => value.trim())
      .filter(Boolean),
  )].slice(0, 8);
}

export function buildTopicDocument(topic) {
  const sourceSignals = Array.isArray(topic?.sourceSignals) ? topic.sourceSignals : [];
  const publishedAt = sourceSignals[0]?.publishedAt ?? topic?.publishedAt ?? topic?.capturedAt ?? null;
  const title = String(topic?.title ?? "").trim();
  const summary = String(topic?.summary ?? topic?.briefSummary ?? topic?.whatHappened ?? "").trim();
  const titleTokens = tokenizeTopicText(title);
  const summaryTokens = tokenizeTopicText(summary).slice(0, 8);
  const tokens = [...new Set([...titleTokens, ...summaryTokens])];
  const entities = extractEntitiesFromText(`${title} ${summary}`);
  const numberTokens = extractNumberTokens(`${title} ${summary}`);
  const fingerprint = [...new Set(tokens)].slice(0, 8).join("|");

  return {
    id: topic?.id ?? title,
    topic,
    title,
    summary,
    category: topic?.category ?? topic?.categories?.[0] ?? "general",
    categories: Array.isArray(topic?.categories) ? topic.categories : [topic?.category ?? "general"],
    publishedAt,
    timestamp: Number.isNaN(new Date(publishedAt ?? "").getTime()) ? 0 : new Date(publishedAt).getTime(),
    titleTokens,
    tokens,
    tokenSet: new Set(tokens),
    entities,
    entitySet: new Set(entities.map((value) => safeLower(value))),
    numberTokens,
    numberSet: new Set(numberTokens),
    fingerprint,
    sourceSignals,
  };
}

export function tokenJaccard(leftSet, rightSet) {
  if (!leftSet.size || !rightSet.size) return 0;
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function entityOverlap(leftSet, rightSet) {
  if (!leftSet.size || !rightSet.size) return 0;
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  return intersection / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

export function buildBlockingKeys(doc) {
  const keys = new Set();
  const topTokens = [...new Set(doc.titleTokens)].slice(0, 4);
  if (topTokens.length >= 2) keys.add(`${doc.category}|${topTokens.slice(0, 2).join("_")}`);
  if (doc.entities.length) keys.add(`${doc.category}|entity|${safeLower(doc.entities[0])}`);
  if (doc.entities.length) keys.add(`entity|${safeLower(doc.entities[0])}`);
  if (doc.entities.length >= 2) keys.add(`entity-pair|${safeLower(doc.entities[0])}|${safeLower(doc.entities[1])}`);
  const topNumbers = [...doc.numberSet].slice(0, 2);
  if (doc.entities.length && topNumbers.length) {
    keys.add(`entity-number|${safeLower(doc.entities[0])}|${topNumbers.join("_")}`);
  }
  const hourBucket = doc.timestamp ? Math.floor(doc.timestamp / (1000 * 60 * 60)) : 0;
  if (topTokens.length) keys.add(`${doc.category}|hour|${hourBucket}|${topTokens[0]}`);
  if (!keys.size) keys.add(`${doc.category}|${doc.fingerprint}`);
  return [...keys];
}
