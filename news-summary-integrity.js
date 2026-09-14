(function attachNewsSummaryIntegrity(global) {
  const TRACKING_PARAMS = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'ref',
    'src',
    'from',
  ]);
  const GENERIC_TERMS = new Set([
    'ニュース',
    '速報',
    '記事',
    '情報',
    '話題',
    '発表',
    '公開',
    '開始',
    '決定',
    '最新',
    '本日',
    '今日',
    '今回',
    '明らか',
    'news',
  ]);
  const INVALID_SUMMARY_MAX_LENGTH = 600;
  const INVALID_SUMMARY_PATTERNS = [
    /^.+に一致する(?:記事|検索結果|ページ|情報)(?:は|が)?(?:見つかりません|ありません|存在しません)(?:でした)?[。.!]?$/u,
    /^(?:検索結果|該当する(?:記事|ページ|情報)|条件に一致する(?:記事|ページ|情報))(?:は|が)?(?:見つかりません|ありません|存在しません)(?:でした)?[。.!]?$/u,
    /^(?:お探しの|指定された|要求された)?(?:ページ|記事)(?:は|が)?(?:見つかりません|存在しません|削除されました|ご利用いただけません)(?:でした)?[。.!]?$/u,
    /^(?:(?:http\s*)?(?:403|404|500|502|503|504)(?:\s*(?:error|エラー))?|(?:error|エラー)\s*(?:403|404|500|502|503|504))(?:[\s:：\-|]*(?:access denied|forbidden|not found|internal server error|service unavailable|bad gateway|gateway timeout|ページが見つかりません|アクセスが拒否されました))?[。.!]?$/iu,
    /^(?:access denied|forbidden|not found|internal server error|service unavailable|bad gateway|gateway timeout)[。.!]?$/iu,
    /^(?:no (?:search )?results?(?: were| was)? found|your search did not match any (?:documents|results)|we (?:could not|couldn't) find any results)[。.!]?$/iu,
    /^(?:just a moment|attention required|checking your browser|security check)(?:[。.!]?\s+.+|[。.!])?$/iu,
    /^(?:(?:please\s+)?(?:verify|confirm).*(?:human|captcha).*|(?:captcha|bot|challenge)\s+(?:verification|required|detected|check).*)$/iu,
    /^(?:ロボットではないこと|人間であること).*(?:確認|証明).*[。.!]?$/u,
    /^(?:アクセスが拒否されました|アクセスは制限されています|このページへのアクセス(?:が拒否されました|は制限されています|権限がありません|はできません))[。.!]?$/u,
    /^(?:(?:please\s+)?enable javascript(?: and cookies)?(?: to continue)?|javascript (?:is disabled|required)|現在javascriptが無効になっています|javascriptを有効にしてください)(?:[。.!].*)?$/iu,
    /^(?:(?:we use|this (?:site|website) uses?) cookies|enable javascript and cookies to continue)(?:[。.!].*)?$/iu,
    /^(?:cookieの使用(?:について|に同意してください)|cookieを(?:有効に|許可)してください)(?:[。.!]|\s.+)?$/iu,
  ];

  function canonicalArticleUrl(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) return '';
    try {
      const parsed = new URL(value);
      parsed.hash = '';
      for (const key of [...parsed.searchParams.keys()]) {
        if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
          parsed.searchParams.delete(key);
        }
      }
      parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
      parsed.searchParams.sort();
      return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
    } catch {
      return value.toLowerCase().replace(/#.*$/u, '');
    }
  }

  function articleIdentityKeys(item = {}) {
    const keys = new Set();
    const addUrl = (value) => {
      const normalized = canonicalArticleUrl(value);
      if (normalized) keys.add(`url:${normalized}`);
    };

    addUrl(item.sourceUrl);
    addUrl(item.canonicalUrl);
    addUrl(item.url);
    addUrl(item.link);
    for (const signal of Array.isArray(item.sourceSignals) ? item.sourceSignals : []) {
      addUrl(signal?.canonicalUrl);
      addUrl(signal?.url);
    }
    for (const link of Array.isArray(item.searchLinks) ? item.searchLinks : []) {
      addUrl(link?.canonicalUrl);
      addUrl(link?.url);
    }

    const id = String(item.id ?? '').trim();
    if (id) keys.add(`id:${id}`);
    return keys;
  }

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeTitle(value) {
    return normalizeText(value)
      .replace(/[\s\p{P}\p{S}]+/gu, '')
      .replace(/(?:速報|動画|写真|ニュース|news)/giu, '');
  }

  function isInvalidArticleSummary(value) {
    const text = normalizeText(value);
    if (!text || text.length > INVALID_SUMMARY_MAX_LENGTH) return false;
    return INVALID_SUMMARY_PATTERNS.some((pattern) => pattern.test(text));
  }

  function meaningfulTerms(value) {
    const text = normalizeText(value);
    const terms = new Set();
    const add = (term) => {
      const normalized = String(term ?? '').replace(/[\s\p{P}\p{S}]+/gu, '').trim();
      if (normalized.length < 2 || GENERIC_TERMS.has(normalized)) return;
      terms.add(normalized);
    };

    for (const match of text.matchAll(/[「『【\[]([^」』】\]]{2,40})[」』】\]]/gu)) add(match[1]);
    for (const match of text.matchAll(/[a-z][a-z0-9+._-]{2,}|\d{3,}/giu)) add(match[0]);
    for (const match of text.matchAll(/[\p{Script=Katakana}ー]{3,}/gu)) add(match[0]);
    for (const match of text.matchAll(/[\p{Script=Han}]{2,}/gu)) {
      const term = match[0];
      add(term);
      if (term.length >= 4) {
        for (let index = 0; index <= term.length - 3; index += 1) add(term.slice(index, index + 3));
      }
    }
    return [...terms];
  }

  function cjkTrigrams(value) {
    const compact = normalizeText(value).replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/gu, '');
    const values = new Set();
    for (let index = 0; index <= compact.length - 3; index += 1) {
      const value = compact.slice(index, index + 3);
      if (!GENERIC_TERMS.has(value)) values.add(value);
    }
    return values;
  }

  function hasSummaryTitleAlignment(summary, title, contextTexts = []) {
    const summaryText = normalizeText(summary);
    const titleText = normalizeText(title);
    if (!summaryText) return false;
    if (isInvalidArticleSummary(summaryText)) return false;
    if (!titleText) return true;

    const normalizedSummary = normalizeTitle(summaryText);
    const normalizedTitle = normalizeTitle(titleText);
    if (normalizedTitle.length >= 5 && normalizedSummary.includes(normalizedTitle)) return true;
    if (normalizedSummary.length >= 8 && normalizedTitle.includes(normalizedSummary)) return true;

    const referenceTexts = [titleText, ...contextTexts.filter(Boolean)];
    const referenceTerms = [...new Set(referenceTexts.flatMap(meaningfulTerms))];
    if (!referenceTerms.length) return true;

    const strongMatches = referenceTerms.filter((term) => term.length >= 3 && summaryText.includes(term));
    if (strongMatches.length) return true;

    const shortMatches = referenceTerms.filter((term) => term.length === 2 && summaryText.includes(term));
    if (shortMatches.length >= 2) return true;

    const summaryTrigrams = cjkTrigrams(summaryText);
    for (const referenceText of referenceTexts) {
      const matchingTrigrams = [...cjkTrigrams(referenceText)].filter((gram) => summaryTrigrams.has(gram));
      if (matchingTrigrams.length >= 2) return true;
    }

    return false;
  }

  function titlesReferToSameArticle(leftTitle, rightTitle) {
    const left = normalizeTitle(leftTitle);
    const right = normalizeTitle(rightTitle);
    if (!left || !right) return false;
    if (left === right) return true;
    if (Math.min(left.length, right.length) >= 10 && (left.includes(right) || right.includes(left))) return true;
    const leftTerms = meaningfulTerms(leftTitle);
    const rightTerms = new Set(meaningfulTerms(rightTitle));
    const overlap = leftTerms.filter((term) => term.length >= 3 && rightTerms.has(term));
    return overlap.length >= 2;
  }

  function articlesShareIdentity(left, right) {
    const leftKeys = articleIdentityKeys(left);
    const rightKeys = articleIdentityKeys(right);
    for (const key of leftKeys) {
      if (rightKeys.has(key)) return true;
    }
    return titlesReferToSameArticle(left?.title, right?.title);
  }

  function summaryContextTexts(item) {
    return [
      item?.description,
      item?.sourceDescription,
    ].filter(Boolean);
  }

  function sanitizeArticleSummaryFields(item = {}) {
    const contextTexts = summaryContextTexts(item);
    const summary = hasSummaryTitleAlignment(item.summary, item.title, contextTexts) ? String(item.summary ?? '') : '';
    const briefSummary = hasSummaryTitleAlignment(item.briefSummary, item.title, contextTexts) ? String(item.briefSummary ?? '') : '';
    const sourceSignals = Array.isArray(item.sourceSignals)
      ? item.sourceSignals.map((signal) => {
        const signalTitle = signal?.title || item.title;
        const signalContext = signal?.title && item.title ? [item.title] : [];
        return {
          ...signal,
          summary: hasSummaryTitleAlignment(signal?.summary, signalTitle, signalContext) ? String(signal?.summary ?? '') : '',
          briefSummary: hasSummaryTitleAlignment(signal?.briefSummary, signalTitle, signalContext) ? String(signal?.briefSummary ?? '') : '',
        };
      })
      : item.sourceSignals;

    return {
      ...item,
      summary,
      briefSummary,
      sourceSignals,
    };
  }

  function normalizedSummaryKey(value) {
    return normalizeText(value).replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  function sanitizeArticleSummaryCollection(items = []) {
    const sanitized = (Array.isArray(items) ? items : []).map(sanitizeArticleSummaryFields);
    for (const field of ['summary', 'briefSummary']) {
      const groups = new Map();
      sanitized.forEach((item, index) => {
        const key = normalizedSummaryKey(item?.[field]);
        if (!key || key.length < 24) return;
        groups.set(key, [...(groups.get(key) ?? []), index]);
      });

      for (const indexes of groups.values()) {
        if (indexes.length < 2) continue;
        const unrelated = indexes.some((index, offset) => indexes.slice(offset + 1).some((otherIndex) => (
          !articlesShareIdentity(sanitized[index], sanitized[otherIndex])
        )));
        if (!unrelated) continue;
        for (const index of indexes) sanitized[index] = { ...sanitized[index], [field]: '' };
      }
    }
    return sanitized;
  }

  global.NewsSummaryIntegrity = Object.freeze({
    articleIdentityKeys,
    articlesShareIdentity,
    canonicalArticleUrl,
    hasSummaryTitleAlignment,
    isInvalidArticleSummary,
    sanitizeArticleSummaryCollection,
    sanitizeArticleSummaryFields,
    titlesReferToSameArticle,
  });
})(globalThis);
