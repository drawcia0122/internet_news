const META_IMAGE_PATTERNS = [
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+property=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+name=["']thumbnail["'][^>]+content=["']([^"']+)["']/i,
  /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
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
      embeddedImage: htmlCandidates.embeddedImage,
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
    item?.ogImage,
    item?.twitterImage,
    item?.mediaContent,
    item?.enclosure,
    item?.rssImage,
    item?.apiImage,
    item?.mediaThumbnail,
    item?.thumbnailUrl,
    item?.thumbnail,
    item?.imageUrl,
    item?.image,
    item?.sourceImage,
    item?.embeddedImage,
    item?.jsonLdImage,
  ];

  for (const candidate of candidates) {
    const normalized = sanitizeThumbnailUrl(candidate, sourceUrl);
    if (normalized && hasSuspiciousThumbnailMismatch(normalized, { sourceUrl })) continue;
    if (normalized) return normalized;
  }
  return null;
}

export function extractThumbnailCandidatesFromHtml(html, sourceUrl = "") {
  const ogImage = sanitizeThumbnailUrl(
    firstMatch(html, META_IMAGE_PATTERNS[0])
      || firstMatch(html, META_IMAGE_PATTERNS[1])
      || firstMatch(html, META_IMAGE_PATTERNS[2])
      || firstMatch(html, META_IMAGE_PATTERNS[5])
      || firstMatch(html, META_IMAGE_PATTERNS[6]),
    sourceUrl,
  );
  const twitterImage = sanitizeThumbnailUrl(
    firstMatch(html, META_IMAGE_PATTERNS[3])
      || firstMatch(html, META_IMAGE_PATTERNS[4])
      || firstMatch(html, META_IMAGE_PATTERNS[7]),
    sourceUrl,
  );
  const jsonLdImage = extractJsonLdImage(html, sourceUrl);
  const sourceImage = extractPrimaryImage(html, sourceUrl);
  const embeddedImage = extractEmbeddedImage(html, sourceUrl);
  return {
    ogImage,
    twitterImage,
    jsonLdImage,
    sourceImage,
    embeddedImage,
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
  const extensionMatch = pathname.match(/\.([a-z0-9]{1,8})(?:$|[?#])/i);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "";

  if (/^\/?$/.test(pathname) && !parsed.search) return null;
  if (extension && !/^(?:avif|bmp|gif|heic|heif|jpeg|jpg|png|svg|webp)$/i.test(extension)) return null;
  if (isKnownGooglePlaceholderImage(href)) return null;
  if (isWeakThumbnailUrl(href)) return null;
  if (pathname.endsWith(".svg")) return null;
  if (isLikelyPlaceholder(pathnameAndSearch)) return null;
  if (isLikelyIconOrLogo(href)) return null;
  if (looksTooSmallToUse(href)) return null;

  return href;
}

export function hasSuspiciousThumbnailMismatch(thumbnailUrl, ...contexts) {
  const normalizedThumbnailUrl = sanitizeThumbnailUrl(thumbnailUrl);
  const thumbnailHost = hostnameFor(normalizedThumbnailUrl);
  if (!thumbnailHost) return false;
  if (!isAggregatorThumbnailHost(thumbnailHost, normalizedThumbnailUrl)) return false;

  const articleHosts = contexts
    .flatMap((context) => [
      context?.url,
      context?.canonicalUrl,
      context?.sourceUrl,
      context?.primaryLink?.url,
      context?.link,
      context?.articleUrl,
    ])
    .map((value) => hostnameFor(value))
    .filter(Boolean)
    .filter((host) => !/news\.yahoo\.co\.jp$|news\.google\.com$|(?:^|\.)yimg\.jp$/i.test(host));

  return articleHosts.length > 0;
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
  if (typeof value !== "string") return value;
  return value
    .replace(/\\u003d/gi, "=")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\x3d/gi, "=")
    .replace(/\\x26/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");
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
    if (typeof value.image.contentUrl === "string") candidates.push(value.image.contentUrl);
    if (typeof value.image["@id"] === "string") candidates.push(value.image["@id"]);
    if (Array.isArray(value.image)) candidates.push(...value.image.map((entry) => entry?.url ?? entry));
  }
  if (typeof value.thumbnailUrl === "string") candidates.push(value.thumbnailUrl);
  if (typeof value.thumbnail === "string") candidates.push(value.thumbnail);
  if (Array.isArray(value.thumbnailUrl)) candidates.push(...value.thumbnailUrl);
  if (value["@graph"]) candidates.push(...extractJsonLdImageCandidates(value["@graph"]));
  return candidates;
}

function extractPrimaryImage(html, sourceUrl = "") {
  const patterns = [
    /<img\b[^>]*(?:data-src|data-original|data-lazy-src|data-lazy|data-image|data-thumb|data-echo|data-url|src)=["']([^"']+)["'][^>]*>/gi,
    /<source\b[^>]*srcset=["']([^"']+)["'][^>]*>/gi,
    /<(?:div|figure|a)\b[^>]*(?:data-bg|data-background-image|data-background|style)=["'][^"']*url\(([^)"']+)[^"']*\)["'][^>]*>/gi,
    /<img\b[^>]*srcset=["']([^"']+)["'][^>]*>/gi,
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

function extractEmbeddedImage(html, sourceUrl = "") {
  const candidates = [];
  const embeddedUrls = [
    ...html.matchAll(/https?:\/\/[^"'\\\s<>()]+/g),
  ].map((match) => match[0]);
  const decodedUrls = extractEncodedUrlsFromHtml(html);
  for (const raw of [...embeddedUrls, ...decodedUrls]) {
    const normalized = sanitizeThumbnailUrl(raw, sourceUrl);
    if (!normalized) continue;
    const score = scoreEmbeddedImageCandidate(normalized);
    if (score <= 0) continue;
    candidates.push({ url: normalized, score });
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.url ?? null;
}

export function extractEncodedUrlsFromHtml(html) {
  const matches = String(html ?? "").match(/[A-Za-z0-9+/_-]{40,}={0,2}/g) ?? [];
  const urls = [];
  const seen = new Set();
  for (const token of matches.slice(0, 800)) {
    const decoded = decodeMaybeBase64(token);
    if (!decoded || !decoded.includes("http")) continue;
    for (const match of decoded.matchAll(/https?:\/\/[^"'\\\s<>()]+/g)) {
      const url = normalizeRawImageValue(match[0]);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function decodeMaybeBase64(value) {
  const normalized = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  try {
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function hostnameFor(value) {
  try {
    return new URL(String(value ?? "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAggregatorThumbnailHost(host, url) {
  return /(?:^|\.)yimg\.jp$|newsatcl-pctr\.c\.yimg\.jp$/i.test(host)
    || (host === "news.google.com" && /\/api\/attachments\//i.test(url));
}

function scoreEmbeddedImageCandidate(url) {
  let score = 0;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const value = `${host}${parsed.pathname}${parsed.search}`.toLowerCase();
    if (/\.(?:jpg|jpeg|png|webp|gif)(?:$|[?#])/i.test(url)) score += 60;
    if (/googleusercontent\.com$/.test(host)) score += 40;
    if (/yimg\.jp$/.test(host) || /newsatcl-pctr/.test(host)) score += 50;
    if (/image|img|photo|thumbnail|thumb|media|article/.test(value)) score += 20;
    if (/=s0-w\d{3,4}|=w\d{3,4}|[?&]w=\d{3,4}|-w\d{3,4}/i.test(url)) score += 20;
    if (/google_news_\d+\.png|newsstand\.google\.com\/media\/app\/icon/i.test(value)) score -= 200;
    if (looksTooSmallToUse(url)) score -= 120;
  } catch {
    return -1;
  }
  return score;
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
  return /(?:^|\/)(?:1x1|blank|placeholder|noimage|no-image|default|dummy|spacer|ogp_default)(?:[._-]|$)|pixel|ico_jiaa\.png|news-pctr\.c\.yimg\.jp\/uUzvQ3lM/i.test(value);
}

function isLikelyIconOrLogo(url) {
  return isKnownGooglePlaceholderImage(url)
    || /(?:^|\/)(?:favicon(?:-\d+x\d+)?|apple-touch-icon|android-chrome-\d+x\d+|mstile-\d+x\d+)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)
    || /faviconv2/i.test(url)
    || /\/favicon\.ico(?:$|[?#])/i.test(url)
    || /(?:^|[/?#&=_-])(logo|icon|sns-share|share-icon|social-icon|site-logo|header-logo|brand-logo)(?:[/?#&=._-]|$)/i.test(url)
    || /(?:google|gstatic)\.[^/]+\/.*(?:favicon|logo|icon)/i.test(url);
}

function isKnownGooglePlaceholderImage(url) {
  return /^https?:\/\/lh3\.googleusercontent\.com\/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc(?:=|$)/i.test(url);
}

export function isWeakThumbnailUrl(url) {
  const value = String(url ?? "").trim();
  if (!value) return true;
  return /^https?:\/\/(?:[^/]+\.)?yimg\.jp\/?$/i.test(value)
    || /^https?:\/\/img\.youtube\.com\/?$/i.test(value)
    || /s\.yimg\.jp\/images\/top\/ogp\/fb_y_1500px\.png|s\.yimg\.jp\/images\/news-web\/versions\/[^/]+\/all\/images\/ogp_default\.png|s\.yimg\.jp\/images\/advertising\/common\/img\/ico_jiaa\.png|news-pctr\.c\.yimg\.jp\/uUzvQ3lM|news-pctr\.c\.yimg\.jp\/t\/news-topics\/images\/tpc\/|news-topics\/images\/tpc|news-topics\/pickups|\/t\/news-topics\//i.test(value);
}

function looksTooSmallToUse(url) {
  const hints = [
    ...url.matchAll(/[?&=_-]w(\d{1,4})(?:[&#/]|$)/gi),
    ...url.matchAll(/[?&=_-]h(\d{1,4})(?:[&#/]|$)/gi),
    ...url.matchAll(/=s(\d{1,4})(?:-|$)/gi),
  ].map((match) => Number(match[1])).filter(Number.isFinite);
  return hints.some((value) => value > 0 && value < 120);
}
