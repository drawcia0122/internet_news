(function () {
  const GENERIC_TOPIC_TOKENS = new Set(['速報', '公開', '発表', '開始', '決定', '話題', '最新', '本日', 'きょう', '今日', '判明', '疑惑', '意見']);
  const MAX_CARD_IMAGE_ATTEMPTS = 3;
  const cardImageAttempts = new WeakMap();

  function normalizeTopic(topic, { includeSearchLinks = true } = {}) {
    const safeTopic = window.NewsSummaryIntegrity?.sanitizeArticleSummaryFields(topic) ?? topic;
    const categories = normalizeCategories(safeTopic.categories, safeTopic.category);
    const normalizedCategories = categories.map(normalizeLegacyCategory);
    const category = normalizedCategories[0] ?? 'general';
    const labelSource = safeTopic.categoryLabels;
    const sourceSignals = Array.isArray(safeTopic.sourceSignals)
      ? safeTopic.sourceSignals.map((signal) => ({
        ...signal,
        title: decodeHtmlEntities(signal?.title ?? ''),
        summary: normalizeSummaryMarkup(signal?.summary ?? ''),
        sourceName: decodeHtmlEntities(signal?.sourceName ?? ''),
        source: decodeHtmlEntities(signal?.source ?? ''),
        sourceTags: window.ArticleCategoryQuality?.sanitizeArticleSourceTags(signal?.sourceTags, {
          ...safeTopic,
          sourceSignals: [signal],
        }) ?? signal?.sourceTags,
      }))
      : [];

    return {
      ...safeTopic,
      title: decodeHtmlEntities(safeTopic.title ?? ''),
      summary: normalizeSummaryMarkup(safeTopic.summary ?? ''),
      briefSummary: normalizeSummaryMarkup(safeTopic.briefSummary ?? ''),
      whatHappened: decodeHtmlEntities(safeTopic.whatHappened ?? ''),
      whyHot: decodeHtmlEntities(safeTopic.whyHot ?? ''),
      importantPoint: decodeHtmlEntities(safeTopic.importantPoint ?? ''),
      futureOutlook: decodeHtmlEntities(safeTopic.futureOutlook ?? ''),
      category,
      categories: [...new Set(normalizedCategories)],
      categoryLabel: normalizeLegacyCategoryLabel(safeTopic.categoryLabel, category),
      categoryLabels: Array.isArray(labelSource) && labelSource.length ? labelSource.filter((label) => label !== 'ネタ') : [categoryLabelFor(category)],
      sourceSignals,
      searchLinks: includeSearchLinks && Array.isArray(safeTopic.searchLinks) ? safeTopic.searchLinks : [],
      thumbnailUrl: pickCardImageUrl(safeTopic),
    };
  }

  function sanitizeArticleSummaryCollection(topics) {
    if (!window.NewsSummaryIntegrity) return Array.isArray(topics) ? topics : [];
    return window.NewsSummaryIntegrity.sanitizeArticleSummaryCollection(topics);
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
    if (category === 'anime') return 'アニメ';
    if (category === 'games') return 'ゲーム';
    if (category === 'game-features') return 'ゲーム特集';
    if (category === 'anime-features') return 'アニメ特集';
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

  function decodeHtmlEntities(value) {
    const text = String(value ?? '');
    if (!/[&][#a-zA-Z0-9]+;/.test(text)) return text;
    const element = document.createElement('textarea');
    element.innerHTML = text;
    return element.value;
  }

  function normalizeSummaryMarkup(value) {
    let text = String(value ?? '');
    // RSS and extracted metadata may escape markup more than once. Decode
    // before stripping, and remove a trailing tag truncated by summary limits.
    for (let pass = 0; pass < 2; pass += 1) text = decodeHtmlEntities(text);
    return text
      .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script>|$)/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style>|$)/gi, ' ')
      .replace(/<\/?[a-z][a-z0-9:-]*(?:\s[^>]*|\s*\/?)>/gi, ' ')
      .replace(/<\/?[a-z][a-z0-9:-]*(?:\s[^>]*)?$/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sanitizeNewsSummaryMarkup(topic) {
    return {
      ...topic,
      summary: normalizeSummaryMarkup(topic?.summary),
      briefSummary: normalizeSummaryMarkup(topic?.briefSummary),
      sourceSignals: Array.isArray(topic?.sourceSignals) ? topic.sourceSignals.map((signal) => ({
        ...signal,
        summary: normalizeSummaryMarkup(signal?.summary),
      })) : topic?.sourceSignals,
    };
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
    if (category === 'anime') return 'アニメ 新作 放送日 PV キービジュアル キャスト 話題';
    if (category === 'games') return 'ゲーム 任天堂 Switch PS5 Steam eスポーツ 話題';
    if (category === 'game-features') return 'ゲーム インタビュー コラム プレイレポート レビュー 開発秘話';
    if (category === 'anime-features') return 'アニメ インタビュー 制作秘話 コラム レビュー 特集';
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
      ...cardImageValues(item),
      ...(Array.isArray(item?.sourceSignals) ? item.sourceSignals.flatMap(cardImageValues) : []),
    ];
    for (const candidate of candidates) {
      const normalized = sanitizeCardImageUrl(candidate);
      if (normalized) return normalized;
    }
    return null;
  }

  function cardImageValues(item) {
    return [item?.ogImage, item?.twitterImage, item?.thumbnailUrl, item?.thumbnail,
      item?.imageUrl, item?.image, item?.sourceImage, item?.jsonLdImage];
  }

  function cardImageArticleKeys(item) {
    return [item?.canonicalUrl, item?.sourceUrl, item?.url, item?.link, item?.primaryLink?.url]
      .map((value) => {
        try {
          const url = new URL(value);
          if (!/^https?:$/.test(url.protocol)) return '';
          url.hash = '';
          for (const key of [...url.searchParams.keys()]) {
            if (/^utm_/i.test(key) || /^(ref|src|from|source|fbclid|gclid|yclid|oc)$/i.test(key)) url.searchParams.delete(key);
          }
          url.searchParams.sort();
          return url.hostname.replace(/^www\./i, '') + url.pathname.replace(/\/$/, '') + url.search;
        } catch {
          return '';
        }
      }).filter(Boolean);
  }

  function uniqueCardImageUrls(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const url = sanitizeCardImageUrl(value);
      if (!url) continue;
      const key = new URL(url);
      key.hash = '';
      if (seen.has(key.href)) continue;
      seen.add(key.href);
      result.push(url);
      if (result.length === MAX_CARD_IMAGE_ATTEMPTS) break;
    }
    return result;
  }

  function getCardImageCandidates(item) {
    // Preserve the existing primary selection, then stay within its article.
    const primary = pickCardImageUrl(item);
    if (!primary) return [];
    const signals = Array.isArray(item?.sourceSignals) ? item.sourceSignals : [];
    const ownsPrimary = (value) => cardImageValues(value).some((url) => sanitizeCardImageUrl(url) === primary);
    const owner = ownsPrimary(item) ? item : signals.find(ownsPrimary);
    const ownerKeys = new Set(cardImageArticleKeys(owner));
    const matchingSignals = signals.filter((signal) => signal !== owner
      && cardImageArticleKeys(signal).some((key) => ownerKeys.has(key)));
    return uniqueCardImageUrls([primary, ...cardImageValues(owner), ...matchingSignals.flatMap(cardImageValues)]);
  }

  function buildCardThumbnail(item) {
    const candidates = getCardImageCandidates(typeof item === 'string' ? { thumbnailUrl: item } : item);
    if (!candidates.length) return '';
    const escapeAttribute = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fallbacks = candidates.length > 1
      ? ' data-thumbnail-fallbacks="' + escapeAttribute(JSON.stringify(candidates.slice(1))) + '"'
      : '';
    return '<div class="trend-thumb-wrap"><img class="trend-thumb" src="' + escapeAttribute(candidates[0]) + '"' + fallbacks + ' alt="" loading="lazy" referrerpolicy="no-referrer" /></div>';
  }

  function buildArticleTitleLink(title, sourceUrl) {
    const escape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const text = escape(title);
    try {
      const url = new URL(String(sourceUrl ?? '').trim());
      if (!/^https?:$/.test(url.protocol)) return text;
      // Old feed data can contain an image/media URL in the article-link field.
      const path = decodeURIComponent(url.pathname);
      if (/\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp|ico|pdf|mp4|m4v|mov|webm|mp3|m4a|wav|ogg|ogv)$/i.test(path)) return text;
      if (['format', 'fm', 'ext'].some((key) => /^(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.searchParams.get(key) ?? ''))) return text;
      return '<a class="article-title-link" href="' + escape(url.href) + '" target="_blank" rel="noreferrer noopener">' + text + '</a>';
    } catch {
      return text;
    }
  }

  function handleCardImageError(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains('trend-thumb')) return;
    // Ignore duplicate/stale errors while the replacement is loading or after success.
    if (image.isConnected === false || !image.complete || image.naturalWidth > 0) return;
    if (image.currentSrc && image.currentSrc !== image.src) return;
    const wrapper = image.closest('.trend-thumb-wrap');
    if (!wrapper) return;
    let state = cardImageAttempts.get(image);
    if (!state) {
      let fallbacks = [];
      try {
        const parsed = JSON.parse(image.getAttribute('data-thumbnail-fallbacks') ?? '[]');
        if (Array.isArray(parsed)) fallbacks = parsed;
      } catch { /* Malformed cached markup degrades to the no-image layout. */ }
      const candidates = uniqueCardImageUrls([image.src, ...fallbacks]);
      state = { remaining: candidates.filter((url) => new URL(url).href !== image.src), attempts: 1, finished: false };
      cardImageAttempts.set(image, state);
      image.removeAttribute('data-thumbnail-fallbacks');
    }
    if (state.finished) return;
    if (state.remaining.length && state.attempts < MAX_CARD_IMAGE_ATTEMPTS) {
      state.attempts += 1;
      image.src = state.remaining.shift();
      return;
    }
    state.finished = true;
    const card = wrapper.closest('.trend-card, .topic-cluster-card, .priority-card, .must-read-card-shell');
    if (card) {
      card.classList.remove('has-thumb');
      card.classList.add('trend-card-no-thumb');
    }
    wrapper.remove();
  }

  function isProxyThumbnailUrl(url) {
    const value = String(url ?? '').trim();
    return /(?:^https?:\/\/)(?:newsatcl-pctr\.c\.yimg\.jp|news-pctr\.c\.yimg\.jp)\//i.test(value)
      || /^https?:\/\/news\.google\.com\/api\/attachments\//i.test(value)
      || /^https?:\/\/lh3\.googleusercontent\.com\//i.test(value);
  }

  function isWeakThumbnailUrl(url) {
    const value = String(url ?? '').trim();
    if (!value) return true;
    if (isProxyThumbnailUrl(value)) return true;
    return /^https?:\/\/(?:[^/]+\.)?yimg\.jp\/?$/i.test(value)
      || /^https?:\/\/img\.youtube\.com\/?$/i.test(value)
      || /^https?:\/\/b\.hatena\.ne\.jp\/entry\/image\//i.test(value)
      || /s\.yimg\.jp\/images\/top\/ogp\/fb_y_1500px\.png|s\.yimg\.jp\/images\/news-web\/versions\/[^/]+\/all\/images\/ogp_default\.png|s\.yimg\.jp\/images\/advertising\/common\/img\/ico_jiaa\.png|news-pctr\.c\.yimg\.jp\/uUzvQ3lM|news-topics\/images\/tpc|news-topics\/pickups|\/t\/news-topics\/|support\.x\.com\/articles\/|gstatic\.com\/_\/mss\/boq-dots\/.*dotssplashui/i.test(value)
      || looksLikeArticlePageThumbnailUrl(value);
  }

  function sanitizeCardImageUrl(value) {
    const url = String(value ?? '').trim();
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      const search = parsed.search.toLowerCase();
      const hasImageExtension = /\.(?:avif|bmp|gif|heic|heif|jpeg|jpg|png|svg|webp)(?:$|[?#])/i.test(pathname);
      const looksLikeImageAsset = /(?:\/|^)(?:images?|img|media|photo|photos|thumbnail|thumb|banner|ogp|avatar|icons?)(?:\/|$)/i.test(pathname)
        || /[?&](?:format|fm|ext|image|img|photo|thumbnail|thumb|width|height)=/i.test(search)
        || /\/_next\/image$/i.test(pathname);
      if (!hasImageExtension && !looksLikeImageAsset) return null;
    } catch {
      return null;
    }
    if (isWeakThumbnailUrl(url)) return null;
    if (/^https?:\/\/lh3\.googleusercontent\.com\/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc(?:=|$)/i.test(url)) return null;
    if (/^https?:\/\/lh3\.googleusercontent\.com\/zpUAWPoFO8BgmXeHZna-q2AFE1ss9PWr2E16kntkjD5pyjVWfWEhzza9qBxRpMypBCYTnINVLw(?:=|$)/i.test(url)) return null;
    if (/(?:^|\/)(?:favicon(?:[-_]\d+x\d+)?|apple-touch-icon|android-chrome-\d+x\d+|mstile-\d+x\d+)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)) return null;
    if (/\/favicon\.ico(?:$|[?#])/i.test(url)) return null;
    if (/(?:google|gstatic)\.[^/]+\/.*(?:favicon|logo|icon)/i.test(url)) return null;
    if (/(?:^|[/?#&=_-])(logo|icon|menu|nav|sns-share|share-icon|social-icon|site-logo|header-logo|brand-logo)(?:[/?#&=._-]|$)/i.test(url)) return null;
    if (/(?:btng?menu|thumbnail-default|ogp(?:[-_]?default|logo)|siteLogo|squarelogo|townlogo|yamashin_ogplogo|[a-z0-9_-]*logo)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(url)) return null;
    return url;
  }

  function looksLikeArticlePageThumbnailUrl(value) {
    try {
      const parsed = new URL(String(value ?? '').trim());
      const pathname = parsed.pathname.toLowerCase();
      const full = `${parsed.hostname.toLowerCase()}${pathname}${parsed.search.toLowerCase()}`;
      if (/\.(?:avif|bmp|gif|heic|heif|jpeg|jpg|png|svg|webp)(?:$|[?#])/i.test(pathname)) return false;
      if (/(?:\/|^)(?:images?|img|media|photo|photos|thumbnail|thumb|banner|ogp|avatar|icon|logos?)(?:\/|$)/i.test(pathname)) return false;
      if (/[?&](?:format|fm|ext|image|img|photo)=.*(?:jpe?g|png|webp|gif|avif)/i.test(parsed.search)) return false;
      return /(?:\/|^)(?:article|articles|pickup|expert|entry|news|kiji|detail|read|story|stories)\//i.test(pathname)
        || /support\.x\.com\/articles\//i.test(full);
    } catch {
      return false;
    }
  }

  function hasVisibleSummary(summary) {
    const text = String(summary ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (window.NewsSummaryIntegrity?.isInvalidArticleSummary(text)) return false;
    return !/に関する話題。?$|が明らかになり、?話題になっている。?$|がきょうの注目話題として取り上げられている。?$|を伝える話題。?$/.test(text);
  }

  function archiveTimestamp(item) {
    const publishedCandidates = [
      ...(Array.isArray(item.sourceSignals) ? item.sourceSignals.map((signal) => signal?.publishedAt) : []),
      item.publishedAt,
    ].map(parseTimestamp).filter((value) => value != null);

    if (publishedCandidates.length) return Math.max(...publishedCandidates);

    const fallbackCandidates = [item.capturedAt, item.generatedAt]
      .map(parseTimestamp)
      .filter((value) => value != null);

    return fallbackCandidates.length ? Math.max(...fallbackCandidates) : null;
  }

  function parseTimestamp(value) {
    if (value == null || value === '') return null;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time) || time <= 0) return null;
    return time;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '不明';
    return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function formatTopicDisplayTime(topic) {
    const timestamp = archiveTimestamp(topic);
    if (timestamp != null) return formatDate(timestamp);

    const explicit = String(topic?.time ?? '').trim();
    return explicit || '時刻不明';
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
      [...params.keys()].forEach((key) => {
        if (/^utm_/i.test(key) || ['ref', 'src', 'from', 'source', 'fbclid', 'gclid', 'yclid', 'oc'].includes(key.toLowerCase())) params.delete(key);
      });
      parsed.search = params.toString();
      const path = parsed.pathname.toLowerCase().replace(/\/$/, '');
      const search = parsed.searchParams.toString();
      return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${path}${search ? `?${search}` : ''}`;
    } catch {
      return value.toLowerCase().replace(/^https?:\/\//, '').replace(/[#?].*$/i, '');
    }
  }

  function articleIdentityKeys(item) {
    if (!item) return [];
    const signals = Array.isArray(item.sourceSignals) ? item.sourceSignals : [];
    const rawUrls = [
      item.canonicalUrl,
      item.sourceUrl,
      item.url,
      item.link,
      item.primaryLink?.url,
      ...signals.flatMap((signal) => [signal?.canonicalUrl, signal?.url]),
    ];
    const urls = [...new Set(rawUrls.map(canonicalUrlForDedup).filter(Boolean))];
    const keys = urls.map((url) => `url:${url}`);
    const id = String(item.id ?? '').trim();
    if (id) keys.push(`id:${id}`);

    const title = normalizeTopicFingerprint(item.title ?? '');
    const publishedDay = articlePublishedDay(item);
    if (title.length >= 18 && publishedDay) {
      const hosts = [...new Set(urls.map((url) => url.split('/')[0]).filter(Boolean))];
      hosts.forEach((host) => keys.push(`title-source-day:${title}::${host}::${publishedDay}`));
    }
    return [...new Set(keys)];
  }

  function createArticleIdentitySet(items = []) {
    return new Set((Array.isArray(items) ? items : []).flatMap(articleIdentityKeys));
  }

  function hasArticleIdentityOverlap(item, identitySet) {
    if (!(identitySet instanceof Set) || !identitySet.size) return false;
    return articleIdentityKeys(item).some((key) => identitySet.has(key));
  }

  function articleIdentityKey(item) {
    return articleIdentityKeys(item)[0] ?? `title:${normalizeTopicFingerprint(item?.title ?? '')}`;
  }

  function articlePublishedDay(item) {
    const value = item?.publishedAt
      ?? item?.capturedAt
      ?? item?.generatedAt
      ?? item?.sourceSignals?.[0]?.publishedAt;
    const time = new Date(value ?? '').getTime();
    return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
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
    const baseCategories = normalizeCategories(topic.categories, topic.category);
    const categories = isAdultNewsContent(topic) && !baseCategories.includes('adult')
      ? ['adult', ...baseCategories]
      : baseCategories;
    const suppliedLabels = Array.isArray(topic.categoryLabels) ? topic.categoryLabels : [];
    const labelsByCategory = new Map(baseCategories.map((category, index) => [
      category,
      suppliedLabels[index] ?? categoryLabelFor(category),
    ]));
    const displayCategories = categories.length > 1
      ? [...categories.filter((category) => category !== 'matome'), ...categories.filter((category) => category === 'matome')]
      : categories;
    return displayCategories.slice(0, 2).map((category) => labelsByCategory.get(category) ?? categoryLabelFor(category)).join(' / ');
  }

  function matchesNewsCategory(topic, category) {
    if (!category || category === 'all') return true;
    if (category === 'general') return String(topic?.category ?? '') === 'general';
    if (category === 'adult') return hasCategory(topic, 'adult') || isAdultNewsContent(topic);
    return hasCategory(topic, category);
  }

  function isAdultNewsContent(topic) {
    const text = topicText(topic);
    return /(アダルト|成人向け|18禁|r-?18|porn|fanza|dlsite|dmm|av女優|アダルトビデオ|同人音声|同人ゲーム|エロ漫画|エロゲ|美少女ゲーム|グラビア|水着|ビキニ|ランジェリー|コスプレ|セクシーショット|美ボディ|美バスト|美尻|谷間|美少女.{0,12}フィギュア|水着.{0,12}フィギュア|セクシー.{0,12}フィギュア)/i.test(text);
  }

  // General-news listings deliberately keep article identity separate from
  // story similarity. A story is a display wrapper, never a metadata merge.
  function sanitizeNewsArticleUrl(value) {
    const raw = String(value ?? '').trim();
    if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f\\]/u.test(raw)) return '';
    try {
      const url = new URL(raw);
      if (!url.hostname || url.username || url.password) return '';
      const path = decodeURIComponent(url.pathname);
      const meaningfulParams = [...url.searchParams.keys()].filter((key) => !/^utm_/i.test(key) && !/^(ref|src|from|source|fbclid|gclid|yclid|oc)$/i.test(key));
      const indexPath = /^\/(?:index\.(?:html?|php)|home)?\/*$/i.test(path);
      if (indexPath && !meaningfulParams.some((key) => /^(?:p|id|article_id|story_id)$/i.test(key))) return '';
      if (/^\/(?:search|tags?|categories?|category|news|topics)(?:\.(?:html?|php))?\/*$/i.test(path)) return '';
      if (meaningfulParams.some((key) => /^(?:q|query|search|s)$/i.test(key)) && /(?:^|\/)search(?:\/|$)/i.test(path)) return '';
      if (/\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp|ico|pdf|mp4|m4v|mov|webm|mp3|m4a|wav|ogg|ogv)$/i.test(path)) return '';
      if (['format', 'fm', 'ext'].some((key) => /^(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.searchParams.get(key) ?? ''))) return '';
      return raw;
    } catch {
      return '';
    }
  }

  function newsArticleUrlKey(value) {
    const safe = sanitizeNewsArticleUrl(value);
    if (!safe) return '';
    const url = new URL(safe);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(ref|src|from|source|fbclid|gclid|yclid|oc)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    // Paths and meaningful query values are case-sensitive article identity.
    return url.hostname.toLowerCase().replace(/^www\./, '') + (url.port ? ':' + url.port : '') + url.pathname.replace(/\/$/, '') + url.search;
  }

  function getNewsArticleSource(item) {
    const signals = Array.isArray(item?.sourceSignals) ? item.sourceSignals : [];
    const ownCandidates = [item?.sourceUrl, item?.url, item?.link, item?.primaryLink?.url, item?.canonicalUrl];
    let url = ownCandidates.map(sanitizeNewsArticleUrl).find(Boolean) ?? '';
    let signal = null;
    if (!url) {
      // A bad/homepage primary URL is not permission to use another cluster
      // member's destination. A fallback needs this article's exact headline.
      const titleKey = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[「」『』“”"\s]/gu, '').trim();
      const title = titleKey(item?.title);
      signal = signals.find((value) => title.length >= 12 && titleKey(value?.title) === title && sanitizeNewsArticleUrl(value?.url));
      url = sanitizeNewsArticleUrl(signal?.url);
    }
    if (!url) return null;
    const key = newsArticleUrlKey(url);
    signal ??= signals.find((value) => newsArticleUrlKey(value?.url) === key);
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const label = String(signal?.sourceName ?? signal?.source ?? item?.sourceName ?? item?.source ?? host).trim() || host;
    return { url, key, host, label };
  }

  function dedupeNewsArticles(items) {
    const seen = new Set();
    return items.filter((item) => {
      const source = getNewsArticleSource(item);
      // Do not use shared titles, generated IDs or a cluster's other signals as
      // proof that two separate articles are interchangeable.
      if (!source) return false;
      if (seen.has(source.key)) return false;
      seen.add(source.key);
      return true;
    });
  }

  function storyHeadline(item, source) {
    let title = decodeHtmlEntities(item?.title ?? '').normalize('NFKC').trim();
    const publisher = String(source?.label ?? '').normalize('NFKC').trim();
    // Only remove a known publisher label, not arbitrary bracketed qualifiers
    // such as a person's name, sequel number, region or release stage.
    if (publisher) {
      for (const prefix of ['[' + publisher + ']', '【' + publisher + '】']) {
        if (title.startsWith(prefix)) title = title.slice(prefix.length).trim();
      }
      for (const separator of [' - ', ' | ', '｜']) {
        const suffix = separator + publisher;
        if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
      }
    }
    title = title.replace(/^(?:【速報】|\[速報\])\s*/u, '');
    // Typographic differences and sentence-final announcement inflections are
    // the only near-match allowance. No bag-of-words/substring similarity:
    // swapping a name, number, action, or subject/object must remain separate.
    return title.toLowerCase()
      .replace(/(?:発表|公開|決定)(?:しました|した)(?=[。.!！]?\s*$)/u, (value) => value.replace(/しました|した/u, ''))
      .replace(/[「」『』“”‘’"'【】\[\]]/gu, '')
      .replace(/[〜～]/gu, '~')
      .replace(/[、,，。.!！\s]+/gu, '')
      .trim();
  }

  function storyComparison(item) {
    const source = getNewsArticleSource(item);
    const title = storyHeadline(item, source);
    const original = decodeHtmlEntities(item?.title ?? '').normalize('NFKC');
    const signals = Array.isArray(item?.sourceSignals) ? item.sourceSignals : [];
    const signal = signals.find((value) => newsArticleUrlKey(value?.url) === source?.key);
    const publishedAt = parseTimestamp(item?.publishedAt ?? signal?.publishedAt);
    const numbers = (original.match(/\d+(?:[.,]\d+)*/g) ?? []).sort().join('|');
    const recurring = /きょう|今日|本日|あす|明日|今朝|今週|今月|毎日|週間|ランキング|運勢|占い|ニュースまとめ/u.test(title);
    const eligible = Boolean(source && title.length >= 20 && !recurring);
    const quoted = [...original.matchAll(/[「『]([^「」『』]+)[」』]/gu)]
      .map((match) => storyHeadline({ title: match[1] })).filter((value) => value.length >= 12);
    // A long work name alone is not a story. This secondary path additionally
    // requires an explicit matching release date and the same release action.
    const releases = [...original.matchAll(/((?:20\d{2}年)?\d{1,2}月\d{1,2}日)(?:に|より|から)?(?:発売|配信|放送|上映|公開)/gu)]
      .map((match) => {
        let action = match[0].match(/発売|配信|放送|上映|公開/u)[0];
        if (/映画|ドキュメンタリー/u.test(original) && /上映|公開/u.test(action)) action = '映画上映';
        return match[1] + ':' + action;
      });
    const roles = new Map([...original.matchAll(/(主演|監督|著者|声優|演出|脚本|主催|会場)(?:は|の|に|が|[:：・]|\s)*([\p{Script=Han}\p{Script=Katakana}A-Za-z・]{2,20})/gu)]
      .map((match) => [match[1], match[2]]));
    for (const match of original.matchAll(/([\p{Script=Han}\p{Script=Katakana}A-Za-z・]{2,20})(?:氏|さん)?(主演|監督|著)/gu)) {
      roles.set('name-before-' + match[2], match[1]);
    }
    const qualifiers = (original.match(/体験版|製品版|リメイク|リマスター|通常版|限定版|特装版|再公開|再上映|再放送|中止|延期|予約|抽選/gu) ?? []).sort().join('|');
    const keys = eligible && publishedAt ? ['headline:' + title + ':' + numbers] : [];
    if (eligible && quoted.length === 1 && releases.length === 1 && (publishedAt || /^20\d{2}年/u.test(releases[0]))) {
      keys.push('release:' + quoted[0] + ':' + releases[0] + ':' + numbers);
    }
    const grams = new Set([...title].slice(1).map((_, index) => title.slice(index, index + 2)));
    return { source, title, publishedAt, numbers, roles, qualifiers, keys, grams };
  }

  function sameNewsStory(left, right) {
    if (!left.keys.length || !right.keys.length || left.numbers !== right.numbers) return false;
    const sameRelease = left.keys.some((key) => key.startsWith('release:') && right.keys.includes(key));
    if (left.publishedAt && right.publishedAt) {
      if (Math.abs(left.publishedAt - right.publishedAt) >= 24 * 60 * 60 * 1000) return false;
    } else if (!sameRelease || !left.keys.some((key) => key.startsWith('release:') && /:20\d{2}年/u.test(key))) {
      // An absolute release date can identify that scheduled event even in
      // legacy data missing publication time. Capture time is never substituted.
      return false;
    }
    for (const [role, name] of left.roles) {
      if (right.roles.has(role) && right.roles.get(role) !== name) return false;
    }
    if (left.title === right.title) return true;
    if (!sameRelease || left.qualifiers !== right.qualifiers) return false;
    const overlap = [...left.grams].filter((gram) => right.grams.has(gram)).length;
    return 2 * overlap / (left.grams.size + right.grams.size) >= 0.6;
  }

  function groupNewsStories(items = []) {
    const groups = [];
    const byKey = new Map();
    const articles = (Array.isArray(items) ? items : []).flatMap((item) => Array.isArray(item?.storyArticles) ? item.storyArticles : [item]);
    for (const item of dedupeNewsArticles(articles)) {
      const comparison = storyComparison(item);
      const candidates = [...new Set(comparison.keys.flatMap((key) => byKey.get(key) ?? []))];
      // Complete-link evidence and time checks prevent A~B~C chaining. Never
      // compare only to an evolving representative or combine article fields.
      let group = candidates.find((candidate) => candidate.comparisons.every((other) => sameNewsStory(other, comparison)));
      if (group) {
        group.articles.push(item);
        group.comparisons.push(comparison);
      } else {
        group = { articles: [item], comparisons: [comparison] };
        groups.push(group);
      }
      for (const key of comparison.keys) {
        const matches = byKey.get(key) ?? [];
        if (!matches.includes(group)) matches.push(group);
        byKey.set(key, matches);
      }
    }
    return groups.map(({ articles }) => articles.length > 1
      ? { ...articles[0], storyArticles: articles }
      : articles[0]);
  }

  function newsStoryArticleCount(items = []) {
    return items.reduce((total, item) => total + (item.storyArticles?.length || 1), 0);
  }

  function formatNewsStoryCount(items = []) {
    const articleCount = newsStoryArticleCount(items);
    return items.length + ' 話題' + (articleCount > items.length ? '・' + articleCount + '記事' : '');
  }

  function renderStorySources(item) {
    const articles = Array.isArray(item?.storyArticles) ? item.storyArticles : [];
    if (articles.length < 2) return '';
    const sources = articles.map((article) => ({ article, source: getNewsArticleSource(article) })).filter(({ source }) => source);
    if (sources.length < 2) return '';
    const publisherCount = new Set(sources.map(({ source }) => source.host)).size;
    return '<details class="news-story-sources"><summary>同じニュースの記事 ' + sources.length + '件（' + publisherCount + '媒体）</summary>' +
      '<ul>' + sources.map(({ article, source }, index) => '<li><a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<strong>' + escapeHtml(source.label) + (index === 0 ? '（表示中）' : '') + '</strong><span>' + escapeHtml(article.title ?? '') + ' ↗</span></a></li>').join('') + '</ul></details>';
  }

  function prepareNewsListItems(topics) {
    return dedupeNewsArticles(Array.isArray(topics) ? topics : [])
      .map(restoreNewsEditorialSections)
      .map(sanitizeNewsSummaryMarkup)
      .filter((topic) => isGeneralNewsListItem(topic))
      .sort((left, right) => {
        const timeDiff = Number(archiveTimestamp(right) ?? 0) - Number(archiveTimestamp(left) ?? 0);
        if (timeDiff !== 0) return timeDiff;
        return Number(right?.score ?? 0) - Number(left?.score ?? 0);
      });
  }

  function restoreNewsEditorialSections(topic) {
    const categories = normalizeCategories(topic?.categories, topic?.category);
    const added = (window.ArticleCategoryQuality?.getArticleEditorialSectionCategories(topic) ?? [])
      .filter((category) => !categories.includes(category));
    if (!added.length) return topic;
    const restored = [...categories.filter((category) => category !== 'general'), ...added, ...categories.filter((category) => category === 'general')];
    return { ...topic, category: restored[0], categories: restored,
      categoryLabel: categoryLabelFor(restored[0]), categoryLabels: restored.map(categoryLabelFor) };
  }

  function isGeneralNewsListItem(topic) {
    if (!topic || !String(topic.title ?? '').trim()) return false;

    const sourceUrl = generalNewsSourceUrl(topic);
    const text = topicText(topic);
    const sourceName = String(
      topic?.sourceName
        ?? topic?.source
        ?? topic?.sourceSignals?.[0]?.sourceName
        ?? topic?.sourceSignals?.[0]?.source
        ?? ''
    ).toLowerCase();
    const thumbnailUrl = String(topic?.thumbnailUrl ?? topic?.thumbnail ?? '').toLowerCase();

    if (!sourceUrl) return false;
    if (/読み込み失敗|リンクなし|整理中です|&#x[0-9a-f]+;|&#\d+;|&amp;#/.test(`${topic.title ?? ''} ${topic.summary ?? ''} ${text}`)) return false;
    if (/japanese-tech-writing\/skill|\/skill\.md\b|\/readme\b/.test(text)) return false;
    if (sourceName.includes('はてな') && /githubassets\.com\/assets\/gist-og-image|anond\.hatelabo\.jp\/assets\//.test(thumbnailUrl)) return false;

    const sourceHost = generalNewsSourceHost(sourceUrl);
    if (/(pr times|共同通信prワイヤー|valuepress|＠press|atpress|dream news|ドリームニュース|newscast|プレスリリース|スポンサー|タイアップ|広告|中古品)/i.test(text)) return false;
    if (/\.(?:org|xyz|top|site)$/i.test(sourceHost)) return false;
    if (/cfecgc-orange\.org|mercari|ラクマ|paypayフリマ/i.test(`${sourceHost} ${text}`)) return false;

    const locale = String(
      topic?.language
        ?? topic?.lang
        ?? topic?.locale
        ?? topic?.sourceSignals?.[0]?.language
        ?? topic?.sourceSignals?.[0]?.locale
        ?? ''
    ).toLowerCase();
    if (locale && !/(^ja\b|japan|ja-jp)/.test(locale)) return false;
    if (/bbc\.com$|bbc\.co\.uk$|cnn\.com$|reuters\.com$|telegram\.org$/.test(sourceHost)) return false;

    const languageText = `${topic.title ?? ''} ${topic.summary ?? ''} ${topic.briefSummary ?? ''}`.replace(/\s+/g, '');
    const japaneseCount = (languageText.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length;
    const latinCount = (languageText.match(/[A-Za-z]/g) ?? []).length;
    return !languageText || (japaneseCount >= Math.max(8, Math.floor(latinCount * 0.35)) && (latinCount < 24 || japaneseCount > 4));
  }

  function generalNewsSourceUrl(topic) {
    const candidates = [
      topic?.sourceUrl,
      topic?.url,
      topic?.link,
      getPrimarySourceUrl(topic),
    ];
    return candidates.find((value) => /^https?:\/\//i.test(String(value ?? '').trim())) ?? '';
  }

  function generalNewsSourceHost(sourceUrl) {
    try {
      return new URL(sourceUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  }

  function dedupeTopicsFuzzy(topics) {
    const kept = [];
    const signatures = [];
    for (const topic of topics) {
      const signature = topicComparisonSignature(topic);
      const duplicateIndex = signatures.findIndex((current) => isNearDuplicateTopic(current, signature));
      if (duplicateIndex === -1) {
        kept.push(topic);
        signatures.push(signature);
        continue;
      }
      kept[duplicateIndex] = mergeDuplicateTopics(kept[duplicateIndex], topic);
      // Merges may replace titles, URLs, dates and categories. Cache only within
      // this pass and recompute the merged record before the next comparison.
      signatures[duplicateIndex] = topicComparisonSignature(kept[duplicateIndex]);
    }
    return kept;
  }

  function topicComparisonSignature(topic) {
    const title = normalizeTopicFingerprint(topic.title ?? '');
    const url = canonicalTopicSourceSignature(topic);
    const key = `${title}::${url}`;
    return {
      title,
      url,
      key,
      titleTokens: distinctiveTokens(title),
      keyTokens: distinctiveTokens(key),
      categories: normalizeCategories(topic.categories, topic.category),
      publishedAt: topicPublishedAt(topic),
    };
  }

  function isNearDuplicateTopic(current, next) {
    if (current.url && next.url && current.url === next.url) return true;
    if (isLikelySameStory(current, next)) return true;
    if (!current.categories.some((category) => next.categories.includes(category))) return false;
    if (!current.key || !next.key) return false;
    if (current.key.includes(next.key) || next.key.includes(current.key)) {
      return Math.min(current.key.length, next.key.length) >= 18;
    }
    const currentTokens = current.keyTokens;
    const nextTokens = next.keyTokens;
    if (currentTokens.length < 3 || nextTokens.length < 3) return false;
    const overlap = currentTokens.filter((token) => nextTokens.includes(token)).length;
    return overlap >= 3 && overlap / Math.min(currentTokens.length, nextTokens.length) >= 0.78;
  }

  function distinctiveTokens(value) {
    return [...new Set(String(value ?? '').split(' ').filter((token) => token.length >= 2 && !GENERIC_TOPIC_TOKENS.has(token)))];
  }

  function isLikelySameStory(current, next) {
    const currentTitle = current.title;
    const nextTitle = next.title;
    if (!currentTitle || !nextTitle) return false;

    const sameTitle = currentTitle === nextTitle || currentTitle.includes(nextTitle) || nextTitle.includes(currentTitle);
    const currentPublishedAt = current.publishedAt;
    const nextPublishedAt = next.publishedAt;
    if (sameTitle) {
      if (currentPublishedAt == null || nextPublishedAt == null) return true;
      return Math.abs(currentPublishedAt - nextPublishedAt) <= 36 * 60 * 60 * 1000;
    }

    const currentTokens = current.titleTokens;
    const nextTokens = next.titleTokens;
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
    articleIdentityKey,
    articleIdentityKeys,
    buildImportantPoint,
    buildGoogleNewsUrl,
    buildTargetAudience,
    buildWhyHotLabel,
    buildCardThumbnail,
    buildArticleTitleLink,
    categoryDisplayLabel,
    categoryLabelFor,
    createArticleIdentitySet,
    decodeHtmlEntities,
    dedupeTopics,
    defaultSearchQueryForCategory,
    escapeHtml,
    formatDate,
    formatTopicDisplayTime,
    hasCategory,
    hasArticleIdentityOverlap,
    hasVisibleSummary,
    isAdultNewsContent,
    isGeneralNewsListItem,
    isWithinRange,
    matchesNewsCategory,
    mergeReports,
    normalizeTopic,
    normalizeSummaryMarkup,
    prepareNewsListItems,
    getNewsArticleSource,
    groupNewsStories,
    newsStoryArticleCount,
    formatNewsStoryCount,
    renderStorySources,
    sanitizeArticleSummaryCollection,
    getPrimarySourceLabel,
    getPrimarySourceSignal,
    getPrimarySourceUrl,
    getCardImageCandidates,
    handleCardImageError,
    isWeakThumbnailUrl,
    pickCardImageUrl,
    shortEventFromTitle,
    topicText,
  };
})();
