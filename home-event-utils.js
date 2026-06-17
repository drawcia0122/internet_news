(function () {
  function normalizeEventDateValue(value) {
    if (!value) return null;
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }

  function parseEventDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getTodayDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function daysBetween(left, right) {
    return Math.round((left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24));
  }

  function isEventOngoing(item, today = getTodayDate()) {
    const start = parseEventDate(item.startDate);
    const end = parseEventDate(item.endDate);
    if (start && today < start) return false;
    if (end && today > end) return false;
    return Boolean(start) && (!end || end >= today);
  }

  function isEventClosingSoon(item, today = getTodayDate()) {
    if (!isEventOngoing(item, today)) return false;
    const end = parseEventDate(item.endDate);
    if (!end) return false;
    const remainingDays = daysBetween(end, today);
    return remainingDays >= 0 && remainingDays <= 14;
  }

  function isLongRunningEvent(item) {
    return (item.tags ?? []).some((tag) => ['ongoing', 'large-scale', 'summer'].includes(tag));
  }

  function isCurrentMonthLimited(item) {
    const today = getTodayDate();
    const start = parseEventDate(item.startDate);
    const end = parseEventDate(item.endDate);
    if (!start || !end) return false;
    return start.getFullYear() === today.getFullYear()
      && end.getFullYear() === today.getFullYear()
      && start.getMonth() === today.getMonth()
      && end.getMonth() === today.getMonth();
  }

  function eventIntersectsMonth(item, monthStart) {
    const start = parseEventDate(item.startDate);
    if (!start) return false;
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const end = parseEventDate(item.endDate) ?? (isLongRunningEvent(item) ? new Date(2999, 11, 31) : start);
    return start <= monthEnd && end >= monthStart;
  }

  function eventStartsInMonth(item, monthStart) {
    const start = parseEventDate(item.startDate);
    return Boolean(start)
      && start.getFullYear() === monthStart.getFullYear()
      && start.getMonth() === monthStart.getMonth();
  }

  function calculateEventScore(item) {
    const text = [
      item.title,
      item.category,
      item.description,
      item.location,
      item.venue,
      ...(item.tags ?? []),
      ...(item.recommendationReasons ?? []),
    ].filter(Boolean).join(' ').toLowerCase();

    let score = 18;
    if (/pokemon|ポケモン/.test(text)) score += 20;
    if (/nintendo|switch|steam|ゲーム/.test(text)) score += 14;
    if (/漫画|マンガ|アニメ|声優/.test(text)) score += 12;
    if (/脱出ゲーム|リアル脱出ゲーム|謎解き|scrap/.test(text)) score += 16;
    if (/イマーシブ|没入/.test(text)) score += 14;
    if (/コラボカフェ|gratte|カフェ/.test(text)) score += 12;
    if (/ポップアップ|オンリーショップ|期間限定ショップ/.test(text)) score += 8;
    if (/sns-buzz|snsで話題|周年|記念|summer carnival/.test(text)) score += 10;
    if ((item.tags ?? []).includes('large-scale')) score += 8;
    if ((item.tags ?? []).includes('collaboration')) score += 6;
    if (/東京|東京都|秋葉原|池袋|渋谷|新宿|稲城市|千代田区|豊島区/.test(text)) score += 8;
    if (isEventOngoing(item, getTodayDate())) score += 10;
    if (!item.description || String(item.description).length < 28) score -= 12;
    if (!item.endDate && !isLongRunningEvent(item)) score -= 10;
    if ((item.tags ?? []).includes('local-only')) score -= 16;
    if ((item.tags ?? []).includes('small-scale')) score -= 10;
    score += Number(item.manualBoost ?? 0);
    score -= Number(item.manualPenalty ?? 0);
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function calculateClosingSoonScore(item) {
    const today = getTodayDate();
    if (!isEventOngoing(item, today)) return 0;
    const end = parseEventDate(item.endDate);
    if (!end) return 0;
    const remainingDays = daysBetween(end, today);
    if (remainingDays < 0 || remainingDays > 14) return 0;
    if (remainingDays === 0) return 100;
    if (remainingDays <= 3) return 88 - (remainingDays - 1) * 6;
    if (remainingDays <= 7) return 68 - (remainingDays - 4) * 4;
    return 48 - (remainingDays - 8) * 3;
  }

  function buildEventRecommendationReasons(item) {
    const reasons = [...(item.recommendationReasons ?? [])];
    const text = [item.title, item.category, ...(item.tags ?? [])].join(' ').toLowerCase();
    if (/pokemon|ポケモン/.test(text)) reasons.push('ポケモン好き向け');
    if (/脱出ゲーム|リアル脱出ゲーム|謎解き/.test(text)) reasons.push('脱出ゲーム好き向け');
    if (/anime|アニメ|漫画|マンガ/.test(text)) reasons.push('アニメ・漫画好き向け');
    if (/sns-buzz/.test(text)) reasons.push('SNSで話題');
    if (/東京|東京都|秋葉原|池袋|渋谷|新宿|稲城市|千代田区|豊島区/.test(item.location + ' ' + item.venue)) reasons.push('東京開催');
    if (isEventOngoing(item, getTodayDate())) reasons.push('開催中');
    if (isCurrentMonthLimited(item)) reasons.push('今月限定');
    return [...new Set(reasons)].slice(0, 4);
  }

  function eventStatusLabel(item) {
    if (isEventClosingSoon(item, getTodayDate())) return '終了間近';
    if (isEventOngoing(item, getTodayDate())) return '開催中';
    const start = parseEventDate(item.startDate);
    if (!start) return '日程確認';
    const now = getTodayDate();
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    if (start >= nextMonthStart) return '来月';
    return '今月';
  }

  function formatMonthDay(date) {
    return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date);
  }

  function formatEventPeriod(item) {
    const start = parseEventDate(item.startDate);
    const end = parseEventDate(item.endDate);
    if (!start && !end) return '開催日程は詳細ページで確認';
    if (start && end) return `${formatMonthDay(start)}〜${formatMonthDay(end)}`;
    if (start && !end) return isLongRunningEvent(item) ? `${formatMonthDay(start)}〜` : `${formatMonthDay(start)}〜日程確認`;
    return `〜${formatMonthDay(end)}`;
  }

  function eventSortScore(item, tabKey, today) {
    const start = parseEventDate(item.startDate);
    const recencyBoost = start ? Math.max(0, 18 - Math.abs(daysBetween(today, start))) : 0;
    const ongoingBoost = isEventOngoing(item, today) ? 18 : 0;
    const nextBoost = tabKey === 'nextMonth' && start && start.getMonth() === new Date(today.getFullYear(), today.getMonth() + 1, 1).getMonth() ? 8 : 0;
    const closingBoost = tabKey === 'closingSoon' ? Number(item.closingSoonScore ?? 0) * 2 : 0;
    return Number(item.eventScore ?? 0) + Number(item.closingSoonScore ?? 0) + recencyBoost + ongoingBoost + nextBoost + closingBoost;
  }

  function getEventItemsForTab(items, tabKey) {
    const now = getTodayDate();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return [...items]
      .filter((item) => {
        if (tabKey === 'ongoing') return isEventOngoing(item, now);
        if (tabKey === 'closingSoon') return isEventClosingSoon(item, now);
        if (tabKey === 'thisMonth') return eventIntersectsMonth(item, monthStart);
        if (tabKey === 'nextMonth') return eventStartsInMonth(item, nextMonthStart) || (item.tags ?? []).includes('next-month');
        return false;
      })
      .sort((left, right) => eventSortScore(right, tabKey, now) - eventSortScore(left, tabKey, now));
  }

  function getEventDaysUntilEnd(item, today = getTodayDate()) {
    const end = parseEventDate(item.endDate);
    if (!end) return null;
    return daysBetween(end, today);
  }

  window.HomeEventUtils = {
    normalizeEventDateValue,
    parseEventDate,
    getTodayDate,
    daysBetween,
    isEventOngoing,
    isEventClosingSoon,
    isLongRunningEvent,
    isCurrentMonthLimited,
    eventIntersectsMonth,
    eventStartsInMonth,
    calculateEventScore,
    calculateClosingSoonScore,
    buildEventRecommendationReasons,
    eventStatusLabel,
    formatEventPeriod,
    eventSortScore,
    getEventItemsForTab,
    getEventDaysUntilEnd,
  };
})();
