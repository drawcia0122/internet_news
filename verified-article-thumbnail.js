(function attachVerifiedArticleThumbnail(global) {
  function yahooUrl(value, kind) {
    try {
      const url = new URL(value);
      const path = kind === 'pickup' ? /^\/pickup\/\d+\/?$/ : /^\/articles\/[a-f0-9]{40}\/?$/;
      if (url.protocol !== 'https:' || url.hostname !== 'news.yahoo.co.jp' || url.username || url.password || url.port || !path.test(url.pathname)) return '';
      return url.origin + url.pathname.replace(/\/$/, '');
    } catch { return ''; }
  }

  function articleImageUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'newsatcl-pctr.c.yimg.jp' || url.username || url.password || url.port || url.hash
        || !/^\/t\/amd-img\/\d{8}-[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return '';
      if ([...url.searchParams].some(([key, value]) => key !== 'exp' || !/^\d{1,8}$/.test(value))) return '';
      return url.href;
    } catch { return ''; }
  }

  const normalizeTitle = (value) => String(value ?? '').normalize('NFKC').trim();

  function getYahooThumbnailOwner(item) {
    const title = normalizeTitle(item?.title);
    if (!title) return null;
    const direct = [item.sourceUrl, item.canonicalUrl, item.url, item.link, item.primaryLink?.url].filter(Boolean);
    const sources = direct.length ? direct : (Array.isArray(item.sourceSignals) ? item.sourceSignals : [])
      .filter((signal) => normalizeTitle(signal?.title) === title)
      .flatMap((signal) => [signal.url, signal.canonicalUrl]).filter(Boolean);
    // A source from a neighbouring article (even one with the same headline)
    // must never establish ownership of the image.
    const keys = [...new Set(sources.map((url) => yahooUrl(url, 'pickup') || yahooUrl(url, 'article')))];
    if (keys.length !== 1 || !keys[0]) return null;
    return { url: keys[0], title, kind: keys[0].includes('/pickup/') ? 'pickup' : 'article' };
  }

  function getArticleThumbnail(item) {
    const photo = item?.articleThumbnail;
    if (!photo) return null;
    const owner = getYahooThumbnailOwner(item);
    const articleUrl = yahooUrl(photo.articleUrl, 'article');
    const imageUrl = articleImageUrl(photo.imageUrl);
    if (!owner || !articleUrl || !imageUrl || imageUrl !== photo.imageUrl || !normalizeTitle(photo.articleTitle)) return null;
    if (!Number.isFinite(photo.width) || !Number.isFinite(photo.height) || photo.width < 320 || photo.height < 120) return null;
    if (owner.kind === 'pickup' && photo.kind === 'yahoo-main-article-og'
      && owner.url === yahooUrl(photo.pickupUrl, 'pickup') && owner.title === normalizeTitle(photo.pickupTitle)) return photo;
    if (owner.kind === 'article' && photo.kind === 'yahoo-direct-article-og'
      && owner.url === articleUrl && owner.title === normalizeTitle(photo.ownerTitle)) return photo;
    return null;
  }

  global.VerifiedArticleThumbnail = { yahooUrl, articleImageUrl, getYahooThumbnailOwner, getArticleThumbnail };
})(globalThis);
