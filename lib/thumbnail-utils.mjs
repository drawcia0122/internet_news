const META_IMAGE_PATTERNS = [
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+property=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
];

export async function resolveThumbnail({ item = {}, pageHtml = "", sourceUrl = "", fetchPageHtml = null } = {}) {
  const directThumbnail = pickThumbnailFromItem(item, { sourceUrl });
  if (directThumbnail) {
    return {
      ...item,
      thumbnail: directThumbnail,
      thumbnailUrl: directThumbnail,
    };
  }

  let html = String(pageHtml ?? "");
  if (!html && typeof fetchPageHtml === "function" && sourceUrl) {
    html = await fetchPageHtml(sourceUrl);
  }
  if (!html) {
    return {
      ...item,
      thumbnail: null,
      thumbnailUrl: null,
    };
  }

  const htmlCandidates = extractThumbnailCandidatesFromHtml(html, sourceUrl);
  const resolvedThumbnail = pickThumbnailFromItem(
    {
      ...item,
      ogImage: htmlCandidates.ogImage,
      twitterImage: htmlCandidates.twitterImage,
      jsonLdImage: htmlCandidates.jsonLdImage,
      sourceImage: htmlCandidates.sourceImage,
      image: item?.image ?? htmlCandidates.jsonLdImage,
    },
    { sourceUrl },
  );

  return {
    ...item,
    ...htmlCandidates,
    thumbnail: resolvedThumbnail,
    thumbnailUrl: resolvedThumbnail,
  };
}

export function pickThumbnailFromItem(item = {}, { sourceUrl = "" } = {}) {
  const candidates = [
    item?.rssImage,
    item?.apiImage,
    item?.mediaThumbnail,
    item?.mediaContent,
    item?.enclosure,
    item?.thumbnailUrl,
    item?.thumbnail,
    item?.imageUrl,
    item?.image,
    item?.ogImage,
    item?.twitterImage,
    item?.jsonLdImage,
    item?.sourceImage,
  ];

  for (const candidate of candidates) {
    const normalized = sanitizeThumbnailUrl(candidate, sourceUrl);
    if (normalized) return normalized;
  }
  return null;
}

export function extractThumbnailCandidatesFromHtml(html, sourceUrl = "") {
  const ogImage = sanitizeThumbnailUrl(firstMatch(html, META_IMAGE_PATTERNS[0]) || firstMatch(html, META_IMAGE_PATTERNS[1]), sourceUrl);
  const twitterImage = sanitizeThumbnailUrl(firstMatch(html, META_IMAGE_PATTERNS[2]) || firstMatch(html, META_IMAGE_PATTERNS[3]), sourceUrl);
  const jsonLdImage = extractJsonLdImage(html, sourceUrl);
  const sourceImage = extractPrimaryImage(html, sourceUrl);
  return {
    ogImage,
    twitterImage,
    jsonLdImage,
    sourceImage,
  };
}

export function sanitizeThumbnailUrl(value, baseUrl = "") {
  const normalizedUrl = absolutizeUrl(value, baseUrl);
  if (!normalizedUrl) return null;
  if (normalizedUrl.startsWith("data:image")) return null;

  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(parsed.protocol)) return null;

  const href = parsed.toString();
  const pathname = parsed.pathname.toLowerCase();
  const pathnameAndSearch = `${pathname}${parsed.search.toLowerCase()}`;

  if (pathname.endsWith(".svg")) return null;
  if (isLikelyPlaceholder(pathnameAndSearch)) return null;
  if (isLikelyIconOrLogo(href)) return null;

  return href;
}

export function absolutizeUrl(value, baseUrl = "") {
  const rawValue = normalizeRawImageValue(value);
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image")) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  try {
    return new URL(raw, baseUrl || undefined).toString().trim();
  } catch {
    return "";
  }
}

function normalizeRawImageValue(value) {
  if (Array.isArray(value)) return normalizeRawImageValue(value[0]);
  if (value && typeof value === "object") {
    return value.url ?? value.src ?? value.contentUrl ?? value["@id"] ?? "";
  }
  return value;
}

export function firstSrcsetCandidate(value) {
  return String(value ?? "").split(",")[0]?.trim().split(/\s+/)[0] ?? "";
}

export function logThumbnailCoverage(items = []) {
  const total = items.length;
  const foundItems = items.filter((item) => pickThumbnailFromItem(item));
  const missingItems = items.filter((item) => !pickThumbnailFromItem(item));
  const found = foundItems.length;
  const missing = missingItems.length;
  const foundRate = total ? ((found / total) * 100).toFixed(1) : "0.0";

  console.log(`[thumbnail] total: ${total}`);
  console.log(`[thumbnail] found: ${found}`);
  console.log(`[thumbnail] missing: ${missing}`);
  console.log(`[thumbnail] foundRate: ${foundRate}%`);
  console.log("[thumbnail] missing samples:");
  missingItems.slice(0, 5).forEach((item) => {
    console.log(`- ${item?.title ?? "(no title)"} / ${item?.sourceName ?? item?.source ?? "(no source)"} / ${item?.sourceUrl ?? item?.url ?? "(no url)"}`);
  });
}

function extractJsonLdImage(html, sourceUrl = "") {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const parsed = safeJsonParse(match[1]);
    const candidates = extractJsonLdImageCandidates(parsed);
    for (const candidate of candidates) {
      const normalized = sanitizeThumbnailUrl(candidate, sourceUrl);
      if (normalized) return normalized;
    }
  }
  return null;
}

function extractJsonLdImageCandidates(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(extractJsonLdImageCandidates);
  if (typeof value !== "object") return [];

  const candidates = [];
  if (typeof value.image === "string") candidates.push(value.image);
  if (Array.isArray(value.image)) candidates.push(...value.image);
  if (value.image && typeof value.image === "object") {
    if (typeof value.image.url === "string") candidates.push(value.image.url);
    if (Array.isArray(value.image)) candidates.push(...value.image.map((entry) => entry?.url ?? entry));
  }
  if (value["@graph"]) candidates.push(...extractJsonLdImageCandidates(value["@graph"]));
  return candidates;
}

function extractPrimaryImage(html, sourceUrl = "") {
  const patterns = [
    /<img\b[^>]*(?:data-src|data-original|data-lazy-src|data-lazy|src)=["']([^"']+)["'][^>]*>/gi,
    /<source\b[^>]*srcset=["']([^"']+)["'][^>]*>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = pattern.source.includes("srcset") ? firstSrcsetCandidate(match[1]) : match[1];
      const normalized = sanitizeThumbnailUrl(raw, sourceUrl);
      if (normalized) return normalized;
    }
  }
  return null;
}

function firstMatch(value, pattern) {
  return String(value ?? "").match(pattern)?.[1] ?? "";
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isLikelyPlaceholder(value) {
  return /(?:^|\/)(?:1x1|blank|placeholder|noimage|no-image|default|dummy|spacer)(?:[._-]|$)|pixel/i.test(value);
}

function isLikelyIconOrLogo(url) {
  return /(?:^|\/)(?:favicon(?:-\d+x\d+)?|apple-touch-icon|android-chrome-\d+x\d+|mstile-\d+x\d+)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)
    || /\/favicon\.ico(?:$|[?#])/i.test(url)
    || /(?:^|[/?#&=_-])(logo|icon|sns-share|share-icon|social-icon)(?:[/?#&=._-]|$)/i.test(url)
    || /(?:google|gstatic)\.[^/]+\/.*(?:favicon|logo|icon)/i.test(url);
}
