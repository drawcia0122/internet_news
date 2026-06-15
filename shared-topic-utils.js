(function () {
  const GENERIC_TOPIC_TOKENS = new Set(['速報', '公開', '発表', '開始', '決定', '話題', '最新', '本日', 'きょう', '今日', '判明', '疑惑', '意見']);

  function normalizeTopic(topic, { includeSearchLinks = true } = {}) {
    const categories = normalizeCategories(topic.categories, topic.category);
    const normalizedCategories = categories.map(normalizeLegacyCategory);
    const category = normalizedCategories[0] ?? 'general';
    const labelSource = topic.categoryLabels;

    return {
      ...topic,
      category,
      categories: [...new Set(normalizedCategories)],
      categoryLabel: normalizeLegacyCategoryLabel(topic.categoryLabel, category),
      categoryLabels: Array.isArray(labelSource) && labelSource.length ? labelSource.filter((label) => label !== 'ネタ') : [categoryLabelFor(category)],
      sourceSignals: Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [],
      searchLinks: includeSearchLinks && Array.isArray(topic.searchLinks) ? topic.searchLinks : [],
      thumbnailUrl: pickCardImageUrl(topic),
    };
  }

  function normalizeLegacyCategory(category) {
    return category === 'fun' ? 'general' : category;
  }

  function normalizeLegacyCategoryLabel(value, fallbackCategory) {
    if (value === 'ネタ') return categoryLabelFor(fallbackCategory ?? 'general');
    return value ?? categoryLabelFor(fallbackCategory ?? 'general');
  }

  function categoryLabelFor(category) {
    if (category === 'general') return 'その他';
    if (category === 'tech') return 'テック';
    if (category === 'business') return '経済';
    if (category === 'politics') return '政治';
    if (category === 'entertainment') return 'エンタメ';
    if (category === 'games') return 'ゲーム';
    if (category === 'manga') return '漫画';
    if (category === 'books') return '本';
    if (category === 'sports') return 'スポーツ';
    if (category === 'sns') return 'SNS';
    if (category === 'net-culture') return 'ネットカルチャー';
    if (category === 'matome') return '2chまとめ系';
    if (category === 'crime') return '犯罪・事件';
    if (category === 'adult') return 'アダルト系';
    if (category === 'world') return '国際';
    return '総合';
  }

  function shortEventFromTitle(title = '') {
    const value = String(title ?? '').replace(/^【[^】]+】\s*/u, '').trim();
    if (!value) return '新しい動きが出ています。';
    return value.replace(/[。！？!?].*$/u, '').slice(0, 42);
  }

  function topicText(topic) {
    return [
      topic.title,
      topic.summary,
      ...(topic.categoryLabels ?? []),
      ...(topic.hotReasons ?? []),
      ...(topic.sourceSignals ?? []).flatMap((signal) => [signal.title, signal.summary, signal.sourceName]),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function buildWhyHotLabel(topic) {
    const reasons = Array.isArray(topic.hotReasons) ? topic.hotReasons : [];
    if (reasons.length) return reasons[0];
    if (Number(topic.posts ?? 1) >= 2) return '複数媒体で同じ話題が扱われています。';
    return '直近の話題として確認されています。';
  }

  function buildImportantPoint(topic) {
    const text = topicText(topic);
    if (/セール|割引|キャンペーン|クーポン/.test(text)) return '終了前の条件確認や購入判断に直結します。';
    if (/ゲーム|任天堂|switch|steam|ps5/.test(text)) return '予約、抽選、購入、プレイ判断に関係します。';
    if (/ai|chatgpt|openai|claude|gemini|生成ai/.test(text)) return '仕事や制作環境の選択に影響する可能性があります。';
    if (/政治|経済|事件|事故|国際|株価|物価/.test(text)) return '生活や社会の判断材料として優先度が高い話題です。';
    return '関連分野の流れを短時間で掴む判断材料になります。';
  }

  function buildTargetAudience(topic) {
    const text = topicText(topic);
    const values = [];
    if (/ゲーム|任天堂|switch|steam|ps5/.test(text)) values.push('ゲームユーザー');
    if (/ai|chatgpt|openai|claude|gemini|生成ai/.test(text)) values.push('AI利用者');
    if (/セール|割引|キャンペーン|クーポン|fanza|dlsite/.test(text)) values.push('セール好き');
    if (/sns|炎上|バズ|ミーム|ネット文化|2ch|5ch/.test(text)) values.push('ネット文化を追う人');
    if (/株|投資|決算|金利|物価/.test(text)) values.push('投資家');
    if (/政治|国際|事件/.test(text)) values.push('時事ニュースを追う人');
    return [...new Set(values)].slice(0, 4);
  }

  function defaultSearchQueryForCategory(category) {
    if (category === 'tech') return 'テクノロジー 生成AI 新製品 アップデート';
    if (category === 'business') return '経済 企業 決算 投資 市況';
    if (category === 'politics') return '政治 国会 首相 選挙 与党 野党';
    if (category === 'entertainment') return 'エンタメ 映画 音楽 配信 話題';
    if (category === 'games') return 'ゲーム 任天堂 Switch PS5 Steam eスポーツ 話題';
    if (category === 'manga') return '漫画 マンガ コミック 新刊 連載 話題';
    if (category === 'books') return '本 書籍 小説 文庫 出版 話題';
    if (category === 'sports') return 'スポーツ 試合 結果 移籍 大会';
    if (category === 'sns') return 'X Twitter Bluesky Reddit SNSで話題 バズ投稿';
    if (category === 'net-culture') return 'ネットカルチャー SNS バズ 炎上';
    if (category === 'matome') return '2ch 5ch まとめサイト バズ';
    if (category === 'crime') return '事件 逮捕 送検 詐欺 強盗 裁判';
    if (category === 'adult') return 'グラビア セクシー女優 アダルト 話題';
    if (category === 'world') return '国際 海外 政治 外交 戦況';
    return '主要ニュース 速報 話題';
  }

  function buildGoogleNewsUrl(query, { rangeDays = 1 } = {}) {
    const normalizedQuery = String(query ?? '').trim();
    const days = Number.isFinite(Number(rangeDays)) && Number(rangeDays) > 0 ? Number(rangeDays) : 1;
    return 'https://news.google.com/search?q=' + encodeURIComponent(normalizedQuery + ' when:' + days + 'd') + '&hl=ja&gl=JP&ceid=JP:ja';
  }

  function isWithinRange(item, range) {
    if (!range) return true;
    const time = archiveTimestamp(item);
    if (!time) return true;
    const ageMs = Date.now() - time;
    const minMs = Number(range.minHours ?? 0) * 60 * 60 * 1000;
    const maxMs = Number(range.maxHours ?? 0) * 60 * 60 * 1000;

    if (ageMs < 0) return Number(range.minHours ?? 0) === 0;
    if (Number(range.minHours ?? 0) === 0) return ageMs < maxMs;
    if (Number.isFinite(Number(range.maxHours)) && Number(range.maxHours) === 336) return ageMs >= minMs && ageMs <= maxMs;
    return ageMs >= minMs && ageMs < maxMs;
  }

  function pickCardImageUrl(item) {
    const candidates = [
      item?.ogImage,
      item?.twitterImage,
      item?.thumbnailUrl,
      item?.thumbnail,
      item?.imageUrl,
      item?.image,
      item?.sourceImage,
      item?.jsonLdImage,
      ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals.flatMap((signal) => [
        signal?.ogImage,
        signal?.twitterImage,
        signal?.thumbnailUrl,
        signal?.thumbnail,
        signal?.imageUrl,
        signal?.image,
        signal?.sourceImage,
        signal?.jsonLdImage,
      ]) : []),
    ];
    for (const candidate of candidates) {
      const normalized = sanitizeCardImageUrl(candidate);
      if (normalized) return normalized;
    }
    return null;
  }

  function sanitizeCardImageUrl(value) {
    const url = String(value ?? '').trim();
    if (!url || !/^https?:\/\//i.test(url)) return null;
    if (/^https?:\/\/lh3\.googleusercontent\.com\/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc(?:=|$)/i.test(url)) return null;
    if (/(?:^|\/)(?:favicon(?:-\d+x\d+)?|apple-touch-icon|android-chrome-\d+x\d+|mstile-\d+x\d+)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)) return null;
    if (/\/favicon\.ico(?:$|[?#])/i.test(url)) return null;
    if (/(?:google|gstatic)\.[^/]+\/.*(?:favicon|logo|icon)/i.test(url)) return null;
    return url;
  }

  function hasVisibleSummary(summary) {
    const text = String(summary ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return !/に関する話題。?$|が明らかになり、?話題になっている。?$|がきょうの注目話題として取り上げられている。?$|を伝える話題。?$/.test(text);
  }

  function archiveTimestamp(item) {
    const publishedCandidates = [
      ...(Array.isArray(item.sourceSignals) ? item.sourceSignals.map((signal) => signal?.publishedAt) : []),
      item.publishedAt,
    ]
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));

    if (publishedCandidates.length) return Math.max(...publishedCandidates);

    const fallbackCandidates = [item.capturedAt, item.generatedAt]
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));

    return fallbackCandidates.length ? Math.max(...fallbackCandidates) : null;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '不明';
    return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function escapeHtml(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
  }

  function mergeReports(...reportGroups) {
    const reports = reportGroups.flat();
    return [...new Map(reports.map((report) => [report.id, report])).values()];
  }

  function mergeSignals(currentSignals = [], nextSignals = []) {
    return [...new Map([...currentSignals, ...nextSignals].map((signal) => [signal.url, signal])).values()];
  }

  function dedupeTopics(topics) {
    const map = new Map();

    for (const topic of topics) {
      const key = canonicalTopicKey(topic);
      const current = map.get(key);
      if (!current) {
        map.set(key, topic);
        continue;
      }

      const nextSignals = mergeSignals(current.sourceSignals, topic.sourceSignals);
      if (Number(topic.score ?? 0) >= Number(current.score ?? 0)) {
        const categories = normalizeCategories(mergeCategories(current.categories, topic.categories), topic.category ?? current.category);
        map.set(key, {
          ...current,
          ...topic,
          category: topic.category ?? current.category,
          categories,
          categoryLabels: categories.map(categoryLabelFor),
          sourceSignals: nextSignals,
          posts: String(Math.max(Number(current.posts ?? 1), Number(topic.posts ?? 1), nextSignals.length || 1)),
          metricLabel: nextSignals.length > 1 ? 'sources' : (topic.metricLabel ?? current.metricLabel ?? 'source'),
          thumbnailUrl: topic.thumbnailUrl ?? current.thumbnailUrl ?? nextSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
        });
      } else {
        const categories = normalizeCategories(mergeCategories(current.categories, topic.categories), current.category ?? topic.category);
        map.set(key, {
          ...current,
          categories,
          categoryLabels: categories.map(categoryLabelFor),
          sourceSignals: nextSignals,
          posts: String(Math.max(Number(current.posts ?? 1), Number(topic.posts ?? 1), nextSignals.length || 1)),
          metricLabel: nextSignals.length > 1 ? 'sources' : (current.metricLabel ?? 'source'),
          thumbnailUrl: current.thumbnailUrl ?? topic.thumbnailUrl ?? nextSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
        });
      }
    }

    return dedupeTopicsFuzzy([...map.values()]);
  }

  function canonicalTopicKey(topic) {
    const titleSignature = normalizeTopicFingerprint(topic.title ?? '');
    const sourceSignature = canonicalTopicSourceSignature(topic);
    return `${titleSignature}::${sourceSignature}`;
  }

  function normalizeCategories(categories, fallbackCategory) {
    const values = Array.isArray(categories) ? categories : [];
    const merged = [...new Set([fallbackCategory, ...values].filter(Boolean))];
    return merged.length ? merged : ['general'];
  }

  function mergeCategories(...groups) {
    return [...new Set(groups.flatMap((group) => Array.isArray(group) ? group : [group]).filter(Boolean))];
  }

  function canonicalTopicSourceSignature(topic) {
    const firstSignalUrl = Array.isArray(topic.sourceSignals) ? topic.sourceSignals[0]?.url : null;
    const fromSearchLinks = Array.isArray(topic.searchLinks) ? topic.searchLinks[0]?.url : null;
    const normalizedUrl = canonicalUrlForDedup(firstSignalUrl || fromSearchLinks);
    return normalizedUrl ? `url:${normalizedUrl}` : '';
  }

  function canonicalUrlForDedup(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) return '';
    try {
      const parsed = new URL(value);
      const params = new URLSearchParams(parsed.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'ref', 'src', 'from'].forEach((key) => params.delete(key));
      parsed.search = params.toString();
      return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.toLowerCase()}`.replace(/\/$/, '');
    } catch {
      return value.toLowerCase().replace(/^https?:\/\//, '').replace(/[#?].*$/i, '');
    }
  }

  function normalizeTopicFingerprint(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/\b(速報|動画|写真|news|ニュース)\b/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/（[^）]*）/g, ' ')
      .replace(/[【】「」『』]/g, ' ')
      .replace(/（[^）]*?新聞[^）]*?）/g, ' ')
      .replace(/（[^）]*?ニュース[^）]*?）/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b[a-z0-9]{8,}\b/g, ' ')
      .replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/g, ' ')
      .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasCategory(topic, category) {
    return normalizeCategories(topic.categories, topic.category).includes(category);
  }

  function categoryDisplayLabel(topic) {
    const labels = Array.isArray(topic.categoryLabels) && topic.categoryLabels.length
      ? topic.categoryLabels
      : normalizeCategories(topic.categories, topic.category).map(categoryLabelFor);
    return labels.slice(0, 2).join(' / ');
  }

  function dedupeTopicsFuzzy(topics) {
    const kept = [];
    for (const topic of topics) {
      const currentKey = canonicalTopicKey(topic);
      const duplicateIndex = kept.findIndex((item) => isNearDuplicateTopic(item, topic, currentKey));
      if (duplicateIndex === -1) {
        kept.push(topic);
        continue;
      }
      kept[duplicateIndex] = mergeDuplicateTopics(kept[duplicateIndex], topic);
    }
    return kept;
  }

  function isNearDuplicateTopic(current, next, nextKey = canonicalTopicKey(next)) {
    if (!current || !next) return false;
    const currentUrl = canonicalTopicSourceSignature(current);
    const nextUrl = canonicalTopicSourceSignature(next);
    if (currentUrl && nextUrl && currentUrl === nextUrl) return true;
    if (isLikelySameStory(current, next)) return true;
    if (!shareAnyCategory(current, next)) return false;
    const currentKey = canonicalTopicKey(current);
    if (!currentKey || !nextKey) return false;
    if (currentKey.includes(nextKey) || nextKey.includes(currentKey)) {
      return Math.min(currentKey.length, nextKey.length) >= 18;
    }
    const currentTokens = distinctiveTokens(currentKey);
    const nextTokens = distinctiveTokens(nextKey);
    if (currentTokens.length < 3 || nextTokens.length < 3) return false;
    const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
    return overlap >= 3 && overlap / Math.min(currentTokens.length, nextTokens.length) >= 0.78;
  }

  function distinctiveTokens(value) {
    return [...new Set(String(value ?? '').split(' ').filter((token) => token.length >= 2 && !GENERIC_TOPIC_TOKENS.has(token)))];
  }

  function shareAnyCategory(left, right) {
    const leftCategories = normalizeCategories(left.categories, left.category);
    const rightCategories = normalizeCategories(right.categories, right.category);
    return leftCategories.some((category) => rightCategories.includes(category));
  }

  function isLikelySameStory(current, next) {
    if (!current || !next) return false;

    const currentTitle = normalizeTopicFingerprint(current.title ?? '');
    const nextTitle = normalizeTopicFingerprint(next.title ?? '');
    if (!currentTitle || !nextTitle) return false;

    const sameTitle = currentTitle === nextTitle || currentTitle.includes(nextTitle) || nextTitle.includes(currentTitle);
    const currentPublishedAt = topicPublishedAt(current);
    const nextPublishedAt = topicPublishedAt(next);
    if (sameTitle) {
      if (currentPublishedAt == null || nextPublishedAt == null) return true;
      return Math.abs(currentPublishedAt - nextPublishedAt) <= 36 * 60 * 60 * 1000;
    }

    const currentTokens = distinctiveTokens(currentTitle);
    const nextTokens = distinctiveTokens(nextTitle);
    if (currentTokens.length < 4 || nextTokens.length < 4) return false;
    if (!currentPublishedAt || !nextPublishedAt) return false;
    const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
    const overlapRatio = overlap / Math.min(currentTokens.length, nextTokens.length);
    return overlap >= 3 && overlapRatio >= 0.8 && Math.abs(currentPublishedAt - nextPublishedAt) <= 36 * 60 * 60 * 1000;
  }

  function topicPublishedAt(topic) {
    const value = topic?.sourceSignals?.[0]?.publishedAt ?? topic?.publishedAt ?? topic?.capturedAt ?? topic?.generatedAt;
    const time = new Date(value ?? '').getTime();
    return Number.isNaN(time) ? null : time;
  }

  function mergeDuplicateTopics(current, next) {
    const currentSignals = Array.isArray(current.sourceSignals) ? current.sourceSignals : [];
    const nextSignals = Array.isArray(next.sourceSignals) ? next.sourceSignals : [];
    const mergedSignals = [...new Map([...currentSignals, ...nextSignals].map((signal) => [signal.url, signal])).values()];
    const winner = Number(next.score ?? 0) >= Number(current.score ?? 0) ? next : current;
    const loser = winner === next ? current : next;
    const categories = normalizeCategories(mergeCategories(current.categories, next.categories), winner.category ?? loser.category);
    return {
      ...loser,
      ...winner,
      category: winner.category ?? loser.category,
      categories,
      categoryLabels: categories.map(categoryLabelFor),
      sourceSignals: mergedSignals,
      posts: String(Math.max(Number(current.posts ?? 1), Number(next.posts ?? 1), mergedSignals.length || 1)),
      metricLabel: mergedSignals.length > 1 ? 'sources' : (winner.metricLabel ?? loser.metricLabel ?? 'source'),
      thumbnailUrl: winner.thumbnailUrl ?? loser.thumbnailUrl ?? mergedSignals.find((signal) => signal.thumbnailUrl)?.thumbnailUrl ?? null,
    };
  }

  function getPrimarySourceSignal(topic) {
    const signals = Array.isArray(topic?.sourceSignals) ? topic.sourceSignals : [];
    return signals.find((signal) => /^https?:/i.test(String(signal?.url ?? '').trim())) ?? signals[0] ?? null;
  }

  function getPrimarySourceUrl(topic) {
    return getPrimarySourceSignal(topic)?.url ?? '';
  }

  function getPrimarySourceLabel(topic) {
    const signal = getPrimarySourceSignal(topic);
    return signal?.sourceName ?? signal?.source ?? '元記事を見る';
  }

  window.TopicClientUtils = {
    archiveTimestamp,
    buildImportantPoint,
    buildGoogleNewsUrl,
    buildTargetAudience,
    buildWhyHotLabel,
    categoryDisplayLabel,
    categoryLabelFor,
    dedupeTopics,
    defaultSearchQueryForCategory,
    escapeHtml,
    formatDate,
    hasCategory,
    hasVisibleSummary,
    isWithinRange,
    mergeReports,
    normalizeTopic,
    getPrimarySourceLabel,
    getPrimarySourceSignal,
    getPrimarySourceUrl,
    pickCardImageUrl,
    shortEventFromTitle,
    topicText,
  };
})();
