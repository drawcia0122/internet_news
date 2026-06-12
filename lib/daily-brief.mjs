import { pickThumbnailFromItem } from "./thumbnail-utils.mjs";

const MAX_BRIEF_ITEMS = 5;
const IMPORTANT_NEWS_THRESHOLD = 80;
const PRIMARY_WINDOW_HOURS = 24;
const EXTENDED_WINDOW_HOURS = 72;

const CATEGORY_LABELS = {
  general: "その他",
  tech: "テック",
  business: "経済",
  politics: "政治",
  entertainment: "エンタメ",
  games: "ゲーム",
  manga: "漫画",
  books: "本",
  sports: "スポーツ",
  sns: "SNS",
  "net-culture": "ネットカルチャー",
  matome: "2chまとめ系",
  crime: "犯罪・事件",
  adult: "アダルト系",
  world: "国際",
};

export function buildDailyBrief({ currentItems = [], archiveItems = [], generatedAt = null } = {}) {
  const now = new Date(generatedAt ?? new Date());
  const currentIds = new Set(currentItems.map((item) => item?.id).filter(Boolean));
  const currentScoredItems = dedupeById(currentItems)
    .map((item) => normalizeItem(item, currentIds))
    .map((item) => scoreDailyBriefItem(item, now))
    .filter((item) => isEligibleForBrief(item))
    .map((item) => ({ ...item, thirtySecondSummary: buildThirtySecondSummary(item) }))
    .filter((item) => item.thirtySecondSummary)
    .sort((left, right) => {
      return right.visualPriority - left.visualPriority
        || right.finalScore - left.finalScore
        || right.importanceScore - left.importanceScore;
    });
  const archiveScoredItems = dedupeById(archiveItems)
    .filter((item) => !currentIds.has(item?.id))
    .map((item) => normalizeItem(item, currentIds))
    .map((item) => scoreDailyBriefItem(item, now))
    .filter((item) => isEligibleForBrief(item))
    .map((item) => ({ ...item, thirtySecondSummary: buildThirtySecondSummary(item) }))
    .filter((item) => item.thirtySecondSummary)
    .sort((left, right) => {
      return right.visualPriority - left.visualPriority
        || right.finalScore - left.finalScore
        || right.importanceScore - left.importanceScore;
    });
  const scoredItems = [...currentScoredItems, ...archiveScoredItems];

  const items = scoredItems.slice(0, MAX_BRIEF_ITEMS).map((item, index) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    categoryLabel: categoryLabelFor(item.category),
    thumbnailUrl: pickThumbnailFromItem(item),
    thumbnail: pickThumbnailFromItem(item),
    publishedAt: item.publishedAt,
    publishedLabel: formatPublishedLabel(item.publishedAt),
    importanceScore: item.importanceScore,
    decayRate: item.decayRate,
    finalScore: item.finalScore,
    tone: index === 0 ? "最重要ニュース" : index < 3 ? "注目ニュース" : "話題ニュース",
    scoreReasons: item.scoreReasons,
    thirtySecondSummary: item.thirtySecondSummary,
    background: buildBackground(item),
    whyHot: buildWhyHot(item),
    whyRead: buildWhyRead(item),
    impact: buildImpact(item),
    watchpoints: buildWatchpoints(item),
    primaryLink: buildPrimaryLink(item),
    relatedLinks: buildRelatedLinks(item),
  }));

  return {
    generatedAt: now.toISOString(),
    items,
  };
}

function normalizeItem(item, currentIds = new Set()) {
  const sourceSignals = Array.isArray(item.sourceSignals) ? item.sourceSignals : [];
  const searchLinks = Array.isArray(item.searchLinks) ? item.searchLinks : [];
  const publishedAt = sourceSignals[0]?.publishedAt ?? item.publishedAt ?? item.capturedAt ?? null;
  const categories = Array.isArray(item.categories) && item.categories.length ? item.categories : [item.category ?? "general"];
  const thumbnailUrl = pickThumbnailFromItem(item);
  return {
    ...item,
    category: item.category ?? categories[0] ?? "general",
    categories,
    sourceSignals,
    searchLinks,
    publishedAt,
    thumbnailUrl,
    thumbnail: thumbnailUrl,
    isCurrentItem: currentIds.has(item?.id),
    briefSummary: normalizeText(item.briefSummary),
    summary: normalizeText(item.summary),
  };
}

function scoreDailyBriefItem(item, now) {
  const ageHours = calculateAgeHours(item.publishedAt, now);
  const sourceSignals = item.sourceSignals ?? [];
  const combinedText = `${item.title ?? ""} ${item.summary ?? ""} ${sourceSignals.map((signal) => signal.title ?? "").join(" ")}`.toLowerCase();
  const reasons = [];
  let importanceScore = 0;

  if (sourceSignals.length > 1 || Number(item.posts ?? 1) > 1) {
    importanceScore += 25;
    reasons.push("複数メディアが継続報道");
  }

  if (/(速報|続報|判明|発表|会見|更新|緊急|速報版)/.test(combinedText)) {
    importanceScore += 20;
    reasons.push("速報・続報性が高い");
  }

  if (hasHighImpactCategory(item, combinedText)) {
    importanceScore += 20;
    reasons.push("生活や制度への影響が大きい");
  }

  if (/(sns|x|twitter|bluesky|reddit|話題|炎上|トレンド|バズ)/.test(combinedText) || item.categories.includes("sns")) {
    importanceScore += 15;
    reasons.push("SNS上の反応が大きい");
  }

  if (hasOfficialSignal(item, combinedText)) {
    importanceScore += 15;
    reasons.push("公的機関・企業・公式発表ベース");
  }

  const recencyScore = ageHours <= 6 ? 10 : ageHours <= 12 ? 8 : ageHours <= 24 ? 6 : ageHours <= 48 ? 3 : 1;
  importanceScore += recencyScore;
  reasons.push("公開時刻が新しい");

  const decayRate = ageHours <= 24 ? 1 : ageHours <= 48 ? 0.5 : ageHours <= 72 ? 0.25 : 0;
  const finalScore = Math.round(importanceScore * decayRate);
  const visualPriority = finalScore
    + (item.isCurrentItem ? 6 : 0)
    + (item.thumbnailUrl ? 3 : 0);

  return {
    ...item,
    importanceScore,
    decayRate,
    finalScore,
    visualPriority,
    ageHours,
    scoreReasons: reasons,
  };
}

function isEligibleForBrief(item) {
  if (item.decayRate === 0) return false;
  if (item.ageHours <= PRIMARY_WINDOW_HOURS) return true;
  return item.ageHours <= EXTENDED_WINDOW_HOURS && item.importanceScore >= IMPORTANT_NEWS_THRESHOLD;
}

function hasHighImpactCategory(item, text) {
  if (item.categories.some((category) => ["politics", "business", "crime", "world"].includes(category))) return true;
  return /(地震|大雨|台風|制度|法案|増税|減税|選挙|物価|年金|医療|補助金|電気代|ガソリン)/.test(text);
}

function hasOfficialSignal(item, text) {
  if (/(政府|首相|省|庁|県|市|町|村|裁判所|警視庁|県警|日銀|公式|発表)/.test(text)) return true;
  return (item.sourceSignals ?? []).some((signal) => /(nhk|政府|日銀|公式)/i.test(signal.sourceName ?? ""));
}

function buildThirtySecondSummary(item) {
  const candidates = collectSummaryCandidates(item);
  const rankedCandidate = candidates
    .map((candidate) => ({ candidate, score: scoreThirtySecondCandidate(candidate, item) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)[0];

  if (rankedCandidate) {
    const fromCandidate = finalizeThirtySecondSummary(rankedCandidate.candidate, item);
    const summaryText = sanitizeThirtySecondSummaryText(fromCandidate);
    if (summaryText) return summaryText;
  }

  const fallback = synthesizeBriefSummary(item);
  if (fallback && !isGenericBriefExplanation(fallback)) {
    const fallbackValue = sanitizeThirtySecondSummaryText(finalizeThirtySecondSummary(fallback, item));
    if (fallbackValue) return fallbackValue;
  }
  return "";
}

function sanitizeThirtySecondSummaryText(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const sanitized = text
    .replace(/複数媒体(?:が|で)同一テーマを扱っており、情報の更新が早い。?/gu, "")
    .replace(/[。]*?[^。]*複数媒体が同じテーマを追っており、継続報道の局面に入っている。?/gu, "")
    .replace(/^\s*[,、\s]+|[,、\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return sanitized;
}

function buildBackground(item) {
  const categoryLabel = categoryLabelFor(item.category);
  if (item.sourceSignals.length > 1) {
    return `${categoryLabel}分野で複数媒体が同じテーマを追っており、継続報道の局面に入っている。`;
  }
  return backgroundByCategory(item.category);
}

function buildWhyHot(item) {
  if (item.scoreReasons.length) return item.scoreReasons.join("、") + "ため。";
  return "複数の観点で注目度が高いため。";
}

function buildWhyRead(item) {
  const category = item.category;
  if (category === "politics") return "制度変更や政治判断が、生活や今後の政策に直結する可能性があるため。";
  if (category === "business") return "家計、価格、雇用、投資環境などへの波及を早めに把握できるため。";
  if (category === "crime") return "事件の深刻度や捜査の進展が、地域の安全認識に関わるため。";
  if (category === "world") return "国際情勢の変化が市場や安全保障へ影響するため。";
  if (category === "tech") return "新製品や技術動向がサービス利用や仕事環境に波及しやすいため。";
  return "話題の核心を短時間で把握し、関連ニュースを追う優先順位を付けやすくなるため。";
}

function buildImpact(item) {
  const category = item.category;
  if (category === "politics") return "政策の実施時期や対象範囲次第で、制度や負担感に影響する可能性がある。";
  if (category === "business") return "価格や企業活動、市場センチメントに影響する可能性がある。";
  if (category === "crime") return "捜査や処分の行方が、地域の安全意識や再発防止策の議論につながる。";
  if (category === "world") return "為替、エネルギー価格、安全保障など広い領域へ波及する可能性がある。";
  if (category === "adult") return "セールやキャンペーン系なら購買判断に、事件系ならコンテンツ業界の見られ方に影響する。";
  return "関連分野の次の動きや周辺ニュースの見え方に影響する。";
}

function buildWatchpoints(item) {
  const title = String(item.title ?? "");
  if (/法案|制度|施行|方針/.test(title)) return "施行時期、対象範囲、追加説明の有無。";
  if (/逮捕|送検|起訴|判決/.test(title)) return "捜査の進展、起訴判断、関係者の説明。";
  if (/決算|株価|上場|投資/.test(title)) return "次回の業績見通し、市場の反応、同業他社への波及。";
  if (/地震|大雨|台風|避難/.test(title)) return "被害範囲、交通・物流への影響、追加の警報情報。";
  if (/セール|キャンペーン|割引|クーポン/.test(title)) return "終了日時、対象作品、割引率、併用条件。";
  return "追加発表、関連当事者のコメント、次の続報。";
}

function buildPrimaryLink(item) {
  const signal = item.sourceSignals[0];
  if (signal?.url) {
    return {
      label: signal.sourceName ?? signal.source ?? "元記事",
      url: signal.url,
    };
  }
  const link = item.searchLinks[0];
  return link ? { label: link.label ?? "関連リンク", url: link.url } : null;
}

function buildRelatedLinks(item) {
  const links = [];
  for (const signal of (item.sourceSignals ?? []).slice(1, 4)) {
    if (!signal?.url) continue;
    links.push({
      label: signal.sourceName ?? signal.source ?? "関連記事",
      url: signal.url,
    });
  }
  if (!links.length) {
    for (const link of (item.searchLinks ?? []).slice(0, 2)) {
      if (!link?.url) continue;
      links.push({
        label: link.label ?? "関連記事",
        url: link.url,
      });
    }
  }
  return links;
}

function summarizeFromTitle(title, category) {
  const compactTitle = String(title ?? "").replace(/^【[^】]+】\s*/u, "").trim();
  if (!compactTitle) return "重要ニュースの要点を整理中。";
  if (category === "adult" && /fanza|dlsite|dmm/i.test(compactTitle)) {
    return `${compactTitle} が出ており、購入判断に直結する情報として注目されている。`;
  }
  if (/逮捕|書類送検|送検|起訴|判決/.test(compactTitle)) return `${compactTitle} として報じられており、事件の進展が注目されている。`;
  if (/発表|決定|開始|公開|発売|配信/.test(compactTitle)) return `${compactTitle} が明らかになり、関係分野で注目が集まっている。`;
  return `${compactTitle} がきょうの注目話題として取り上げられている。`;
}

function backgroundByCategory(category) {
  if (category === "politics") return "政策や制度の方向性が見え始める局面で、今後の判断材料として関心が集まっている。";
  if (category === "business") return "企業・市場・物価の動きとして受け止められ、生活や投資への影響が意識されている。";
  if (category === "crime") return "事件・捜査の進展として報じられており、事実関係と責任の所在が焦点になっている。";
  if (category === "world") return "国際情勢の変化として継続的に追う必要があるテーマ。";
  if (category === "tech") return "技術や製品の更新が利用者や企業活動へ波及する可能性がある。";
  return "関連分野の動きを短時間で把握する入口として押さえておきたい話題。";
}

function categoryLabelFor(category) {
  return CATEGORY_LABELS[category] ?? "その他";
}

function formatPublishedLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時刻不明";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function calculateAgeHours(value, now) {
  const time = new Date(value ?? 0).getTime();
  if (Number.isNaN(time)) return 9999;
  return Math.max(0, (now.getTime() - time) / (1000 * 60 * 60));
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isUsefulSummary(summary) {
  if (!summary) return false;
  return !/に関する話題。$/.test(summary);
}

function collectSummaryCandidates(item) {
  const candidates = [
    item.briefSummary,
    item.summary,
    ...(item.sourceSignals ?? []).flatMap((signal) => [
      signal?.briefSummary,
      signal?.summary,
    ]),
    ...extractSignalTextCandidates(item.sourceSignals),
  ];
  return candidates
    .map((candidate) => normalizeSummaryCandidate(candidate, item.title))
    .filter(Boolean);
}

function extractSignalTextCandidates(signals = []) {
  return (Array.isArray(signals) ? signals : [])
    .map((signal) => signal?.title)
    .filter(Boolean)
    .filter((title) => String(title).trim().length > 6)
    .slice(0, 10);
}

function scoreThirtySecondCandidate(candidate, item) {
  if (!candidate || !isInformativeSummaryCandidate(candidate, item.title)) return 0;
  let score = 0;
  const length = candidate.length;
  if (length >= 52 && length <= 170) score += 20;
  else if (length > 170) score += 10;
  else score += 6;

  const sentenceCount = (candidate.match(/[。！？]/g) || []).length;
  if (sentenceCount >= 1) score += 8;
  if (sentenceCount >= 2) score += 6;

  if (/逮捕|殺害|死亡|発見|事故|炎上|会見|発表|報じ|提案|開発|発売|会談|続報|捜査|判決/.test(candidate)) score += 10;
  if (/(事件|政治|経済|制度|選挙|災害|価格|株価|ゲーム|配信|事件|捜査)/.test(candidate)) score += 8;
  if (/\d/.test(candidate)) score += 5;
  if (item.sourceSignals?.length > 1) score += 2;
  if (item.scoreReasons?.length) score += Math.min(10, item.scoreReasons.length * 2);
  return score;
}

function normalizeSummaryCandidate(value, title) {
  let text = normalizeText(value);
  if (!text) return "";

  text = text
    .replace(/^Comprehensive up-to-date news coverage, aggregated from sources all over the world by Google News\.?$/iu, "")
    .replace(/^View the latest[^.]+from Google News\.?$/iu, "")
    .replace(/(日本経済新聞|毎日新聞|読売新聞|朝日新聞|産経新聞|共同通信|時事通信|ロイター|Reuters|Yahoo!ファイナンス|Yahoo!ニュース|日経BP|長崎新聞ホームページ)\s*$/u, "")
    .replace(/[…。]+$/u, "")
    .replace(/\s*を伝える話題。?$/u, "")
    .replace(/\s*に関する話題。?$/u, "")
    .replace(/\s*を(めぐる|中心に|きっかけで)?まとめた.*$/u, "")
    .replace(/\s*(?:詳細は|内容は|事件の詳しい|原因は|結果は|詳細)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  const cleanedTitle = stripLeadingHeadline(title, text);
  if (cleanedTitle && isProbablySourceTail(cleanedTitle)) return "";
  const normalized = cleanedTitle || text;
  if (/^がきょうの注目話題として取り上げられている。?$/u.test(normalized)) return "";
  if (/^が明らかになり、?話題になっている。?$/u.test(normalized)) return "";
  if (/^として報じられており、?事件の進展が注目されている。?$/u.test(normalized)) return "";
  if (isGenericBriefExplanation(normalized)) return "";
  return normalized;
}

function isInformativeSummaryCandidate(summary, title) {
  if (!summary || summary.length < 24) return false;
  if (/Comprehensive up-to-date news coverage|View the latest|がきょうの注目話題として取り上げられている|が明らかになり、?話題になっている|として報じられており、?事件の進展が注目されている/.test(summary)) return false;
  if (isGenericBriefExplanation(summary)) return false;
  const summaryFp = fingerprint(summary);
  const titleFp = fingerprint(title);
  const compactTitleFp = fingerprint(compactHeadline(title));
  if (!summaryFp || !titleFp) return false;
  if (summaryFp === titleFp) return false;
  if (compactTitleFp && summaryFp === compactTitleFp) return false;
  if (summaryFp.includes(titleFp) && summaryFp.length - titleFp.length < 24) return false;
  if (compactTitleFp && summaryFp.includes(compactTitleFp) && summaryFp.length - compactTitleFp.length < 24) return false;
  if (/^(速報|注目|話題|きょう|今日)/.test(summary)) return false;
  if (!summaryAddsDetail(summary, title)) return false;
  return true;
}

function finalizeThirtySecondSummary(summary, item) {
  return compressBriefSummary(summary, item) || "";
}

function synthesizeBriefSummary(item) {
  const title = normalizeText(item.title);
  const compactTitle = title.replace(/^【[^】]+】\s*/u, "").trim();
  const location = extractLocation(compactTitle);
  const categories = item.categories ?? [item.category];
  const value = `${compactTitle} ${item.summary ?? ""}`.toLowerCase();
  const coreTitle = extractCoreTitlePhrase(compactTitle);
  const withNumber = compactTitle.match(/([0-9０-９一二三四五六七八九十兆億万千百\d]+[％%]?(?:万|千|百万|億|株|円|件|人)?)/u);
  const numberText = withNumber ? withNumber[1] : "";
  const mentionDate = compactTitle.match(/([0-9]+日|本日|きょう|昨日|今朝|今後|先週|来週|今夜)/u)?.[0] ?? "";

  if (/市況|株価|株式|相場|値上がり|値下がり|指数/.test(compactTitle)) {
    return `${compactTitle} の値動きが更新されており、市場の受け止めを追う価値があります。`;
  }

  if (/(答弁|訂正|首相|内閣|閣僚|国会|官房|与党|政府|首相|首相秘書)/u.test(compactTitle)) {
    return `${coreTitle}の報道を受け、政治的な説明と対応を確認する意味で注目されています。${mentionDate ? ` (${mentionDate})` : ""}`.trim();
  }

  if (categories.includes("crime") || item.category === "crime") {
    if (/遺体/.test(compactTitle)) {
      return `${location || "現場"}で遺体が見つかり、事件性の有無を含めた捜査が進められている。`;
    }
    if (/逮捕|送検|起訴/.test(compactTitle)) {
      return `事件の関係者が逮捕・送検されたか、捜査が大きく進展した可能性がある。`;
    }
    if (/詐欺|投資詐欺|ロマンス詐欺/.test(value)) {
      return `詐欺被害や捜査の進展が報じられており、被害の広がりや手口への関心が高まっている。`;
    }
    return `事件や捜査の進展に関する新しい情報が出ており、事実関係の確認が進められている。`;
  }

  if (categories.includes("politics") || item.category === "politics") {
    if (/法案|制度|規制|改正/.test(value)) return `制度やルールに関わる新しい動きがあり、今後の影響範囲に注目が集まっています。`;
    return `${coreTitle}が話題になっており、続報の方向性を追う必要があります。`;
  }

  if (categories.includes("business") || item.category === "business") {
    if (/上場|ipo|ロックアップ|自社株買い|株買い|株価|株探|株券/.test(value)) {
      const subject = compactTitle.length > 20 ? compactTitle : "該当企業";
      return `${subject}の報道を受け、${numberText ? `${numberText}規模の材料` : "関連市場への材料"}として注目されています。${mentionDate ? ` (${mentionDate})` : ""}`.trim();
    }
    if (/決算|株価|市況|市場|金利/.test(value)) {
      return `${compactTitle}の発表を受けて、経済指標・市場判断の材料として反応の推移が注目されています。`;
    }
    if (/値上げ|価格|物価|関税|補助金/.test(value)) {
      return `価格やコストに関わる新しい動きがあり、家計や企業活動への影響に関心が集まっている。`;
    }
    return `企業や市場に関する新しい発表や動きがあり、今後の影響が注目されている。`;
  }

  if (categories.includes("tech") || item.category === "tech") {
    if (/半導体|ai|生成ai|gpu|データセンター/.test(value)) return `AIや半導体をめぐる新しい動きがあり、関連業界や競争環境への影響が注目されている。`;
    return `技術開発や製品動向に新しい進展があり、関連業界や利用者への影響が注目されている。`;
  }

  if (categories.includes("games") || item.category === "games") {
    if (/switch|ps5|steam|任天堂|抽選|倍率|発売/.test(value)) return `人気ゲーム機やタイトルに新しい情報が出ており、入手難易度や発売動向への関心が高まっている。`;
    return `ゲームや関連サービスをめぐる新しい発表があり、ユーザーの反応が広がっている。`;
  }

  if (categories.includes("sports") || item.category === "sports") {
    if (/大谷|ドジャース|mlb|代表|w杯|日本代表/.test(value)) return `注目選手や代表をめぐる新しい動きがあり、試合結果や起用判断に関心が集まっている。`;
    return `試合結果や選手・代表をめぐる新しい動きがあり、ファンや関係者の関心が集まっている。`;
  }

  if (categories.includes("entertainment") || categories.includes("manga") || categories.includes("books")) {
    if (/アニメ化|映画化|ドラマ化|キャスト発表|放送/.test(value)) return `作品の映像化や出演情報に新しい発表があり、ファンの期待が高まっている。`;
    return `作品や出演者をめぐる新しい発表があり、ファンの反応が広がっている。`;
  }

  if (categories.includes("adult") || item.category === "adult") {
    if (/セール|キャンペーン|割引|クーポン/.test(value)) {
      return `大型セールやキャンペーンの情報が出ており、対象作品や割引内容に関心が集まっている。`;
    }
    return `関連コンテンツや人物をめぐる話題が広がっており、ネット上で反応が集まっている。`;
  }

  if (categories.includes("sns") || categories.includes("net-culture") || item.category === "sns") {
    if (/炎上|拡散|バズ|トレンド入り/.test(value)) return `SNSでの拡散や反響が大きく、ネット上で一気に注目が集まっている。`;
    return `SNSやネット上で反応が広がっており、短時間で注目を集めている。`;
  }

  return buildFallbackBriefSummary(compactTitle);
}

function buildFallbackBriefSummary(title) {
  const cleaned = String(title ?? "")
    .replace(/^【[^】]+】\s*/u, "")
    .replace(/^(速報|特報|材料|市況)[:：\s]*/u, "")
    .replace(/[「」]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "主要ニュースの進展が報じられており、内容確認が必要です。";
  return `${cleaned}に関する報道が複数あり、影響範囲と今後の続報を確認する価値があります。`;
}

function extractCoreTitlePhrase(title) {
  const cleaned = String(title ?? "")
    .replace(/^【[^】]+】\s*/u, "")
    .replace(/^(速報|特報|材料|市況)[:：\s]*/u, "")
    .replace(/。+$/u, "")
    .trim();
  if (!cleaned) return "関連報道";
  const parts = cleaned.split(/[、，,]/).filter(Boolean).map((item) => item.trim());
  const byComma = parts.length >= 2 ? `${parts[0]}、${parts[1]}` : parts[0];
  const byDash = byComma.split(/-+/u)[0].trim();
  return byDash || cleaned;
}

function buildAttentionSentence(item) {
  if (item.scoreReasons.includes("複数メディアが継続報道")) {
    return "複数の媒体が続報を出しており、関心が高まっている。";
  }
  if (item.scoreReasons.includes("SNS上の反応が大きい")) {
    return "SNSでも反応が広がっている。";
  }
  if (item.scoreReasons.includes("生活や制度への影響が大きい")) {
    return "生活や制度への影響が大きい可能性がある。";
  }
  if (item.scoreReasons.includes("公的機関・企業・公式発表ベース")) {
    return "公式発表ベースの情報として注目されている。";
  }
  return "";
}

function trimToSentence(value, maxLength = 110) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return ensureSentence(text);
  return ensureSentence(text.slice(0, maxLength).replace(/[、。・,:：\s]+$/u, ""));
}

function ensureSentence(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return /[。！？]$/.test(text) ? text : `${text}。`;
}

function stripLeadingHeadline(title, summary) {
  const normalizedTitle = normalizeText(String(title ?? ""));
  const compactTitle = normalizedTitle.replace(/^【[^】]+】\s*/u, "").trim();
  const candidates = [normalizedTitle, compactTitle].filter(Boolean);
  for (const candidate of candidates) {
    if (summary.startsWith(candidate)) {
      return summary.slice(candidate.length).replace(/^[-:：、。・\s]+/, "").trim();
    }
  }
  return summary;
}

function compactHeadline(title) {
  return normalizeText(String(title ?? ""))
    .replace(/^【[^】]+】\s*/u, "")
    .replace(/\s*[（(][^)）]{1,40}[)）]\s*$/u, "")
    .trim();
}

function isProbablySourceTail(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (text.length <= 24) return true;
  return /^(nhk|bbc|cnn|reuters|ロイター|毎日新聞|朝日新聞|読売新聞|産経新聞|共同通信|時事通信|株探|yahoo!ニュース|at-s\.com|bcnr|pr times|日経bp|itmedia)/i.test(text);
}

function isGenericBriefExplanation(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return [
    /企業や経済に関する新しい発表があり、今後の影響が注目されている/u,
    /政権や国会をめぐる新しい動きがあり、今後の説明や判断に注目が集まっている/u,
    /政府や与野党の動きに新しい展開があり、今後の説明や判断に注目が集まっている/u,
    /遺体が見つかり、警察が事件と事故の両面から状況確認を進めている/u,
    /事件や捜査に関する新しい情報が出ており、事実関係の確認が進められている/u,
    /警察の捜査が進み、逮捕や送検など新しい動きが出ている/u,
    /詐欺被害や捜査の進展が報じられており、被害の実態や手口に関心が集まっている/u,
    /技術開発や製品動向に新しい進展があり、関連業界や利用者への影響が注目されている/u,
    /作品や出演者をめぐる新しい発表があり、ファン(?:や読者)?の反応が広がっている/u,
    /ゲームや関連サービスをめぐる新しい発表があり、ユーザーの反応が広がっている/u,
    /試合結果や選手・代表をめぐる新しい動きがあり、ファン(?:や関係者)?の関心が集まっている/u,
    /新しい発表や動きがあり、詳細確認のために注目されている/u,
  ].some((pattern) => pattern.test(text));
}

function summaryAddsDetail(summary, title) {
  const summaryFp = fingerprint(summary);
  const titleFp = fingerprint(compactHeadline(title));
  if (!summaryFp || !titleFp) return false;
  if (summaryFp === titleFp) return false;
  const extraLength = summaryFp.replace(titleFp, "").trim().length;
  if (extraLength < 12) return false;
  return /によると|によりますと|として|ことを|ことが|ことから|と発表|と明らかに|とみられる|が見つか|が死亡|を逮捕|を開始|を公表|を確認|方針|見通し|認めている|判明している/u.test(summary);
}

function fingerprint(value) {
  return normalizeText(String(value ?? ""))
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/[【】「」『』]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLocation(title) {
  const match = String(title ?? "").match(/(神奈川|東京|大阪|北海道|福岡|愛知|千葉|埼玉|兵庫|京都|相模原|横浜|池袋|河川敷|中東|韓国|米国|アメリカ|中国)[^、。 ]*/u);
  return match?.[0] ?? "";
}

function compressBriefSummary(summary, item) {
  const cleaned = normalizeNewsLikeSummary(summary);
  if (!cleaned) return "";

  const sentences = cleaned
    .split(/(?<=[。.!！?？])/u)
    .map((sentence) => normalizeNewsLikeSummary(sentence))
    .filter(Boolean);

  if (!sentences.length) return "";

  const compressed = sentences
    .map((sentence, index) => compressSentenceByCategory(sentence, item, index))
    .filter(Boolean);

  const joined = joinCompressedSentences(compressed, 132, 1);
  return joined || trimToSentence(cleaned, 132);
}

function normalizeNewsLikeSummary(value) {
  return normalizeText(value)
    .replace(/^【[^】]+】\s*/u, "")
    .replace(/^(NHK|BBC|CNN|ロイター|Reuters)[\s:：-]*/iu, "")
    .replace(/ということです。?$/u, "。")
    .replace(/…+$/u, "")
    .trim();
}

function compressSentenceByCategory(sentence, item, index) {
  const text = normalizeNewsLikeSummary(sentence);
  if (!text) return "";
  const category = item.category ?? item.categories?.[0] ?? "general";

  if (category === "crime") {
    return compressCrimeSentence(text, index);
  }
  if (category === "politics") {
    return compressPoliticsSentence(text);
  }
  if (category === "business") {
    return compressBusinessSentence(text);
  }
  if (category === "world") {
    return compressWorldSentence(text);
  }
  return trimToSentence(text, index === 0 ? 78 : 58);
}

function compressCrimeSentence(text, index) {
  if (index === 0) {
    const arrest = text.match(/(.+?)として、?(?:20代|30代|40代|50代|60代|男女|男|女).{0,24}?(\d+人).{0,24}?逮捕されました/u);
    if (arrest) {
      return ensureSentence(`${arrest[1]}として${arrest[2]}が逮捕された`);
    }
    const found = text.match(/(.+?)で、?(.+?)が見つかった/u);
    if (found) {
      return ensureSentence(`${found[1]}で${found[2]}が見つかった`);
    }
    const robbed = text.match(/(.+?)で、?(.+?)が(.+?)を奪われました/u);
    if (robbed) {
      return ensureSentence(`${robbed[1]}で${robbed[2]}が${robbed[3]}を奪われた`);
    }
  }

  if (/利益|売り上げ|被害/u.test(text)) {
    const profit = text.match(/(\d+億円|\d+万円).{0,20}(利益|被害)/u);
    if (profit) {
      return ensureSentence(`${profit[1]}規模の${profit[2]}が出た可能性がある`);
    }
  }

  if (/認めている|否認している|捜査している/u.test(text)) {
    return ensureSentence(text.replace(/捜査関係者によりますと、?/u, "").replace(/警察は/u, "").slice(0, 52));
  }

  return trimToSentence(text, index === 0 ? 78 : 56);
}

function compressPoliticsSentence(text) {
  const proposal = text.match(/(.+?)は(.+?)(方針|方向で調整に入りました|提案を行う方向)/u);
  if (proposal) {
    return ensureSentence(`${proposal[1]}は${proposal[2]}${proposal[3].replace(/方向で調整に入りました/u, "方針です").replace(/提案を行う方向/u, "を提案する方針")}`);
  }
  return trimToSentence(text, 82);
}

function compressBusinessSentence(text) {
  const buyback = text.match(/(.+?)が(.+?自社株買い)を発表/u);
  if (buyback) {
    return ensureSentence(`${buyback[1]}が${buyback[2]}を発表した`);
  }
  const recall = text.match(/(.+?)で(.+?台).{0,12}リコール/u);
  if (recall) {
    return ensureSentence(`${recall[1]}で${recall[2]}規模のリコールを実施する`);
  }
  return trimToSentence(text, 82);
}

function compressWorldSentence(text) {
  const attack = text.match(/(.+?)が(.+?)への報復として(.+?)を実施/u);
  if (attack) {
    return ensureSentence(`${attack[1]}が${attack[2]}への報復として${attack[3]}を実施した`);
  }
  return trimToSentence(text, 82);
}

function joinCompressedSentences(sentences, maxLength = 96, maxSentences = 2) {
  const picked = [];
  for (const sentence of sentences) {
    if (picked.length >= maxSentences) break;
    const next = picked.length ? `${picked.join(" ")} ${sentence}` : sentence;
    if (next.length > maxLength && picked.length) break;
    picked.push(sentence);
  }
  return picked.join(" ");
}

function dedupeById(items) {
  return [...new Map(items.filter(Boolean).map((item) => [item.id, item])).values()];
}
