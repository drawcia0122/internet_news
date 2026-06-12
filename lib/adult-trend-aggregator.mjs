import { absolutizeUrl, firstSrcsetCandidate, pickThumbnailFromItem, resolveThumbnail } from "./thumbnail-utils.mjs";

export const ADULT_CATEGORY_LABELS = {
  av: "AV",
  doujin: "同人",
  voice: "同人音声",
  ai: "AI作品",
  manga: "エロ漫画",
  sale: "セール",
  industry: "業界ニュース",
};

export const DEFAULT_ADULT_SOURCES = [
  {
    key: "dlsite-maniax-ranking-day",
    source: "DLsite",
    sourceUrl: "https://www.dlsite.com/maniax/ranking/day",
    category: ["同人"],
    categories: ["doujin"],
    type: "ranking",
    hotReason: "DLsiteデイリーランキング掲載",
    maxItems: 12,
  },
  {
    key: "dlsite-maniax-new",
    source: "DLsite",
    sourceUrl: "https://www.dlsite.com/maniax/new",
    category: ["同人"],
    categories: ["doujin"],
    type: "new",
    hotReason: "DLsite新着作品",
    maxItems: 10,
  },
  {
    key: "dlsite-books-ranking-day",
    source: "DLsite",
    sourceUrl: "https://www.dlsite.com/books/ranking/day",
    category: ["エロ漫画"],
    categories: ["manga"],
    type: "ranking",
    hotReason: "DLsite漫画ランキング掲載",
    maxItems: 10,
  },
  {
    key: "dlsite-campaign",
    source: "DLsite",
    sourceUrl: "https://www.dlsite.com/maniax/campaign",
    category: ["セール"],
    categories: ["sale"],
    type: "campaign",
    hotReason: "DLsiteセール・キャンペーン掲載",
    maxItems: 8,
  },
  {
    key: "fanza-video-ranking",
    source: "FANZA",
    sourceUrl: "https://www.dmm.co.jp/digital/videoa/-/ranking/=/term=daily/",
    category: ["AV"],
    categories: ["av"],
    type: "ranking",
    hotReason: "FANZAデイリーランキング掲載",
    maxItems: 12,
  },
  {
    key: "fanza-campaign",
    source: "FANZA",
    sourceUrl: "https://www.dmm.co.jp/digital/-/campaign/",
    category: ["セール"],
    categories: ["sale"],
    type: "campaign",
    hotReason: "FANZAセール・キャンペーン掲載",
    maxItems: 8,
  },
  {
    key: "ci-en-adult-sitemap",
    source: "Ci-en",
    sourceUrl: "https://ci-en.net/sitemap/adult",
    category: ["業界ニュース", "同人"],
    categories: ["industry", "doujin"],
    type: "creator-update",
    hotReason: "Ci-enクリエイター更新",
    maxItems: 10,
  },
];

const BLOCKED_TITLE_PATTERN = /(未成年|児童|小学生|中学生|女子高生|\bJK\b|ロリ|少女|幼女)/iu;
const GENERIC_TITLE_PATTERN = /^(ログイン|会員登録|ヘルプ|お問い合わせ|ランキング|もっと見る|一覧|次へ|前へ|検索|カート|購入|お気に入り|年齢認証|トップページ|無料サンプル|レビュー|評価)$/u;
const POPULAR_SIGNAL_WORDS = ["ランキング", "急上昇", "セール", "割引", "キャンペーン", "クーポン", "ポイント", "還元", "新作", "AI", "同人音声", "ASMR", "人気", "体験版"];

export function aggregateAdultTrendItems(rawItems, { fetchedAt = new Date().toISOString(), limit = 80 } = {}) {
  return dedupeAdultItems(rawItems.map((item) => normalizeAdultTrendItem(item, fetchedAt)))
    .sort((left, right) => Number(right.adultHotScore ?? 0) - Number(left.adultHotScore ?? 0))
    .slice(0, limit);
}

export function aggregateAdultFeatures(trendItems, { fetchedAt = new Date().toISOString() } = {}) {
  const groups = new Map();

  for (const rawItem of trendItems) {
    const item = rawItem?.adultSourceGroup ? rawItem : normalizeAdultTrendItem(rawItem, fetchedAt);
    const featureKey = buildAdultFeatureKey(item);
    if (!featureKey) continue;
    const current = groups.get(featureKey) ?? [];
    current.push(item);
    groups.set(featureKey, current);
  }

  return [...groups.entries()]
    .map(([featureKey, items]) => buildAdultFeature(featureKey, items, fetchedAt))
    .filter(Boolean)
    .sort(compareAdultFeatures);
}

export function normalizeAdultTrendItem(item, fetchedAt = new Date().toISOString()) {
  const source = normalizeText(item.sourceName ?? item.source ?? "Source");
  const sourceKey = normalizeSlug(item.sourceKey ?? source);
  const title = normalizeTitle(item.title);
  const categories = inferCategories(title, item.categories ?? item.category);
  const categoryLabels = categories.map((category) => ADULT_CATEGORY_LABELS[category] ?? category);
  const rank = Number(item.rank ?? item.position ?? 0) || null;
  const trendType = item.trendType ?? item.type ?? "trend";
  const hotReasons = buildHotReasons({ ...item, title, source, categories, rank, type: trendType });
  const adultHotScore = calculateAdultHotScore({ ...item, title, categories, rank, hotReasons, type: trendType });
  const sourceUrl = item.sourceUrl ?? item.url ?? "";
  const thumbnail = pickThumbnailFromItem(item, { sourceUrl });
  const maker = normalizeText(item.maker ?? item.circle ?? item.brand ?? extractMaker(title));
  const publishedAt = item.publishedAt ?? item.releasedAt ?? item.lastmod ?? item.updatedAt ?? fetchedAt;
  const tags = buildTags({ title, categories, tags: item.tags, hotReasons });
  const stableId = buildAdultTrendStableId({ item, sourceKey, sourceUrl, title, rank, publishedAt });
  const adultSourceGroup = classifyAdultSourceGroup({ ...item, source, sourceKey, categories, type: trendType, title });
  const adultDisplayType = classifyAdultDisplayType({ ...item, categories, type: trendType, title });
  const adultPrimaryGenre = inferAdultPrimaryGenre({ ...item, source, sourceKey, title, categories, tags, type: trendType });
  const price = normalizePriceValue(item.price ?? item.currentPrice ?? item.salePrice);
  const originalPrice = normalizePriceValue(item.originalPrice ?? item.regularPrice ?? item.listPrice);
  const discountRate = normalizeDiscountRate(item.discountRate, price, originalPrice);
  const saleEndDate = normalizeDateValue(item.saleEndDate ?? item.campaignEndDate ?? item.endDate ?? item.endsAt);
  const ranking = rank ?? normalizeNullableNumber(item.ranking);
  const valueScore = calculateValueScore({ discountRate, ranking, adultHotScore, tags, adultDisplayType });

  return {
    id: stableId,
    title,
    summary: normalizeText(item.summary) || buildSummary({ title, source, categories, maker, rank, hotReasons }),
    source,
    sourceName: source,
    sourceKey,
    sourceUrl,
    thumbnail,
    thumbnailUrl: thumbnail,
    category: categoryLabels,
    categories,
    categoryLabels,
    tags,
    maker,
    genre: adultPrimaryGenre,
    adultSourceGroup,
    adultDisplayType,
    adultPrimaryGenre,
    adultHotScore,
    price,
    originalPrice,
    discountRate,
    currency: normalizeText(item.currency) || "JPY",
    saleEndDate,
    ranking,
    valueScore,
    hotReasons,
    trendReasons: hotReasons,
    rank,
    rankLabel: rank ? `${rank}位` : "注目候補",
    trendType,
    publishedAt,
    fetchedAt,
    history: [{ fetchedAt, rank, adultHotScore, source }],
  };
}

function buildAdultTrendStableId({ item, sourceKey, sourceUrl, title, rank, publishedAt }) {
  return buildAdultTrendId(
    sourceKey,
    [
      sourceUrl,
      title,
      rank ? `rank-${rank}` : "",
      publishedAt,
      item.sourceName ?? item.source ?? "",
    ].filter(Boolean).join("::"),
  );
}

export async function collectAdultTrendRawItems({ fetchText, fetchJson, sources = DEFAULT_ADULT_SOURCES, fanzaApi, manualItems = [], fetchedAt = new Date().toISOString() }) {
  const groups = [];

  if (fanzaApi?.apiId && fanzaApi?.affiliateId) {
    groups.push(await collectFanzaApiItems({ fetchJson, fanzaApi, fetchedAt }).catch(() => []));
  }

  for (const source of sources) {
    const items = await collectPublicSourceItems({ source, fetchText, fetchedAt }).catch(() => []);
    groups.push(items);
  }

  groups.push(normalizeManualItems(manualItems, fetchedAt));
  return groups.flat().filter((item) => isUsefulTitle(item.title));
}

async function collectFanzaApiItems({ fetchJson, fanzaApi, fetchedAt }) {
  const requests = [
    {
      service: "digital",
      floor: "videoa",
      sort: "rank",
      categories: ["av"],
      category: ["AV"],
      type: "ranking",
      hotReason: "FANZA公式APIランキング上位",
    },
  ];
  const groups = [];

  for (const request of requests) {
    const url = new URL("https://api.dmm.com/affiliate/v3/ItemList");
    url.searchParams.set("api_id", fanzaApi.apiId);
    url.searchParams.set("affiliate_id", fanzaApi.affiliateId);
    url.searchParams.set("site", "FANZA");
    url.searchParams.set("service", request.service);
    url.searchParams.set("floor", request.floor);
    url.searchParams.set("sort", request.sort);
    url.searchParams.set("hits", String(fanzaApi.hits ?? 20));
    url.searchParams.set("output", "json");
    const payload = await fetchJson(url.toString());
    const items = payload?.result?.items ?? [];
    groups.push(items.map((item, index) => ({
      title: item.title,
      source: "FANZA",
      sourceKey: `fanza-api-${request.floor}`,
      sourceUrl: item.URL,
      thumbnail: item.imageURL?.large ?? item.imageURL?.list ?? item.imageURL?.small,
      category: request.category,
      categories: request.categories,
      tags: extractFanzaTags(item),
      maker: item.iteminfo?.maker?.[0]?.name ?? item.iteminfo?.label?.[0]?.name ?? null,
      rank: index + 1,
      type: request.type,
      hotReasons: [request.hotReason],
      publishedAt: item.date ?? fetchedAt,
      fetchedAt,
    })));
  }

  return groups.flat();
}

async function collectPublicSourceItems({ source, fetchText, fetchedAt }) {
  const text = await fetchText(source.sourceUrl);
  if (source.key === "ci-en-adult-sitemap") {
    return await enrichAdultItemsWithPageMetadata(extractCiEnItemsFromSitemap(text, source, fetchedAt), fetchText);
  }
  if (/xml/i.test(text.slice(0, 120))) {
    return await enrichAdultItemsWithPageMetadata(extractSitemapItems(text, source, fetchedAt), fetchText);
  }
  return await enrichAdultItemsWithPageMetadata(extractItemsFromHtml(text, source, fetchedAt).slice(0, source.maxItems ?? 10), fetchText);
}

function extractItemsFromHtml(html, source, fetchedAt) {
  const candidates = [];
  const blocks = html.match(/<a\b[\s\S]*?<\/a>/gi) ?? [];

  blocks.forEach((block) => {
    const href = firstMatch(block, /\bhref=["']([^"']+)["']/i);
    const sourceUrl = absolutizeUrl(href, source.sourceUrl);
    if (!sourceUrl || isBlockedUrl(sourceUrl)) return;
    if (!isSourceUrlCandidate(sourceUrl, source)) return;

    const title = normalizeTitle(
      firstMatch(block, /\b(?:alt|title)=["']([^"']{4,180})["']/i) ||
      firstMatch(block, /<span[^>]*(?:work_name|title|txt)[^>]*>([\s\S]{4,240}?)<\/span>/i) ||
      stripHtml(block),
    );
    if (!isUsefulTitle(title)) return;

    const thumbnail = pickThumbnailFromItem({
      thumbnail: absolutizeUrl(firstMatch(block, /\b(?:data-src|data-lazy|data-original|src)=["']([^"']+)["']/i), source.sourceUrl),
      image: absolutizeUrl(firstMatch(block, /\b(?:data-image|data-thumb)=["']([^"']+)["']/i), source.sourceUrl),
      sourceImage: absolutizeUrl(firstSrcsetCandidate(firstMatch(block, /\bsrcset=["']([^"']+)["']/i)), source.sourceUrl),
    }, { sourceUrl: source.sourceUrl });
    candidates.push({
      title,
      source: source.source,
      sourceKey: source.key,
      sourceUrl,
      thumbnail,
      category: source.category,
      categories: source.categories,
      type: source.type,
      hotReasons: [source.hotReason],
      fetchedAt,
    });
  });

  return assignRanks(dedupeAdultItems(candidates));
}

function extractSitemapItems(xml, source, fetchedAt) {
  return parseSitemapUrls(xml)
    .filter((entry) => entry.loc && !isBlockedUrl(entry.loc))
    .slice(0, source.maxItems ?? 10)
    .map((entry, index) => ({
      title: inferTitleFromUrl(entry.loc, source),
      source: source.source,
      sourceKey: source.key,
      sourceUrl: entry.loc,
      category: source.category,
      categories: source.categories,
      type: source.type,
      hotReasons: [source.hotReason],
      rank: index + 1,
      publishedAt: entry.lastmod ?? fetchedAt,
      fetchedAt,
    }))
    .filter((item) => isUsefulTitle(item.title));
}

function extractCiEnItemsFromSitemap(xml, source, fetchedAt) {
  return parseSitemapUrls(xml)
    .filter((entry) => entry.loc && new Date(entry.lastmod ?? 0).getTime() >= Date.now() - 14 * 24 * 60 * 60 * 1000)
    .filter((entry) => /\/(creator|article)\//.test(entry.loc))
    .slice(0, source.maxItems ?? 10)
    .map((entry, index) => {
      const id = entry.loc.match(/\/(?:creator|article)\/(\d+)/)?.[1];
      const isCreator = /\/creator\//.test(entry.loc);
      return {
        title: isCreator ? `Ci-enクリエイター更新 #${id}` : `Ci-en記事更新 #${id}`,
        source: source.source,
        sourceKey: source.key,
        sourceUrl: entry.loc,
        category: source.category,
        categories: source.categories,
        type: source.type,
        hotReasons: [source.hotReason, "sitemap更新日が新しい"],
        maker: isCreator ? `Creator #${id}` : null,
        rank: index + 1,
        publishedAt: entry.lastmod ?? fetchedAt,
        fetchedAt,
      };
    });
}

function normalizeManualItems(items, fetchedAt) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    ...item,
    fetchedAt: item.fetchedAt ?? fetchedAt,
    hotReasons: item.hotReasons ?? item.trendReasons ?? ["手動管理データ"],
  }));
}

export function mergeAdultArchiveItems(previousItems, currentItems, fetchedAt = new Date().toISOString()) {
  const map = new Map();
  for (const item of [...previousItems, ...currentItems]) {
    const normalized = {
      ...item,
      history: Array.isArray(item.history) ? item.history : [],
    };
    const key = normalized.id || buildAdultTrendId(normalized.sourceKey ?? normalized.source ?? "source", normalized.sourceUrl || normalized.title || "");
    const current = map.get(key);
    if (!current) {
      map.set(key, normalized);
      continue;
    }
    map.set(key, {
      ...current,
      ...normalized,
      history: dedupeHistory([...(current.history ?? []), ...(normalized.history ?? [])]),
    });
  }
  return [...map.values()]
    .filter((item) => isWithinArchiveWindow(item, fetchedAt))
    .sort((left, right) => Number(right.adultHotScore ?? 0) - Number(left.adultHotScore ?? 0));
}

function assignRanks(items) {
  return items.map((item, index) => ({ ...item, rank: item.rank ?? index + 1 }));
}

function calculateAdultHotScore({ title, categories, rank, hotReasons, type }) {
  let score = type === "sale" || type === "campaign" || categories.includes("sale") ? 66 : type === "ranking" ? 62 : 50;
  if (rank) score += Math.max(0, 24 - (rank - 1) * 2);
  if (categories.includes("sale")) score += 18;
  if (categories.includes("ai")) score += 14;
  if (categories.includes("voice")) score += 8;
  if (categories.includes("doujin")) score += 6;
  if ((hotReasons ?? []).length >= 2) score += 6;
  for (const word of POPULAR_SIGNAL_WORDS) {
    if (title.toLowerCase().includes(word.toLowerCase())) score += 3;
  }
  return Math.min(100, Math.round(score));
}

function calculateValueScore({ discountRate, ranking, adultHotScore, tags, adultDisplayType }) {
  const discountBoost = Number(discountRate ?? 0);
  const rankingBoost = ranking ? Math.max(0, 32 - Number(ranking)) : 0;
  const popularityBoost = Math.min(24, Math.round(Number(adultHotScore ?? 0) / 4));
  const badgeBoost = Array.isArray(tags) && tags.some((tag) => /人気|上位|急上昇|おすすめ/.test(String(tag))) ? 6 : 0;
  const saleBoost = adultDisplayType === "sale" || adultDisplayType === "campaign" ? 8 : 0;
  return Math.min(100, Math.round(discountBoost + rankingBoost + popularityBoost + badgeBoost + saleBoost));
}

function buildHotReasons(item) {
  const reasons = [...(item.hotReasons ?? item.trendReasons ?? [])].filter(Boolean);
  if (item.type === "ranking" && item.rank) reasons.push(item.rank <= 3 ? "ランキング上位" : "ランキング掲載");
  if (item.type === "campaign") reasons.push("キャンペーン開催中");
  if (item.type === "sale" || item.categories.includes("sale")) reasons.push("セール対象");
  if (item.type === "new") reasons.push("新着人気候補");
  if (item.type === "creator-update") reasons.push("クリエイター更新");
  if (/AI|生成AI/i.test(item.title)) reasons.push("AI作品として注目");
  if (/音声|ASMR|ボイス|声優/.test(item.title)) reasons.push("同人音声系");
  return [...new Set(reasons)].slice(0, 5);
}

function buildSummary({ title, source, categories, maker, rank, hotReasons }) {
  const target = maker ? `${maker}の「${title}」` : `「${title}」`;
  if (categories.includes("sale")) return `${target}が${source}のセール・キャンペーン対象として確認されています。割引や還元、対象期間を見ておきたいトレンドです。`;
  if (categories.includes("voice")) return `${target}が同人音声系の注目候補として検出されています。ASMR、声優、シチュエーション系タグの動きを見る材料になります。`;
  if (categories.includes("ai")) return `${target}がAI作品関連のトレンドとして検出されています。生成系作品の売れ筋やカテゴリ変化を追う入口になります。`;
  if (rank) return `${target}が${source}のランキング${rank}位として検出されています。${hotReasons[0] ?? "ランキング掲載"}を根拠に今日の売れ筋候補として扱っています。`;
  return `${target}が${source}の公開情報から検出されています。カテゴリ、タグ、更新状況をもとにアダルトトレンド候補として整理しています。`;
}

function buildTags({ title, categories, tags, hotReasons }) {
  const values = new Set(Array.isArray(tags) ? tags.filter(Boolean) : []);
  categories.map((category) => ADULT_CATEGORY_LABELS[category]).filter(Boolean).forEach((label) => values.add(label));
  hotReasons.filter(Boolean).forEach((reason) => values.add(reason));
  POPULAR_SIGNAL_WORDS.forEach((word) => {
    if (title.toLowerCase().includes(word.toLowerCase())) values.add(word);
  });
  return [...values].slice(0, 10);
}

function classifyAdultSourceGroup({ source, sourceKey, categories, type, title }) {
  const haystack = `${source} ${sourceKey} ${title}`.toLowerCase();
  if (haystack.includes("fanza") || haystack.includes("dmm")) return "fanza";
  if (haystack.includes("dlsite")) return "dlsite";
  if (haystack.includes("ci-en") || haystack.includes("cien")) return "cien";
  if (type === "campaign" || /キャンペーン|クーポン|ポイント|還元/i.test(title)) return "campaign";
  if (type === "sale" || categories.includes("sale")) return "sale";
  if (categories.includes("industry")) return "industry";
  return "industry";
}

function buildAdultFeatureKey(item) {
  const sourceGroup = item.adultSourceGroup ?? "industry";
  const genre = item.adultPrimaryGenre ?? "業界ニュース";
  const displayType = item.adultDisplayType ?? "article";

  if (sourceGroup === "cien") return "cien:creator_update";
  if (displayType === "sale") return `${sourceGroup}:sale`;
  if (sourceGroup === "fanza") {
    if (/女優/.test([item.title, ...(item.tags ?? []), ...(item.trendReasons ?? [])].join(" "))) return "fanza:actress";
    return "fanza:top";
  }
  if (sourceGroup === "dlsite") {
    if (genre === "同人音声") return "dlsite:voice";
    if (genre === "同人ゲーム") return "dlsite:game";
    if (genre === "AI作品") return "dlsite:ai";
    if (genre === "エロ漫画") return "dlsite:manga";
    return "dlsite:spotlight";
  }
  return `${sourceGroup}:${displayType}:${genre}`;
}

function buildAdultFeature(featureKey, items, fetchedAt) {
  const sortedItems = [...items].sort(compareFeatureItems);
  const first = sortedItems[0];
  if (!first) return null;

  const [sourceGroup, kind] = featureKey.split(":");
  const featureType = inferFeatureTypeFromKey(kind ?? featureKey, first);
  const importance = Math.min(100, Math.round(average(sortedItems.map((item) => Number(item.adultHotScore ?? 0))) + Math.min(sortedItems.length * 2, 12)));
  const relatedItems = sortedItems.slice(0, 8).map((item, index) => ({
    id: item.id,
    title: item.title,
    thumbnail: item.thumbnailUrl ?? item.thumbnail ?? null,
    url: item.sourceUrl ?? "",
    detailUrl: `./adult-topic.html?id=${encodeURIComponent(item.id ?? "")}`,
    sourceName: item.sourceName ?? item.source ?? "Source",
    rank: item.rank ?? index + 1,
  }));
  const aggregateReasons = aggregateFeatureReasons(sortedItems);
  const labels = aggregateFeatureLabels(sortedItems);
  const featureTitle = buildAdultFeatureTitle({ sourceGroup, kind, featureType, first });
  const featureSummary = buildAdultFeatureSummary({ sourceGroup, kind, featureType, first, items: sortedItems });
  const whyHot = buildAdultFeatureWhyHot({ sourceGroup, kind, featureType, items: sortedItems, reasons: aggregateReasons });
  const updatedAt = sortedItems.reduce((latest, item) => Math.max(latest, new Date(item.publishedAt ?? item.fetchedAt ?? 0).getTime() || 0), 0);

  return {
    id: buildAdultFeatureId(featureKey, fetchedAt),
    title: featureTitle,
    summary: featureSummary,
    featureType,
    sourceGroup: featureSourceLabel(sourceGroup),
    sourceGroupKey: sourceGroup,
    importance,
    whyHot,
    thumbnailUrl: first.thumbnailUrl ?? first.thumbnail ?? null,
    primaryItemId: first.id,
    primaryItemTitle: first.title,
    primaryGenre: first.adultPrimaryGenre ?? first.genre ?? null,
    tags: labels,
    trendReasons: aggregateReasons,
    relatedItems,
    itemCount: sortedItems.length,
    sourceUrl: first.sourceUrl ?? "",
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : fetchedAt,
  };
}

function buildAdultFeatureTitle({ sourceGroup, kind, featureType }) {
  if (sourceGroup === "dlsite" && kind === "sale") return "🔥 DLsite大型セール開催中";
  if (sourceGroup === "fanza" && kind === "sale") return "🔥 FANZAセール・キャンペーン注目";
  if (sourceGroup === "dlsite" && kind === "voice") return "🎧 DLsiteで今売れている同人音声";
  if (sourceGroup === "dlsite" && kind === "game") return "🎮 DLsiteで今売れている同人ゲーム";
  if (sourceGroup === "dlsite" && kind === "ai") return "🤖 DLsiteで伸びているAI作品";
  if (sourceGroup === "dlsite" && kind === "manga") return "📚 DLsiteで売れているエロ漫画";
  if (sourceGroup === "fanza" && kind === "actress") return "🌟 FANZAで注目の女優・出演作";
  if (sourceGroup === "fanza" && kind === "top") return "🔞 FANZAで今売れている作品";
  if (sourceGroup === "cien") return "📝 Ci-en更新情報まとめ";
  if (featureType === "sale") return `${featureSourceLabel(sourceGroup)}セール特集`;
  return `${featureSourceLabel(sourceGroup)}注目トレンド`;
}

function buildAdultFeatureSummary({ sourceGroup, kind, featureType, items }) {
  const count = items.length;
  const topRanked = items.filter((item) => Number(item.rank) > 0).length;
  if (featureType === "sale") return `割引、キャンペーン、ポイント還元をまとめた特集です。関連作品 ${count} 件を一度に追えます。`;
  if (sourceGroup === "cien") return `新作発表、開発進捗、制作報告の更新をまとめています。直近の更新 ${count} 件を確認できます。`;
  if (kind === "voice") return `ASMR、シチュ音声、声優系の売れ筋をまとめました。注目作品 ${count} 件を横断できます。`;
  if (kind === "game") return `RPG、ADV、体験版を含む同人ゲームの売れ筋特集です。ランキング上位 ${topRanked} 件を含みます。`;
  if (kind === "ai") return `生成系の売れ筋や話題作をまとめたAI作品特集です。今の伸び筋を短時間で追えます。`;
  if (kind === "manga") return `売れ筋の成人向けコミックをまとめています。人気作品 ${count} 件を確認できます。`;
  if (sourceGroup === "fanza") return `トップ作品、急上昇候補、関連セールをまとめたFANZA特集です。注目作 ${count} 件を追えます。`;
  return `同テーマの作品や更新をまとめた特集です。関連項目 ${count} 件を確認できます。`;
}

function buildAdultFeatureWhyHot({ sourceGroup, kind, featureType, items, reasons }) {
  const top = items[0];
  if (featureType === "sale") return `${featureSourceLabel(sourceGroup)}で割引・還元系の signal が重なっています。${reasons.slice(0, 2).join("・") || "セール対象"}`;
  if (sourceGroup === "cien") return `クリエイター更新が連続しており、制作進捗や新作告知をまとめて追える状態です。`;
  if (kind === "voice") return `同人音声系の注目作がまとまっており、ASMRやシチュエーション需要の強さが見えます。`;
  if (kind === "game") return `同人ゲームの上位作が固まっており、今どの作品が強いかを一目で判断できます。`;
  if (kind === "ai") return `AI作品の上位が複数入っており、生成系カテゴリの勢いが強い状態です。`;
  if (kind === "manga") return `漫画ランキング上位と話題作がまとまっており、今売れている作品を短く把握できます。`;
  return `${top?.title ?? "注目作"}を中心に、${reasons.slice(0, 2).join("・") || "ランキング上位"}が重なっています。`;
}

function aggregateFeatureReasons(items) {
  const counts = new Map();
  for (const item of items) {
    for (const reason of item.trendReasons ?? item.hotReasons ?? []) {
      if (!reason) continue;
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
    .map(([reason]) => reason)
    .slice(0, 5);
}

function aggregateFeatureLabels(items) {
  const labels = new Set();
  for (const item of items) {
    if (item.adultPrimaryGenre) labels.add(item.adultPrimaryGenre);
    for (const label of item.categoryLabels ?? []) labels.add(label);
    for (const tag of item.tags ?? []) {
      if (labels.size >= 8) break;
      labels.add(tag);
    }
    if (labels.size >= 8) break;
  }
  return [...labels].slice(0, 8);
}

function inferFeatureTypeFromKey(kind, item) {
  if (kind === "sale" || item.adultDisplayType === "sale") return "sale";
  if (kind === "campaign" || item.adultDisplayType === "campaign") return "campaign";
  if (kind === "creator_update" || item.adultDisplayType === "magazine") return "creator_update";
  return "trend";
}

function buildAdultFeatureId(featureKey, fetchedAt) {
  const stamp = String(fetchedAt ?? "").slice(0, 10).replace(/-/g, "");
  return `adult-feature-${normalizeSlug(featureKey)}-${stamp || "current"}`;
}

function featureSourceLabel(sourceGroup) {
  if (sourceGroup === "fanza") return "FANZA";
  if (sourceGroup === "dlsite") return "DLsite";
  if (sourceGroup === "cien") return "Ci-en";
  return String(sourceGroup ?? "Source").toUpperCase();
}

function compareAdultFeatures(left, right) {
  return Number(right.importance ?? 0) - Number(left.importance ?? 0)
    || Number(new Date(right.updatedAt ?? 0).getTime() || 0) - Number(new Date(left.updatedAt ?? 0).getTime() || 0)
    || String(left.title ?? "").localeCompare(String(right.title ?? ""), "ja");
}

function compareFeatureItems(left, right) {
  return Number(right.adultHotScore ?? 0) - Number(left.adultHotScore ?? 0)
    || Number(Boolean(right.thumbnailUrl)) - Number(Boolean(left.thumbnailUrl))
    || Number(Boolean(String(right.summary ?? "").trim())) - Number(Boolean(String(left.summary ?? "").trim()))
    || Number(new Date(right.publishedAt ?? right.fetchedAt ?? 0).getTime() || 0) - Number(new Date(left.publishedAt ?? left.fetchedAt ?? 0).getTime() || 0);
}

function average(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function classifyAdultDisplayType({ categories, type, title, discountRate, saleEndDate, originalPrice, price }) {
  if (type === "ranking") return "ranking";
  if (type === "campaign" || /キャンペーン|クーポン|ポイント|還元/i.test(title)) return "campaign";
  if (discountRate || saleEndDate || (originalPrice && price && originalPrice > price)) return "sale";
  if (type === "sale" || categories.includes("sale") || /セール|割引|キャンペーン|クーポン|ポイント|還元/i.test(title)) return "sale";
  if (type === "creator-update" || categories.includes("industry")) return "magazine";
  return "trending";
}

function normalizePriceValue(value) {
  const normalized = normalizeNullableNumber(value);
  return normalized && normalized > 0 ? normalized : null;
}

function normalizeNullableNumber(value) {
  const digits = String(value ?? "").replace(/[^\d.-]+/g, "").trim();
  if (!digits) return null;
  const normalized = Number(digits);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeDiscountRate(value, price, originalPrice) {
  const normalized = normalizeNullableNumber(value);
  if (normalized !== null && normalized >= 0) return Math.max(0, Math.min(100, Math.round(normalized)));
  if (price && originalPrice && originalPrice > price) {
    return Math.max(0, Math.min(100, Math.round((1 - price / originalPrice) * 100)));
  }
  return null;
}

function normalizeDateValue(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function inferAdultPrimaryGenre({ source, title, categories, tags, type, discountRate, saleEndDate, originalPrice, price }) {
  const haystack = [source, title, ...(Array.isArray(tags) ? tags : []), ...(Array.isArray(categories) ? categories : [])].join(" ");
  if (type === "sale" || categories.includes("sale") || discountRate || saleEndDate || (originalPrice && price && originalPrice > price) || /セール|割引|キャンペーン|クーポン|ポイント|還元/i.test(haystack)) return "セール";
  if (/音声|ASMR|ボイス|声優/i.test(haystack) || categories.includes("voice")) return "同人音声";
  if (/漫画|コミック|単話|電子書籍|book/i.test(haystack) || categories.includes("manga")) return "エロ漫画";
  if (/AI|生成AI/i.test(haystack) || categories.includes("ai")) return "AI作品";
  if (/ゲーム|RPG|SLG|ADV|シミュレーション|アクション|ノベル|体験版/i.test(haystack) || (categories.includes("doujin") && /DLsite/i.test(source))) return "同人ゲーム";
  if (/AV|女優|メーカー|ビデオ|動画|FANZA/i.test(haystack) || categories.includes("av")) return "AV";
  return "業界ニュース";
}

function inferCategories(title, input) {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  const categories = new Set(values.flatMap((value) => normalizeCategory(value)));
  if (/セール|割引|キャンペーン|クーポン|ポイント|還元|sale/i.test(title)) categories.add("sale");
  if (/AI|生成AI/i.test(title)) categories.add("ai");
  if (/音声|ASMR|ボイス|声優/.test(title)) categories.add("voice");
  if (/漫画|コミック|単話|電子書籍|books?/i.test(title)) categories.add("manga");
  if (/同人|サークル|体験版|ゲーム/.test(title)) categories.add("doujin");
  if (/AV|女優|メーカー|ビデオ|FANZA/i.test(title)) categories.add("av");
  if (!categories.size) categories.add("industry");
  return [...categories];
}

function normalizeCategory(value) {
  const text = String(value ?? "").toLowerCase();
  if (["av", "ＡＶ"].includes(text) || /av|fanza/.test(text)) return ["av"];
  if (/同人音声|voice|音声|asmr/.test(text)) return ["voice", "doujin"];
  if (/同人|doujin/.test(text)) return ["doujin"];
  if (/ai|生成/.test(text)) return ["ai"];
  if (/漫画|コミック|manga|comic|book/.test(text)) return ["manga"];
  if (/セール|sale|割引|キャンペーン/.test(text)) return ["sale"];
  if (/業界|industry|creator/.test(text)) return ["industry"];
  return [text || "industry"];
}

function extractFanzaTags(item) {
  return [
    ...(item.iteminfo?.genre ?? []).map((entry) => entry.name),
    ...(item.iteminfo?.actress ?? []).slice(0, 2).map((entry) => entry.name),
    ...(item.campaign ?? []).map((entry) => entry.title),
  ].filter(Boolean).slice(0, 10);
}

function dedupeAdultItems(items) {
  const map = new Map();
  for (const item of items) {
    if (!isUsefulTitle(item.title)) continue;
    const key = normalizeFingerprint(item.sourceUrl || item.title || "");
    const titleKey = normalizeFingerprint(item.title || "");
    const current = map.get(key) ?? map.get(titleKey);
    if (!current) {
      map.set(key || titleKey, item);
      continue;
    }
    map.set(key || titleKey, mergeAdultItems(current, item));
  }
  return [...map.values()];
}

function mergeAdultItems(left, right) {
  const scoreLeft = Number(left.adultHotScore ?? 0);
  const scoreRight = Number(right.adultHotScore ?? 0);
  const winner = scoreRight >= scoreLeft ? right : left;
  const loser = winner === right ? left : right;
  return {
    ...loser,
    ...winner,
    hotReasons: [...new Set([...(loser.hotReasons ?? []), ...(winner.hotReasons ?? [])])],
    trendReasons: [...new Set([...(loser.trendReasons ?? []), ...(winner.trendReasons ?? [])])],
    tags: [...new Set([...(loser.tags ?? []), ...(winner.tags ?? [])])].slice(0, 10),
    thumbnail: winner.thumbnail ?? loser.thumbnail ?? null,
    thumbnailUrl: winner.thumbnailUrl ?? loser.thumbnailUrl ?? null,
  };
}

function parseSitemapUrls(xml) {
  const entries = [];
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const value = block[1] ?? "";
    entries.push({
      loc: decodeXml(firstMatch(value, /<loc>([\s\S]*?)<\/loc>/i)),
      lastmod: decodeXml(firstMatch(value, /<lastmod>([\s\S]*?)<\/lastmod>/i)),
    });
  }
  return entries;
}

function inferTitleFromUrl(url, source) {
  const parsed = safeUrl(url);
  if (!parsed) return source.hotReason;
  const workId = parsed.pathname.match(/product_id\/([^/.]+)/)?.[1];
  if (workId) return `${source.source}作品 ${workId}`;
  const creatorId = parsed.pathname.match(/creator\/(\d+)/)?.[1];
  if (creatorId) return `${source.source}クリエイター更新 #${creatorId}`;
  return `${source.source}公開情報 ${parsed.pathname.split("/").filter(Boolean).pop() ?? "trend"}`;
}

function isUsefulTitle(title) {
  const value = normalizeTitle(title);
  if (!value || value.length < 4) return false;
  if (BLOCKED_TITLE_PATTERN.test(value)) return false;
  if (GENERIC_TITLE_PATTERN.test(value)) return false;
  if (/^(DLsite R18|DLsite|FANZA|DMM|こだわり条件|新規登録|無料会員登録|ログイン|マイページ|フロア|ジャンル)$/iu.test(value)) return false;
  if (/^\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+まで$/u.test(value)) return false;
  if (/^[a-z0-9_-]+\.[a-z0-9_.-]+$/i.test(value)) return false;
  if (/^(campaign|common|ranking|product|work)\./i.test(value)) return false;
  if (/^\(?\d+\)?$/.test(value)) return false;
  return true;
}

function normalizeTitle(value) {
  return stripHtml(String(value ?? ""))
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function normalizeText(value) {
  return stripHtml(String(value ?? "")).replace(/\s+/g, " ").trim();
}

async function enrichAdultItemsWithPageMetadata(items, fetchText) {
  const nextItems = await Promise.all(items.map(async (item) => {
    const metadata = await fetchAdultPageMetadata(item.sourceUrl, fetchText).catch(() => null);
    const resolved = await resolveThumbnail({
      item,
      sourceUrl: item.sourceUrl,
      pageHtml: metadata?.html ?? "",
    });
    const commerce = extractAdultCommerceSignals(metadata?.html ?? "", item.sourceUrl);
    const thumbnail = resolved.thumbnailUrl;
    return {
      ...item,
      ogImage: resolved.ogImage ?? item.ogImage ?? null,
      twitterImage: resolved.twitterImage ?? item.twitterImage ?? null,
      jsonLdImage: resolved.jsonLdImage ?? item.jsonLdImage ?? null,
      sourceImage: resolved.sourceImage ?? item.sourceImage ?? null,
      thumbnail,
      thumbnailUrl: thumbnail,
      price: commerce.price ?? item.price ?? null,
      originalPrice: commerce.originalPrice ?? item.originalPrice ?? null,
      discountRate: commerce.discountRate ?? item.discountRate ?? null,
      saleEndDate: commerce.saleEndDate ?? item.saleEndDate ?? null,
      currency: commerce.currency ?? item.currency ?? "JPY",
      tags: [...new Set([...(item.tags ?? []), ...(commerce.tags ?? [])])].slice(0, 10),
    };
  }));
  return nextItems;
}

async function fetchAdultPageMetadata(url, fetchText) {
  if (!url) return null;
  const html = await fetchText(url);
  return { html };
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAdultCommerceSignals(html, sourceUrl) {
  if (!html) return {};
  if (/dlsite\.com/i.test(sourceUrl)) return extractDlsiteCommerceSignals(html);
  return {};
}

function extractDlsiteCommerceSignals(html) {
  const price = normalizeNullableNumber(firstMatch(html, /data-price="([^"]+)"/i))
    ?? normalizeNullableNumber(firstMatch(html, /<meta\s+itemprop="price"\s+content="([^"]+)"/i))
    ?? normalizeNullableNumber(firstMatch(html, /class="work_price_base">([\d,]+)/i));
  const originalPrice = normalizeNullableNumber(firstMatch(html, /data-official_price="([^"]+)"/i))
    ?? normalizeNullableNumber(firstMatch(html, /class="strike">([\d,]+)<i/i));
  const saleEndDate = normalizeDateValue(firstMatch(html, /<meta\s+itemprop="priceValidUntil"\s+content="([^"]+)"/i));
  const discountRate = normalizeNullableNumber(firstMatch(html, /(\d{1,3})%OFF/i))
    ?? normalizeDiscountRate(null, price, originalPrice);
  const tags = [];
  if (discountRate) tags.push(`${discountRate}%OFF`);
  if (saleEndDate) tags.push("セール対象");

  return {
    price,
    originalPrice,
    discountRate,
    saleEndDate,
    currency: firstMatch(html, /<meta\s+itemprop="priceCurrency"\s+content="([^"]+)"/i) ?? "JPY",
    tags,
  };
}

function firstMatch(value, pattern) {
  return String(value ?? "").match(pattern)?.[1] ?? "";
}

function isBlockedUrl(url) {
  return /adultcheck|\/mypage|\/cart|\/basket|\/popup|\/api\/|\/regist\/|\/login|\/fs$|\/work\/reviewlist\/|\.(?:png|jpe?g|gif|webp|svg|ico|css|js)(?:$|\?)/i.test(url);
}

function isSourceUrlCandidate(url, source) {
  const value = String(url ?? "");
  if (source.source === "DLsite") {
    if (!/dlsite\.com/i.test(value)) return false;
    if (source.type === "sale" || source.type === "campaign") return /\/(?:campaign|discount|coupon|bulkbuy)\//i.test(value);
    return /\/work\/=\/product_id\//i.test(value) || /\/product_id\//i.test(value);
  }
  if (source.source === "FANZA") {
    if (!/dmm\.co\.jp|fanza/i.test(value)) return false;
    if (source.type === "sale" || source.type === "campaign") return /\/(?:campaign|sale|detail)\//i.test(value);
    return /\/(?:detail|ranking)\//i.test(value) || /cid=/i.test(value);
  }
  if (source.source === "Ci-en") {
    if (!/ci-en\.net/i.test(value)) return false;
    return /\/(?:creator|article)\//i.test(value);
  }
  return true;
}

function buildAdultTrendId(sourceKey, value) {
  const slug = normalizeFingerprint(value).replace(/\s+/g, "-").slice(0, 90) || "adult-trend";
  return `adult-${normalizeSlug(sourceKey)}-${slug}`;
}

function normalizeSlug(value) {
  return normalizeFingerprint(value).replace(/\s+/g, "-") || "source";
}

function normalizeFingerprint(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[【】「」『』"'“”]/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMaker(title) {
  const match = String(title ?? "").match(/(?:\(|（|\[)([^()[\]（）]{2,32})(?:\)|）|\])$/u);
  return match?.[1] ?? null;
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function dedupeHistory(history) {
  const map = new Map();
  for (const entry of history) {
    if (!entry?.fetchedAt && !entry?.capturedAt) continue;
    map.set(`${entry.fetchedAt ?? entry.capturedAt}:${entry.source ?? entry.sourceName ?? ""}`, entry);
  }
  return [...map.values()].sort((left, right) => new Date(right.fetchedAt ?? right.capturedAt).getTime() - new Date(left.fetchedAt ?? left.capturedAt).getTime()).slice(0, 90);
}

function isWithinArchiveWindow(item, nowValue) {
  const now = new Date(nowValue).getTime();
  const time = new Date(item.fetchedAt ?? item.publishedAt ?? item.history?.[0]?.fetchedAt ?? item.history?.[0]?.capturedAt ?? nowValue).getTime();
  if (Number.isNaN(time)) return true;
  return now - time <= 90 * 24 * 60 * 60 * 1000;
}
