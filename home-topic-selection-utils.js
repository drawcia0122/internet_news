(function () {
  const { hasCategory } = window.TopicClientUtils;

  const PERSONAL_INTEREST_RULES = [
    { label: 'ポケモン', pattern: /ポケモン|pokemon|pokémon|ポケカ|pokemon go|pokémon home/i, score: 60 },
    { label: 'ゲーム', pattern: /ゲーム|モンハン|マリオ|ゼルダ|スプラトゥーン|apex|valorant|eスポーツ/i, score: 45 },
    { label: 'Nintendo / Switch', pattern: /任天堂|nintendo|switch\s?2?|switch/i, score: 40 },
    { label: 'Steam', pattern: /steam|steam deck/i, score: 35 },
    { label: '漫画・アニメ', pattern: /漫画|マンガ|コミック|アニメ|声優|映画化|アニメ化|pv公開/i, score: 35 },
    { label: 'ネット文化', pattern: /sns|xで話題|twitter|bluesky|reddit|炎上|バズ|ミーム|ネット文化|togetter|はてブ|バズり|トレンド入り/i, score: 34 },
    { label: 'セール', pattern: /セール|割引|キャンペーン|クーポン|ポイント還元|無料配布|期間限定/i, score: 30 },
    { label: '脱出・謎解き', pattern: /脱出ゲーム|リアル脱出ゲーム|scrap|謎解き|謎解きイベント/i, score: 42 },
    { label: 'イマーシブ体験', pattern: /イマーシブ|イマーシブフォート|イマーシブシアター|イマーシブイベント|没入型/i, score: 40 },
    { label: '体験型イベント', pattern: /体験型|体験施設|常設体験施設|東京近郊イベント|展示会|ポップアップイベント|ポップアップ|コラボカフェ/i, score: 36 },
    { label: 'オタク系イベント', pattern: /イベント|展示会|即売会|コミケ|ポップアップ|ライブイベント|配布会|コラボカフェ/i, score: 25 },
    { label: '同人', pattern: /同人|dlsite|メロンブックス|booth/i, score: 25 },
  ];
  const PERSONAL_NEGATIVE_RULES = [
    { pattern: /スポーツ|野球|サッカー|mlb|jリーグ|試合|移籍/i, score: 80 },
    { pattern: /政治|国会|首相|与党|野党|選挙/i, score: 50 },
    { pattern: /経済|株価|投資|決算|日銀|金利|市況/i, score: 50 },
    { pattern: /国際|外交|戦況|米軍|中東|ウクライナ|ロシア/i, score: 50 },
    { pattern: /事件|逮捕|送検|起訴|判決|強盗|詐欺/i, score: 50 },
    { pattern: /地方ニュース|県内|市内|町内|観光協会|地域おこし/i, score: 40 },
    { pattern: /ai|生成ai|chatgpt|openai|claude|gemini|llm/i, score: 50 },
    { pattern: /ガジェット|スマホ|iphone|android|gpu|pcパーツ|nvidia/i, score: 40 },
    { pattern: /ビジネス|副業|収益化|個人開発|アフィリエイト|saas/i, score: 40 },
    { pattern: /芸能|熱愛|ゴシップ|スキャンダル/i, score: 30 },
  ];
  const ADULT_CONTENT_PATTERN = /dlsite|fanza|dmm|同人音声|エロ漫画|\bav\b|成人向け|18禁|r-?18|adult[-\s]?trend|adult[-\s]?feature/i;

  let latestTrendGeneratedAt = null;

  function setLatestTrendGeneratedAt(value) {
    latestTrendGeneratedAt = value ?? null;
  }

  function prepareVisibleTrendTopics(topics, { limit = 96 } = {}) {
    return [...topics]
      .filter((topic) => !isAdultContentTopic(topic))
      .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
      .slice(0, limit);
  }

  function selectPersonalNews(topics, { excludedIds = new Set(), overlapLimit = 2, limit = 10 } = {}) {
    const baseCandidates = [...topics]
      .filter((topic) => !isAdultContentTopic(topic))
      .filter((topic) => isJapaneseHeavyTopic(topic))
      .filter((topic) => hasPersonalInterestSignal(topic))
      .filter((topic) => isPersonalTopicCandidate(topic))
      .filter((topic) => !isPersonalHardExcludedTopic(topic))
      .filter((topic) => Number(topic.personalScore ?? 0) >= 12)
      .filter((topic) => !isPersonalExcludedTopic(topic) || isStrongOtakuTopic(topic))
      .sort((left, right) => personalTopicRank(right) - personalTopicRank(left) || hotTopicScore(right) - hotTopicScore(left));

    const primary = baseCandidates.filter((topic) => !excludedIds.has(topic.id)).slice(0, limit);
    if (primary.length >= limit) return primary;

    const overlap = baseCandidates
      .filter((topic) => excludedIds.has(topic.id))
      .slice(0, overlapLimit);

    const fallback = [...topics]
      .filter((topic) => !isAdultContentTopic(topic))
      .filter((topic) => isJapaneseHeavyTopic(topic))
      .filter((topic) => !excludedIds.has(topic.id))
      .filter((topic) => isPersonalTopicCandidate(topic))
      .filter((topic) => !isPersonalHardExcludedTopic(topic))
      .filter((topic) => !isPersonalExcludedTopic(topic) || isStrongOtakuTopic(topic))
      .sort((left, right) => personalTopicRank(right) - personalTopicRank(left) || hotTopicScore(right) - hotTopicScore(left));

    return [...new Map([...primary, ...overlap, ...fallback].map((topic) => [topic.id, topic])).values()].slice(0, limit);
  }

  function selectInternetNews(topics, { limit = 10 } = {}) {
    const preferred = [...topics]
      .filter((topic) => !isAdultContentTopic(topic))
      .filter((topic) => isInternetMainTopic(topic))
      .sort((left, right) => internetTopicRank(right) - internetTopicRank(left));

    const selected = pickDiverseInternetNews(preferred, limit);
    if (selected.length >= limit) return selected;

    const fallback = [...topics]
      .filter((topic) => !isAdultContentTopic(topic))
      .filter((topic) => !isLowPriorityTopic(topic))
      .sort((left, right) => internetTopicRank(right) - internetTopicRank(left));

    return pickDiverseInternetNews(
      [...new Map([...preferred, ...fallback].map((topic) => [topic.id, topic])).values()],
      limit,
    );
  }

  function selectCategoryTopics(topics, predicate, limit = 6) {
    return [...topics]
      .filter((topic) => !isAdultContentTopic(topic))
      .filter((topic) => predicate(topic))
      .filter((topic) => !isLowPriorityTopic(topic))
      .sort((left, right) => categoryShowcaseScore(right) - categoryShowcaseScore(left))
      .slice(0, limit);
  }

  function isAiTopic(topic) {
    return isAiText(topicText(topic));
  }

  function isDealsTopic(topic) {
    return /セール|割引|キャンペーン|クーポン|ポイント還元|無料配布|期間限定/i.test(topicText(topic));
  }

  function isSnsOrNetTopic(topic) {
    return hasCategory(topic, 'sns') || hasCategory(topic, 'net-culture') || hasCategory(topic, 'matome');
  }

  function isWorldTopic(topic) {
    return ['politics', 'business', 'world', 'crime'].some((category) => hasCategory(topic, category));
  }

  function calculatePersonalFit(topic) {
    const text = topicText(topic);
    const reasons = [];
    let score = 0;

    for (const rule of PERSONAL_INTEREST_RULES) {
      if (!rule.pattern.test(text)) continue;
      score += rule.score;
      reasons.push(rule.label);
    }

    for (const rule of PERSONAL_NEGATIVE_RULES) {
      if (!rule.pattern.test(text)) continue;
      score -= rule.score;
    }

    score += personalSourceAffinityScore(topic);
    if (topic.thumbnailUrl) score += 8;
    if (Number(topic.posts ?? 1) >= 2) score += 8;
    if (isTrendTopicFresh(topic)) score += 8;
    if (hotTopicScore(topic) >= 55) score += 8;

    return {
      score: Math.max(0, Math.min(100, score)),
      reasons: [...new Set(reasons)].slice(0, 4),
    };
  }

  function hasPersonalInterestSignal(topic) {
    const text = topicText(topic);
    return PERSONAL_INTEREST_RULES.some((rule) => rule.pattern.test(text)) || personalSourceAffinityScore(topic) >= 10;
  }

  function isJapaneseHeavyTopic(topic) {
    const text = topicText(topic);
    const japaneseCount = (text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length;
    const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
    return japaneseCount >= Math.max(10, Math.floor(latinCount * 0.45));
  }

  function isPersonalTopicCandidate(topic) {
    const text = topicText(topic);
    if (hasCategory(topic, 'games') || hasCategory(topic, 'manga') || hasCategory(topic, 'entertainment') || hasCategory(topic, 'sns') || hasCategory(topic, 'net-culture') || hasCategory(topic, 'matome')) {
      return true;
    }
    return /ポケモン|pokemon|任天堂|nintendo|switch|steam|漫画|マンガ|アニメ|同人|脱出ゲーム|scrap|謎解き|イマーシブ|展示会|ポップアップ|コラボカフェ|セール|割引|無料配布|キャンペーン/.test(text);
  }

  function isPersonalHardExcludedTopic(topic) {
    const text = topicText(topic);
    return /(中古品|メルカリ|ラクマ|paypayフリマ|ヤフオク|amazon整備済み品)/i.test(text)
      || /(android|iphone|pixel|itmedia mobile|openai|chatgpt|claude|gemini|生成ai|ai動画|google pixel|google ai|google workspace|google cloud)/i.test(text)
      || /(法案|国会|首相|与党|野党|選挙|外交|中東|株価|日銀|金利|物価|再審|逮捕|起訴|判決|地震速報|通行止め)/.test(text);
  }

  function isPersonalExcludedTopic(topic) {
    const text = topicText(topic);
    return PERSONAL_NEGATIVE_RULES.some((rule) => rule.pattern.test(text));
  }

  function isStrongOtakuTopic(topic) {
    const text = topicText(topic);
    const matchedRules = PERSONAL_INTEREST_RULES.filter((rule) => rule.pattern.test(text));
    return matchedRules.length >= 2 || matchedRules.some((rule) => rule.score >= 40);
  }

  function isInternetMainTopic(topic) {
    if (!topic || isAdultContentTopic(topic) || isLowPriorityTopic(topic)) return false;
    const text = topicText(topic);
    const hot = hotTopicScore(topic);
    const primaryCategory = topic.category ?? topic.categories?.[0] ?? 'general';
    const preferredCategory = ['games', 'manga', 'entertainment', 'sns', 'net-culture', 'matome'].includes(primaryCategory);
    const preferredKeywords = /ポケモン|pokemon|任天堂|nintendo|switch|steam|ゲーム|漫画|マンガ|アニメ|同人|コミケ|コラボカフェ|炎上|バズ|ミーム|トレンド入り|togetter|はてブ|セール|割引|無料配布|オタク|声優|配信者/.test(text);
    const networkBuzz = /sns|xで話題|twitter|bluesky|reddit|炎上|バズ|ミーム|まとめ|ネットの反応|話題/.test(text)
      || (Array.isArray(topic.hotReasons) && topic.hotReasons.some((reason) => /話題|拡散|複数媒体|専門媒体/.test(reason)));
    const secondaryCategory = ['sports', 'crime', 'general'].includes(primaryCategory);
    const lowPriorityDomain = /(政治|国会|選挙|与党|野党|経済|株価|決算|金利|国際|外交|戦況|ai|生成ai|openai|claude|gemini|個人開発|副業|収益化)/i.test(text);

    if ((preferredCategory || preferredKeywords) && !lowPriorityDomain) return true;
    if (networkBuzz && hot >= 54 && !lowPriorityDomain) return true;
    if (secondaryCategory && networkBuzz && hot >= 60) return true;
    return hot >= 90 && !/(地域おこし|観光協会|セミナー|説明会)/.test(text);
  }

  function internetTopicRank(topic) {
    const text = topicText(topic);
    let score = hotTopicScore(topic) + topicRecencyScore(topic);
    if (['sns', 'net-culture', 'matome'].includes(topic.category)) score += 28;
    if (['games', 'manga', 'entertainment'].includes(topic.category)) score += 20;
    if (/ポケモン|pokemon|任天堂|nintendo|switch|steam|ゲーム|漫画|マンガ|アニメ|同人/.test(text)) score += 18;
    if (/炎上|バズ|ミーム|xで話題|トレンド入り|togetter|はてブ|ネットの反応/.test(text)) score += 22;
    if (/セール|割引|無料配布|キャンペーン/.test(text)) score += 12;
    if (/(政治|国会|選挙|経済|株価|金利|国際|外交|ai|生成ai|副業|個人開発|収益化)/i.test(text)) score -= 26;
    if (Number(topic.posts ?? 1) >= 2) score += 10;
    return score;
  }

  function pickDiverseInternetNews(items, limit = 10) {
    const selected = [];
    const categoryCounts = new Map();

    for (const topic of items) {
      if (selected.length >= limit) break;
      const category = topic.category ?? topic.categories?.[0] ?? 'general';
      const currentCount = categoryCounts.get(category) ?? 0;
      const categoryLimit = internetCategoryLimit(topic, category);
      if (currentCount >= categoryLimit) continue;
      selected.push(topic);
      categoryCounts.set(category, currentCount + 1);
    }

    if (selected.length >= limit) return selected.slice(0, limit);

    for (const topic of items) {
      if (selected.length >= limit) break;
      if (selected.some((item) => item.id === topic.id)) continue;
      selected.push(topic);
    }

    return selected.slice(0, limit);
  }

  function internetCategoryLimit(topic, category) {
    const text = topicText(topic);
    const hasStrongBuzz = /sns|xで話題|twitter|bluesky|reddit|炎上|バズ|ミーム|トレンド入り|togetter|はてブ|ネットの反応/.test(text);
    if (['sns', 'net-culture', 'matome'].includes(category)) return 4;
    if (['games', 'manga', 'entertainment'].includes(category)) return hasStrongBuzz ? 3 : 2;
    if (['politics', 'business', 'world'].includes(category)) return 2;
    return 3;
  }

  function personalSourceAffinityScore(topic) {
    const signals = Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [];
    let score = 0;

    for (const signal of signals.slice(0, 4)) {
      const priority = Number(signal?.sourcePriority ?? 0);
      score = Math.max(score, Math.max(0, Math.round((priority - 40) / 5)));

      if (signal?.forPersonal) score += 4;
      if (signal?.specialist) score += 6;
      if (signal?.official) score += 4;

      const sourceGroup = String(signal?.sourceGroup ?? '');
      if (/games|anime|net-culture|sales|steam|events|pokemon/.test(sourceGroup)) score += 6;
      if (sourceGroup === 'google-news') score -= 6;
    }

    return Math.max(-8, Math.min(22, score));
  }

  function personalTopicRank(topic) {
    return Number(topic.personalScore ?? 0) + personalSourceAffinityScore(topic) + topicRecencyScore(topic);
  }

  function buildTrendInsights(topic, personal = calculatePersonalFit(topic)) {
    return {
      whatHappened: shortEventFromTitle(topic.title),
      whyHot: buildWhyHotLabel(topic),
      importantPoint: buildImportantPoint(topic),
      futureOutlook: buildFutureOutlook(topic),
      targetAudience: buildTargetAudience(topic, personal),
    };
  }

  function topicText(topic) {
    return [
      topic.title,
      topic.summary,
      topic.categoryLabel,
      ...(topic.categoryLabels ?? []),
      ...(topic.hotReasons ?? []),
      ...(topic.relatedKeywords ?? []),
      ...(topic.sourceSignals ?? []).flatMap((signal) => [
        signal.title,
        signal.summary,
        signal.sourceName,
        signal.sourceGroup,
        ...(Array.isArray(signal.sourceTags) ? signal.sourceTags : []),
      ]),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function shortEventFromTitle(title = '') {
    const value = String(title ?? '').replace(/^【[^】]+】\s*/u, '').trim();
    if (!value) return '新しい動きが出ています。';
    return trimMetaText(value.replace(/[。！？!?].*$/u, ''), 42);
  }

  function buildWhyHotLabel(topic) {
    const reasons = Array.isArray(topic.hotReasons) ? topic.hotReasons : [];
    if (reasons.length) return trimMetaText(reasons[0], 44);
    if (Number(topic.posts ?? 1) >= 2) return '複数媒体で同じ話題が扱われています。';
    if (isTrendTopicFresh(topic)) return '直近の新しい話題です。';
    if (Number(topic.personalScore ?? 0) >= 35) return '自分の関心分野に近い話題です。';
    return '関連分野の流れを追う判断材料になります。';
  }

  function buildImportantPoint(topic) {
    const text = topicText(topic);
    if (/セール|割引|キャンペーン|クーポン|ポイント還元/.test(text)) return '終了前に条件を確認すると損を避けやすい情報です。';
    if (/脱出ゲーム|リアル脱出ゲーム|scrap|謎解き|イマーシブ|展示会|コラボカフェ|ポップアップ/.test(text)) return '開催期間、会場、予約条件を早めに押さえる価値が高い話題です。';
    if (/ポケモン|pokemon|任天堂|switch|steam|ゲーム/.test(text)) return '遊ぶ予定や購入判断、予約・抽選の判断に関係します。';
    if (/ai|chatgpt|openai|claude|gemini|生成ai/.test(text)) return '仕事や制作環境の選択に影響する可能性があります。';
    if (/炎上|sns|xで話題|バズ|拡散/.test(text)) return 'ネット上の空気や評判の変化を早めに掴めます。';
    if (/逮捕|事件|事故|判決|政治|選挙|物価|株価/.test(text)) return '生活や社会の判断材料として優先度が高い話題です。';
    return '後で追うべきかを短時間で判断する材料になります。';
  }

  function buildFutureOutlook(topic) {
    const text = topicText(topic);
    if (/セール|キャンペーン|クーポン/.test(text)) return '対象範囲、終了日時、追加キャンペーンの有無。';
    if (/予約|抽選|発売|配信|公開/.test(text)) return '次回受付、在庫、配信日、公式発表の更新。';
    if (/ai|chatgpt|openai|claude|gemini/.test(text)) return '利用条件、料金、競合サービスの追随。';
    if (/逮捕|事件|事故|裁判/.test(text)) return '捜査や発表、関係者コメントの続報。';
    return '追加発表、関連ニュース、SNS上の反応の広がり。';
  }

  function buildTargetAudience(topic, personal = { reasons: [] }) {
    const text = topicText(topic);
    const values = [];
    if (/ポケモン|pokemon|ポケカ/.test(text)) values.push('ポケモンユーザー');
    if (/ゲーム|任天堂|switch|steam|ps5/.test(text)) values.push('ゲームユーザー');
    if (/ai|chatgpt|openai|claude|gemini/.test(text)) values.push('AI利用者');
    if (/iphone|android|ガジェット|スマホ|nvidia|gpu/.test(text)) values.push('ガジェット好き');
    if (/セール|割引|キャンペーン|クーポン|fanza|dlsite/.test(text)) values.push('セール好き');
    if (/漫画|マンガ|アニメ|声優/.test(text)) values.push('漫画・アニメ好き');
    if (/sns|炎上|バズ|ミーム|ネット文化/.test(text)) values.push('ネット文化を追う人');
    if (/脱出ゲーム|リアル脱出ゲーム|scrap|謎解き|イマーシブ|展示会|コラボカフェ|ポップアップ|体験型/.test(text)) values.push('体験型イベント好き');
    if (/株|投資|決算|金利|物価/.test(text)) values.push('投資家');
    if (!values.length && personal.reasons.length) values.push(...personal.reasons.map((reason) => reason.replace(/関連|情報/g, '')));
    return [...new Set(values)].slice(0, 4);
  }

  function hotTopicScore(topic) {
    return Number(topic.hotScore ?? topic.score ?? 0);
  }

  function trimMetaText(value, limit = 34) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }

  function categoryShowcaseScore(topic) {
    const freshnessBonus = topicRecencyScore(topic);
    const sourceBonus = Math.min(8, Number(topic.posts ?? 1) * 2);
    const baseScore = Number(topic.score ?? 0);
    const personalSourceBonus = Math.max(0, personalSourceAffinityScore(topic));
    const importanceBonus = isHighImportanceTopic(topic) ? 18 : 0;
    const penalty = isLowPriorityTopic(topic) ? 36 : 0;
    return baseScore + freshnessBonus + sourceBonus + personalSourceBonus + importanceBonus - penalty;
  }

  function isAdultContentTopic(topic) {
    if (!topic) return false;
    if (hasCategory(topic, 'adult')) return true;
    const text = topicText(topic);
    if (ADULT_CONTENT_PATTERN.test(text)) return true;
    const sourceSignals = Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [];
    return sourceSignals.some((signal) => ADULT_CONTENT_PATTERN.test([
      signal?.sourceName,
      signal?.sourceGroup,
      signal?.url,
      signal?.canonicalUrl,
    ].filter(Boolean).join(' ')));
  }

  function isDoujinEventOnlyTopic(topic) {
    if (!topic) return false;
    const text = topicText(topic);
    if (!/同人/.test(text)) return false;
    if (!/イベント|即売会|サークル|展示|特集/.test(text)) return false;
    return !/(fanza|dlsite|dmm|同人音声|エロ漫画|アダルト|成人向け|18禁|r-?18|av女優|セクシー女優|グラビア|写真集|ランジェリー)/i.test(text);
  }

  function isHighImportanceTopic(topic) {
    const text = topicText(topic);
    if (['crime', 'politics', 'business', 'world'].some((category) => hasCategory(topic, category))) return true;
    return /(地震|大雨|台風|避難|事故|火災|殺人|逮捕|起訴|判決|法案|制度|選挙|関税|物価|株価|決算|iphone|switch|ps5|steam|任天堂|openai|chatgpt|claude|gemini|nvidia|microsoft|google|apple|セール|クーポン|大型アップデート|抽選)/.test(text);
  }

  function isLowPriorityTopic(topic) {
    const text = topicText(topic);
    return /(pr times|共同通信prワイヤー|valuepress|＠press|atpress|dream news|ドリームニュース|newscast|プレスリリース|スポンサー|タイアップ|広告)/i.test(text)
      || /(地域対応|エリア対応|正式スタート|サービス開始|提供開始|販売開始|導入開始|参加者募集|受講者募集|開催のお知らせ|来場者募集|観光イベント|ワークショップ|講習会|地域おこし|セミナー|講演会|説明会|体験会|初級クラス)/.test(text)
      || /(地元の魅力をアピール|観光pr|地域pr|やってみた|首長と○○やってみた)/.test(text)
      || /(トークセッションを開催|対談しました|本学の学生|meijo-u\.ac\.jp|大学公式サイト)/i.test(text)
      || (/(累計動画|累計導入|導入実績|掲載実績|利用者数|満足度|受賞歴|フォロワー数)/.test(text) && !/(逮捕|事件|決算|法案|選挙|抽選|値上げ|事故)/.test(text));
  }

  function isAiText(value) {
    return /(?:^|[^a-z])ai(?:[^a-z]|$)|生成ai|chatgpt|openai|claude|gemini|llm/i.test(value);
  }

  function topicRecencyScore(topic) {
    const dateValue = topic.sourceSignals?.[0]?.publishedAt ?? topic.publishedAt ?? topic.capturedAt ?? latestTrendGeneratedAt;
    if (!dateValue) return 0;
    const time = new Date(dateValue).getTime();
    if (Number.isNaN(time)) return 0;
    const ageHours = Math.max(0, (Date.now() - time) / (1000 * 60 * 60));
    if (ageHours <= 2) return 18;
    if (ageHours <= 6) return 14;
    if (ageHours <= 12) return 10;
    if (ageHours <= 24) return 6;
    return 0;
  }

  function isTrendTopicFresh(topic) {
    const dateValue = topic.sourceSignals?.[0]?.publishedAt ?? topic.publishedAt ?? topic.capturedAt ?? latestTrendGeneratedAt;
    if (!dateValue) return true;
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return true;
    return Date.now() - date.getTime() <= 24 * 60 * 60 * 1000;
  }

  function isTrendTopicWithinDays(topic, days) {
    const dateValue = topic.sourceSignals?.[0]?.publishedAt ?? topic.publishedAt ?? topic.capturedAt ?? latestTrendGeneratedAt;
    if (!dateValue) return true;
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return true;
    return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
  }

  function topicTimestamp(topic) {
    const dateValue = topic.sourceSignals?.[0]?.publishedAt ?? topic.publishedAt ?? topic.capturedAt ?? latestTrendGeneratedAt;
    const timestamp = new Date(dateValue ?? '').getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  window.HomeTopicSelectionUtils = {
    setLatestTrendGeneratedAt,
    prepareVisibleTrendTopics,
    selectPersonalNews,
    selectInternetNews,
    selectCategoryTopics,
    isAiTopic,
    isDealsTopic,
    isSnsOrNetTopic,
    isWorldTopic,
    calculatePersonalFit,
    hasPersonalInterestSignal,
    isPersonalExcludedTopic,
    isStrongOtakuTopic,
    isInternetMainTopic,
    internetTopicRank,
    personalSourceAffinityScore,
    personalTopicRank,
    buildTrendInsights,
    topicText,
    shortEventFromTitle,
    buildWhyHotLabel,
    buildImportantPoint,
    buildFutureOutlook,
    buildTargetAudience,
    hotTopicScore,
    trimMetaText,
    categoryShowcaseScore,
    isAdultContentTopic,
    isDoujinEventOnlyTopic,
    isLowPriorityTopic,
    topicRecencyScore,
    isTrendTopicFresh,
    isTrendTopicWithinDays,
    topicTimestamp,
  };
})();
