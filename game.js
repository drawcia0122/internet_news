(function gameDashboard() {
  const {
    archiveTimestamp,
    buildArticleTitleLink,
    buildGoogleNewsUrl,
    dedupeTopics,
    escapeHtml,
    formatTopicDisplayTime,
    getNewsArticleSource,
    getCardImageCandidates,
    normalizeTopic,
    topicText,
  } = window.TopicClientUtils;
  const { fetchJsonWithCache } = window.HomeDataUtils;

  const heroBriefElement = document.querySelector('#game-hero-brief');
  const heroCommandElement = document.querySelector('#game-hero-command');
  const heroStatsElement = document.querySelector('#game-hero-stats');
  const searchFormElement = document.querySelector('#game-search-form');
  const searchInputElement = document.querySelector('#game-search-input');
  const searchStatusElement = document.querySelector('#game-search-status');
  const searchResultsSection = document.querySelector('#game-search-section');
  const searchResultsHeading = document.querySelector('#game-search-heading');
  const searchResultsElement = document.querySelector('#game-search-results');
  const searchClearElement = document.querySelector('#game-search-clear');
  const searchMoreElement = document.querySelector('#game-search-more');
  const loadNoticeElement = document.querySelector('#game-load-notice');
  const loadMessageElement = document.querySelector('#game-load-message');
  const loadRetryElement = document.querySelector('#game-load-retry');
  const importantListElement = document.querySelector('#important-list');
  const hubListElement = document.querySelector('#game-hub-list');
  const freeGameListElement = document.querySelector('#free-game-list');
  const steamSaleListElement = document.querySelector('#steam-sale-list');
  const saleControlsElement = document.querySelector('#game-sale-controls');
  const saleCountElement = document.querySelector('#game-sale-count');
  const saleMoreElement = document.querySelector('#game-sale-more');
  const saleFilters = { platform: 'all', store: 'all', sort: 'recommended', ceiling: '' };
  let saleVisibleCount = 8;
  const steamStoryListElement = document.querySelector('#steam-story-list');
  const newsListElement = document.querySelector('#news-list');
  const followListElement = document.querySelector('#game-follow-list');
  const followStatusElement = document.querySelector('#game-follow-status');
  const followUtils = window.GameFollowUtils;
  const followStore = followUtils?.createStore(window);
  let savedFollowState = followUtils?.emptyState();
  let followStorageStatus = 'local';
  let followMessage = '';

  const GAME_HINT_PATTERN = /ゲーム|switch|steam|ps5|xbox|nintendo|任天堂|playstation|pcゲーム|eスポーツ|esports|valorant|apex|pokemon|ポケモン|モンハン|mario|マリオ|gta|原神|スト6|street fighter|lol|league of legends/i;
  const INVALID_GAME_NAME_PATTERN = /^(ゲーム|セール|アップデート|デモ版|体験版|発売日|予約|配信|リリース|イベント|大会|無料配布|公式番組|最終アップデート|今週のすべり込みセール情報|steamos|switch2\/ios\/android版|switch 2|steam next fest|summer game fest|nintendo direct|state of play|valorant masters|ndc26|steam|switch|ps5|xbox|dlc|コラボ|メンテ|ガチャ|steam machine|nex playground|集英社100周年ut|サンリオキャラクターズ)$/i;
  const QUOTED_TITLE_PATTERN = /[『「]([^『』「」]{2,42})[』」]/gu;
  const PERCENT_PATTERN = /(\d{1,3})\s*(?:％|%)\s*(?:オフ|OFF)/i;
  const PRICE_PATTERN = /([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*円/g;
  const JAPANESE_DATE_PATTERN = /(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})日(?:\s*[（(][月火水木金土日](?:曜日)?[）)])?(?:\s*(午前|午後)?\s*(\d{1,2})(?:[:：](\d{2})|時(?:(\d{1,2})分|半)?))?/gu;
  const GENERIC_GAME_NAME_PATTERN = /steam|switch(?:\s?2)?|ps[45]|xbox|pc(?:\s*\/\s*steam)?|dlc|イベント|コラボ|メンテ|ガチャ|アップデート|大型アップデート|無料配布|セール|予約開始|予約受付|配信開始|発売予定|体験版|デモ版|festival|fest|showcase|direct|state of play|game pass|worlds|masters|championship|cup/i;
  const STORE_SIGNAL_PATTERN = /steam|eshop|playstation store|ps store|xbox store|app store|google play|store page|ストアページ|公式サイト|公式x|公式発表/i;
  const OFFICIAL_SIGNAL_PATTERN = /公式|official|メーカー|開発元|パブリッシャー/i;
  const STRONG_GAME_TOPIC_PATTERN = /steam|switch|ps5|xbox|pc|ios|android|ゲーム|アプリ|アップデート|dlc|セール|発売|配信|早期アクセス|体験版|デモ版|store|eスポーツ|大会/i;
  const NON_GAME_TOPIC_PATTERN = /フィギュア|ぬいぐるみ|グッズ|シール|一番くじ|ポップアップ|popup|カフェ|tvアニメ|アニメ化|映画化|舞台化|漫画|コミック|blu-ray|dvd|主題歌|コスメ|アパレル|カード|トレカ/i;
  const MERCHANDISE_TOPIC_PATTERN = /グッズ|tシャツ|アパレル|ソックス|ルームウェア|ライト|ウェファー|キーリング|ぬいぐるみ|フィギュア|コスメ|雑貨|ステッカー|シール|カード|トレカ|ガシャポン|くじ|ポップアップ|カフェ/i;
  const NON_GAME_PRODUCT_PATTERN = /steam machine|playground|ゲーミングpc|ゲームシステム|デバイス|ハードウェア|周辺機器|しまむら|シャンブル|クッション|収納ボックス|チョコエッグ|食玩|お菓子|フィギュア|tシャツ|アパレル|グッズ|コラボメニュー|ライト|ウェファー|ガシャポン|設定画集|キーホルダー|画集|書籍/i;
  const NON_ACTIONABLE_MEDIA_PATTERN = /kindle|漫画|マンガ|コミック|小説|文庫|画集|設定画集|サントラ|サウンドトラック|アルバム|主題歌|朗読劇|ライブ配信|ブロマイド|アニメ化|tvアニメ|映画化|舞台化|amazon限定|アパレル|ルームウェア|バッグ|ポーチ|チャーム|キャディバッグ|コントローラー|ゲーミングpc|steam machine|switch online|playstation plus|game pass|料金改定|値上げ/i;
  const WEAK_FALLBACK_TITLE_PATTERN = /^(もうすぐ始まる|まもなく|開催中|配信開始|発売開始|発売決定|予約開始|予約受付|体験版|デモ版|大型アップデート|最終アップデート|無料配布|セール|注目タイトル|新作ゲーム|話題作)$/i;
  const PROMOTIONAL_TITLE_PATTERN = /sale|セール|キャンペーン|summer sale|june sale|sale part|steam machine|playground|集英社100周年ut|diorama|ver\.?|version|パック/i;
  const LIMITED_FREE_PATTERN = /無料配布|無料でもらえる|無料で入手|無料取得|0円配布|無料プレゼント|永久無料|free.to.keep/i;
  const TRIAL_PATTERN = /無料(?:で)?プレイ|フリープレイ|無料トライアル|体験版|デモ版|free (?:weekend|play|trial)/i;
  const SUBSCRIPTION_PATTERN = /prime gaming|amazonプライム|プライム会員|game pass|playstation plus|ps plus|nintendo switch online|加入者|会員(?:限定|向け)|サブスクリプション/i;
  const ADAPTATION_PATTERN = /映画[・／/]?(?:ドラマ)?化|映画・テレビ|ドラマ化|映像化|映像作品化|アニメ化|舞台化/i;
  const SALE_PATTERN = /セール|割引|オフ|最安|sale/i;
  const RELEASE_PATTERN = /発売|配信開始|リリース/i;
  const UPDATE_PATTERN = /大型アップデート|アップデート配信|アップデート実装|シーズン開始|新章開幕|新エリア追加|新キャラ実装|新オペレーター実装|パッチノート|イベント開始/i;
  const FREE_TO_PLAY_PATTERN = /基本プレイ無料|基本無料|free-to-play|f2p|ストアページを公開|配信開始|事前登録|発表/i;
  const NEWS_EXCLUDE_PATTERN = /nintendo switch online|playstation plus|xbox game pass|値上げ|料金改定|周辺機器|コントローラー|ヘッドセット|キーボード|マウス|tvアニメ|アニメ|コミック|漫画|書籍|サントラ|サウンドトラック|グッズ|ポップアップ|カフェ/i;
  const KNOWN_GAME_TERMS = [
    ['Monster Hunter Wilds', /monster hunter wilds|モンスターハンターワイルズ|モンハンワイルズ/i],
    ['どうぶつの森', /どうぶつの森|animal crossing/i],
    ['Pokemon Champions', /pokemon champions|ポケモンチャンピオンズ/i],
    ['Mario Kart World', /mario kart world|マリオカートワールド/i],
    ['Street Fighter 6', /street fighter 6|ストリートファイター6|スト6/i],
    ['League of Legends', /\blol\b|league of legends/i],
    ['Apex Legends', /apex legends|\bapex\b/i],
    ['GTA6', /\bgta\s?6\b|grand theft auto vi/i],
    ['ドラゴンボール ゼノバース3', /ドラゴンボール ゼノバース[3３]|dragon ball xenoverse 3/i],
    ['アークナイツ', /アークナイツ|arknights/i],
    ['Desktop Mate', /desktop mate/i],
    ['幻想水滸伝 STAR LEAP', /幻想水滸伝 star leap|suikoden star leap/i],
    ['薔薇と椿 〜お豪華絢爛版〜', /薔薇と椿.*お豪華絢爛版|rose and camellia/i],
    ['原神', /原神|genshin/i],
    ['ゼンレスゾーンゼロ', /ゼンレスゾーンゼロ|zenless zone zero/i],
    ['ドルフロ2', /ドルフロ2/i],
    ['シチズン・スリーパー', /シチズン・スリーパー|citizen sleeper/i],
    ['ROBOBEAT', /robobeat/i],
    ['World War Z', /world war z/i],
    ['theHunter: Call of the Wild', /thehunter:\s*call of the wild|thehunter call of the wild/i],
    ['ひぐらしのなく頃に', /ひぐらしのなく頃に/i],
  ];

  const GAME_DATA_SOURCES = [
    { key: 'trend', file: 'trend-topics.json', label: '新着記事', articles: true },
    { key: 'archive', file: 'news-archive.json', label: '過去の記事', articles: true },
    { key: 'home', file: 'home-news.json', label: 'ニュース記事', articles: true },
    { key: 'events', file: 'events.json', label: 'イベント情報' },
    { key: 'prices', file: 'game-sale-offers.json', label: 'Steam公式価格' },
  ];
  let gameSourcePayloads = {};
  let gameSourceFailures = new Set();
  let gameSourceLoading = false;
  let gameLoadFatal = false;
  let dashboardState = null;
  let newsVisibleCount = 8;
  let searchQuery = '';
  let searchLoadFailed = false;
  let searchVisibleCount = 8;
  let dashboardInputs = null;
  let offerRefreshTimer = null;
  let offerLifecycleBound = false;
  const offerClockOrigin = Date.now();
  const offerMonotonicOrigin = window.performance?.now?.() ?? null;
  let latestOfferClock = offerClockOrigin;
  const gameImageAttempts = new WeakMap();
  const gameThumbnailFieldCache = new WeakMap();
  const gameImageUrlCache = new Map();

  init().catch((error) => {
    console.error('[game] failed to render', error);
    renderFailure();
  });

  async function init() {
    if (followStore) {
      const saved = followStore.load({ now: currentOfferTime() });
      savedFollowState = saved.state;
      followStorageStatus = saved.status;
      if (saved.reason === 'invalid') followMessage = '保存データを読み直せなかったため、空の一覧から開始しました。';
    }
    bindInteractions();
    await loadGameSources(GAME_DATA_SOURCES.map((source) => source.key));
  }

  function prepareGameSourcePayload(source, payload) {
    if (!payload || !Array.isArray(payload.items)) throw new Error(`Invalid ${source.file}`);
    if (source.articles) {
      const items = payload.items.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.title !== 'string') throw new Error(`Invalid article in ${source.file}`);
        // Keep original image provenance before generic normalization/grouping
        // can borrow a neighbour's art. Resolve it lazily for game articles only.
        const topic = { ...normalizeTopic(item), gameArticleImages: { article: item } };
        if (topic.relatedKeywords != null && !Array.isArray(topic.relatedKeywords)) throw new Error(`Invalid keywords in ${source.file}`);
        // Validate the fields used by the game filter before committing a source.
        isGameTopic(topic);
        return topic;
      });
      return { ...payload, items };
    }
    if (source.key === 'events') payload.items.forEach((event) => {
      if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.title !== 'string'
        || (event.tags != null && !Array.isArray(event.tags))) throw new Error('Invalid event record');
      isLikelyGameEvent(event);
    });
    if (source.key === 'prices' && payload.sources !== undefined && !Array.isArray(payload.sources)) throw new Error('Invalid price source diagnostics');
    return payload;
  }

  async function loadGameSources(keys, { isRetry = false } = {}) {
    if (gameSourceLoading) return;
    const requested = GAME_DATA_SOURCES.filter((source) => keys.includes(source.key));
    if (!requested.length) return;
    gameSourceLoading = true;
    renderGameLoadNotice();
    const previousPayloads = { ...gameSourcePayloads };
    const results = await Promise.all(requested.map(async (source) => {
      try {
        const payload = await fetchJsonWithCache({ endpoints: [`./data/${source.file}`, `data/${source.file}`] });
        return { source, payload: prepareGameSourcePayload(source, payload) };
      } catch {
        return { source, failed: true };
      }
    }));
    for (const result of results) {
      if (result.failed) gameSourceFailures.add(result.source.key);
      else {
        gameSourcePayloads[result.source.key] = result.payload;
        gameSourceFailures.delete(result.source.key);
      }
    }
    try {
      const hasArticles = GAME_DATA_SOURCES.some((source) => source.articles && gameSourcePayloads[source.key]);
      if (hasArticles) applyGameSourcePayloads({ isRetry, refreshSaleAvailability: requested.some((source) => source.key === 'prices') });
      else renderFailure();
    } catch (error) {
      // A failed retry must not replace a reader's usable snapshot with bad data.
      gameSourcePayloads = previousPayloads;
      requested.forEach((source) => gameSourceFailures.add(source.key));
      gameLoadFatal = true;
      console.error('[game] source display failed', error);
      if (!dashboardState) renderFailure();
    } finally {
      gameSourceLoading = false;
      renderGameLoadNotice();
    }
  }

  async function retryGameSources() {
    const keys = gameSourceFailures.size ? [...gameSourceFailures] : GAME_DATA_SOURCES.map((source) => source.key);
    await loadGameSources(keys, { isRetry: true });
  }

  function applyGameSourcePayloads({ isRetry = false, refreshSaleAvailability = false } = {}) {
    const { trend: trendPayload, archive: archivePayload, home: homeNewsPayload, events: eventPayload, prices: salePayload } = gameSourcePayloads;
    const currentTopics = trendPayload?.items || [];
    const archiveTopics = archivePayload?.items || [];
    const homeNewsTopics = (homeNewsPayload?.items || []).filter((topic) => isGameTopic(topic) || isSteamRelevantTopic(topic));
    const searchTopics = [...currentTopics, ...archiveTopics, ...homeNewsTopics];
    const gameTopics = dedupeTopics(searchTopics).filter(isGameTopic);
    const inputs = {
      topics: gameTopics,
      events: eventPayload?.items || [],
      meta: {
        // Topic grouping is presentation-only; search preserves each article URL.
        searchTopics,
        saleOffers: salePayload?.items || [],
        saleSources: Array.isArray(salePayload?.sources) ? salePayload.sources : [],
        generatedAt: trendPayload?.generatedAt ?? homeNewsPayload?.generatedAt ?? archivePayload?.generatedAt ?? eventPayload?.generatedAt ?? null,
      },
    };
    const next = buildDashboardState(inputs.topics, inputs.events, inputs.meta);
    const previous = dashboardState;
    dashboardInputs = inputs;
    dashboardState = next;
    updateFollowObservations();
    searchLoadFailed = false;
    gameLoadFatal = false;
    if (previous) renderDashboardChanges(previous, next);
    else renderDashboard();
    if (previous) renderPreservingFocus([followListElement], renderFollowedGames);
    // Availability can change even when an empty sale list remains empty.
    if (isRetry && refreshSaleAvailability) renderPreservingFocus([steamSaleListElement], renderSteamSales);
    if (searchQuery) {
      if (!previous || !sameDisplayedData(previous.searchItems, next.searchItems)) {
        renderPreservingFocus([searchResultsElement], () => renderSearchResults({ focusHeading: !isRetry }));
      }
    } else setSearchStatus();
    bindOfferLifecycle();
    scheduleOfferRefresh();
  }

  function renderGameLoadNotice() {
    if (!loadNoticeElement || !loadMessageElement || !loadRetryElement) return;
    const failedLabels = GAME_DATA_SOURCES.filter((source) => gameSourceFailures.has(source.key)).map((source) => source.label);
    const visible = failedLabels.length > 0 || gameLoadFatal;
    const restoreFocus = !visible && loadNoticeElement.contains?.(document.activeElement);
    loadNoticeElement.hidden = !visible;
    loadMessageElement.textContent = gameSourceLoading
      ? `読み込めなかった情報を再試行しています。${dashboardState ? '表示中の記事はそのまま読めます。' : ''}`
      : `${failedLabels.length ? `${failedLabels.join('・')}を読み込めませんでした。` : 'データの表示を準備できませんでした。'}${dashboardState ? '読み込めた情報だけを表示しています。' : '通信状況を確認して、再試行してください。'}`;
    loadRetryElement.textContent = gameSourceLoading ? '再試行中…' : '読み込めなかった情報を再試行';
    // Keep the initiating control focused while repeated clicks are ignored.
    loadRetryElement.setAttribute?.('aria-disabled', String(gameSourceLoading));
    if (restoreFocus) searchInputElement?.focus({ preventScroll: true });
  }

  function bindInteractions() {
    document.addEventListener?.('error', handleGameImageError, true);
    document.addEventListener?.('click', (event) => {
      const button = event.target?.closest?.('[data-game-follow], [data-game-unfollow], [data-game-jump]');
      if (!button) return;
      if (button.hasAttribute('data-game-jump')) {
        event.preventDefault();
        jumpToGameCard(button.getAttribute('data-game-jump'));
      } else if (button.hasAttribute('data-game-unfollow')) {
        changeGameFollow(button.getAttribute('data-game-unfollow'), false);
      } else changeGameFollow(button.getAttribute('data-game-follow'), true);
    });
    window.addEventListener?.('storage', (event) => {
      if (!followStore || (event.key !== null && event.key !== followUtils.STORAGE_KEY)) return;
      const saved = followStore.load({ now: currentOfferTime(), external: true });
      savedFollowState = saved.state;
      followStorageStatus = saved.status;
      refreshFollowViews();
    });
    loadRetryElement?.addEventListener('click', retryGameSources);
    saleControlsElement?.addEventListener('change', (event) => {
      const field = event.target?.getAttribute?.('data-sale-filter');
      if (!Object.hasOwn(saleFilters, field)) return;
      saleFilters[field] = String(event.target.value || '');
      saleVisibleCount = 8;
      if (dashboardState) renderSteamSales();
    });
    document.querySelector('#game-sale-reset')?.addEventListener('click', () => {
      Object.assign(saleFilters, { platform: 'all', store: 'all', sort: 'recommended', ceiling: '' });
      saleControlsElement?.querySelectorAll('[data-sale-filter]').forEach((element) => { element.value = saleFilters[element.getAttribute('data-sale-filter')]; });
      saleVisibleCount = 8;
      if (dashboardState) renderSteamSales();
    });
    saleMoreElement?.addEventListener('click', () => {
      const firstNew = saleVisibleCount;
      saleVisibleCount += 8;
      renderSteamSales();
      steamSaleListElement?.querySelectorAll('h3 a')[firstNew]?.focus();
    });
    searchFormElement?.addEventListener('submit', (event) => {
      event.preventDefault();
      searchQuery = String(searchInputElement?.value || '').trim();
      searchVisibleCount = 8;
      if (!searchQuery) {
        clearGameSearch();
        return;
      }
      if (!dashboardState) {
        setSearchStatus(searchLoadFailed ? '' : '記事を読み込み中です。完了後に検索します。');
        return;
      }
      renderSearchResults({ focusHeading: true });
    });
    searchInputElement?.addEventListener('input', () => {
      // The native search-field clear button must restore the unfiltered page too.
      if (!String(searchInputElement.value || '').trim()) clearGameSearch();
    });
    searchClearElement?.addEventListener('click', () => clearGameSearch({ focusInput: true }));
    searchMoreElement?.addEventListener('click', () => {
      const firstNewIndex = searchVisibleCount;
      searchVisibleCount += 8;
      renderSearchResults();
      const firstNewTitle = searchResultsElement?.querySelectorAll('[data-game-result-title]')[firstNewIndex];
      (firstNewTitle?.querySelector('a') || firstNewTitle)?.focus();
    });

    heroStatsElement?.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-target]');
      if (!trigger) return;
      const target = document.querySelector(trigger.dataset.target);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function currentOfferTime() {
    // A clock correction must never make an already-aged snapshot fresh again.
    const monotonicNow = window.performance?.now?.();
    const elapsed = offerMonotonicOrigin !== null && Number.isFinite(monotonicNow)
      ? Math.max(0, monotonicNow - offerMonotonicOrigin) : 0;
    latestOfferClock = Math.max(latestOfferClock, Date.now(), offerClockOrigin + elapsed);
    return new Date(latestOfferClock);
  }

  function bindOfferLifecycle() {
    if (offerLifecycleBound) return;
    offerLifecycleBound = true;
    document.addEventListener?.('visibilitychange', synchronizeOfferLifecycle);
    window.addEventListener?.('focus', synchronizeOfferLifecycle);
    window.addEventListener?.('pageshow', synchronizeOfferLifecycle);
    window.addEventListener?.('pagehide', clearOfferRefreshTimer);
    scheduleOfferRefresh();
  }

  function clearOfferRefreshTimer() {
    if (offerRefreshTimer !== null) window.clearTimeout?.(offerRefreshTimer);
    offerRefreshTimer = null;
  }

  function scheduleOfferRefresh() {
    clearOfferRefreshTimer();
    if (!dashboardInputs || document.hidden || !window.setTimeout) return;
    const now = currentOfferTime().getTime();
    const deadlines = [];
    for (const offer of dashboardInputs.meta.saleOffers || []) {
      if (!offer) continue;
      const checkedAt = safeDate(offer.checkedAt)?.getTime();
      if (checkedAt !== undefined) deadlines.push(checkedAt + 6 * 3600000, checkedAt + 24 * 3600000);
      for (const value of [offer.freshUntil, offer.priceValidUntil, offer.endsAt]) {
        const date = safeDate(value);
        if (date) deadlines.push(date.getTime());
      }
    }
    for (const source of dashboardInputs.meta.saleSources || []) {
      const checkedAt = safeDate(source?.attemptedAt)?.getTime();
      if (checkedAt !== undefined) deadlines.push(checkedAt + 6 * 3600000);
    }
    for (const item of [...(dashboardState?.steamSales || []), ...(dashboardState?.freeGames || [])]) {
      if (item.startsAt) deadlines.push(item.startsAt.getTime());
      if (item.endsAt) deadlines.push(item.endsAt.getTime(), item.endsAt.getTime() - 24 * 3600000);
    }
    const delay = Math.max(1, deadlines.reduce((soonest, at) => at > now ? Math.min(soonest, at - now) : soonest, 60000));
    offerRefreshTimer = window.setTimeout(synchronizeOfferLifecycle, delay);
  }

  function synchronizeOfferLifecycle() {
    clearOfferRefreshTimer();
    if (document.hidden) return;
    refreshTimeSensitiveDashboard();
    scheduleOfferRefresh();
  }

  function sameDisplayedData(before, after) {
    // Ranking scores can age continuously without changing visible content.
    const serialize = (value) => JSON.stringify(value, (key, item) => key === 'sortScore' ? undefined : item);
    return serialize(before) === serialize(after);
  }

  function refreshTimeSensitiveDashboard() {
    if (!dashboardInputs || !dashboardState) return;
    const previous = dashboardState;
    const next = buildDashboardState(dashboardInputs.topics, dashboardInputs.events, dashboardInputs.meta);
    // Article search and its pagination belong to the reader, not the clock.
    next.searchItems = previous.searchItems;
    dashboardState = next;
    renderDashboardChanges(previous, next);
    renderPreservingFocus([followListElement], renderFollowedGames);
  }

  function renderDashboardChanges(previous, next) {
    const heroFields = ['generatedAt', 'todayHighlights', 'briefing', 'importantItems', 'gameHubs', 'freeGames', 'steamSales', 'releasesToday', 'majorUpdates'];
    if (!sameDisplayedData(heroFields.map((key) => previous[key]), heroFields.map((key) => next[key]))) {
      renderPreservingFocus([heroBriefElement, heroCommandElement, heroStatsElement], renderHero);
    }
    for (const [key, element, render] of [
      ['importantItems', importantListElement, renderImportantItems],
      ['gameHubs', hubListElement, renderGameHubs],
      ['freeGames', freeGameListElement, renderFreeGames],
      ['steamSales', steamSaleListElement, renderSteamSales],
      ['steamStories', steamStoryListElement, renderSteamStories],
      ['newsItems', newsListElement, renderNewsList],
    ]) {
      if (!sameDisplayedData(previous[key], next[key])) renderPreservingFocus([element], render);
    }
  }

  function renderPreservingFocus(elements, render) {
    const active = document.activeElement;
    const owner = elements.find((element) => element?.contains?.(active));
    const identity = owner ? {
      id: active.id,
      href: active.getAttribute('href'),
      target: active.getAttribute('data-target'),
      moreNews: active.hasAttribute('data-game-more-news'),
      className: active.className,
      control: active.getAttribute('data-game-control'),
      resultTitle: active.hasAttribute('data-game-result-title'),
      cardKey: active.closest?.('[data-game-key]')?.getAttribute('data-game-key'),
      text: String(active.textContent || '').trim(),
    } : null;
    const matchesIdentity = (element) => {
      if (identity.id) return element.id === identity.id;
      if (identity.control) return element.getAttribute('data-game-control') === identity.control;
      if (identity.resultTitle) return element.hasAttribute('data-game-result-title') && (identity.cardKey
        ? element.closest?.('[data-game-key]')?.getAttribute('data-game-key') === identity.cardKey
        : String(element.textContent || '').trim() === identity.text);
      if (identity.href) return element.getAttribute('href') === identity.href && element.className === identity.className
        && (!identity.cardKey || element.closest?.('[data-game-key]')?.getAttribute('data-game-key') === identity.cardKey);
      if (identity.target) return element.getAttribute('data-target') === identity.target && String(element.textContent || '').trim() === identity.text;
      return identity.moreNews && element.hasAttribute('data-game-more-news');
    };
    // Stable card/control keys survive reordering; the occurrence fallback keeps
    // equivalent unkeyed controls from jumping to the first shared destination.
    const occurrence = owner ? [...owner.querySelectorAll('a, button, [tabindex]')].filter(matchesIdentity).indexOf(active) : -1;
    render();
    if (!owner || document.activeElement === active) return;
    const replacement = [...owner.querySelectorAll('a, button, [tabindex]')].filter(matchesIdentity)[occurrence];
    if (replacement) replacement.focus({ preventScroll: true });
    else {
      const section = owner.closest('section');
      const heading = section?.querySelector('h2, h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
  }

  function buildDashboardState(topics, events, meta) {
    const steamSales = buildSteamSales(topics, meta.saleOffers, meta.saleSources);
    const freeGames = buildFreeGames(topics);
    const releasesToday = buildTodayReleases(topics);
    const majorUpdates = buildMajorUpdates(topics);
    const startingEvents = buildStartingEvents(events);
    const importantItems = buildImportantItems({ steamSales, freeGames, releasesToday, majorUpdates, startingEvents });
    const todayHighlights = buildTodayHighlights({ steamSales, freeGames, releasesToday, majorUpdates, startingEvents });
    const supersededPrices = supersededPriceArticles(topics, meta.saleOffers, meta.saleSources);
    const hubTopics = topics.filter((topic) => !supersededPrices.has(canonicalArticleUrl(articleSource(topic)?.canonicalUrl || articleSource(topic)?.url || topic.sourceUrl || topic.url)));
    const gameHubs = buildGameHubs(hubTopics, {
      steamSales,
      freeGames,
      releasesToday,
      majorUpdates,
    });
    const excludedTopicIds = new Set([
      ...importantItems.slice(0, 4).map((item) => item.topicId).filter(Boolean),
      ...gameHubs.slice(0, 6).flatMap((item) => item.topicIds || []),
      ...steamSales.map((item) => item.topicId).filter(Boolean),
      ...freeGames.slice(0, 4).map((item) => item.topicId).filter(Boolean),
    ]);
    const steamStories = buildSteamStories(topics, excludedTopicIds);
    steamStories.slice(0, 6).forEach((item) => {
      if (item.topicId) excludedTopicIds.add(item.topicId);
    });
    const newsItems = buildNewsFeed(topics, excludedTopicIds);

    return {
      generatedAt: meta.generatedAt,
      searchItems: buildSearchArticles(Array.isArray(meta.searchTopics) ? meta.searchTopics : topics),
      briefing: buildBriefing({ importantItems, gameHubs, freeGames, steamSales, releasesToday, majorUpdates }),
      importantItems,
      todayHighlights,
      gameHubs,
      freeGames,
      steamSales,
      steamStories,
      releasesToday,
      majorUpdates,
      newsItems,
      totals: {
        endingSoonSaleCount: steamSales.filter((item) => item.status === 'active' && item.deadlineVerified && item.endsAt && hoursUntil(item.endsAt) > 0 && hoursUntil(item.endsAt) <= 24).length,
        freeCount: freeGames.filter((item) => item.status === 'active' && item.offerType === 'ownership').length,
        releaseTodayCount: releasesToday.length,
        updateCount: majorUpdates.length,
        hotGameCount: gameHubs.length,
      },
    };
  }

  function renderDashboard() {
    if (!dashboardState) return;
    renderHero();
    renderImportantItems();
    renderGameHubs();
    renderFreeGames();
    renderSteamSales();
    renderSteamStories();
    renderNewsList();
    renderFollowedGames();
  }

  function renderHero() {
    const highlights = dashboardState.todayHighlights || [];
    heroCommandElement.innerHTML = buildHeroCommandCards();
    // Keep the top concise: one set of evidence-bound picks and direct navigation.
    heroBriefElement.innerHTML = `<li>${highlights.length ? `日本時間の本日分として確認できた${highlights.length}件を表示。価格確認日は値下げの開始日とは限りません。` : '日本時間の本日分として確認できる項目はまだありません。過去の記事を今日の変化として補いません。'}</li>`;
    heroStatsElement.innerHTML = [
      renderHeroStat('セールを探す', `${dashboardState.steamSales.length}件`, '価格・予算・終了日時で絞り込み', '#sale-section'),
      renderHeroStat('気になる作品', `${savedFollowState?.follows.length || 0}作品`, '保存した作品の確認情報と変更履歴', '#game-follow-section'),
      renderHeroStat('記事を読む', '検索', '検索ですべての記事を確認', '#game-search-form'),
    ].join('') + `<p class="game-sale-source game-hero-update">データ更新 ${dashboardState.generatedAt ? escapeHtml(formatPriceCheckedAt(dashboardState.generatedAt)) : '未確認'}</p>`;
  }

  function buildTodayHighlights({ steamSales = [], freeGames = [], releasesToday = [], majorUpdates = [], startingEvents = [] }) {
    const now = currentOfferTime();
    const today = (value) => { const date = safeDate(value); return date && daysBetween(now, date) === 0; };
    const picks = [];
    for (const item of steamSales) {
      if (!comparableSale(item)) continue;
      const ending = item.deadlineVerified && item.endsAt > now && today(item.endsAt);
      if (!ending && !today(item.checkedAt)) continue;
      picks.push({ ...item, highlightKey: `sale:${item.key}`, label: ending ? '本日終了' : '本日価格確認',
        detail: ending ? `${item.endsAtLabel} · ${item.remainingLabel}` : `${salePriceSummary(item)} · ${item.discount}`,
        jumpKey: item.key, href: `#game-card-${item.key}`, rank: ending ? 100 : 30 + Math.min(1, (item.discountPercent || 0) / 100) });
    }
    for (const item of releasesToday) if (today(item.releaseDate)) picks.push({ ...item, highlightKey: `release:${item.key}`,
      label: item.status === 'upcoming' ? '本日発売予定の報道' : '本日発売の報道', detail: item.releaseDateLabel,
      href: item.url, rank: 80 });
    for (const item of majorUpdates) if (today(item.publishedAt) && item.publishedAt <= now) picks.push({ ...item,
      highlightKey: `update:${item.key}`, label: '本日更新の報道', detail: item.publishedLabel, href: item.url, rank: 70 });
    for (const item of freeGames) if (item.status === 'active' && today(item.startsAt)) picks.push({ ...item,
      highlightKey: `free:${item.key}`, label: `本日開始の報道 · ${item.offerLabel}`, detail: `${item.startsAtLabel} · 利用条件は記事で確認`,
      href: item.url, rank: 60 });
    for (const item of startingEvents) if (today(item.startAt)) picks.push({ ...item, highlightKey: `event:${item.key}`,
      label: '本日開始予定', detail: item.startLabel, href: item.url, rank: 50 });
    const seen = new Set();
    return picks.sort((a, b) => b.rank - a.rank).filter((item) => {
      // Deduplicate presentation only. Never borrow prices/dates from another card.
      const key = normalizeGameName(item.title).toLocaleLowerCase('ja-JP');
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 3);
  }

  function buildHeroCommandCards() {
    const cards = dashboardState.todayHighlights || [];
    if (!cards.length) return renderEmptyCard('今日分の確認情報はまだありません', 'セール一覧や記事検索から確認できます。取得した情報が更新されるとここに最大3件表示します。');
    return cards.map((item) => `
      <article class="game-home-command-card" data-game-key="${escapeHtml(item.highlightKey)}">
        ${item.thumbnailUrl ? renderSignalThumbnail(item) : ''}
        <strong>${escapeHtml(item.label)}</strong>
        <h3><a class="article-title-link" href="${escapeHtml(item.href)}" ${item.jumpKey ? `data-game-jump="${escapeHtml(item.jumpKey)}"` : 'target="_blank" rel="noreferrer"'}>${escapeHtml(item.title)}</a></h3>
        <p>${escapeHtml(item.detail)}</p>
        <a class="game-card-link" href="${escapeHtml(item.href)}" ${item.jumpKey ? `data-game-jump="${escapeHtml(item.jumpKey)}"` : 'target="_blank" rel="noreferrer"'}>${item.jumpKey ? 'セールの詳細へ ↓' : '日付と条件を記事で確認 ↗'}</a>
      </article>`).join('');
  }

  function jumpToGameCard(key) {
    if (!dashboardState) return;
    const targetIndex = dashboardState.steamSales.findIndex((item) => item.key === key);
    if (targetIndex < 0) return;
    Object.assign(saleFilters, { platform: 'all', store: 'all', sort: 'recommended', ceiling: '' });
    saleControlsElement?.querySelectorAll('[data-sale-filter]').forEach((element) => { element.value = saleFilters[element.getAttribute('data-sale-filter')]; });
    saleVisibleCount = Math.max(8, Math.ceil((targetIndex + 1) / 8) * 8);
    renderSteamSales();
    const card = document.getElementById?.(`game-card-${key}`);
    card?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    card?.focus?.({ preventScroll: true });
  }

  function renderHeroStat(label, value, description, target) {
    return `
      <button class="topic-meta-card game-home-stat" type="button" data-game-control="${escapeHtml(label)}" data-target="${escapeHtml(target)}">
        <strong>${escapeHtml(label)}</strong>
        <span class="game-hero-value">${escapeHtml(value)}</span>
        <p class="topic-signal-summary">${escapeHtml(description)}</p>
      </button>
    `;
  }

  function formatCountLabel(count, unit, zeroLabel = 'なし') {
    return count > 0 ? `${count}${unit}` : zeroLabel;
  }

  function renderImportantItems() {
    const items = dashboardState.importantItems.slice(0, 4);
    if (!items.length) {
      importantListElement.innerHTML = renderEmptyCard('今日は緊急で見るべき案件は少なめです', '無料配布、セール、今日動いているゲームからそのまま判断できる状態にしています。');
      return;
    }
    importantListElement.innerHTML = items.map((item) => `
      <article class="game-home-card game-important-card" data-game-key="${escapeHtml(item.key)}" data-game-search="${escapeHtml(searchIndexText(item.gameTitle, item.title, item.summary))}">
        ${renderSignalThumbnail(item, item.icon)}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-badge">${escapeHtml(item.label)}</span>
            <span class="game-card-meta">${escapeHtml(item.meta)}</span>
          </div>
          <h3>${buildArticleTitleLink(item.title, item.url)}</h3>
          <p class="game-card-summary">${escapeHtml(item.summary)}</p>
          <div class="game-home-inline-facts">${renderFactPills(item.facts || [])}</div>
          <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.cta || '確認する ↗')}</a>
        </div>
      </article>
    `).join('');
  }

  function renderGameHubs() {
    const items = dashboardState.gameHubs.slice(0, 6);
    if (!items.length) {
      hubListElement.innerHTML = renderEmptyCard('今日強く動いたゲームはまだ抽出できていません', '発売・大型更新・無料配布・大型セールなど、行動につながる変化があるゲームを優先表示します。');
      return;
    }
    hubListElement.innerHTML = items.map((item) => `
      <article class="game-home-card game-hub-card" data-game-key="${escapeHtml(item.key)}" data-game-search="${escapeHtml(searchIndexText(item.title, item.summary, item.tags.join(' ')))}">
        ${renderSignalThumbnail(item, '🎮')}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-meta">${escapeHtml(item.evidenceLabel)}</span>
          </div>
          <h3>${buildArticleTitleLink(item.title, item.url)}</h3>
          <p class="game-card-summary">${escapeHtml(item.summary)}</p>
          <div class="game-home-tag-row">${renderTagPills(item.tags)}</div>
          <div class="game-home-inline-facts">${renderFactPills(item.facts)}</div>
          <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.ctaLabel)} ↗</a>
        </div>
      </article>
    `).join('');
  }

  function renderFreeGames() {
    const items = dashboardState.freeGames.slice(0, 4);
    if (!items.length) {
      freeGameListElement.innerHTML = renderEmptyCard('無料・体験情報はまだ確認できていません', '配布、期間限定の体験、加入者向けの情報を区別し、日付が不明な場合はその旨を表示します。');
      return;
    }
    freeGameListElement.innerHTML = items.map((item) => `
      <article class="game-home-card game-compact-card" data-game-key="${escapeHtml(item.key)}" data-game-search="${escapeHtml(searchIndexText(item.title, item.summary, item.store))}">
        ${renderSignalThumbnail(item, '🎁')}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-badge">${escapeHtml(item.offerLabel)}</span>
            <span class="game-card-meta">${escapeHtml(actionStatusLabel(item.status))}</span>
          </div>
          <h3>${buildArticleTitleLink(item.title, item.url)}</h3>
          <p class="game-card-summary">${escapeHtml(item.summary)}</p>
          <div class="game-home-inline-facts">${renderFactPills([
            item.startsAtLabel ? `開始 ${item.startsAtLabel}` : '開始日時不明',
            item.endsAtLabel ? `終了 ${item.endsAtLabel}` : '終了日時不明',
            item.store || '対象ストアは記事で確認',
          ])}</div>
          <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">記事で条件を確認 ↗</a>
        </div>
      </article>
    `).join('');
  }

  function renderSalePrice(item) {
    const prior = item.priceState === 'stale' || item.status === 'ended';
    const original = item.regularPrice === null || item.regularPrice === undefined ? '未確認' : `${Number(item.regularPrice).toLocaleString('ja-JP')}円`;
    const sale = item.salePrice === null || item.salePrice === undefined ? '未確認' : `${Number(item.salePrice).toLocaleString('ja-JP')}円`;
    return `<div class="game-sale-prices${prior ? ' is-historical' : ''}" role="group" aria-label="${escapeHtml(`${prior ? '前回確認価格。' : ''}通常価格 ${original}、割引後 ${sale}`)}">
      <span class="game-sale-price-part"><span class="game-sale-price-label">通常価格</span>${item.regularPrice !== null && item.regularPrice !== undefined ? `<s>${escapeHtml(original)}</s>` : '<span>未確認</span>'}</span>
      <span class="game-sale-price-arrow" aria-hidden="true">→</span>
      <span class="game-sale-price-part"><span class="game-sale-price-label">${prior ? '前回の割引価格' : '割引後'}</span><strong>${escapeHtml(sale)}</strong></span>
    </div>`;
  }

  function comparableSale(item) {
    return item.priceState === 'verified' && item.status === 'active' && item.store === 'Steam'
      && item.platform === 'PC' && Number.isSafeInteger(item.salePrice) && item.salePrice > 0;
  }

  function selectSaleCards(items, filters = saleFilters) {
    const ceiling = /^\d+$/.test(String(filters.ceiling)) ? Number(filters.ceiling) : null;
    const filtered = items.filter((item) => {
      const platform = item.platform === 'PC' ? 'PC' : 'unknown';
      const store = item.store === 'Steam' && item.platform === 'PC' ? 'Steam' : 'unknown';
      return (filters.platform === 'all' || filters.platform === platform)
        && (filters.store === 'all' || filters.store === store)
        && (ceiling === null || (comparableSale(item) && item.salePrice <= ceiling));
    });
    if (filters.sort === 'recommended') return filtered;
    const value = (item) => {
      if (!comparableSale(item)) return null;
      if (filters.sort === 'price') return item.salePrice;
      if (filters.sort === 'discount') return Number.isInteger(item.discountPercent) ? -item.discountPercent : null;
      if (filters.sort === 'ending') return item.deadlineVerified && item.endsAt ? item.endsAt.getTime() : null;
      return null;
    };
    return filtered.map((item, index) => ({ item, index, value: value(item) })).sort((a, b) =>
      (a.value === null) - (b.value === null) || (a.value === null ? 0 : a.value - b.value) || a.index - b.index
    ).map(({ item }) => item);
  }

  function renderSteamSales() {
    const filtered = selectSaleCards(dashboardState.steamSales);
    const items = filtered.slice(0, saleVisibleCount);
    if (saleCountElement) saleCountElement.textContent = `${filtered.length}件 / 全${dashboardState.steamSales.length}件（${items.length}件表示）。価格・割引率・終了順は確認済みの有効な情報を先に表示。予算指定時は古い価格・未確認・終了済みを除きます。`;
    if (saleMoreElement) {
      const restoreFocus = document.activeElement === saleMoreElement && items.length >= filtered.length;
      saleMoreElement.hidden = items.length >= filtered.length;
      if (restoreFocus) {
        const heading = document.querySelector('#sale-section h2');
        heading?.setAttribute?.('tabindex', '-1');
        heading?.focus?.({ preventScroll: true });
      }
    }
    if (!items.length) {
      steamSaleListElement.innerHTML = dashboardState.steamSales.length
        ? renderEmptyCard('条件に合うセールはありません', '予算指定では再確認待ちの価格も除外します。「条件をリセット」で全件に戻せます。')
        : gameSourceFailures.has('prices')
        ? renderEmptyCard('Steam公式価格を読み込めませんでした', 'ページ上部の再試行で読み込み直せます。取得できたゲーム記事は引き続き読めます。')
        : renderEmptyCard('確認できるセール情報はまだありません', '通常価格と割引後の価格を確認できた情報から掲載します。');
      return;
    }
    steamSaleListElement.innerHTML = items.map((item) => `
      <article class="game-home-card game-compact-card game-sale-card" id="game-card-${escapeHtml(item.key)}" tabindex="-1" data-game-key="${escapeHtml(item.key)}" data-game-search="${escapeHtml(searchIndexText(item.title, item.summary, item.discount, item.price))}">
        ${renderSignalThumbnail(item, '💸')}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-badge">${escapeHtml(item.priorityLabel)}</span>
            <span class="game-card-meta">${escapeHtml(item.discount || '割引率未確認')}</span>
          </div>
          <h3>${buildArticleTitleLink(item.title, item.storeUrl || item.url)}</h3>
          ${renderSalePrice(item)}
          <p class="game-card-summary">${escapeHtml(item.storeUrl ? 'Steam日本ストア · PC版 · 本編 · 税込' : item.summary)}</p>
          <div class="game-home-inline-facts">${renderFactPills([
            item.deadlineVerified ? `終了 ${item.endsAtLabel}` : '終了日時未確認',
            item.remainingLabel,
            item.platform === 'PC' ? 'PC / Steam' : '機種・ストア未確認',
            item.priceState === 'stale' ? '現在の価格は再確認待ち' : null,
          ])}</div>
          ${item.deadlineVerified ? `<p class="game-sale-source">期限確認 ${escapeHtml(formatPriceCheckedAt(item.deadlineCheckedAt))} · <a href="${escapeHtml(item.storeUrl)}" target="_blank" rel="noreferrer">公式ストアの期限</a></p>` : ''}
          <p class="game-sale-source">${item.checkedAt ? `価格確認 ${escapeHtml(formatPriceCheckedAt(item.checkedAt))} · ` : '記事掲載価格 · '}${item.storeUrl ? `<a href="${escapeHtml(item.storeUrl)}" target="_blank" rel="noreferrer">Steam公式</a>` : '元の価格が未記載の場合は未確認'}</p>
          <div class="game-sale-links">
            ${renderFollowButton(item)}
            ${item.storeUrl ? `<a class="game-card-link" href="${escapeHtml(item.storeUrl)}" target="_blank" rel="noreferrer">Steamで確認 ↗</a>` : ''}
            <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">紹介記事 ↗</a>
          </div>
        </div>
      </article>
    `).join('');
  }

  function followObservations() {
    if (!followUtils) return [];
    const now = currentOfferTime();
    return (dashboardInputs?.meta.saleOffers || []).flatMap((offer) => {
      const card = verifiedSaleCard(offer, dashboardInputs?.topics || [], { includeEnded: true });
      if (!card) return [];
      const price = card.status === 'ended' && offer.discountPercent > 0 ? null : followUtils.observationFromSteamOffer(offer, { now });
      // The producer carries only exact per-app official evidence. Validate the
      // individual observation again; source/check times never become "now".
      const events = (Array.isArray(offer?.followObservations) ? offer.followObservations : [])
        .filter((event) => event?.identity?.kind === 'steam' && event.identity.appId === offer.appId)
        .map((event) => followUtils.normalizeObservation(event, { now })).filter(Boolean);
      return [price, ...events].filter(Boolean);
    });
  }

  function updateFollowObservations() {
    if (!followUtils || !followStore || !savedFollowState) return;
    const now = currentOfferTime();
    const next = followUtils.applyObservations(savedFollowState, followObservations(), { now });
    savedFollowState = next.state;
    if (next.changed) {
      const saved = followStore.save(savedFollowState, { now });
      savedFollowState = saved.state;
      followStorageStatus = saved.status;
    }
  }

  function renderFollowButton(item) {
    if (!followUtils || !Number.isSafeInteger(item.appId) || item.store !== 'Steam') return '';
    const key = `steam:${item.appId}`;
    const followed = savedFollowState?.follows.some((entry) => entry.key === key);
    return `<button type="button" class="game-card-link game-follow-button" data-game-control="follow-${item.appId}" ${followed ? 'data-game-unfollow' : 'data-game-follow'}="${escapeHtml(key)}" aria-pressed="${Boolean(followed)}" aria-label="${escapeHtml(`${item.title}を${followed ? 'フォロー解除' : 'フォロー'}`)}">${followed ? 'フォロー中 ✓' : '＋ フォロー'}</button>`;
  }

  function changeGameFollow(key, shouldFollow) {
    if (!followUtils || !followStore || !savedFollowState) return;
    const now = currentOfferTime();
    savedFollowState = followStore.load({ now }).state;
    let result;
    if (shouldFollow) {
      const offer = (dashboardInputs?.meta.saleOffers || []).find((entry) => `steam:${entry?.appId}` === key);
      if (!offer || !verifiedSaleCard(offer, dashboardInputs.topics, { includeEnded: true })) return;
      result = followUtils.followGame(savedFollowState, offer, followObservations(), { now });
    } else result = followUtils.removeGame(savedFollowState, key, { now });
    followMessage = result.status === 'limit' ? 'フォローは50作品までです。不要な作品を解除してから追加してください。'
      : result.changed ? shouldFollow ? 'フォローに追加しました。最初の確認内容を比較の基準にします。' : 'フォローを解除しました。' : '';
    if (result.changed) {
      const saved = followStore.save(result.state, { now });
      savedFollowState = saved.state;
      followStorageStatus = saved.status;
    }
    refreshFollowViews();
  }

  function refreshFollowViews() {
    if (dashboardState) renderPreservingFocus([steamSaleListElement], renderSteamSales);
    renderPreservingFocus([followListElement], renderFollowedGames);
    if (dashboardState) renderPreservingFocus([heroBriefElement, heroCommandElement, heroStatsElement], renderHero);
  }

  function followChangeText(change) {
    const before = change.before;
    const after = change.after;
    if (change.kind === 'price-drop' || change.kind === 'price-increase') return `${change.kind === 'price-drop' ? '値下げを確認' : '価格変更を確認'}: ${before.amount.toLocaleString('ja-JP')}円 → ${after.amount.toLocaleString('ja-JP')}円`;
    if (change.kind === 'release-changed') return `発売情報の変更: ${before.date} → ${after.date}（${after.status === 'released' ? '発売済み' : '予定'}）`;
    return `公式更新記事: ${after.title || 'リリースノート'}`;
  }

  function renderFollowedGames() {
    if (!followListElement || !followStatusElement) return;
    if (!followUtils || !savedFollowState) {
      followStatusElement.textContent = 'フォロー機能を読み込めませんでした。ページを再読み込みしてください。';
      return;
    }
    const now = currentOfferTime();
    const follows = savedFollowState.follows;
    const storageText = followStorageStatus === 'local' ? 'このブラウザーに保存します。'
      : followStorageStatus === 'session' ? '長期保存が使えないため、このタブの保存領域を使用中です。タブを閉じると失われる場合があります。'
        : '保存領域が使えないため、このページを開いている間だけ保持します。再読み込みで失われます。';
    followStatusElement.textContent = `${follows.length}作品をフォロー中。${storageText}${followMessage}`;
    if (!follows.length) {
      followListElement.innerHTML = renderEmptyCard('気になる作品を保存', 'セールカードの「＋ フォロー」から追加できます。次の訪問時に確認できた価格・発売情報・公式更新記事を比較します。');
      return;
    }
    const changes = followUtils.listChanges(savedFollowState, { now });
    const currentObservations = followObservations();
    followListElement.innerHTML = follows.map((follow) => {
      const observations = follow.observations;
      const price = observations.find((entry) => entry.kind === 'price');
      const release = observations.find((entry) => entry.kind === 'release');
      const update = observations.find((entry) => entry.kind === 'update');
      const records = changes.filter((entry) => entry.key === follow.key).slice(0, 3);
      const currentOffer = (dashboardInputs?.meta.saleOffers || []).find((offer) => `steam:${offer?.appId}` === follow.key);
      const covered = Boolean(currentOffer);
      const currentPrice = currentObservations.find((entry) => entry.kind === 'price' && followUtils.identityKey(entry.identity) === follow.key);
      const saleEnd = currentOffer ? verifiedSaleDeadline(currentOffer) : null;
      const expiredSale = saleEnd && saleEnd <= now;
      const fresh = (entry) => followUtils.observationStatus(entry, { now }) === 'fresh';
      return `<article class="game-follow-card" data-game-key="${escapeHtml(follow.key)}">
        <h3>${buildArticleTitleLink(follow.title, follow.url)}</h3>
        <p>${!covered ? '今回の掲載対象外。新しい情報は未確認です。' : expiredSale ? '確認したセール期限を過ぎました。現在価格は再確認待ちです。' : price && fresh(price) && currentPrice && currentPrice.amount === price.amount && currentPrice.checkedAt === price.checkedAt ? `確認価格 ${price.amount.toLocaleString('ja-JP')}円（Steam日本ストア）` : '現在価格は未確認・再確認待ちです。'}</p>
        ${price ? `<p class="game-sale-source">前回確認 ${escapeHtml(formatPriceCheckedAt(price.checkedAt))} · ${price.amount.toLocaleString('ja-JP')}円</p>` : ''}
        <p class="game-sale-source">${release ? `公式発売日 ${escapeHtml(release.date)}（${release.status === 'released' ? '発売済み' : '予定'}）${fresh(release) ? '' : ' · 再確認待ち'}` : '発売情報は未確認'}</p>
        ${update ? `<p class="game-sale-source"><a href="${escapeHtml(update.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(update.title || '公式リリースノート')}</a> · 発表 ${escapeHtml(formatPriceCheckedAt(update.date))}${fresh(update) ? '' : ' · 再確認待ち'}</p>` : '<p class="game-sale-source">公式更新記事は未確認</p>'}
        ${records.length ? `<ul class="game-follow-changes">${records.map((change) => `<li><a href="${escapeHtml(change.url)}" target="_blank" rel="noreferrer">${escapeHtml(followChangeText(change))}</a><span>確認 ${escapeHtml(formatPriceCheckedAt(change.after.checkedAt))}${change.freshness === 'stale' ? ' · 過去の記録' : ''}</span></li>`).join('')}</ul>` : '<p class="game-sale-source">フォロー後の新しい変更はまだ確認されていません。</p>'}
        <button type="button" class="game-card-link" data-game-control="remove-${escapeHtml(follow.key)}" data-game-unfollow="${escapeHtml(follow.key)}" aria-label="${escapeHtml(`${follow.title}のフォローを解除`)}">フォローを解除</button>
      </article>`;
    }).join('');
  }

  function renderSteamStories() {
    const items = dashboardState.steamStories.slice(0, 6);
    if (!items.length) {
      steamStoryListElement.innerHTML = renderEmptyCard('今拾う価値があるSteam記事は少なめです', '新作、体験版、早期アクセス、大型更新などSteamで見る意味がある話題だけを残しています。');
      return;
    }
    steamStoryListElement.innerHTML = items.map((item) => `
      <article class="game-home-card game-compact-card" data-game-key="${escapeHtml(item.key)}" data-game-search="${escapeHtml(searchIndexText(item.title, item.summary, item.label, item.gameTitle))}">
        ${renderSignalThumbnail(item, '🖥')}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-badge">${escapeHtml(item.label)}</span>
            <span class="game-card-meta">${escapeHtml(item.sourceLabel)}</span>
          </div>
          <h3>${buildArticleTitleLink(item.title, item.url)}</h3>
          <p class="game-card-summary">${escapeHtml(item.summary)}</p>
          <div class="game-home-inline-facts">${renderFactPills([
            item.gameTitle,
            item.publishedLabel,
            'Steam',
          ])}</div>
          <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">記事を見る ↗</a>
        </div>
      </article>
    `).join('');
  }

  function renderNewsList() {
    const items = dashboardState.newsItems.slice(0, newsVisibleCount);
    if (!items.length) {
      newsListElement.innerHTML = renderEmptyCard('補完用のニュースは現在ありません', 'このページでは、主役をゲームの動きに寄せているため、記事一覧は最小限にしています。');
      return;
    }
    newsListElement.innerHTML = items.map((item) => `
      <article class="game-news-row" data-game-key="${escapeHtml(item.key)}" data-game-search="${escapeHtml(searchIndexText(item.gameTitle, item.title, item.summary))}">
        <div class="game-news-row-main">
          ${item.thumbnailUrl ? renderSignalThumbnail(item) : ''}
          <span class="game-news-row-game">${escapeHtml(item.gameTitle)}</span>
          <h3>${buildArticleTitleLink(item.title, item.url)}</h3>
          <p>${escapeHtml(item.summary)}</p>
        </div>
        <div class="game-news-row-side">
          <span class="game-card-meta">${escapeHtml(item.publishedLabel)}</span>
          <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceLabel)}で読む ↗</a>
        </div>
      </article>
    `).join('');
    if (items.length < dashboardState.newsItems.length) {
      newsListElement.insertAdjacentHTML('beforeend', '<button type="button" class="game-card-link" data-game-more-news>記事をもっと見る</button>');
      newsListElement.querySelector('[data-game-more-news]')?.addEventListener('click', () => {
        const firstNewIndex = items.length;
        newsVisibleCount += 8;
        renderNewsList();
        // Rendering replaces the activated button. Continue keyboard navigation
        // at the first newly revealed article rather than losing focus to body.
        const firstNewTitle = newsListElement.querySelectorAll('.game-news-row h3 a')[firstNewIndex];
        const focusTarget = firstNewTitle || newsListElement.querySelector('[data-game-more-news]');
        focusTarget?.focus();
      });
    }
  }

  function buildBriefing({ importantItems, gameHubs, freeGames, steamSales, releasesToday, majorUpdates }) {
    const lines = [];
    if (importantItems[0]) lines.push(`最優先: ${importantItems[0].title}`);
    if (releasesToday.length) lines.push(`本日発売 ${releasesToday.length} 件`);
    if (majorUpdates.length) lines.push(`大型アップデート ${majorUpdates.length} 件`);
    if (freeGames.length) lines.push(`無料・体験情報 ${freeGames.length} 件（予定・状況不明を含む）`);
    if (steamSales.some((item) => item.status === 'active' && item.deadlineVerified && item.endsAt && hoursUntil(item.endsAt) > 0 && hoursUntil(item.endsAt) <= 24)) lines.push('終了間近のセールあり');
    if (!lines.length && gameHubs.length) lines.push(`今日は ${gameHubs[0].title} 周辺の動きが強め`);
    return lines.slice(0, 4);
  }

  // Action cards use the named article's headline and entity-scoped statements only.
  // Feed tags, sibling source articles and incidental summary keywords are not evidence.
  function formatPriceCheckedAt(value) {
    const date = safeDate(value);
    return date ? `${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)} JST` : '日時未確認';
  }

  function verifiedSaleCard(offer, topics, { includeEnded = false } = {}) {
    if (!offer || !Number.isSafeInteger(offer.appId) || offer.appId <= 0 || offer.currency !== 'JPY'
      || offer.country !== 'JP' || offer.edition !== 'base-game' || offer.store !== 'Steam'
      || !['verified', 'cached', 'stale', 'ended'].includes(offer.status)) return null;
    const checked = safeDate(offer.checkedAt);
    const now = currentOfferTime();
    if (!checked || checked > now || now - checked >= 24 * 60 * 60 * 1000) return null;
    const validUntil = safeDate(offer.priceValidUntil);
    if (!validUntil || now >= validUntil || validUntil - checked > 24 * 60 * 60 * 1000) return null;
    const title = String(offer.title || '').trim();
    if (!title) return null;
    const { regularPrice, salePrice, discountPercent } = offer;
    const noDiscount = discountPercent === 0 && salePrice === regularPrice;
    if (offer.status === 'ended' && !noDiscount) return null;
    if (noDiscount && !includeEnded) return null;
    if (!Number.isSafeInteger(regularPrice) || !Number.isSafeInteger(salePrice) || regularPrice <= 0 || salePrice <= 0
      || salePrice > regularPrice || !Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 99
      || (salePrice === regularPrice && !noDiscount)
      || Math.abs(100 * (regularPrice - salePrice) / regularPrice - discountPercent) > 1) return null;
    try {
      const store = new URL(offer.storeUrl);
      const source = new URL(offer.priceSource?.url);
      if (offer.priceSource?.kind !== 'steam-appdetails' || store.username || store.password || source.username || source.password || store.port || source.port || source.hash
        || store.protocol !== 'https:' || store.hostname !== 'store.steampowered.com' || !new RegExp(`^/app/${offer.appId}(?:/|$)`).test(store.pathname)
        || source.protocol !== 'https:' || source.hostname !== 'store.steampowered.com'
        || source.pathname !== '/api/appdetails' || source.searchParams.getAll('appids').length !== 1 || source.searchParams.get('appids') !== String(offer.appId)
        || source.searchParams.getAll('cc').length !== 1
        || source.searchParams.get('cc')?.toLowerCase() !== 'jp') return null;
    } catch { return null; }
    if (!Array.isArray(offer.articleUrls)) return null;
    const articleUrls = new Set(offer.articleUrls.filter((value) => typeof value === 'string').map(canonicalArticleUrl).filter(Boolean));
    const topic = topics.find((entry) => {
      const source = articleSource(entry);
      if (entry.sourceSignals?.length && !source) return false;
      const published = safeDate(entry.publishedAt || source?.publishedAt);
      return published && published <= now && articleUrls.has(canonicalArticleUrl(source?.canonicalUrl || source?.url || entry.sourceUrl || entry.url));
    });
    if (!topic) return null;
    const endsAt = verifiedSaleDeadline(offer);
    const freshUntil = safeDate(offer.freshUntil);
    const stale = !freshUntil || offer.status === 'stale' || (freshUntil && now >= freshUntil) || now - checked >= 6 * 60 * 60 * 1000;
    const status = noDiscount || (endsAt && endsAt <= now) ? 'ended' : stale ? 'unknown' : 'active';
    const url = articleSource(topic)?.url || topic.sourceUrl || topic.url;
    return {
      key: `steam-${offer.appId}`, appId: offer.appId, store: 'Steam', platform: 'PC', discountPercent, articleUrls: [...articleUrls], topicId: topic.id || topic.title, title,
      summary: `${title} のSteam日本ストア価格`, url,
      storeUrl: `https://store.steampowered.com/app/${offer.appId}/?cc=jp&l=japanese`,
      ...thumbnailFields(steamImageCandidates(offer)),
      regularPrice, salePrice: noDiscount ? null : salePrice, price: noDiscount ? null : `${salePrice.toLocaleString('ja-JP')}円`, discount: noDiscount ? null : `${discountPercent}% OFF`,
      checkedAt: offer.checkedAt, priceState: stale ? 'stale' : 'verified', status,
      startsAt: null, startsAtLabel: null, endsAt,
      endsAtLabel: endsAt ? formatSaleDeadline(endsAt) : null,
      deadlineVerified: Boolean(endsAt), deadlineCheckedAt: endsAt ? offer.deadlineSource.checkedAt : null,
      remainingLabel: endsAt ? saleRemainingLabel(endsAt, now) : null,
      priority: 100 + (offer.featuredInArticle === true ? 100 : 0) + discountPercent, priorityLabel: status === 'ended' ? 'セール終了' : stale ? '価格の再確認待ち' : '確認時に割引中',
    };
  }

  function formatSaleDeadline(value) {
    const date = safeDate(value);
    return date ? `${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)} JST` : '終了日時未確認';
  }

  function verifiedSaleDeadline(offer) {
    const end = safeDate(offer?.endsAt);
    const source = offer?.deadlineSource;
    if (!end || typeof offer.endsAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(offer.endsAt)
      || end.toISOString() !== offer.endsAt || source?.kind !== 'steam-storebrowse' || source.appId !== offer.appId
      || !Number.isSafeInteger(source.packageId) || source.packageId <= 0
      || source.checkedAt !== offer.checkedAt || source.country !== 'JP' || source.currency !== 'JPY'
      || source.edition !== 'base-game' || source.regularPrice !== offer.regularPrice
      || source.salePrice !== offer.salePrice || source.discountPercent !== offer.discountPercent
      || source.storeUrl !== offer.storeUrl || source.storeUrl !== `https://store.steampowered.com/app/${offer.appId}/?cc=jp&l=japanese`
      || !Number.isSafeInteger(source.discountEndDate) || source.discountEndDate * 1000 !== end.getTime()
      || !safeDate(source.checkedAt) || end <= safeDate(source.checkedAt) || end - safeDate(source.checkedAt) > 366 * 86400000) return null;
    const expectedUrl = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify({
      ids: [{ appid: offer.appId }], context: { language: 'japanese', country_code: 'JP' },
      data_request: { include_all_purchase_options: true },
    }))}`;
    if (source.url !== expectedUrl) return null;
    return end;
  }

  function saleRemainingLabel(end, now = currentOfferTime()) {
    const remaining = end - now;
    if (remaining <= 0) return '終了済み';
    if (remaining < 60000) return '残り1分未満';
    const minutes = Math.ceil(remaining / 60000);
    if (minutes < 60) return `残り${minutes}分`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `残り${hours}時間${minutes % 60 ? `${minutes % 60}分` : ''}`;
    return `残り${Math.floor(hours / 24)}日${hours % 24 ? `${hours % 24}時間` : ''}`;
  }

  function isAuthoritativePriceUnavailable(source) {
    if (source?.kind !== 'steam' || source.status !== 'unavailable' || !Number.isSafeInteger(source.appId) || source.appId <= 0
      || !Array.isArray(source.articleUrls) || source.articleUrls.some((value) => typeof value !== 'string')) return false;
    const checked = safeDate(source.attemptedAt);
    const now = currentOfferTime();
    if (!checked || checked > now || now - checked >= 6 * 60 * 60 * 1000) return false;
    try {
      const url = new URL(source.url);
      return url.protocol === 'https:' && url.hostname === 'store.steampowered.com' && !url.username && !url.password && !url.port && !url.hash
        && url.pathname === '/api/appdetails' && url.searchParams.getAll('appids').length === 1 && url.searchParams.get('appids') === String(source.appId)
        && url.searchParams.getAll('cc').length === 1
        && url.searchParams.get('cc')?.toLowerCase() === 'jp';
    } catch { return false; }
  }

  function supersededPriceArticles(topics, offers = [], sources = []) {
    const urls = new Set((Array.isArray(sources) ? sources : []).filter(isAuthoritativePriceUnavailable)
      .flatMap((source) => source.articleUrls).map(canonicalArticleUrl).filter(Boolean));
    const newest = uniqueBy((Array.isArray(offers) ? offers : []).slice()
      .sort((a, b) => (safeDate(a?.checkedAt)?.getTime() || 0) - (safeDate(b?.checkedAt)?.getTime() || 0))
      .map((offer) => verifiedSaleCard(offer, topics, { includeEnded: true })).filter(Boolean), (item) => item.key);
    for (const item of newest) if (item.status === 'ended') item.articleUrls.forEach((url) => urls.add(url));
    return urls;
  }

  function buildSteamSales(topics, offers = [], sources = []) {
    const official = uniqueBy((Array.isArray(offers) ? offers : [])
      .slice().sort((a, b) => (safeDate(a?.checkedAt)?.getTime() || 0) - (safeDate(b?.checkedAt)?.getTime() || 0))
      .map((offer) => verifiedSaleCard(offer, topics, { includeEnded: true })).filter(Boolean), (item) => item.key);
    const items = official.filter((item) => item.salePrice !== null);
    const unavailableArticles = new Set((Array.isArray(sources) ? sources : []).filter(isAuthoritativePriceUnavailable)
      .flatMap((source) => source.articleUrls).map(canonicalArticleUrl).filter(Boolean));
    for (const topic of topics) {
      const evidence = actionEvidence(topic, SALE_PATTERN, { kind: 'sale' });
      if (!evidence || evidence.multipleSubjects || !/\bsteam\b/i.test(evidence.text)) continue;
      const sourceIdentity = canonicalArticleUrl(articleSource(topic)?.canonicalUrl || evidence.url);
      if (unavailableArticles.has(sourceIdentity) || official.some((item) => item.articleUrls.includes(sourceIdentity))) continue;
      const discount = extractDiscount(evidence.claim);
      const pair = extractPricePair(evidence.claim);
      const price = pair.salePrice === null ? extractPrice(evidence.claim) : pair.salePrice.toLocaleString('ja-JP');
      if ((!discount || discount < 30) && !/過去最安|最安/i.test(evidence.claim)) continue;
      const period = extractActionPeriod(evidence.text, evidence.referenceDate);
      const priority = (discount >= 90 ? 4 : 0) + (/過去最安|最安/i.test(evidence.claim) ? 3 : 0);
      items.push({
        ...actionCardBase(topic, evidence), ...period,
        key: `sale-${evidence.title}-${topic.id || evidence.url}`,
        discount: discount ? `${discount}% OFF` : null,
        regularPrice: pair.regularPrice, salePrice: price === null ? null : Number(price.replace(/,/g, '')),
        price: price !== null ? `${price}円` : null, priceState: 'article', store: null, platform: null, discountPercent: null, deadlineVerified: false,
        priority, priorityLabel: actionStatusLabel(period.status),
      });
    }
    return uniqueBy(items, (item) => item.key)
      .sort((a, b) => actionStatusRank(a.status) - actionStatusRank(b.status) || b.priority - a.priority);
  }

  function buildFreeGames(topics) {
    const items = [];
    for (const topic of topics) {
      const evidence = actionEvidence(topic, /無料|フリープレイ|体験版|デモ版|game pass|playstation plus|ps plus/i, { allowSubscription: true, kind: 'free' });
      if (!evidence || /有料体験|購入特典|予約特典/.test(evidence.claim)) continue;
      const offerType = classifyFreeOffer(evidence.restrictions || evidence.claim);
      if (!offerType) continue;
      const period = extractActionPeriod(evidence.text, evidence.referenceDate);
      items.push({
        ...actionCardBase(topic, evidence),
        ...period,
        key: `free-${evidence.title}-${topic.id || evidence.url}`,
        offerType,
        offerLabel: freeOfferLabel(offerType),
        store: inferStore(evidence.text, /無料|フリープレイ|体験版|デモ版|game pass|playstation plus|ps plus/i),
      });
    }
    return uniqueBy(items, (item) => item.key)
      .sort((a, b) => actionStatusRank(a.status) - actionStatusRank(b.status) || compareDates(a.endsAt, b.endsAt))
      .slice(0, 10);
  }

  function buildTodayReleases(topics) {
    const items = [];
    for (const topic of topics) {
      const evidence = actionEvidence(topic, RELEASE_PATTERN, { kind: 'release' });
      if (!evidence || evidence.multipleSubjects || /予約|事前登録|体験版|デモ版|発表|決定/i.test(evidence.claim)) continue;
      const release = extractEventDate(evidence.text, RELEASE_PATTERN, evidence.referenceDate);
      if (!release || daysBetween(new Date(), release.date) !== 0) continue;
      items.push({
        ...actionCardBase(topic, evidence),
        key: `release-${evidence.title}-${release.date.toISOString()}`,
        status: /予定|発売へ|配信へ/.test(evidence.claim) || (release.precision === 'minute' && release.date > new Date()) ? 'upcoming' : 'active',
        releaseDate: release.date,
        releaseDateLabel: formatActionDate(release),
      });
    }
    return uniqueBy(items, (item) => item.key).sort((a, b) => compareDates(a.releaseDate, b.releaseDate));
  }

  function buildMajorUpdates(topics) {
    const items = [];
    for (const topic of topics) {
      const evidence = actionEvidence(topic, UPDATE_PATTERN, { kind: 'update' });
      if (!evidence || evidence.multipleSubjects || /予定|予告|配信へ|実施へ|pv公開|トレイラー公開|映像公開|hotfix|軽微な修正|不具合修正|微調整/i.test(evidence.claim)) continue;
      const update = extractEventDate(evidence.text, UPDATE_PATTERN, evidence.referenceDate);
      // Publication time is never substituted for an update's effective date.
      if (!update || daysBetween(new Date(), update.date) !== 0 || update.date > new Date()) continue;
      items.push({
        ...actionCardBase(topic, evidence),
        key: `update-${evidence.title}-${topic.id || evidence.url}`,
        status: 'active',
        publishedAt: update.date,
        publishedLabel: formatActionDate(update),
      });
    }
    return uniqueBy(items, (item) => item.key).sort((a, b) => compareDates(b.publishedAt, a.publishedAt));
  }

  function articleSource(topic) {
    const title = String(topic.title || '').replace(/\s+/g, ' ').trim();
    const sourceUrl = topic.sourceUrl || topic.url;
    return (topic.sourceSignals || []).find((signal) => {
      if (String(signal.title || '').replace(/\s+/g, ' ').trim() !== title) return false;
      if (!sourceUrl) return true;
      const identity = canonicalArticleUrl(sourceUrl);
      return Boolean(identity) && identity === canonicalArticleUrl(signal.canonicalUrl || signal.url);
    }) || null;
  }

  function canonicalArticleUrl(value) {
    try {
      const url = new URL(value);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
      }
      url.searchParams.sort();
      return url.href.replace(/\/$/, '');
    } catch { return null; }
  }

  function actionEvidence(topic, actionPattern, { allowSubscription = false, kind = '' } = {}) {
    const headline = String(topic.title || '');
    if (!actionPattern.test(headline) || isNonGameProductTopic(topic) || ADAPTATION_PATTERN.test(headline) || /映画|ドラマ|テレビアニメ|TVアニメ/i.test(headline) || /延期|中止|撤回|終了済み/.test(headline)) return null;
    if (kind === 'release' && !/steam|switch|playstation|ps[45]|xbox|pc|ゲーム|アプリ|android|ios/i.test(headline)) return null;
    if (kind === 'release' && /アップデート|パッチ|シーズン|追加コンテンツ|dlc|体験版|デモ版/i.test(headline)) return null;
    if (kind === 'sale' && /無料|体験版|デモ版/i.test(headline)) return null;
    const mediaPattern = allowSubscription
      ? /kindle|漫画|マンガ|コミック|小説|文庫|画集|サントラ|サウンドトラック|アニメ|映画|ドラマ|アパレル|料金改定|値上げ/i
      : NON_ACTIONABLE_MEDIA_PATTERN;
    if (mediaPattern.test(headline)) return null;
    const source = articleSource(topic);
    if (topic.sourceSignals?.length && !source) return null;
    const referenceDate = safeDate(topic.publishedAt || source?.publishedAt);
    if (referenceDate && referenceDate > new Date()) return null;
    const title = pickPrimaryGameTitle(topic, { actionableOnly: true });
    if (!title || !isPrimaryGameSubject(topic, title)) return null;
    const subjects = extractQuotedNames(headline).filter(isValidGameName).map(canonicalizeGameName);
    const multipleSubjects = new Set(subjects).size > 1;
    const statements = [headline, source?.summary, topic.summary, topic.briefSummary]
      .filter(Boolean).flatMap((text) => String(text).split(/[。！!？?\n]/u)).map((text) => text.trim()).filter(Boolean);
    // Restrictions and withdrawals may be in the next sentence with an omitted
    // subject. They may veto/downgrade an action, never establish a positive fact.
    const restrictions = statements.filter((text) => {
      const names = extractQuotedNames(text).filter(isValidGameName).map(canonicalizeGameName);
      return !names.length || names.every((name) => name === title);
    }).join('。');
    if (/延期|中止|撤回|終了済み|配布終了|セール終了/.test(restrictions)) return null;
    const scoped = statements.filter((text) => {
      if (!mentionsGame(text, title) || !actionPattern.test(text)) return false;
      if (kind === 'sale' && /無料|体験版|デモ版/i.test(text)) return false;
      return extractQuotedNames(text).filter(isValidGameName).every((name) => canonicalizeGameName(name) === title);
    });
    // The headline can quote patch names as well as games. Keep only the primary
    // subject's clause; never take another quoted subject's price, dates or store.
    const claim = scoped.find((text) => actionPattern.test(text)) || '';
    if (!claim) return null;
    const context = statements.filter((text) => !extractQuotedNames(text).length && /\bsteam\b/i.test(text) && SALE_PATTERN.test(text));
    return {
      title,
      claim,
      restrictions,
      text: [...new Set([...scoped, ...(context.length && kind === 'sale' ? ['Steamセール'] : [])])].join('。'),
      multipleSubjects,
      referenceDate,
      url: source?.url || topic.sourceUrl || topic.url || buildGoogleNewsUrl(headline, { rangeDays: 7 }),
    };
  }

  function actionCardBase(topic, evidence) {
    // Japanese headlines also quote patch names and descriptive phrases with 「」.
    // A single explicitly featured 『game title』 is not a multi-game roundup.
    const featured = [...String(topic.title).matchAll(/『([^』]+)』/gu)].map((match) => canonicalizeGameName(match[1]));
    const secondaryQuotes = [...String(topic.title).matchAll(QUOTED_TITLE_PATTERN)]
      .filter((match) => canonicalizeGameName(match[1]) !== canonicalizeGameName(evidence.title));
    const onlyQuotedDescriptions = secondaryQuotes.every((match) => {
      const before = topic.title.slice(0, match.index).trimEnd();
      const after = topic.title.slice(match.index + match[0].length);
      return /アップデート(?:名)?$/.test(before)
        || /^(?:リリース以来|過去|史上).*(?:アプデ|アップデート)$/.test(match[1])
        || (/の限界$/.test(match[1]) && /^を見極め/.test(after));
    });
    const singleFeaturedGame = featured.length === 1 && featured[0] === canonicalizeGameName(evidence.title) && onlyQuotedDescriptions;
    return {
      topicId: topic.id || topic.title,
      title: evidence.title,
      summary: evidence.claim,
      ...thumbnailFields(evidence.multipleSubjects && !singleFeaturedGame ? [] : articleImageCandidates(topic)),
      url: evidence.url,
    };
  }

  function classifyFreeOffer(text) {
    if (SUBSCRIPTION_PATTERN.test(text)) return 'subscription';
    if (/基本プレイ無料|基本無料|free-to-play|f2p/i.test(text)) return 'free-to-play';
    if (TRIAL_PATTERN.test(text)) return 'trial';
    if (LIMITED_FREE_PATTERN.test(text)) return 'ownership';
    return null;
  }

  function freeOfferLabel(type) {
    return { ownership: '無料配布', trial: '体験・試遊', subscription: '加入者向け', 'free-to-play': '基本プレイ無料' }[type] || '無料関連情報';
  }

  function actionStatusLabel(status) {
    return { upcoming: '開始予定', active: '期間内', ended: '終了', unknown: '実施状況は記事で確認' }[status] || '実施状況は記事で確認';
  }

  function actionStatusRank(status) {
    return { active: 0, upcoming: 1, unknown: 2, ended: 3 }[status] ?? 2;
  }

  function buildStartingEvents(events) {
    const items = [];
    const now = new Date();
    for (const event of events) {
      if (!isLikelyGameEvent(event)) continue;
      const start = safeDate(event.startDate);
      if (!start || daysBetween(now, start) !== 0) continue;
      items.push({
        key: event.id || event.title,
        title: event.title,
        startAt: start, startLabel: formatPriceCheckedAt(start),
        summary: event.description || event.category || '本日開始イベント',
        ...thumbnailFields(getCardImageCandidates({ ...event, sourceSignals: [] })),
        url: event.detailUrl || event.officialUrl || '#',
      });
    }
    return uniqueBy(items, (item) => item.key).sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  }

  function buildImportantItems({ steamSales, freeGames, releasesToday, majorUpdates, startingEvents }) {
    const items = [];

    for (const sale of steamSales) {
      if (sale.status !== 'active' || !sale.deadlineVerified || !sale.endsAt || hoursUntil(sale.endsAt) <= 0 || hoursUntil(sale.endsAt) > 24) continue;
      items.push({
        key: `sale-${sale.key}`,
        topicId: sale.topicId,
        label: '24時間以内に終了',
        meta: sale.endsAtLabel || '本日終了',
        title: `${sale.title} のセール終了が近い`,
        gameTitle: sale.title,
        summary: sale.discount ? `${sale.discount}、${sale.price || '価格未取得'}。終了日時と条件を記事で確認してください。` : sale.summary,
        facts: [salePriceSummary(sale), sale.discount, 'Steam'],
        ...thumbnailFields(sale.thumbnailCandidates || [sale.thumbnailUrl]),
        url: sale.url,
        icon: '💸',
        cta: '記事で確認 ↗',
        sortScore: 5000 - hoursUntil(sale.endsAt),
      });
    }

    for (const giveaway of freeGames) {
      if (giveaway.status !== 'active' || !['ownership', 'trial'].includes(giveaway.offerType)) continue;
      items.push({
        key: `free-${giveaway.key}`,
        topicId: giveaway.topicId,
        label: giveaway.offerLabel,
        meta: giveaway.endsAtLabel || '期間限定',
        title: `${giveaway.title} の${giveaway.offerLabel}期間`,
        gameTitle: giveaway.title,
        summary: `${giveaway.offerLabel}の報道です。${giveaway.endsAtLabel ? `${giveaway.endsAtLabel}まで。` : ''}対象ストアと利用条件は記事で確認してください。`,
        facts: [giveaway.store, giveaway.endsAtLabel ? `終了 ${giveaway.endsAtLabel}` : null],
        ...thumbnailFields(giveaway.thumbnailCandidates || [giveaway.thumbnailUrl]),
        url: giveaway.url,
        icon: '🎁',
        cta: '記事で確認 ↗',
        sortScore: giveaway.endsAt ? 4400 - hoursUntil(giveaway.endsAt) : 4100,
      });
    }

    for (const release of releasesToday) {
      items.push({
        key: `release-${release.key}`,
        topicId: release.topicId,
        label: 'TODAY',
        meta: release.releaseDateLabel,
        title: `${release.title} が本日発売${release.status === 'upcoming' ? '予定' : ''}`,
        gameTitle: release.title,
        summary: release.summary,
        facts: [release.status === 'upcoming' ? '本日発売予定' : '本日発売', release.releaseDateLabel],
        ...thumbnailFields(release.thumbnailCandidates || [release.thumbnailUrl]),
        url: release.url,
        icon: '🕹️',
        cta: '記事で確認 ↗',
        sortScore: 3600,
      });
    }

    for (const update of majorUpdates) {
      items.push({
        key: `update-${update.key}`,
        topicId: update.topicId,
        label: 'UPDATE',
        meta: update.publishedLabel,
        title: `${update.title} に大型アップデート`,
        gameTitle: update.title,
        summary: update.summary,
        facts: ['大型更新', update.publishedLabel],
        ...thumbnailFields(update.thumbnailCandidates || [update.thumbnailUrl]),
        url: update.url,
        icon: '🛠️',
        cta: '記事で確認 ↗',
        sortScore: 3200,
      });
    }

    for (const event of startingEvents) {
      items.push({
        key: `event-${event.key}`,
        topicId: null,
        label: 'TODAY',
        meta: event.startLabel,
        title: `${event.title} が本日開始`,
        gameTitle: event.title,
        summary: event.summary,
        facts: ['本日開始', event.startLabel],
        ...thumbnailFields(event.thumbnailCandidates || [event.thumbnailUrl]),
        url: event.url,
        icon: '🎫',
        cta: 'イベントを見る ↗',
        sortScore: 2800,
      });
    }

    return uniqueBy(items, (item) => item.key).sort((a, b) => b.sortScore - a.sortScore).slice(0, 5);
  }

  function buildGameHubs(topics, signals) {
    const saleByTitle = new Map(signals.steamSales.map((item) => [item.title, item]));
    const freeByTitle = new Map(signals.freeGames.map((item) => [item.title, item]));
    const releaseByTitle = new Map(signals.releasesToday.map((item) => [item.title, item]));
    const updateByTitle = new Map(signals.majorUpdates.map((item) => [item.title, item]));

    const buckets = new Map();
    for (const topic of topics) {
      if (!isDiscoveryGameTopic(topic) || new Set(extractQuotedNames(topic.title).filter(isValidGameName).map(canonicalizeGameName)).size > 1) continue;
      const title = pickPrimaryGameTitle(topic, { actionableOnly: true });
      if (!title || !isPrimaryGameSubject(topic, title)) continue;
      const trigger = classifyGameMovement(topic);
      const evidenceTypes = collectEvidenceTypes(topic);
      const bucket = buckets.get(title) || createGameHubBucket(title);
      const topicFitness = scoreTopicFitness(topic, title) + trigger.score * 30;
      bucket.topicIds.add(topic.id || topic.title);
      bucket.articleCount += Math.max(1, Number(topic.posts ?? topic.sourceSignals?.length ?? 1));
      bucket.hotScore = Math.max(bucket.hotScore, Number(topic.score ?? topic.hotScore ?? 0));
      bucket.latestAt = Math.max(bucket.latestAt, archiveTimestamp(topic) || 0);
      evidenceTypes.forEach((type) => bucket.evidenceTypes.add(type));
      if (!bucket.bestTopic || topicFitness > bucket.bestTopicScore) {
        bucket.bestTopic = topic;
        bucket.bestTopicScore = topicFitness;
      }
      if (trigger.score > bucket.trigger.score) {
        bucket.trigger = trigger;
      }
      buckets.set(title, bucket);
    }

    return [...buckets.values()]
      .map((bucket) => finalizeGameHub(bucket, {
        sale: saleByTitle.get(bucket.title) || null,
        free: freeByTitle.get(bucket.title) || null,
        release: releaseByTitle.get(bucket.title) || null,
        update: updateByTitle.get(bucket.title) || null,
      }))
      .filter(Boolean)
      .sort((a, b) => b.sortScore - a.sortScore)
      .slice(0, 10);
  }

  function buildNewsFeed(topics, excludedTopicIds) {
    return topics
      .filter((topic) => !excludedTopicIds.has(topic.id || topic.title))
      .filter(isUsefulNewsTopic)
      .map((topic) => {
        const gameTitle = 'ゲームニュース';
        const steamBonus = isSteamRelevantTopic(topic) ? 42 : 0;
        return {
          key: topic.id || topic.title,
          gameTitle,
          title: topic.title || gameTitle,
          summary: summarizeSupportingText(topic, gameTitle),
          publishedLabel: formatArticleTime(topic),
          sourceLabel: getNewsArticleSource(topic)?.label || '元記事',
          ...thumbnailFields(articleImageCandidates(topic)),
          url: getNewsArticleSource(topic)?.url || buildGoogleNewsUrl(gameTitle, { rangeDays: 7 }),
          sortScore: Number(topic.score ?? topic.hotScore ?? 0) + steamBonus + ((archiveTimestamp(topic) || 0) / 100000000),
        };
      })
      .sort((a, b) => b.sortScore - a.sortScore);
  }

  function buildSteamStories(topics, excludedTopicIds) {
    return topics
      .filter((topic) => !excludedTopicIds.has(topic.id || topic.title))
      .filter((topic) => isSteamRelevantTopic(topic))
      .filter((topic) => isUsefulSteamTopic(topic))
      .map((topic) => {
        const gameTitle = 'Steam記事';
        const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary].filter(Boolean).join(' ');
        return {
          key: topic.id || topic.title,
          topicId: topic.id || null,
          gameTitle,
          title: topic.title || gameTitle,
          summary: summarizeSupportingText(topic, gameTitle),
          label: classifySteamStoryLabel(topic.title),
          publishedLabel: formatArticleTime(topic),
          sourceLabel: getNewsArticleSource(topic)?.label || 'Steam記事',
          ...thumbnailFields(articleImageCandidates(topic)),
          url: getNewsArticleSource(topic)?.url || buildGoogleNewsUrl(`${gameTitle} Steam`, { rangeDays: 7 }),
          sortScore: scoreTopicFitness(topic, gameTitle) + steamStoryPriority(text),
        };
      })
      .sort((a, b) => b.sortScore - a.sortScore)
      .slice(0, 8);
  }

  function createGameHubBucket(title) {
    return {
      title,
      topicIds: new Set(),
      articleCount: 0,
      hotScore: 0,
      latestAt: 0,
      evidenceTypes: new Set(),
      bestTopic: null,
      bestTopicScore: -1,
      trigger: { score: 0, label: '', reason: '' },
    };
  }

  function finalizeGameHub(bucket, extra) {
    for (const key of ['sale', 'free', 'release', 'update']) {
      if (extra[key]?.topicId !== (bucket.bestTopic?.id || bucket.bestTopic?.title)) extra[key] = null;
    }
    const actionableCount = [extra.sale, extra.free, extra.release, extra.update].filter(Boolean).length;
    if (!bucket.bestTopic) return null;
    if (bucket.trigger.score < 2 && actionableCount === 0) return null;

    const tags = [];
    const facts = [];
    let sortScore = bucket.hotScore + bucket.articleCount * 8 + bucket.trigger.score * 60 + bucket.evidenceTypes.size * 20;
    let summary = summarizeGameTopic(bucket.bestTopic);
    let ctaLabel = '関連記事を見る';
    let url = getNewsArticleSource(bucket.bestTopic)?.url || buildGoogleNewsUrl(bucket.title, { rangeDays: 7 });

    if (extra.release) {
      tags.push(extra.release.status === 'upcoming' ? '本日発売予定' : '本日発売');
      facts.push(extra.release.releaseDateLabel);
      summary = extra.release.summary;
      ctaLabel = '発売情報を見る';
      url = extra.release.url;
      sortScore += 260;
    }
    if (extra.update) {
      tags.push('大型更新');
      facts.push(extra.update.publishedLabel);
      if (!extra.release) summary = `${bucket.title} に大型アップデート。${summarizeSupportingText(extra.update, summary)}`;
      if (ctaLabel === '関連記事を見る') ctaLabel = '更新内容を見る';
      if (!extra.release) url = extra.update.url;
      sortScore += 220;
    }
    if (extra.free) {
      tags.push(extra.free.offerLabel, actionStatusLabel(extra.free.status));
      facts.push(extra.free.store);
      if (!extra.release && !extra.update) summary = extra.free.summary;
      ctaLabel = '受け取る';
      url = extra.free.url;
      sortScore += 240;
    }
    if (extra.sale) {
      tags.push(extra.sale.priorityLabel);
      facts.push(extra.sale.discount || null);
      facts.push(salePriceSummary(extra.sale));
      if (!extra.release && !extra.update && !extra.free) {
        summary = `${bucket.title} のセール報道。${extra.sale.discount || '割引情報あり'} / ${salePriceSummary(extra.sale)}。${actionStatusLabel(extra.sale.status)}`;
      }
      if (ctaLabel === '関連記事を見る') ctaLabel = 'セールを見る';
      if (!extra.free && !extra.release && !extra.update) url = extra.sale.url;
      sortScore += 200;
    }
    if (!tags.length && bucket.trigger.label) tags.push(bucket.trigger.label);
    if (bucket.trigger.label && !tags.includes(bucket.trigger.label)) tags.push(bucket.trigger.label);
    if (bucket.articleCount) facts.push(`関連記事 ${bucket.articleCount}件`);
    const evidenceLabel = buildEvidenceLabel(bucket.evidenceTypes);

    return {
      key: bucket.title,
      topicIds: [bucket.bestTopic.id || bucket.bestTopic.title],
      title: bucket.title,
      summary: trimSummary(summary, 78),
      ...thumbnailFields(articleImageCandidates(bucket.bestTopic)),
      tags: uniqueCompact(tags).slice(0, 3),
      facts: uniqueCompact(facts).slice(0, 4),
      evidenceLabel,
      ctaLabel: '記事で確認',
      url,
      sortScore,
    };
  }

  function classifyGameMovement(topic) {
    const text = String(topic.title || '');
    if (isNonGameProductTopic(topic) || ADAPTATION_PATTERN.test(text) || /映画|ドラマ|テレビアニメ|TVアニメ/i.test(text)) return { score: 1, label: '関連ニュース', reason: '記事で内容を確認できます' };
    if (buildTodayReleases([topic]).length) return { score: 6, label: '本日発売情報', reason: '記事に発売日の記載があります' };
    if (buildMajorUpdates([topic]).length) return { score: 5, label: '大型更新', reason: '記事に実施日の記載があります' };
    const free = buildFreeGames([topic])[0];
    if (free) return { score: 4, label: `${free.offerLabel}・${actionStatusLabel(free.status)}`, reason: '利用条件は記事で確認してください' };
    if (SALE_PATTERN.test(text)) return { score: 2, label: 'セール情報', reason: '価格と期間は記事で確認してください' };
    if (/体験版|デモ版/.test(text)) return { score: 2, label: '体験版情報', reason: '配信状況は記事で確認してください' };
    if (RELEASE_PATTERN.test(text)) return { score: 2, label: '発売・配信情報', reason: '発売日と対象機種は記事で確認してください' };
    if (UPDATE_PATTERN.test(text)) return { score: 2, label: '更新情報', reason: '実施日時は記事で確認してください' };
    if (/万ダウンロード|万本|突破|達成|記録/i.test(text)) return { score: 3, label: '記録の報道', reason: '記事で内容を確認できます' };
    if (/pv公開|トレイラー公開|映像公開|続報|詳細公開/i.test(text)) return { score: 2, label: '続報', reason: '記事で内容を確認できます' };
    return { score: 1, label: '関連ニュース', reason: '記事で内容を確認できます' };
  }

  function collectEvidenceTypes(topic) {
    return new Set(['news']);
  }

  function buildEvidenceLabel(evidenceSet) {
    return '記事で報道';
  }

  function isUsefulNewsTopic(topic) {
    // Not enough evidence for an action card is a reason to retain the original
    // article, including roundups, adaptations and merchandise coverage.
    return isGameTopic(topic) && Boolean(String(topic.title || '').trim());
  }

  function isSteamRelevantTopic(topic) {
    // Publisher-wide feed tags do not establish this article's platform.
    return /\bsteam\b|steam deck|pcゲーム|早期アクセス/i.test([topic.title, topic.summary, topic.briefSummary].filter(Boolean).join(' '));
  }

  function isUsefulSteamTopic(topic) {
    const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary].filter(Boolean).join(' ');
    const gameTitle = pickPrimaryGameTitle(topic, { actionableOnly: true });
    if (!gameTitle) return false;
    if (!isDiscoveryGameTopic(topic)) return false;
    if (isNonGameProductTopic(topic) || NON_ACTIONABLE_MEDIA_PATTERN.test(text)) return false;
    if (/コラボカフェ|グッズ|tシャツ|フィギュア|チャーム|サントラ|サウンドトラック/i.test(text)) return false;
    if (!isPrimaryGameSubject(topic, gameTitle)) return false;
    return /steam|早期アクセス|体験版|デモ版|配信開始|発売|アップデート|パッチノート|セール|無料トライアル|ストアページ|ウィッシュリスト/i.test(text);
  }

  function classifySteamStoryLabel(text) {
    if (ADAPTATION_PATTERN.test(text)) return '関連ニュース';
    if (/体験版|デモ版|無料(?:で)?プレイ|フリープレイ|無料トライアル/i.test(text)) return '無料体験情報';
    if (SUBSCRIPTION_PATTERN.test(text)) return '加入者向け情報';
    if (LIMITED_FREE_PATTERN.test(text)) return '無料配布情報';
    if (/早期アクセス/i.test(text)) return '早期アクセス情報';
    if (RELEASE_PATTERN.test(text)) return '発売・配信情報';
    if (UPDATE_PATTERN.test(text)) return '更新情報';
    if (SALE_PATTERN.test(text)) return 'セール情報';
    return 'Steam記事';
  }

  function steamStoryPriority(text) {
    if (/早期アクセス/i.test(text)) return 80;
    if (/体験版|デモ版/i.test(text)) return 72;
    if (/本日発売|発売|配信開始/i.test(text)) return 68;
    if (/大型アップデート|アップデート|パッチノート|新シーズン/i.test(text)) return 64;
    if (/無料トライアル|無料配布/i.test(text)) return 60;
    if (/セール|割引|最安/i.test(text)) return 56;
    return 24;
  }

  function isGameTopic(topic) {
    return (Array.isArray(topic.categories) && topic.categories.includes('games')) || GAME_HINT_PATTERN.test(topicText(topic));
  }

  function extractGameNames(topic) {
    const text = String(topic.title || '');
    const bookQuote = text.match(/『([^『』]{2,48})』/u);
    const generalQuotes = [...text.matchAll(/「([^「」]{2,48})」/gu)];
    // General-purpose quotation marks also enclose features and opinions. With
    // multiple candidates, retain the article without inventing a game label.
    if (!bookQuote && generalQuotes.length > 1) return [];
    const generalQuote = generalQuotes[0];
    if (!bookQuote && generalQuote) {
      const name = canonicalizeGameName(generalQuote[1]);
      const isKnown = KNOWN_GAME_TERMS.some(([label]) => label === name);
      const following = text.slice(generalQuote.index + generalQuote[0].length);
      const hasSubjectAction = /^\s*[,，、]?\s*(?:は|が|の|を)?\s*(?:Steam|Switch|PS[45]|Xbox|PC|発売|配信|リリース|早期アクセス|セール|無料配布|無料プレイ|フリープレイ|大型アップデート|体験版|デモ版)/i.test(following);
      if (!isKnown && !hasSubjectAction) return [];
    }
    const firstQuote = bookQuote?.[1] || generalQuote?.[1];
    // Do not skip an unrecognized primary name and promote a quoted feature,
    // character or opinion later in the headline into a made-up game title.
    if (firstQuote) return [canonicalizeGameName(firstQuote)].filter(isValidGameName);
    const found = [];
    for (const [label, pattern] of KNOWN_GAME_TERMS) {
      if (pattern.test(text) && !found.includes(label)) found.push(label);
    }
    return [...new Set(found)];
  }

  function mentionsGame(text, name) {
    if (!name) return false;
    if (String(text).toLowerCase().includes(String(name).toLowerCase())) return true;
    return KNOWN_GAME_TERMS.some(([label, pattern]) => label === name && pattern.test(text));
  }

  function pickPrimaryGameTitle(topic, { actionableOnly = false } = {}) {
    const candidates = extractGameNames(topic)
      .filter((name) => isDisplayableGameTitle(name, topic))
      .filter((name) => (actionableOnly ? !PROMOTIONAL_TITLE_PATTERN.test(name) : true));
    return candidates[0] || null;
  }

  function extractQuotedNames(text) {
    const values = [];
    for (const match of String(text ?? '').matchAll(QUOTED_TITLE_PATTERN)) values.push(match[1]);
    return values;
  }

  function normalizeGameName(value) {
    // Quoted title punctuation is part of identity (e.g. Warhammer 40,000).
    return String(value ?? '').replace(/^[『「]|[』」]$/g, '').replace(/\s+/g, ' ').trim();
  }

  function canonicalizeGameName(value) {
    const normalized = normalizeGameName(value);
    for (const [label, pattern] of KNOWN_GAME_TERMS) {
      const match = normalized.match(pattern);
      if (match && match[0].length === normalized.length) return label;
    }
    return normalized;
  }

  function isValidGameName(value) {
    const normalized = canonicalizeGameName(value);
    const isKnownAlias = KNOWN_GAME_TERMS.some(([label]) => label === normalized);
    const englishWordCount = normalized.split(/\s+/).filter(Boolean).length;
    return normalized.length >= 2
      && normalized.length <= 48
      && !INVALID_GAME_NAME_PATTERN.test(normalized)
      && !GENERIC_GAME_NAME_PATTERN.test(normalized)
      && !/メーカー|スタジオ|開発者|開発チーム|運営|関係者/i.test(normalized)
      && !/フェス|チャプター|シーズン|episode|エピソード|パック|セット|エディション|シール|サウンドトラック|サントラ/i.test(normalized)
      && !/(conference|fest|festival|showcase|direct|masters|worlds|championship|cup|ndc\d+|state of play|game pass|switch 2|steam next fest)/i.test(normalized)
      && !/^(発売|配信|セール|無料配布|アップデート|デモ版|体験版|大型アップデート)/.test(normalized)
      && !/^[A-Z]{1,4}$/.test(normalized)
      && !/^[\u30a0-\u30ff]{2,5}$/.test(normalized)
      && !(englishWordCount === 1 && /^[A-Za-z]+$/.test(normalized) && !isKnownAlias)
      && !(/[\u3040-\u309f].*\s+[\u3040-\u309f]/u.test(normalized))
      && !(/^[\u3040-\u309fー]{3,}$/u.test(normalized) && !isKnownAlias);
  }

  function isDisplayableGameTitle(name, topic) {
    if (!isValidGameName(name)) return false;
    const normalized = canonicalizeGameName(name);
    if (WEAK_FALLBACK_TITLE_PATTERN.test(normalized)) return false;
    if (isNonGameProductTopic(topic)) return false;
    return hasStrongTitleEvidence(normalized, topic);
  }

  function isPrimaryGameSubject(topic, name) {
    return isFocusedGameMention(String(topic.title || ''), name);
  }

  function isFocusedGameMention(text, name) {
    if (!name) return false;
    const source = String(text || '');
    let index = source.toLowerCase().indexOf(String(name).toLowerCase());
    if (index < 0) {
      for (const [label, pattern] of KNOWN_GAME_TERMS) {
        if (label !== name) continue;
        const match = source.match(pattern);
        if (match) { index = match.index; break; }
      }
    }
    return index >= 0 && index <= Math.floor(source.length * 0.45);
  }

  function hasStrongTitleEvidence(name, topic) {
    return mentionsGame(topic.title, name);
  }

  function scoreGameNameCandidate(name, topic, text) {
    let score = 0;
    if (KNOWN_GAME_TERMS.some(([label]) => label === name)) score += 50;
    if (String(topic.title || '').includes(name)) score += 20;
    if ((topic.sourceSignals || []).some((signal) => String(signal.title || '').includes(name))) score += 16;
    if (new RegExp(`[『「]${escapeRegExp(name)}[』」]`, 'u').test(text)) score += 12;
    if (/[A-Za-z]/.test(name) || /[:：]/.test(name) || name.length >= 6) score += 8;
    if (/^[\u30a0-\u30ff]{2,5}$/.test(name) && !KNOWN_GAME_TERMS.some(([label]) => label === name)) score -= 18;
    if (/^[\u4e00-\u9fff]{1,3}$/.test(name) && !KNOWN_GAME_TERMS.some(([label]) => label === name)) score -= 12;
    if (/フェス|チャプター|シーズン|episode|エピソード/i.test(name)) score -= 30;
    return score;
  }

  function isDiscoveryGameTopic(topic) {
    const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary, ...(topic.relatedKeywords || [])].filter(Boolean).join(' ');
    return isGameTopic(topic)
      && !ADAPTATION_PATTERN.test(String(topic.title || ''))
      && !/映画|ドラマ|テレビアニメ|TVアニメ/i.test(String(topic.title || ''))
      && !isNonGameProductTopic(topic)
      && !NON_ACTIONABLE_MEDIA_PATTERN.test(text)
      && (!NON_GAME_TOPIC_PATTERN.test(text) || STRONG_GAME_TOPIC_PATTERN.test(text));
  }

  function isMerchandiseTopic(topic) {
    const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary, ...(topic.relatedKeywords || [])]
      .filter(Boolean)
      .join(' ');
    return MERCHANDISE_TOPIC_PATTERN.test(text);
  }

  function isNonGameProductTopic(topic) {
    const text = String(topic.title || '');
    return MERCHANDISE_TOPIC_PATTERN.test(text) || NON_GAME_PRODUCT_PATTERN.test(text);
  }

  function isLikelyGameEvent(event) {
    const text = [event.title, event.description, event.category, event.venue, ...(event.tags || [])].filter(Boolean).join(' ');
    return /game|ゲーム|nintendo|switch|steam|playstation|xbox|eスポーツ|esports|pokemon|ポケモン|valorant|apex|street fighter|bitsummit/i.test(text);
  }

  function inferStore(text, actionPattern = /無料|セール|割引|体験版|デモ版/i) {
    const stores = new Set();
    for (const sentence of String(text || '').split(/[。！!？?\n]/u)) {
      if (!actionPattern.test(sentence)) continue;
      // General retail availability is not evidence of participating platforms.
      if (/向けに発売中|対応機種|発売中です/.test(sentence)) continue;
      for (const [label, pattern] of [
        ['Steam', /\bsteam\b/i], ['Epic Games', /epic games/i], ['GOG', /\bgog\b/i],
        ['itch.io', /itch\.io/i], ['PS5', /ps5/i], ['Xbox', /xbox/i],
        ['Prime Gaming（会員向け）', /prime gaming/i], ['Game Pass', /game pass/i], ['PlayStation Plus', /playstation plus|ps plus/i],
      ]) if (pattern.test(sentence)) stores.add(label);
    }
    return [...stores].join(' / ') || null;
  }

  function summarizeGameTopic(topic) {
    return trimSummary(summarizeSupportingText(topic, topic.title || ''), 70);
  }

  function summarizeSupportingText(topic, fallback = '') {
    const source = topic.whatHappened || topic.title || topic.briefSummary || topic.summary || fallback;
    const cleaned = cleanSummaryText(source);
    return cleaned || fallback;
  }

  function cleanSummaryText(value) {
    return String(value ?? '')
      .replace(/「([^」]+)」の検索結果。*$/u, '$1')
      .replace(/Yahoo!ニュースでは.*$/u, '')
      .replace(/こんにちは。.*?(?=「|『|[A-Z0-9一-龠ぁ-んァ-ヶ])/u, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function trimSummary(value, max = 70) {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max).trim()}…`;
  }

  function scoreTopicFitness(topic, gameName) {
    const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary].filter(Boolean).join(' ');
    const exactTitle = text.includes(gameName) ? 20 : 0;
    const hasThumbnail = topic.thumbnailUrl ? 6 : 0;
    const sourceCount = Math.max(1, Number(topic.posts ?? topic.sourceSignals?.length ?? 1)) * 5;
    const score = Number(topic.score ?? topic.hotScore ?? 0);
    const steamBias = isSteamRelevantTopic(topic) ? 18 : 0;
    return exactTitle + hasThumbnail + sourceCount + score + steamBias;
  }

  function extractDiscount(text) {
    if (/最大\s*\d+\s*[%％]|(?:から|〜|～)\s*\d+\s*[%％]/.test(String(text))) return null;
    const values = [...String(text ?? '').matchAll(/(\d{1,3})\s*[%％]\s*(?:オフ|OFF)/gi)].map((match) => Number(match[1]));
    const distinct = [...new Set(values)];
    return distinct.length === 1 && distinct[0] > 0 && distinct[0] <= 100 ? distinct[0] : null;
  }

  function salePriceSummary(sale) {
    const regular = sale.regularPrice === null || sale.regularPrice === undefined ? '通常価格未確認' : `通常${Number(sale.regularPrice).toLocaleString('ja-JP')}円`;
    return `${regular} → ${sale.price || '割引後未確認'}`;
  }

  function extractPricePair(text) {
    const source = String(text || '');
    const unknown = { regularPrice: null, salePrice: null };
    // Both roles must be stated for the same product. Never reverse-calculate
    // the regular price from a rounded discount or mix editions/bundles.
    if (/最大|円(?:から|より|〜|～|相当|引き|割引)|通常版.*(?:デラックス|deluxe|限定版)|本編.*(?:DLC|セット|バンドル)|(?:デラックス|deluxe|限定版).*通常版/i.test(source)) return unknown;
    const amount = '([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\\s*円';
    const regular = [...source.matchAll(new RegExp(`(?:通常価格|定価|元値)\\s*[：:]?\\s*${amount}`, 'g'))];
    const sale = [...source.matchAll(new RegExp(`(?:セール価格|割引後(?:の価格)?|特価)\\s*[：:]?\\s*${amount}`, 'g'))];
    const arrow = source.match(new RegExp(`(?:通常価格|定価|元値)\\s*[：:]?\\s*${amount}\\s*[→⇒]\\s*(?:(?:セール価格|割引後(?:の価格)?|特価)\\s*[：:]?\\s*)?${amount}`));
    const prices = [...source.matchAll(PRICE_PATTERN)].map((match) => Number(match[1].replace(/,/g, '')));
    if (regular.length !== 1) return unknown;
    const regularPrice = Number(regular[0][1].replace(/,/g, ''));
    const salePrice = sale.length === 1 ? Number(sale[0][1].replace(/,/g, '')) : arrow ? Number(arrow[2].replace(/,/g, '')) : null;
    if (salePrice === null) return prices.length === 1 ? { regularPrice, salePrice: null } : unknown;
    if (salePrice >= regularPrice || salePrice < 0 || prices.some((value) => value !== regularPrice && value !== salePrice)) return unknown;
    const discount = extractDiscount(source);
    if (discount && Math.abs(100 * (regularPrice - salePrice) / regularPrice - discount) > 1) return unknown;
    return { regularPrice, salePrice };
  }

  function extractPrice(text) {
    if (/通常価格|定価|参考価格|元値|円(?:引き|割引|相当|分|から|〜|～)/.test(String(text))) return null;
    const prices = [...String(text ?? '').matchAll(PRICE_PATTERN)].map((match) => Number(match[1].replace(/,/g, '')));
    // A list price, previous price or another edition must not become the sale price.
    const distinct = [...new Set(prices)];
    return distinct.length === 1 ? distinct[0].toLocaleString('ja-JP') : null;
  }

  function japaneseParts(value) {
    const date = safeDate(value);
    if (!date) return null;
    const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
  }

  function parseJapaneseDates(text, referenceDate) {
    const source = String(text || '');
    const reference = japaneseParts(referenceDate);
    const entries = [];
    for (const match of source.matchAll(JAPANESE_DATE_PATTERN)) {
      const [, explicitYear, monthText, dayText, meridiem, hourText, colonMinutes, kanjiMinutes] = match;
      const month = Number(monthText);
      const day = Number(dayText);
      const relativeYear = source.slice(Math.max(0, match.index - 3), match.index).match(/(再来年|来年|今年|昨年|去年)$/)?.[1];
      let year = explicitYear ? Number(explicitYear) : reference?.year;
      if (!explicitYear && relativeYear && year) year += { 再来年: 2, 来年: 1, 今年: 0, 昨年: -1, 去年: -1 }[relativeYear];
      if (!year) continue; // A yearless date without a publication anchor is unknown.
      if (!explicitYear && !relativeYear && reference) {
        // Only the adjacent Dec/Jan boundary warrants inferring another year.
        if (reference.month >= 11 && month <= 2) year += 1;
        if (reference.month <= 2 && month >= 11) year -= 1;
      }
      const previous = entries.at(-1);
      const connector = previous ? source.slice(previous.end, match.index) : '';
      if (!explicitYear && !relativeYear && previous && /^(?:\s*(?:から|[〜～~－–—-])\s*)$/.test(connector)) {
        year = previous.year + (month < previous.month ? 1 : 0);
      }
      let hour = hourText === undefined ? 0 : Number(hourText);
      const minute = Number(colonMinutes ?? kanjiMinutes ?? (/時半/.test(match[0]) ? 30 : 0));
      if (meridiem) {
        if (hour < 1 || hour > 12) continue;
        hour = hour % 12 + (meridiem === '午後' ? 12 : 0);
      }
      const date = buildDateFromParts(month, day, hour, minute, year);
      if (!date) continue;
      entries.push({ date, year, month, day, precision: hourText === undefined ? 'day' : 'minute', index: match.index, end: match.index + match[0].length, raw: match[0] });
    }
    return entries;
  }

  function buildDateFromParts(month, day, hour = 0, minute = 0, year = null) {
    if (!year || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
    if (utc.getUTCFullYear() !== Number(year) || utc.getUTCMonth() + 1 !== Number(month) || utc.getUTCDate() !== Number(day)) return null;
    return new Date(utc.getTime() - 9 * 60 * 60 * 1000);
  }

  function distinctDate(entries) {
    if (!entries.length) return null;
    const days = new Set(entries.map((entry) => `${entry.year}-${entry.month}-${entry.day}`));
    if (days.size !== 1) return null;
    const precise = entries.filter((entry) => entry.precision === 'minute');
    if (new Set(precise.map((entry) => entry.date.getTime())).size > 1) return null;
    return precise[0] || entries[0];
  }

  function extractActionPeriod(text, referenceDate) {
    const starts = [];
    const ends = [];
    for (const sentence of String(text || '').split(/[。！!？?\n]/u)) {
      const dates = parseJapaneseDates(sentence, referenceDate);
      dates.forEach((entry, index) => {
        const after = sentence.slice(entry.end, dates[index + 1]?.index ?? sentence.length);
        const before = sentence.slice(dates[index - 1]?.end ?? 0, entry.index);
        if (/^\s*(?:から|より|[〜～~－–—-])/.test(after) || /(?:開始|スタート)\s*(?:日時)?[:：]?\s*$/.test(before)) starts.push(entry);
        if (/^\s*(?:まで|終了|締切)/.test(after) || /(?:終了|期限|締切)\s*(?:日時)?[:：]?\s*$/.test(before)) ends.push(entry);
        if (index > 0 && /^\s*[〜～~－–—-]\s*$/.test(before)) ends.push(entry);
      });
    }
    const start = distinctDate(starts);
    const end = distinctDate(ends);
    const startsAt = start?.date || null;
    // A day-only end includes the named Japanese calendar day. Do not display a
    // made-up clock time. A precise end is exclusive, including exactly at expiry.
    const endsAt = end ? new Date(end.date.getTime() + (end.precision === 'day' ? 86400000 : 0)) : null;
    const conflicting = (starts.length > 0 && !start) || (ends.length > 0 && !end) || (startsAt && endsAt && startsAt >= endsAt);
    let status = 'unknown';
    if (!conflicting) {
      if (endsAt && Date.now() >= endsAt.getTime()) status = 'ended';
      else if (startsAt && Date.now() < startsAt.getTime()) status = 'upcoming';
      else if (startsAt && endsAt) status = 'active';
    }
    return {
      status,
      startsAt: conflicting ? null : startsAt,
      startsAtLabel: !conflicting && start ? formatActionDate(start) : null,
      endsAt: conflicting ? null : endsAt,
      endsAtLabel: !conflicting && end ? formatActionDate(end) : null,
    };
  }

  function extractEventDate(text, eventPattern, referenceDate) {
    const matches = [];
    for (const sentence of String(text || '').split(/[。！!？?\n]/u)) {
      if (!eventPattern.test(sentence) || /発表|決定|予告|予定だった/.test(sentence)) continue;
      const dates = parseJapaneseDates(sentence, referenceDate);
      dates.forEach((entry, index) => {
        const following = sentence.slice(entry.end, dates[index + 1]?.index ?? sentence.length);
        // The effective date must lead directly into the event, not "announced
        // today" or a publication timestamp elsewhere in the article.
        if (/^\s*(?:(?:に|から|より|を予定して|予定の)\s*)?(?:発売|配信開始|リリース|大型アップデート|アップデート(?:配信|実装)|シーズン開始|新章開幕|新エリア追加|新キャラ実装|新オペレーター実装|パッチノート|イベント開始)/i.test(following)) matches.push(entry);
      });
      if (!dates.length && /本日(?:発売|配信(?:開始)?|リリース|、?大型アップデート)/.test(sentence) && referenceDate) {
        const ref = japaneseParts(referenceDate);
        matches.push({ ...ref, date: buildDateFromParts(ref.month, ref.day, 0, 0, ref.year), precision: 'day' });
      }
    }
    return distinctDate(matches);
  }

  function extractRelevantDate(text, hintPattern = null, referenceDate = null) {
    const dates = parseJapaneseDates(text, referenceDate);
    const candidates = hintPattern ? dates.filter((entry) => hintPattern.test(String(text).slice(entry.end, entry.end + 12))) : dates;
    return distinctDate(candidates)?.date || null;
  }

  function formatActionDate(entry) {
    if (!entry) return null;
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
      ...(entry.precision === 'minute' ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(entry.date) + (entry.precision === 'minute' ? ' JST' : '');
  }

  function renderFailure() {
    searchLoadFailed = true;
    gameLoadFatal = true;
    clearOfferRefreshTimer();
    setSearchStatus();
    const html = renderEmptyCard('ゲーム記事を読み込めませんでした', '通信状況を確認して、ページ上部の再試行で読み込み直してください。');
    if (heroBriefElement) heroBriefElement.innerHTML = '<li>ゲームデータの読み込みに失敗しました。</li>';
    if (heroStatsElement) heroStatsElement.innerHTML = html;
    if (heroCommandElement) heroCommandElement.innerHTML = html;
    if (importantListElement) importantListElement.innerHTML = html;
    if (hubListElement) hubListElement.innerHTML = html;
    if (steamSaleListElement) steamSaleListElement.innerHTML = html;
    if (steamStoryListElement) steamStoryListElement.innerHTML = html;
    if (freeGameListElement) freeGameListElement.innerHTML = html;
    if (newsListElement) newsListElement.innerHTML = html;
    renderGameLoadNotice();
  }

  function buildSearchArticles(topics) {
    const articles = new Map();
    for (const topic of topics.filter(isUsefulNewsTopic)) {
      const source = getNewsArticleSource(topic);
      const key = source?.key || topic.id || topic.title;
      const searchText = normalizeSearchText(searchIndexText(topic.title, topic.whatHappened, topic.summary, topic.briefSummary, ...extractGameNames(topic)));
      const existing = articles.get(key);
      if (existing) {
        // Same-article mirrors add searchable wording, never sibling destinations.
        if (!existing.searchText.includes(searchText)) existing.searchText += ` ${searchText}`;
        Object.assign(existing, thumbnailFields([...existing.thumbnailCandidates, ...articleImageCandidates(topic)]));
        continue;
      }
      articles.set(key, {
        key,
        title: topic.title,
        summary: summarizeSupportingText(topic, topic.title),
        sourceLabel: source?.label || '記事リンク未確認',
        url: source?.url || '',
        publishedLabel: formatArticleTime(topic),
        publishedAt: safeDate(topic.publishedAt || articleSource(topic)?.publishedAt)?.getTime() || 0,
        ...thumbnailFields(articleImageCandidates(topic)),
        // Index original article text before display limits and hub exclusions.
        // A neighbouring source in a topic cluster cannot donate its destination.
        searchText,
      });
    }
    return [...articles.values()].sort((a, b) => b.publishedAt - a.publishedAt);
  }

  function normalizeSearchText(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
  }

  function findSearchResults(query) {
    const terms = normalizeSearchText(query).split(' ').filter(Boolean);
    if (!terms.length) return [];
    return (dashboardState?.searchItems || []).filter((item) => terms.every((term) => item.searchText.includes(term)));
  }

  function setSearchStatus(message = '') {
    if (!searchStatusElement) return;
    const count = dashboardState?.searchItems?.length;
    searchStatusElement.textContent = message || (searchLoadFailed
      ? '記事を読み込めませんでした。上の再試行で読み込み直してください。'
      : count === undefined
      ? 'ゲーム記事を読み込んでいます。'
      : `読み込んだゲーム記事 ${count}件を検索できます。表示欄に収まらない記事も対象です。`);
  }

  function renderSearchResults({ focusHeading = false } = {}) {
    if (!searchResultsSection || !searchResultsElement || !searchQuery) return;
    const matches = findSearchResults(searchQuery);
    const items = matches.slice(0, searchVisibleCount);
    const corpusCount = dashboardState?.searchItems?.length || 0;
    searchResultsSection.hidden = false;
    setSearchStatus(`「${searchQuery}」に一致する記事 ${matches.length}件（${items.length}件表示 / 読み込んだ${corpusCount}件を検索）`);
    if (searchResultsHeading) searchResultsHeading.textContent = `「${searchQuery}」の記事 ${matches.length}件`;
    searchResultsElement.innerHTML = items.length ? items.map((result) => `
      <article class="game-news-row" data-game-key="${escapeHtml(result.key)}">
        <div class="game-news-row-main">
          ${result.thumbnailUrl ? renderSignalThumbnail(result) : ''}
          <span class="game-news-row-game">${escapeHtml(result.sourceLabel)}</span>
          <h3 tabindex="-1" data-game-result-title>${buildArticleTitleLink(result.title, result.url)}</h3>
          <p>${escapeHtml(result.summary)}</p>
        </div>
        <div class="game-news-row-side">
          <span class="game-card-meta">${escapeHtml(result.publishedLabel)}</span>
        </div>
      </article>
    `).join('') : renderEmptyCard('一致する記事は見つかりませんでした', 'ゲーム名を短くするか、別の表記で試してください。検索対象は現在読み込んだ記事です。');
    if (searchMoreElement) {
      searchMoreElement.hidden = items.length >= matches.length;
      searchMoreElement.textContent = `次の${Math.min(8, matches.length - items.length)}件を表示（残り${matches.length - items.length}件）`;
    }
    if (focusHeading) {
      searchResultsHeading?.focus({ preventScroll: true });
      searchResultsSection.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function clearGameSearch({ focusInput = false } = {}) {
    searchQuery = '';
    searchVisibleCount = 8;
    if (searchInputElement) searchInputElement.value = '';
    if (searchResultsSection) searchResultsSection.hidden = true;
    if (searchResultsElement) searchResultsElement.innerHTML = '';
    if (searchMoreElement) searchMoreElement.hidden = true;
    setSearchStatus();
    if (focusInput) searchInputElement?.focus();
  }

  function searchIndexText(...parts) {
    return parts.filter(Boolean).join(' ');
  }

  function renderEmptyCard(title, text) {
    return `
      <article class="game-empty-card">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
      </article>
    `;
  }

  function thumbnailFields(values) {
    if (Array.isArray(values) && gameThumbnailFieldCache.has(values)) return gameThumbnailFieldCache.get(values);
    const candidates = [];
    for (const value of values || []) {
      const key = String(value ?? '').trim();
      if (!gameImageUrlCache.has(key)) {
        // Validation is URL-only and shared across exact-article mirrors. Bound
        // this cache independently from the image-attempt state on DOM nodes.
        const url = getCardImageCandidates({ thumbnailUrl: key })[0];
        const identity = url ? new URL(url) : null;
        if (identity) identity.hash = '';
        if (gameImageUrlCache.size >= 1024) gameImageUrlCache.clear();
        gameImageUrlCache.set(key, identity?.href || null);
      }
      const url = gameImageUrlCache.get(key);
      if (!url) continue;
      if (!candidates.includes(url)) candidates.push(url);
      if (candidates.length === 3) break;
    }
    const fields = { thumbnailUrl: candidates[0] || null, thumbnailCandidates: candidates };
    if (Array.isArray(values)) gameThumbnailFieldCache.set(values, fields);
    gameThumbnailFieldCache.set(candidates, fields);
    return fields;
  }

  function articleImageSnapshot(topic) {
    const source = getNewsArticleSource(topic);
    if (!source) return { articleKey: '', candidates: [] };
    const signals = (Array.isArray(topic.sourceSignals) ? topic.sourceSignals : []).filter((signal) => getNewsArticleSource(signal)?.key === source.key);
    const ownSource = getNewsArticleSource({ ...topic, sourceSignals: [] });
    // An exact-headline signal may establish the destination when the top-level
    // URL is absent. Its own images are safe; unowned cluster images are not.
    const owner = ownSource?.key === source.key ? topic : signals[0];
    const imageValues = (item) => [item?.ogImage, item?.twitterImage, item?.thumbnailUrl, item?.thumbnail,
      item?.imageUrl, item?.image, item?.sourceImage, item?.jsonLdImage];
    const candidates = thumbnailFields([...imageValues(owner), ...signals.flatMap(imageValues)]).thumbnailCandidates;
    return { articleKey: source.key, candidates };
  }

  function articleImageCandidates(topic) {
    const snapshot = topic.gameArticleImages || articleImageSnapshot(topic);
    if (snapshot.article) {
      Object.assign(snapshot, articleImageSnapshot(snapshot.article));
      delete snapshot.article;
    }
    return snapshot.articleKey === getNewsArticleSource(topic)?.key ? snapshot.candidates : [];
  }

  function steamImageCandidates(offer) {
    return [offer.thumbnailUrl, ...(Array.isArray(offer.thumbnailCandidates) ? offer.thumbnailCandidates : [])].filter((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
          && /(?:^|\.)(?:steamstatic\.com|steamcdn-a\.akamaihd\.net)$/i.test(url.hostname)
          && new RegExp(`^/(?:store_item_assets/)?steam/apps/${offer.appId}/`).test(url.pathname);
      } catch { return false; }
    });
  }

  function renderSignalThumbnail(item, fallbackIcon = '🎮') {
    const { thumbnailCandidates: candidates } = thumbnailFields(item?.thumbnailCandidates || [item?.thumbnailUrl]);
    if (candidates.length) {
      return `
        <div class="game-card-thumb" data-game-image-fallback="${escapeHtml(fallbackIcon).replace(/"/g, '&quot;')}">
          <img class="game-card-image" src="${escapeHtml(candidates[0])}" data-game-image-candidates="${escapeHtml(JSON.stringify(candidates.slice(1))).replace(/"/g, '&quot;')}" alt="" width="460" height="259" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
        </div>
      `;
    }
    return `
      <div class="game-card-thumb game-card-thumb-fallback" aria-hidden="true">
        <span>${escapeHtml(fallbackIcon)}</span>
      </div>
    `;
  }

  function handleGameImageError(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains('game-card-image')) return;
    if (image.isConnected === false || !image.complete || image.naturalWidth > 0 || (image.currentSrc && image.currentSrc !== image.src)) return;
    const wrapper = image.closest('.game-card-thumb');
    if (!wrapper) return;
    let state = gameImageAttempts.get(image);
    if (!state) {
      let candidates = [];
      try {
        const raw = JSON.parse(image.getAttribute('data-game-image-candidates') || '[]');
        if (Array.isArray(raw)) candidates = raw;
      } catch { /* Invalid cached markup ends at the stable no-image fallback. */ }
      const primary = thumbnailFields([image.src]).thumbnailUrl;
      state = { remaining: thumbnailFields([image.src, ...candidates]).thumbnailCandidates.filter((url) => url !== primary).slice(0, 2), attempts: 1, finished: false };
      gameImageAttempts.set(image, state);
      image.removeAttribute('data-game-image-candidates');
    }
    if (state.finished) return;
    if (state.remaining.length && state.attempts < 3) { state.attempts += 1; image.src = state.remaining.shift(); return; }
    state.finished = true;
    // Keep the reserved frame so a failed remote image never moves links or text.
    const icon = document.createElement('span');
    icon.textContent = wrapper.getAttribute('data-game-image-fallback') || '🎮';
    wrapper.replaceChildren(icon);
    wrapper.classList.add('game-card-thumb-fallback');
    wrapper.setAttribute('aria-hidden', 'true');
  }

  function renderTagPills(tags) {
    return uniqueCompact(tags).map((tag) => `<span class="game-home-tag">${escapeHtml(tag)}</span>`).join('');
  }

  function renderFactPills(facts) {
    return uniqueCompact(facts).map((fact) => `<span class="game-home-fact">${escapeHtml(fact)}</span>`).join('');
  }

  function uniqueCompact(values) {
    return [...new Set((values || []).filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
  }

  function uniqueBy(items, selector) {
    const map = new Map();
    for (const item of items) map.set(selector(item), item);
    return [...map.values()];
  }

  function compareDates(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.getTime() - b.getTime();
  }

  function formatArticleTime(topic) {
    const date = safeDate(topic.publishedAt || articleSource(topic)?.publishedAt);
    return date ? `${formatAbsoluteDate(date)} JST` : '公開日時不明';
  }

  function formatAbsoluteDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '日時未定';
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function safeDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function daysBetween(a, b) {
    return Math.floor((startOfDay(b) - startOfDay(a)) / (24 * 60 * 60 * 1000));
  }

  function startOfDay(value) {
    const parts = japaneseParts(value);
    return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) : Number.NaN;
  }

  function hoursUntil(date) {
    if (!date) return Number.POSITIVE_INFINITY;
    return (date.getTime() - Date.now()) / (60 * 60 * 1000);
  }

  function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
})();
