(function attachArticleCategoryQuality(global) {
  const POKEMON_BRAND_PATTERN = /(?:ポケモン|ポケットモンスター|ピカチュウ|ポケカ|(?<![a-z])pok[eé]mon(?:\s*(?:go|home))?(?![a-z])|(?<![a-z])pok[eé]park(?![a-z]))/iu;
  const POKEMON_TAG_PATTERN = /^(?:pokemon|pokémon|ポケモン)$/iu;
  const YAHOO_EDITORIAL_SECTIONS = { 'yahoo-sports': 'sports', 'yahoo-world': 'world', 'yahoo-business': 'business' };

  function yahooArticleIdentity(value) {
    try {
      const url = new URL(String(value ?? ''));
      if (!/^https?:$/.test(url.protocol) || url.hostname !== 'news.yahoo.co.jp') return '';
      if (!/^\/(?:pickup\/\d+|articles\/[a-z0-9]+)\/?$/i.test(url.pathname)) return '';
      return url.hostname + url.pathname.replace(/\/$/, '');
    } catch { return ''; }
  }

  // Only dedicated editorial sections qualify. A broad publisher tag or a
  // secondary story in a cluster must never relabel the primary article.
  function getArticleEditorialSectionCategories(article) {
    const signals = Array.isArray(article?.sourceSignals) ? article.sourceSignals : [];
    const primaryUrl = article?.sourceUrl ?? article?.url ?? article?.link ?? article?.primaryLink?.url ?? article?.canonicalUrl
      ?? signals[0]?.url ?? signals[0]?.canonicalUrl;
    const identity = yahooArticleIdentity(primaryUrl);
    const title = String(article?.title ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!identity || !title) return [];
    return [...new Set(signals.flatMap((signal) => {
      const category = Object.hasOwn(YAHOO_EDITORIAL_SECTIONS, signal?.sourceId) ? YAHOO_EDITORIAL_SECTIONS[signal.sourceId] : null;
      if (!category) return [];
      if (yahooArticleIdentity(signal?.url ?? signal?.canonicalUrl) !== identity) return [];
      if (String(signal?.title ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim() !== title) return [];
      return [category];
    }))];
  }

  function articleBrandText(article) {
    return [
      article?.title,
      article?.summary,
      article?.briefSummary,
      article?.description,
      article?.whatHappened,
      ...(Array.isArray(article?.sourceSignals) ? article.sourceSignals.flatMap((signal) => [
        signal?.title,
        signal?.summary,
        signal?.description,
      ]) : []),
    ].filter(Boolean).join(' ');
  }

  function isOfficialPokemonSource(article) {
    const candidates = [article, ...(Array.isArray(article?.sourceSignals) ? article.sourceSignals : [])];
    return candidates.some((signal) => {
      if (String(signal?.sourceGroup ?? '').toLowerCase() === 'pokemon' && signal?.official) return true;
      const rawUrl = signal?.canonicalUrl ?? signal?.url ?? signal?.sourceUrl ?? '';
      try {
        const host = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
        return signal?.official && (host === 'pokemon.co.jp' || host.endsWith('.pokemon.co.jp'));
      } catch {
        return false;
      }
    });
  }

  function hasPokemonBrandSignal(article) {
    return POKEMON_BRAND_PATTERN.test(articleBrandText(article)) || isOfficialPokemonSource(article);
  }

  function sanitizeArticleSourceTags(sourceTags, article) {
    const tags = Array.isArray(sourceTags) ? sourceTags : [];
    if (hasPokemonBrandSignal(article)) return tags;
    return tags.filter((tag) => !POKEMON_TAG_PATTERN.test(String(tag ?? '').trim()));
  }

  function hasOnlyStoreReviewFeatureEvidence(value) {
    const text = String(value ?? '').normalize('NFKC');
    // Store ratings are not the publisher's editorial review. Remove only
    // explicit store/user-review phrases; independent feature evidence wins.
    const withoutRatings = text.replace(/(?:steam\s*(?:の\s*)?(?:日本語\s*)?(?:ユーザー\s*)?|(?:日本語\s*)?ユーザー\s*)レビュー/giu, '');
    return withoutRatings !== text
      && !/インタビュー|開発秘話|制作裏話|コラム|特集|プレイレポート|先行プレイ|レビュー|技術解説|開発者ブログ|振り返り|開発者に聞く|体験レポ|ハンズオン/.test(withoutRatings);
  }

  function correctStoreReviewCategories(article, categories) {
    if (!categories.includes('game-features') || !hasOnlyStoreReviewFeatureEvidence(articleBrandText(article))) return categories;
    return [...new Set(categories.map((category) => category === 'game-features' ? 'games' : category))];
  }

  global.ArticleCategoryQuality = {
    hasOnlyStoreReviewFeatureEvidence,
    correctStoreReviewCategories,
    getArticleEditorialSectionCategories,
    hasPokemonBrandSignal,
    sanitizeArticleSourceTags,
  };
})(typeof window === 'undefined' ? globalThis : window);
