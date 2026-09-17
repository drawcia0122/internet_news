(function attachArticleCategoryQuality(global) {
  const POKEMON_BRAND_PATTERN = /(?:ポケモン|ポケットモンスター|ピカチュウ|ポケカ|(?<![a-z])pok[eé]mon(?:\s*(?:go|home))?(?![a-z])|(?<![a-z])pok[eé]park(?![a-z]))/iu;
  const POKEMON_TAG_PATTERN = /^(?:pokemon|pokémon|ポケモン)$/iu;

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

  global.ArticleCategoryQuality = {
    hasPokemonBrandSignal,
    sanitizeArticleSourceTags,
  };
})(typeof window === 'undefined' ? globalThis : window);
