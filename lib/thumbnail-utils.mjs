// Attribute order is not significant in HTML. Keep extraction bounded to actual tags.
export function readImageTagAttributes(tag) {
  const attributes = {};
  for (const match of String(tag ?? "").matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

export async function resolveThumbnail({ item = {}, pageHtml = "", sourceUrl = "", fetchPageHtml = null } = {}) {
  const directThumbnail = pickThumbnailFromItem(item, { sourceUrl });
  if (directThumbnail && !shouldUpgradeThumbnailFromPage(directThumbnail, sourceUrl)) {
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
      thumbnail: directThumbnail,
      thumbnailUrl: directThumbnail,
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
    thumbnail: resolvedThumbnail || directThumbnail,
    thumbnailUrl: resolvedThumbnail || directThumbnail,
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
    item?.jsonLdImage,
    item?.sourceImage,
    item?.embeddedImage,
  ];

  return selectUsableImage(candidates, sourceUrl);
}

function selectUsableImage(candidates, sourceUrl = "") {
  let smallFallback = null;
  for (const candidate of candidates.flat(Infinity)) {
    const normalized = sanitizeThumbnailUrl(candidate, sourceUrl);
    if (!normalized || hasSuspiciousThumbnailMismatch(normalized, { sourceUrl })) continue;
    if (!isLowResolutionThumbnailUrl(normalized)) return normalized;
    smallFallback ??= normalized;
  }
  return smallFallback;
}

export function extractThumbnailCandidatesFromHtml(html, sourceUrl = "") {
  const metadata = new Map();
  for (const match of String(html ?? "").matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
    const attrs = readImageTagAttributes(match[0]);
    const key = String(attrs.property || attrs.name || attrs.itemprop || attrs.rel || "").toLowerCase();
    if (!metadata.has(key)) metadata.set(key, []);
    metadata.get(key).push(attrs.content || attrs.href);
  }
  const valuesFor = (...keys) => keys.flatMap((key) => metadata.get(key) || []);
  return {
    ogImage: selectUsableImage(valuesFor("og:image:secure_url", "og:image", "og:image:url", "image", "thumbnail"), sourceUrl),
    twitterImage: selectUsableImage(valuesFor("twitter:image", "twitter:image:src", "image_src"), sourceUrl),
    jsonLdImage: extractJsonLdImage(String(html ?? ""), sourceUrl),
    sourceImage: extractPrimaryImage(String(html ?? ""), sourceUrl),
    // Unscoped script URLs and base64 strings can be advertisements or related stories.
    embeddedImage: null,
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
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const pathnameAndSearch = `${pathname}${parsed.search.toLowerCase()}`;
  const extensionMatch = pathname.match(/\.([a-z0-9]{1,8})(?:$|[?#])/i);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "";

  if (/^\/?$/.test(pathname) && !parsed.search) return null;
  if (extension && !/^(?:avif|bmp|gif|heic|heif|jpeg|jpg|png|svg|webp)$/i.test(extension)) return null;
  if (!extension && !looksLikeDirectImageAssetUrl(parsed)) return null;
  if (isAppStoreScreenshotUrl(host, href)) return null;
  if (isKnownGooglePlaceholderImage(href)) return null;
  if (isProxyThumbnailUrl(href)) return null;
  if (isWeakThumbnailUrl(href)) return null;
  if (looksLikeArticlePageThumbnailUrl(href)) return null;
  if (pathname.endsWith(".svg")) return null;
  if (isLikelyPlaceholder(pathnameAndSearch)) return null;
  if (isLikelyIconOrLogo(href)) return null;
  if (looksTooSmallToUse(href)) return null;

  return href;
}

export function isLowResolutionThumbnailUrl(value, minimum = 320) {
  const url = sanitizeThumbnailUrl(value);
  if (!url) return true;
  const hints = extractDimensionHints(url);
  return hints.some((hint) => hint > 0 && hint < minimum);
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

export function isAggregatorThumbnailUrl(value) {
  const normalizedThumbnailUrl = sanitizeThumbnailUrl(value);
  const thumbnailHost = hostnameFor(normalizedThumbnailUrl);
  if (!thumbnailHost) return false;
  return isAggregatorThumbnailHost(thumbnailHost, normalizedThumbnailUrl);
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
    return value.url ?? value.src ?? value.contentUrl ?? "";
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/\\u003d/gi, "=")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\x3d/gi, "=")
    .replace(/\\x26/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (match, hex, decimal) => {
      const code = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
}

export function firstSrcsetCandidate(value) {
  return srcsetCandidates(value)[0] || "";
}

function srcsetCandidates(value) {
  // Prefer the largest explicitly advertised variant; never rewrite publisher URLs.
  return String(value ?? "").split(",")
    .map((part, index) => {
      const [url, descriptor = ""] = part.trim().split(/\s+/);
      const match = descriptor.match(/^(\d+(?:\.\d+)?)(w|x)$/);
      return { url, size: match ? Number(match[1]) * (match[2] === "x" ? 1000 : 1) : 0, index };
    })
    .filter((entry) => entry.url && !/^data:/i.test(entry.url))
    .sort((left, right) => right.size - left.size || left.index - right.index).map((entry) => entry.url);
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
  const candidates = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (readImageTagAttributes(match[1]).type?.toLowerCase() !== "application/ld+json") continue;
    const parsed = safeJsonParse(match[2]);
    candidates.push(...extractJsonLdImageCandidates(parsed));
  }
  return selectUsableImage(candidates, sourceUrl);
}

function extractJsonLdImageCandidates(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(extractJsonLdImageCandidates);
  if (typeof value !== "object") return [];

  const types = [value["@type"]].flat().filter(Boolean);
  if (types.some((type) => /^(?:Organization|Person|WebSite|BreadcrumbList|ItemList)$/i.test(type))) return [];
  const candidates = [];
  if (types.includes("ImageObject")) candidates.push(value.contentUrl, value.url);
  if (typeof value.image === "string") candidates.push(value.image);
  if (Array.isArray(value.image)) candidates.push(...value.image);
  if (value.image && typeof value.image === "object") {
    if (typeof value.image.url === "string") candidates.push(value.image.url);
    if (typeof value.image.contentUrl === "string") candidates.push(value.image.contentUrl);
    if (Array.isArray(value.image)) candidates.push(...value.image.map((entry) => entry?.url ?? entry));
  }
  if (typeof value.thumbnailUrl === "string") candidates.push(value.thumbnailUrl);
  if (typeof value.thumbnail === "string") candidates.push(value.thumbnail);
  if (Array.isArray(value.thumbnailUrl)) candidates.push(...value.thumbnailUrl);
  if (value["@graph"]) candidates.push(...extractJsonLdImageCandidates(value["@graph"]));
  return candidates;
}

function extractPrimaryImage(html, sourceUrl = "") {
  const withoutChrome = html
    .replace(/<(?:script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/(?:script|style|nav|header|footer|aside)>/gi, "");
  const article = withoutChrome.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main = withoutChrome.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const scope = article || main;
  // Without an article container, accept only explicitly marked lead images.
  const candidates = [];
  for (const match of String(scope || withoutChrome).matchAll(/<(?:img|source|figure|div|a)\b[^>]*>/gi)) {
    const attrs = readImageTagAttributes(match[0]);
    const marker = `${attrs.class || ""} ${attrs.id || ""} ${attrs.itemprop || ""}`;
    if (!scope && !/(?:article|entry|main|hero|lead)[-_ ]?(?:image|photo|visual)|(?:^|\s)image(?:\s|$)/i.test(marker)) continue;
    if (/(?:advert|banner|related|recommend|avatar|profile|logo|icon)/i.test(marker)) continue;
    const dimensions = [attrs.width, attrs.height].map(Number).filter((value) => value > 0);
    if (dimensions.some((value) => value < 120)) continue;
    candidates.push(...srcsetCandidates(attrs["data-srcset"] || attrs.srcset));
    for (const key of ["data-src", "data-original", "data-lazy-src", "data-lazy", "data-image", "data-echo", "data-url", "data-thumb", "src"]) {
      candidates.push(attrs[key]);
    }
    for (const key of ["data-bg", "data-background", "data-background-image", "style"]) {
      const raw = attrs[key] || "";
      const background = raw.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i)?.[1];
      if (background) candidates.push(background.trim());
      else if (key !== "style") candidates.push(raw);
    }
  }
  return selectUsableImage(candidates, sourceUrl);
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

function isProxyThumbnailUrl(url) {
  return /(?:^https?:\/\/)(?:newsatcl-pctr\.c\.yimg\.jp|news-pctr\.c\.yimg\.jp)\//i.test(url)
    || /^https?:\/\/news\.google\.com\/api\/attachments\//i.test(url)
    || /^https?:\/\/lh3\.googleusercontent\.com\//i.test(url);
}

function isAppStoreScreenshotUrl(host, url) {
  return /(?:^|\.)mzstatic\.com$/i.test(host)
    || /(?:^|\.)apps\.apple\.com$/i.test(host)
    || /(?:^|\.)play-lh\.googleusercontent\.com$/i.test(host)
    || /(?:^|\.)play\.google\.com$/i.test(host)
    || /(?:app\s*store|google\s*play|screen(?:shot)?)/i.test(url) && /(purplesource|iphone\d+|ipad\d+|android|screen\d+)/i.test(url);
}

function looksLikeArticlePageThumbnailUrl(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    const pathname = parsed.pathname.toLowerCase();
    const full = `${parsed.hostname.toLowerCase()}${pathname}${parsed.search.toLowerCase()}`;
    if (/^news\.yahoo\.co\.jp$/i.test(parsed.hostname) && /^\/media\/[a-z0-9_-]+\/?$/i.test(pathname)) return true;
    if (/\.(?:avif|bmp|gif|heic|heif|jpeg|jpg|png|svg|webp)(?:$|[?#])/i.test(pathname)) return false;
    if (/(?:\/|^)(?:images?|img|media|photo|photos|thumbnail|thumb|banner|ogp|avatar|icon|logos?)(?:\/|$)/i.test(pathname)) return false;
    if (/[?&](?:format|fm|ext|image|img|photo)=.*(?:jpe?g|png|webp|gif|avif)/i.test(parsed.search)) return false;
    return /(?:\/|^)(?:article|articles|pickup|expert|entry|news|kiji|detail|read|story|stories)\//i.test(pathname)
      || /support\.x\.com\/articles\//i.test(full);
  } catch {
    return false;
  }
}

function looksLikeDirectImageAssetUrl(parsed) {
  const pathname = parsed.pathname.toLowerCase();
  const search = parsed.search.toLowerCase();
  return /(?:\/|^)(?:images?|img|media|photo|photos|thumbnail|thumb|banner|ogp|avatar|icons?)(?:\/|$)/i.test(pathname)
    || /[?&](?:format|fm|ext|image|img|photo|thumbnail|thumb|width|height)=/i.test(search)
    || /\/_next\/image$/i.test(pathname);
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isLikelyPlaceholder(value) {
  return /(?:^|\/)(?:1x1|blank|placeholder|noimage|no-image|default|dummy|spacer|ogp_default|thumb_large)(?:[._-]|$)|pixel|ico_jiaa\.png|news-pctr\.c\.yimg\.jp\/uUzvQ3lM|anond\.hatelabo\.jp\/assets\/images\/(?:og-image-1500(?:-square)?|common\/open)\.gif|noscript-image\.gif|btn_google_prefered_link\.png|entry-button\/button-only|corporate-banner\/kyodo\.png/i.test(value);
}

function isLikelyIconOrLogo(url) {
  return isKnownGooglePlaceholderImage(url)
    || /(?:^|\/)(?:favicon(?:[-_]\d+x\d+)?|apple-touch-icon|android-chrome-\d+x\d+|mstile-\d+x\d+)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)
    || /faviconv2/i.test(url)
    || /\/favicon\.ico(?:$|[?#])/i.test(url)
    || /(?:^|[/?#&=_-])(logo|icon|menu|nav|sns-share|share-icon|social-icon|site-logo|header-logo|brand-logo|profile_images|profile_banners|ext_tw_video_thumb|entry-button)(?:[/?#&=._-]|$)/i.test(url)
    || /(?:btng?menu|thumbnail-default|ogp(?:[-_]?default|logo)|siteLogo|squarelogo|townlogo|yamashin_ogplogo|[a-z0-9_-]*logo)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)
    || /(?:google|gstatic)\.[^/]+\/.*(?:favicon|logo|icon)/i.test(url);
}

function isKnownGooglePlaceholderImage(url) {
  return /^https?:\/\/lh3\.googleusercontent\.com\/(?:J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc|zpUAWPoFO8BgmXeHZna-q2AFE1ss9PWr2E16kntkjD5pyjVWfWEhzza9qBxRpMypBCYTnINVLw)(?:=|$)/i.test(url);
}

export function isWeakThumbnailUrl(url) {
  const value = String(url ?? "").trim();
  if (!value) return true;
  if (isProxyThumbnailUrl(value)) return true;
  if (isAppStoreScreenshotUrl(hostnameFor(value), value)) return true;
  return /^https?:\/\/(?:[^/]+\.)?yimg\.jp\/?$/i.test(value)
    // Yahoo's versioned JSON-LD fallback is site branding, not an article image.
    || /^https?:\/\/s\.yimg\.jp\/images\/news-web\/versions\/[^/]+\/all\/images\/jsonld_image_1244x700\.png(?:[?#]|$)/i.test(value)
    || /^https?:\/\/img\.youtube\.com\/?$/i.test(value)
    || /^https?:\/\/support\.x\.com\/articles\//i.test(value)
    || /s\.yimg\.jp\/images\/top\/ogp\/fb_y_1500px\.png|s\.yimg\.jp\/images\/news-web\/versions\/[^/]+\/all\/images\/ogp_default\.png|s\.yimg\.jp\/images\/advertising\/common\/img\/ico_jiaa\.png|news-pctr\.c\.yimg\.jp\/uUzvQ3lM|news-pctr\.c\.yimg\.jp\/t\/news-topics\/images\/tpc\/|news-topics\/images\/tpc|news-topics\/pickups|\/t\/news-topics\/|pbs\.twimg\.com\/(?:profile_(?:images|banners)|ext_tw_video_thumb)\/|anond\.hatelabo\.jp\/assets\/images\/(?:og-image-1500(?:-square)?|common\/open)\.(?:gif|png)|b\.st-hatena\.com\/images\/entry-button\/button-only@2x\.png|47news\.jp\/static\/(?:renewal\/common\/img\/thumb_large|btn_google_prefered_link)|img\.cf\.47news\.jp\/static\/(?:btn_google_prefered_link|corporate-banner\/kyodo)\.png|tagger\.opecloud\.com\/mediaconsortium\/v2\/noscript-image\.gif|gstatic\.com\/_\/mss\/boq-dots\/.*dotssplashui/i.test(value);
}

function looksTooSmallToUse(url) {
  const hints = extractDimensionHints(url);
  return hints.some((value) => value > 0 && value < 120);
}

function extractDimensionHints(url) {
  return [
    ...String(url ?? "").matchAll(/[?&=_-]w=?(\d{1,4})(?:[&#/._-]|$)/gi),
    ...String(url ?? "").matchAll(/[?&=_-]h=?(\d{1,4})(?:[&#/._-]|$)/gi),
    ...String(url ?? "").matchAll(/=s(\d{1,4})(?:-|$)/gi),
    ...String(url ?? "").matchAll(/[?&;](?:width|height)=(\d{1,4})(?:[&#;/]|$)/gi),
  ].map((match) => Number(match[1])).filter(Number.isFinite);
}

function shouldUpgradeThumbnailFromPage(thumbnailUrl, sourceUrl = "") {
  const normalized = sanitizeThumbnailUrl(thumbnailUrl, sourceUrl);
  if (!normalized) return false;
  return isWeakThumbnailUrl(normalized)
    || isLowResolutionThumbnailUrl(normalized)
    || hasSuspiciousThumbnailMismatch(normalized, { sourceUrl });
}
