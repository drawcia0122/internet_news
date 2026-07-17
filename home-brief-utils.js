(function attachHomeBriefUtils(global) {
  const ADULT_BRIEF_PATTERN = /dlsite|fanza|dmm|同人音声|エロ漫画|\bav\b|成人向け|18禁|r-?18|adult[-\s]?trend|adult[-\s]?feature/i;

  function selectTodayNews(items, { limit = 10 } = {}) {
    const uniqueItems = [...new Map(items.map((item) => [todayItemKey(item), item])).values()];

    const preferred = [...uniqueItems]
      .filter((item) => isTodayNewsItem(item))
      .sort((left, right) => todayNewsRank(right) - todayNewsRank(left) || briefPublishedAt(right) - briefPublishedAt(left));

    if (preferred.length >= limit) {
      return diversifyTodayNews(preferred, limit);
    }

    const fallback = [...uniqueItems]
      .filter((item) => !isInternetOrOtakuBrief(item))
      .sort((left, right) => todayNewsRank(right) - todayNewsRank(left) || briefPublishedAt(right) - briefPublishedAt(left));

    return diversifyTodayNews([...new Map([...preferred, ...fallback].map((item) => [todayItemKey(item), item])).values()], limit);
  }

  function isTodayNewsItem(item) {
    const text = briefItemText(item);
    if (isInternetOrOtakuBrief(item) || isAdultBriefItem(item)) return false;
    if (/事件|事故|逮捕|起訴|判決|災害|地震|大雨|台風|避難|政治|首相|国会|選挙|経済|株価|金利|物価|国際|外交|戦況|芸能|スポーツ|生活|値上げ|制度|交通/.test(text)) return true;
    return ['政治', '経済', '国際', 'スポーツ', 'エンタメ', 'その他'].includes(String(item.categoryLabel ?? ''));
  }

  function isInternetOrOtakuBrief(item) {
    const text = briefItemText(item);
    return /ポケモン|pokemon|ゲーム|任天堂|nintendo|switch|steam|漫画|マンガ|アニメ|アダルト|同人|セール|ミーム|炎上|ネット文化/.test(text);
  }

  function isAdultBriefItem(item) {
    return ADULT_BRIEF_PATTERN.test(briefItemText(item));
  }

  function todayNewsRank(item) {
    const text = briefItemText(item);
    let score = briefPublishedAt(item);
    if (/事件|事故|逮捕|起訴|判決|災害|地震|大雨|台風|避難/.test(text)) score += 40;
    if (/政治|首相|国会|選挙|経済|株価|金利|物価|国際|外交|戦況/.test(text)) score += 24;
    if (/芸能|スポーツ/.test(text)) score += 12;
    return score;
  }

  function diversifyTodayNews(items, limit) {
    const buckets = new Map();
    for (const item of items) {
      const key = todayCategoryKey(item);
      const list = buckets.get(key) ?? [];
      list.push(item);
      buckets.set(key, list);
    }

    const orderedKeys = ['crime', 'general', 'sports', 'entertainment', 'politics', 'business', 'world', 'other'];
    const picked = [];
    const seen = new Set();

    for (const key of orderedKeys) {
      const bucket = buckets.get(key) ?? [];
      if (!bucket.length) continue;
      const item = bucket.shift();
      const dedupeKey = todayItemKey(item);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      picked.push(item);
      if (picked.length >= limit) return picked;
    }

    const maxPerBucket = 2;
    for (const key of orderedKeys) {
      const bucket = buckets.get(key) ?? [];
      let taken = picked.filter((item) => todayCategoryKey(item) === key).length;
      for (const item of bucket) {
        if (taken >= maxPerBucket) break;
        const dedupeKey = todayItemKey(item);
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        picked.push(item);
        taken += 1;
        if (picked.length >= limit) return picked;
      }
    }

    for (const item of items) {
      const dedupeKey = todayItemKey(item);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      picked.push(item);
      if (picked.length >= limit) break;
    }

    return picked;
  }

  function todayCategoryKey(item) {
    const text = briefItemText(item);
    const category = String(item?.categoryLabel ?? '').toLowerCase();
    if (/事件|事故|逮捕|起訴|判決|災害|地震|大雨|台風|避難|犯罪/.test(text) || /犯罪|事件/.test(category)) return 'crime';
    if (/芸能|エンタメ|文化/.test(text) || /エンタメ/.test(category)) return 'entertainment';
    if (/スポーツ|野球|サッカー|大会/.test(text) || /スポーツ/.test(category)) return 'sports';
    if (/政治|首相|国会|選挙/.test(text) || /政治/.test(category)) return 'politics';
    if (/経済|株価|金利|物価|企業|景気/.test(text) || /経済/.test(category)) return 'business';
    if (/国際|外交|中東|米国|中国|欧州|戦況/.test(text) || /国際/.test(category)) return 'world';
    if (/生活|交通|制度|お知らせ|発表|開始|再開|安全/.test(text) || /その他/.test(category)) return 'general';
    return 'other';
  }

  function todayItemKey(item) {
    const titleKey = String(item?.title ?? '').replace(/\s+/g, ' ').trim();
    return titleKey || String(item?.id ?? '').trim();
  }

  function briefItemText(item) {
    return [
      item?.title,
      item?.categoryLabel,
      item?.thirtySecondSummary,
      item?.watchpoints,
      item?.primaryLink?.label,
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function briefPublishedAt(item) {
    const timestamp = new Date(item?.publishedAt ?? 0).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function formatBriefTimelineTime(value) {
    const date = new Date(value ?? '');
    if (Number.isNaN(date.getTime())) return '時刻不明';
    return new Intl.DateTimeFormat('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function sanitizeBriefSummaryText(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';

    const sanitized = text
      .replace(/複数媒体(?:が|で)同一テーマを扱っており、情報の更新が早い。?/gu, '')
      .replace(/複数媒体が同じテーマを追っており、継続報道の局面に入っている。?/gu, '')
      .replace(/^\s*[,、\s]+|[,、\s]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!sanitized) return '情報を整理中です。';
    return sanitized;
  }

  global.HomeBriefUtils = {
    selectTodayNews,
    isAdultBriefItem,
    todayNewsRank,
    briefItemText,
    briefPublishedAt,
    formatBriefTimelineTime,
    sanitizeBriefSummaryText,
  };
})(window);
