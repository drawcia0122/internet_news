import { RSS_FEEDS } from "../config/rss-feeds.mjs";
import { pickThumbnailFromItem } from "./thumbnail-utils.mjs";

const CATEGORY_STYLES = {
  general: { label: "その他", color: "#ffd84d", searchQuery: "主要ニュース 速報 話題" },
  tech: { label: "テック", color: "#9dd5ff", searchQuery: "テクノロジー 生成AI 新製品 アップデート" },
  business: { label: "経済", color: "#ffb09d", searchQuery: "経済 企業 決算 投資 市況" },
  politics: { label: "政治", color: "#8cb7ff", searchQuery: "政治 国会 首相 選挙 与党 野党" },
  entertainment: { label: "エンタメ", color: "#ff9ad1", searchQuery: "エンタメ 映画 音楽 配信 話題" },
  games: { label: "ゲーム", color: "#8e9bff", searchQuery: "ゲーム 任天堂 Switch PS5 Steam eスポーツ 話題" },
  manga: { label: "漫画", color: "#ff9d7c", searchQuery: "漫画 マンガ コミック 新刊 連載 話題" },
  books: { label: "本", color: "#d6b27f", searchQuery: "本 書籍 小説 文庫 出版 話題" },
  sports: { label: "スポーツ", color: "#8fdca8", searchQuery: "スポーツ 試合 結果 移籍 大会" },
  sns: { label: "SNS", color: "#65c7c8", searchQuery: "X Twitter Bluesky Reddit SNSで話題 バズ投稿" },
  "net-culture": { label: "ネットカルチャー", color: "#7fc8ff", searchQuery: "2ch まとめ ネット掲示板 バズ SNS" },
  matome: { label: "2chまとめ系", color: "#8fa8ff", searchQuery: "2ch 5ch なんJ まとめサイト 痛いニュース はちま オタコム" },
  crime: { label: "犯罪・事件", color: "#ff9f7d", searchQuery: "事件 逮捕 送検 詐欺 強盗 裁判" },
  adult: { label: "アダルト系", color: "#ff91b9", searchQuery: "FANZA DLsite セール キャンペーン グラビア アダルト 話題" },
  world: { label: "国際", color: "#c8b3ff", searchQuery: "国際 海外 政治 外交 戦況" },
};

const CATEGORY_RULES = [
  { key: "tech", pattern: /生成ai|openai|apple|google|microsoft|meta|半導体|テック|iphone|android|chatgpt|gpu|ソフトウェア|wi-fi|スマホ|アプリ|クラウド|データセンター|nvidia/ },
  { key: "business", pattern: /株|決算|企業|日銀|金利|経済|市場|投資|ipo|上場|円安|物価|生産|業界|工場/ },
  { key: "politics", pattern: /政治|首相|政権|国会|選挙|与党|野党|議員|大統領|党派|官房長官|知事/ },
  { key: "entertainment", pattern: /映画|音楽|芸能|ドラマ|配信|俳優|歌手|アニメ|番組/ },
  { key: "games", pattern: /ゲーム機|ゲームソフト|ゲーム会社|ゲーム開発|ゲーミング|任天堂|nintendo|switch\s?2?|switch|ps5|playstation|xbox|steam|モンハン|ポケモンsv|eスポーツ|esports|apex|valorant|スプラトゥーン|ゼルダ|マリオカート/ },
  { key: "manga", pattern: /漫画|マンガ|コミック|単行本|連載|ジャンプ|マガジン|サンデー|ヤング/ },
  { key: "books", pattern: /書籍|小説|文庫|新書|出版|作家|芥川賞|直木賞|絵本|単行本|新刊|書店/ },
  { key: "crime", pattern: /事件|逮捕|送検|起訴|判決|裁判|詐欺|強盗|殺人|暴行|窃盗/ },
  { key: "sports", pattern: /野球|サッカー|試合|監督|移籍|大会|五輪|巨人|jリーグ|大谷|ドジャース|mlb|バドミントン|高校野球/ },
  { key: "sns", pattern: /\bx\b|twitter|bluesky|reddit|snsで話題|sns投稿|投稿が話題|トレンド入り|バズ投稿/ },
  { key: "net-culture", pattern: /2ch|5ch|掲示板|まとめサイト|ネット民|バズる|炎上|sns|xで話題|ミーム/ },
  { key: "matome", pattern: /はちま|オタコム|痛いニュース|俺的ゲーム速報|刃|まとめブログ|まとめサイト|なんj|なんg|vipper|暇人速報|アルファルファモザイク/ },
  { key: "adult", pattern: /アダルト|av女優|セクシー女優|グラビア|r18|porn|adult|fanza|dlsite|dmm|同人|美少女ゲーム/ },
  { key: "world", pattern: /中国|米国|アメリカ|ウクライナ|ロシア|イラン|イスラエル|中東|外交|国際|米軍|戦況|フィリピン|カンボジア|トランプ|中央軍/ },
];

const CATEGORY_PRIORITY = ["crime", "politics", "business", "tech", "sports", "games", "adult", "entertainment", "manga", "books", "sns", "net-culture", "matome", "world", "general"];

export async function collectTrendTopics({ fetchImpl = fetch, now = new Date() } = {}) {
  const nowDate = new Date(now);
  const groups = await Promise.all(
    RSS_FEEDS.map((feed) =>
      fetchRssEntries(fetchImpl, feed).catch(() => []),
    ),
  );
  const entries = groups.flat();
  const items = clusterSignals(dedupeSignals(entries).filter(shouldKeepSignal))
    .map((cluster, index) => buildSignalTopic(cluster, nowDate, index))
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  return { generatedAt: items.length ? nowDate.toISOString() : null, items };
}

function buildSignalTopic(cluster, nowDate, index) {
  const primarySignal = cluster.signals[0];
  const categories = inferCategoriesForCluster(cluster.signals);
  const category = categories[0] ?? inferPrimaryCategory(primarySignal.title, primarySignal.description, primarySignal.categoryHint);
  const style = CATEGORY_STYLES[category] ?? CATEGORY_STYLES.general;
  const title = trimSourceSuffix(primarySignal.title);
  const hotContext = buildHotContext(cluster, nowDate, title, categories);
  const summary = buildSummary(primarySignal, category);
  return {
    id: `auto-${category}-${extractStableId(primarySignal)}`,
    category,
    categoryLabel: style.label,
    categories,
    categoryLabels: categories.map((key) => CATEGORY_STYLES[key]?.label ?? CATEGORY_STYLES.general.label),
    score: computeSignalScore(cluster, nowDate, index),
    hotScore: hotContext.score,
    hotReasons: hotContext.reasons,
    relatedKeywords: hotContext.relatedKeywords,
    socialLinks: buildSocialLinks(title),
    scoreSummary: buildScoreSummary(cluster, hotContext, primarySignal, categories),
    color: style.color,
    title,
    summary,
    posts: String(cluster.signals.length),
    metricLabel: cluster.signals.length > 1 ? "sources" : "source",
    time: formatRelativeTime(primarySignal.publishedAt, nowDate),
    searchLinks: buildSearchLinks(title, style.searchQuery),
    thumbnailUrl: primarySignal.thumbnailUrl ?? cluster.signals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
    thumbnail: primarySignal.thumbnail ?? primarySignal.thumbnailUrl ?? cluster.signals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
    sourceSignals: cluster.signals.map(toClientSignal),
    tweets: [],
  };
}

function buildSummary(signal, category) {
  const title = trimSourceSuffix(signal.title);
  const description = normalizeDescriptionSummary(signal.description, title);
  return description || summarizeFromTitle(title, category);
}

function inferPrimaryCategory(title = "", description = "", categoryHint = null) {
  if (categoryHint) return categoryHint;
  return inferCategories(title, description)[0] ?? "general";
}

function inferCategories(title = "", description = "", categoryHint = null) {
  const categories = inferTextCategories(title, description);
  if (categories.length) return categories;
  if (categoryHint) return [categoryHint];
  return ["general"];
}

function inferCategoriesForCluster(signals = []) {
  const scores = new Map();
  const primarySignal = signals[0];
  const primaryCategory = inferPrimaryCategory(primarySignal?.title, primarySignal?.description, primarySignal?.categoryHint);
  const clusterText = signals.map((signal) => `${signal.title ?? ""} ${signal.description ?? ""}`).join(" ").toLowerCase();

  for (const signal of signals) {
    const categories = inferTextCategories(signal.title, signal.description);
    categories.forEach((category, index) => {
      let increment = index === 0 ? 2 : 1;
      if (category === "adult" && /fanza|dlsite|dmm/i.test(`${signal.title ?? ""} ${signal.description ?? ""}`)) {
        increment += 3;
      }
      scores.set(category, (scores.get(category) ?? 0) + increment);
    });
  }

  if (/逮捕|送検|起訴|判決|容疑|家宅捜索|警視庁|県警/.test(clusterText)) {
    scores.set("crime", (scores.get("crime") ?? 0) + 6);
    if (/アダルトサイト|ライブ配信|ストリップチャット|公然わいせつ|わいせつ/.test(clusterText)) {
      scores.set("crime", (scores.get("crime") ?? 0) + 4);
    }
  }

  if (!scores.size) return [primaryCategory];

  return [...scores.entries()]
    .sort((left, right) => {
      const scoreDiff = right[1] - left[1];
      if (scoreDiff !== 0) return scoreDiff;
      return CATEGORY_PRIORITY.indexOf(left[0]) - CATEGORY_PRIORITY.indexOf(right[0]);
    })
    .map(([category]) => category);
}

function buildSearchLinks(title, fallbackQuery) {
  const query = title || fallbackQuery;
  return [
    { label: "Googleニュースで探す", url: `https://news.google.com/search?q=${encodeURIComponent(`${query} when:7d`)}&hl=ja&gl=JP&ceid=JP:ja` },
    { label: "Yahoo!ニュースで探す", url: `https://news.yahoo.co.jp/search?p=${encodeURIComponent(query)}` },
    { label: "Webで広く探す", url: `https://www.google.com/search?q=${encodeURIComponent(query)}` },
  ];
}

function buildSocialLinks(title) {
  const query = encodeURIComponent(title || "話題");
  return [
    { label: "Xで反応を見る", url: `https://x.com/search?q=${query}&src=typed_query&f=live` },
    { label: "Blueskyで探す", url: `https://bsky.app/search?q=${query}` },
    { label: "Redditで探す", url: `https://www.reddit.com/search/?q=${query}` },
  ];
}

function toClientSignal(signal) {
  return {
    source: signal.source,
    sourceName: signal.sourceName ?? signal.source,
    title: trimSourceSuffix(signal.title),
    url: signal.url,
    publishedAt: signal.publishedAt ?? null,
    publishedLabel: formatSignalDate(signal.publishedAt),
    thumbnailUrl: signal.thumbnailUrl ?? null,
    thumbnail: signal.thumbnail ?? signal.thumbnailUrl ?? null,
    summary: normalizeSignalSummary(signal),
  };
}

async function fetchRssEntries(fetchImpl, feed) {
  const response = await fetchImpl(feed.url, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml",
      "user-agent": "INTERNET NEWS/1.0",
    },
  });
  if (!response.ok) throw new Error(`${feed.source} returned ${response.status}`);
  const xml = await response.text();
  return parseXmlEntries(xml, feed);
}

function parseXmlEntries(xml, feed) {
  const blocks = [...matchBlocks(xml, "item"), ...matchBlocks(xml, "entry")];
  return blocks
    .map((block) => {
      const description = decodeEntities(readTag(block, "description") ?? "");
      const rssUrl = decodeEntities(readLink(block) ?? "");
      const primaryUrl = pickEntryUrl(rssUrl, extractDescriptionUrls(block, feed.url), feed.source);
      const mediaThumbnail = decodeEntities(readMediaThumbnail(block) ?? "");
      const mediaContent = decodeEntities(readMediaContent(block) ?? "");
      const enclosure = decodeEntities(readEnclosureImage(block) ?? "");
      const thumbnail = pickThumbnailFromItem({
        mediaThumbnail,
        mediaContent,
        enclosure,
        thumbnail: decodeEntities(readInlineImage(block) ?? ""),
      }, { sourceUrl: primaryUrl || feed.url });

      return {
        source: feed.source,
        sourceName: feed.sourceName,
        categoryHint: feed.categoryHint ?? null,
        title: decodeEntities(readTag(block, "title") ?? ""),
        url: primaryUrl,
        description,
        mediaThumbnail,
        mediaContent,
        enclosure,
        thumbnailUrl: thumbnail,
        thumbnail,
        publishedAt: normalizeDate(
          readTag(block, "pubDate") ?? readTag(block, "published") ?? readTag(block, "updated"),
        ),
      };
    })
    .filter((entry) => entry.title && entry.url);
}

function matchBlocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((match) => match[1]);
}

function readTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() ?? null;
}

function readLink(block) {
  const atomHref = block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1];
  if (atomHref) return atomHref;
  return readTag(block, "link");
}

function readMediaThumbnail(block) {
  return block.match(/<media:thumbnail\b[^>]*url=["']([^"']+)["']/i)?.[1] ?? null;
}

function readMediaContent(block) {
  return block.match(/<media:content\b[^>]*url=["']([^"']+)["'][^>]*type=["']image\//i)?.[1] ?? null;
}

function readEnclosureImage(block) {
  return block.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*type=["']image\//i)?.[1] ?? null;
}

function readInlineImage(block) {
  return block.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] ?? null;
}

function extractDescriptionUrls(block, baseUrl) {
  const links = [];
  for (const match of block.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const normalized = absolutizeUrl(decodeEntities(match[1] ?? ""), baseUrl);
    if (normalized) links.push(normalized);
  }
  return [...new Set(links)];
}

function pickEntryUrl(rssUrl, descriptionUrls, source) {
  if (source === "Google News") {
    const externalUrl = descriptionUrls.find((url) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        return hostname !== "news.google.com" && !hostname.endsWith(".google.com");
      } catch {
        return false;
      }
    });
    if (externalUrl) return externalUrl;
  }
  return rssUrl;
}

function absolutizeUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'");
}

function stripHtml(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimSourceSuffix(value) {
  return String(value ?? "")
    .replace(/\s+-\s+[^-]+$/, "")
    .replace(/\s+\|\s+[^|]+$/, "")
    .replace(/\s*[（(][^)）]{1,40}[)）]\s*$/, "")
    .trim();
}

function computeSignalScore(cluster, nowDate, index) {
  const signal = cluster.signals[0];
  const ageHours = Math.max(
    0,
    (new Date(nowDate).getTime() - new Date(signal.publishedAt ?? nowDate).getTime()) / (1000 * 60 * 60),
  );
  const freshness = Math.max(0, 34 - Math.round(ageHours * 1.5));
  const sourceBoost = Math.min(12, (cluster.signals.length - 1) * 4);
  return Math.max(1, 62 + freshness + sourceBoost + keywordBoost(signal) - index);
}

function buildHotContext(cluster, nowDate, title, categories) {
  const primarySignal = cluster.signals[0];
  const ageHours = Math.max(
    0,
    (new Date(nowDate).getTime() - new Date(primarySignal.publishedAt ?? nowDate).getTime()) / (1000 * 60 * 60),
  );
  const sourceCoverage = cluster.signals.length >= 2 ? Math.min(28, cluster.signals.length * 7) : 4;
  const freshness = ageHours <= 2 ? 18 : ageHours <= 6 ? 15 : ageHours <= 12 ? 11 : ageHours <= 24 ? 7 : 3;
  const burstCount = cluster.signals.filter((signal) => {
    const publishedAt = new Date(signal.publishedAt ?? 0).getTime();
    return publishedAt && new Date(nowDate).getTime() - publishedAt <= 6 * 60 * 60 * 1000;
  }).length;
  const velocity = Math.min(22, Math.max(0, burstCount - 1) * 6);
  const signalText = cluster.signals
    .map((signal) => `${signal.title ?? ""} ${signal.description ?? ""} ${signal.sourceName ?? ""}`)
    .join(" ")
    .toLowerCase();
  const snsSignal = categories.includes("sns") || categories.includes("net-culture") || /\bx\b|twitter|bluesky|reddit|sns|トレンド入り|バズ|拡散/.test(signalText) ? 16 : 0;
  const officialSignal = /公式|発表|会見|政府|省|庁|警視庁|県警|nhk|共同通信|日経|時事通信/.test(signalText) ? 8 : 0;
  const sourceAuthority = sourceAuthorityBoost(cluster.signals);
  const searchDemand = /急上昇|検索|注目|話題|トレンド|続報|速報|抽選|倍率|入手困難|炎上/.test(signalText) ? 12 : 0;
  const broadInterest = broadInterestBoost(categories, signalText);
  const interactionSignal = interactionBoost(signalText);
  const mediaDiversity = mediaDiversityBoost(cluster.signals);
  const penalty = nichePenalty(categories, signalText, cluster.signals);
  const score = Math.max(1, sourceCoverage + freshness + velocity + snsSignal + officialSignal + sourceAuthority + searchDemand + broadInterest + interactionSignal + mediaDiversity - penalty);
  const reasons = [];

  if (cluster.signals.length >= 4) reasons.push(`複数メディア${cluster.signals.length}本がほぼ同時に扱っています。`);
  else if (cluster.signals.length >= 2) reasons.push("複数ソースで同じ話題が確認されています。");
  if (burstCount >= 3) reasons.push("直近数時間で関連記事が急増しています。");
  else if (burstCount >= 2) reasons.push("直近数時間で関連記事が増えています。");
  if (snsSignal || interactionSignal >= 10) reasons.push("SNSやネット上で反応が広がりやすい話題です。");
  if (searchDemand) reasons.push("検索需要やトレンド化の兆しが強い話題です。");
  if (broadInterest >= 12) reasons.push("一般ユーザーの関心が集まりやすいテーマです。");
  if (sourceAuthority >= 10) reasons.push("主要ニュースソースや公式発表ベースで確認されています。");

  return {
    score,
    reasons: reasons.slice(0, 4),
    burstCount,
    snsSignal,
    officialSignal,
    sourceAuthority,
    searchDemand,
    broadInterest,
    interactionSignal,
    mediaDiversity,
    penalty,
    relatedKeywords: buildRelatedKeywords(title, categories, cluster.signals),
  };
}

function buildScoreSummary(cluster, hotContext, primarySignal, categories) {
  const parts = [];
  const sourceCount = cluster.signals.length;
  parts.push(`${sourceCount}サイト掲載`);

  if (hotContext.burstCount >= 2) {
    parts.push(`直近${hotContext.burstCount}本増加`);
  }

  if (categories.includes("sns") || categories.includes("net-culture") || hotContext.snsSignal) {
    parts.push("SNS急上昇");
  }

  if (hotContext.sourceAuthority >= 10) {
    parts.push("主要ソース");
  }

  if (hotContext.searchDemand >= 12) {
    parts.push("検索関心高め");
  }

  if (/速報|続報|判明|会見|発表/.test(`${primarySignal.title ?? ""} ${primarySignal.description ?? ""}`)) {
    parts.push("速報性あり");
  }

  return parts.slice(0, 3).join(" / ");
}

function normalizeDescriptionSummary(value, title) {
  const description = stripHtml(String(value ?? "")).trim();
  if (!description) return "";
  const compactTitle = String(title ?? "").trim();
  let normalized = description;
  if (compactTitle && normalized.startsWith(compactTitle)) {
    normalized = normalized.slice(compactTitle.length).trim();
  }
  normalized = normalized
    .replace(/^[-:：、。・\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized.length < 18) return "";
  if (/続きを読む|詳細はこちら|関連リンク|この記事は/.test(normalized)) return "";
  if (isWeakGeneratedSummary(normalized, title)) return "";
  return trimSentence(normalized, 82);
}

function trimSentence(value, maxLength = 82) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/[、。・,:：\s]+$/u, "") + "…";
}

function normalizeSignalSummary(signal) {
  const title = trimSourceSuffix(signal?.title);
  const description = stripHtml(String(signal?.description ?? "")).trim();
  if (description) {
    const remainder = description.startsWith(title) ? description.slice(title.length).trim() : description;
    const candidate = remainder.length >= 18 ? remainder : description;
    if (isWeakGeneratedSummary(candidate, title)) return "";
    return candidate.slice(0, 120) + (candidate.length > 120 ? "…" : "");
  }
  return summarizeFromTitle(title, inferPrimaryCategory(signal?.title, signal?.description, signal?.categoryHint));
}

function buildRelatedKeywords(title, categories, signals) {
  const tokens = new Set();
  const categoryLabels = categories.map((category) => CATEGORY_STYLES[category]?.label).filter(Boolean);
  categoryLabels.forEach((label) => tokens.add(label));

  extractKeywordTokens(title).forEach((token) => tokens.add(token));
  for (const signal of signals.slice(0, 3)) {
    extractKeywordTokens(`${signal.title ?? ""} ${signal.description ?? ""}`).forEach((token) => tokens.add(token));
    if (tokens.size >= 8) break;
  }

  return [...tokens].slice(0, 8);
}

function extractKeywordTokens(value) {
  const rawTokens = String(value ?? "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[【】「」『』（）()]/g, " ")
    .split(/[\s/・,、。!！?？:：]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 18);

  return [...new Set(rawTokens.filter((token) => !/^(速報|続報|話題|ニュース|記事|公開|発表|開始|決定|最新)$/.test(token)))];
}

function formatRelativeTime(value, nowDate) {
  if (!value) return "直近";
  const diffMs = new Date(nowDate).getTime() - new Date(value).getTime();
  const diffHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
  if (diffHours < 1) return "1時間以内";
  if (diffHours < 24) return `${diffHours}時間前`;
  return `${Math.floor(diffHours / 24)}日前`;
}

function formatSignalDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時刻不明";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractStableId(signal) {
  const source = String(signal?.url ?? "").toLowerCase();
  const normalizedSourcePath = normalizeSignalUrlId(source);
  const titleSuffix = trimSourceSuffix(signal.title)
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "topic";
  return `${titleSuffix}-${normalizedSourcePath || "topic"}`.slice(0, 180);
}

function normalizeSignalUrlId(url) {
  const value = String(url ?? "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return `${host}${path}`.replace(/\/$/, "").replace(/[^a-z0-9/.\-_]/g, "-");
  } catch {
    return "";
  }
}

function dedupeSignals(signals) {
  const deduped = new Map();
  for (const signal of signals) {
    const urlKey = String(signal?.url ?? "").trim();
    const titleKey = normalizeSignalIdentity(signal);
    const key = titleKey || urlKey;
    if (!key) continue;
    const current = deduped.get(key);
    if (!current || signalTimestamp(signal) > signalTimestamp(current)) {
      deduped.set(key, signal);
    }
  }
  return [...deduped.values()];
}

function normalizeSignalIdentity(signal) {
  const source = String(signal?.sourceName ?? signal?.source ?? "").replace(/google news\s*\/\s*/i, "").toLowerCase().trim();
  const title = trimSourceSuffix(signal?.title)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/[【】「」『』]/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title ? `${source}::${title}` : "";
}

function shouldKeepSignal(signal) {
  const title = trimSourceSuffix(signal.title);
  const description = stripHtml(String(signal.description ?? ""));
  const sourceName = String(signal.sourceName ?? signal.source ?? "");
  const sourceUrl = String(signal.url ?? "");
  const value = `${title} ${description} ${sourceName} ${sourceUrl}`.toLowerCase();

  if (!title) return false;
  if (title.length < 8) return false;
  if (isPromotionalSignalValue(value)) return false;

  if (signal.source === "Google News") {
    if (isLowSignalGoogleNewsTitle(title, value)) return false;
  }

  return true;
}

function isLowSignalGoogleNewsTitle(title, value) {
  if (/を楽しむ人たち|参加者募集|教室について|おしらせ|のお知らせ|開催のお知らせ|開催しました|開催されました/.test(title)) {
    return true;
  }

  const softFeaturePattern = /楽しむ|体験|教室|講習会|フェア|イベント|ワークショップ|募集|来場|開催|オープン|特集|コラム|ランキング|キャンペーン|グルメ|観光/;
  const hardNewsPattern = /速報|発表|判明|逮捕|決定|合意|協議|会見|選挙|事故|地震|戦況|決算|株価|生成ai|openai|nvidia|microsoft|google|apple|移籍|優勝|開幕|公開|配信|値上げ|関税|法案|抽選|発売/;

  if (softFeaturePattern.test(title) && !hardNewsPattern.test(value)) {
    return true;
  }

  return false;
}

function isPromotionalSignalValue(value) {
  return /(pr times|共同通信prワイヤー|valuepress|＠press|atpress|dream news|ドリームニュース|newscast|プレスリリース|スポンサー|タイアップ|広告|advertorial)/i.test(value)
    || /(対応を正式スタート|正式スタート|提供開始|サービス開始|販売開始|発売開始|導入開始|実施開始|キャンペーン開始|開催決定)/.test(value)
    || /(累計動画|累計導入|導入実績|掲載実績|利用者数|フォロワー数|満足度|受賞歴|売上no\.?1|シェアno\.?1)/i.test(value)
    || /(セミナー|講演会|説明会|体験会|講習会|ワークショップ|初級クラス|受講者募集|参加者募集)/.test(value)
    || /(地元の魅力をアピール|観光pr|地域pr|やってみた|首長と○○やってみた)/.test(value)
    || /(トークセッションを開催|対談しました|本学の学生|meijo-u\.ac\.jp|大学公式サイト)/i.test(value);
}

function clusterSignals(signals) {
  const map = new Map();

  for (const signal of signals) {
    const key = clusterKeyFor(signal);
    const current = map.get(key);
    if (!current) {
      map.set(key, { key, signals: [signal] });
      continue;
    }

    current.signals.push(signal);
    current.signals.sort((left, right) => signalTimestamp(right) - signalTimestamp(left));
  }

  return [...map.values()].sort((left, right) => signalTimestamp(right.signals[0]) - signalTimestamp(left.signals[0]));
}

function clusterKeyFor(signal) {
  return normalizeTopicFingerprint(trimSourceSuffix(signal.title))
    .replace(/\b(速報|動画|写真|news|ニュース)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTopicFingerprint(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/[【】「」『』]/g, " ")
    .replace(/（[^）]*?新聞[^）]*?）/g, " ")
    .replace(/（[^）]*?ニュース[^）]*?）/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[a-z0-9]{8,}\b/g, " ")
    .replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ");
}

function uniqueCategories(categories) {
  return [...new Set(categories.filter(Boolean))];
}

function inferTextCategories(title = "", description = "") {
  const value = `${stripHtml(String(title ?? ""))} ${stripHtml(String(description ?? ""))}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/g, " ");
  const categories = [];
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(value)) categories.push(rule.key);
  }
  return normalizeCategoryMix(uniqueCategories(categories), value);
}

function signalTimestamp(signal) {
  const time = new Date(signal.publishedAt ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function keywordBoost(signal) {
  const value = `${signal.title ?? ""} ${signal.description ?? ""}`.toLowerCase();
  if (/fanza|dlsite|dmm/.test(value) && /セール|キャンペーン|割引|クーポン|期間限定/.test(value)) return 18;
  if (/セール|キャンペーン|割引|クーポン|期間限定/.test(value)) return 6;
  return 0;
}

function broadInterestBoost(categories, value) {
  let score = 0;
  if (categories.some((category) => ["crime", "world", "politics", "business", "sports", "games", "entertainment", "sns"].includes(category))) score += 8;
  if (/(地震|大雨|台風|避難|事故|火災|強盗|殺人|逮捕|国会|首相|選挙|関税|値上げ|物価|株価|決算|iphone|switch|ps5|steam|任天堂|大谷|ドジャース|jリーグ|ワンピース|鬼滅|ガンダム|ジブリ|fanza|dlsite|セール)/.test(value)) score += 10;
  if (/(アイドル|俳優|女優|芸人|歌手|vtuber|声優|人気ゲーム|人気アニメ|大型セール|抽選販売|入手困難)/.test(value)) score += 8;
  return score;
}

function interactionBoost(value) {
  let score = 0;
  if (/(コメント|反応|炎上|称賛|悲鳴|ざわつく|騒然|大反響|拡散|バズ|話題騒然)/.test(value)) score += 10;
  if (/(トレンド入り|急上昇|検索急増|検索需要|抽選倍率)/.test(value)) score += 8;
  return score;
}

function mediaDiversityBoost(signals) {
  const sources = new Set(signals.map((signal) => String(signal.sourceName ?? signal.source ?? "").replace(/google news\s*\/\s*/i, "").trim().toLowerCase()).filter(Boolean));
  return Math.min(14, Math.max(0, sources.size - 1) * 4);
}

function sourceAuthorityBoost(signals) {
  let score = 0;
  const normalizedSources = signals.map((signal) => String(signal.sourceName ?? signal.source ?? "").toLowerCase());
  const joinedSources = normalizedSources.join(" ");

  if (/\bnhk\b/.test(joinedSources)) score += 12;
  if (/yahoo!ニュース|yahoo news/.test(joinedSources)) score += 8;
  if (/共同通信|時事通信|日経|朝日|毎日|読売|産経|bloomberg|reuters|ロイター|ap\b/.test(joinedSources)) score += 8;
  if (signals.length === 1 && normalizedSources.every((value) => value.includes("google news"))) score -= 10;
  if (signals.length >= 2 && normalizedSources.some((value) => value.includes("google news")) && (/\bnhk\b|yahoo!ニュース|yahoo news/.test(joinedSources))) score += 4;

  return score;
}

function nichePenalty(categories, value, signals) {
  let penalty = 0;
  if (signals.length <= 1) penalty += 8;
  if (/(担当者に聞く|特集|連載|コラム|教室|講習会|講座|イベント情報|来場者|募集開始|開催のお知らせ|観光|地域おこし)/.test(value)) penalty += 12;
  if (/(新商品発売|販売開始|新発売|予約開始)/.test(value) && !/(抽選|完売|入手困難|話題|炎上)/.test(value)) penalty += 8;
  if (isPromotionalSignalValue(value)) penalty += 34;
  if (/(地域対応|エリア対応|特設サイト|キャンペーンページ|申込受付|申し込み受付|参加受付|受講者募集)/.test(value)) penalty += 12;
  if (isStronglyLocalTopic(value) && !categories.includes("crime") && !categories.includes("world")) penalty += 10;
  if (categories.includes("books") && !/(受賞|話題|炎上|人気|売上|ランキング)/.test(value)) penalty += 5;
  if (categories.includes("business") && /(決算速報|1q|2q|3q|4q)/.test(value) && signals.length <= 1) penalty += 8;
  if (signals.length === 1 && signals.every((signal) => String(signal.source ?? "").toLowerCase() === "google news")) penalty += 8;
  if (isLowInformationTopic(value)) penalty += 18;
  return penalty;
}

function isStronglyLocalTopic(value) {
  return (/(市役所|町役場|村役場|県庁|商工会|道の駅|地域おこし|観光協会|地元|県内|市内|町内|村内)/.test(value)
    || /(青森|岩手|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)/.test(value))
    && !/(東京|全国|日本代表|国会|内閣|日銀)/.test(value);
}

function isLowInformationTopic(value) {
  return value.length < 20 || /^(あいさつする|コメントする|登壇する|公開した|出席した|紹介した)\b/.test(value);
}

function summarizeFromTitle(title, category) {
  return "";
}

function isWeakGeneratedSummary(summary, title = "") {
  const text = String(summary ?? "").replace(/\s+/g, " ").trim();
  const compactTitle = String(title ?? "").replace(/^【[^】]+】\s*/u, "").trim();
  if (!text) return true;
  if (/に関する話題。?$|が明らかになり、?話題になっている。?$|がきょうの注目話題として取り上げられている。?$|を伝える話題。?$/.test(text)) return true;
  if (compactTitle && (text === compactTitle || text === `${compactTitle}。`)) return true;
  return false;
}

function normalizeCategoryMix(categories, value) {
  const next = [...categories];

  if (next.includes("crime") && next.includes("adult")) {
    const isSaleContext = /fanza|dlsite|dmm|セール|キャンペーン|割引|クーポン|期間限定/.test(value);
    if (!isSaleContext) {
      return next.filter((category) => category !== "adult");
    }
  }

  if (next.includes("crime") && next.includes("entertainment")) {
    const hasCrimeDominantContext = /逮捕|送検|起訴|判決|容疑|家宅捜索|警視庁|県警/.test(value);
    if (hasCrimeDominantContext) {
      return next.filter((category) => category !== "entertainment");
    }
  }

  return next;
}
