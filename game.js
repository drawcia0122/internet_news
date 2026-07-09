(function gameDashboard() {
  const {
    archiveTimestamp,
    buildGoogleNewsUrl,
    dedupeTopics,
    escapeHtml,
    formatTopicDisplayTime,
    normalizeTopic,
    topicText,
  } = window.TopicClientUtils;
  const { fetchJsonWithCache } = window.HomeDataUtils;

  const heroBriefElement = document.querySelector('#game-hero-brief');
  const heroCommandElement = document.querySelector('#game-hero-command');
  const heroStatsElement = document.querySelector('#game-hero-stats');
  const searchFormElement = document.querySelector('#game-search-form');
  const searchInputElement = document.querySelector('#game-search-input');
  const importantListElement = document.querySelector('#important-list');
  const hubListElement = document.querySelector('#game-hub-list');
  const freeGameListElement = document.querySelector('#free-game-list');
  const steamSaleListElement = document.querySelector('#steam-sale-list');
  const steamStoryListElement = document.querySelector('#steam-story-list');
  const newsListElement = document.querySelector('#news-list');

  const GAME_HINT_PATTERN = /ゲーム|switch|steam|ps5|xbox|nintendo|任天堂|playstation|pcゲーム|eスポーツ|esports|valorant|apex|pokemon|ポケモン|モンハン|mario|マリオ|gta|原神|スト6|street fighter|lol|league of legends/i;
  const INVALID_GAME_NAME_PATTERN = /^(ゲーム|セール|アップデート|デモ版|体験版|発売日|予約|配信|リリース|イベント|大会|無料配布|公式番組|最終アップデート|今週のすべり込みセール情報|steamos|switch2\/ios\/android版|switch 2|steam next fest|summer game fest|nintendo direct|state of play|valorant masters|ndc26|steam|switch|ps5|xbox|dlc|コラボ|メンテ|ガチャ|steam machine|nex playground|集英社100周年ut|サンリオキャラクターズ)$/i;
  const QUOTED_TITLE_PATTERN = /[『「]([^『』「」]{2,42})[』」]/gu;
  const PERCENT_PATTERN = /(\d{1,3})\s*(?:％|%)\s*(?:オフ|OFF)/i;
  const PRICE_PATTERN = /([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*円/g;
  const JAPANESE_DATE_PATTERN = /(\d{1,2})月(\d{1,2})日(?:[^\d]{0,6}(\d{1,2})[:：](\d{2}))?/g;
  const GENERIC_GAME_NAME_PATTERN = /steam|switch(?:\s?2)?|ps[45]|xbox|pc(?:\s*\/\s*steam)?|dlc|イベント|コラボ|メンテ|ガチャ|アップデート|大型アップデート|無料配布|セール|予約開始|予約受付|配信開始|発売予定|体験版|デモ版|festival|fest|showcase|direct|state of play|game pass|worlds|masters|championship|cup/i;
  const STORE_SIGNAL_PATTERN = /steam|eshop|playstation store|ps store|xbox store|app store|google play|store page|ストアページ|公式サイト|公式x|公式発表/i;
  const OFFICIAL_SIGNAL_PATTERN = /公式|official|メーカー|開発元|パブリッシャー/i;
  const STRONG_GAME_TOPIC_PATTERN = /steam|switch|ps5|xbox|pc|ios|android|ゲーム|アプリ|アップデート|dlc|セール|発売|配信|早期アクセス|体験版|デモ版|store|eスポーツ|大会/i;
  const NON_GAME_TOPIC_PATTERN = /フィギュア|ぬいぐるみ|グッズ|シール|一番くじ|ポップアップ|popup|カフェ|tvアニメ|アニメ化|映画化|舞台化|漫画|コミック|blu-ray|dvd|主題歌|コスメ|アパレル|カード|トレカ/i;
  const MERCHANDISE_TOPIC_PATTERN = /グッズ|tシャツ|アパレル|ソックス|ルームウェア|ライト|ウェファー|キーリング|ぬいぐるみ|フィギュア|コスメ|雑貨|ステッカー|シール|カード|トレカ|ガシャポン|くじ|ポップアップ|カフェ/i;
  const NON_GAME_PRODUCT_PATTERN = /steam machine|playground|ゲーミングpc|ゲームシステム|デバイス|ハードウェア|周辺機器|フィギュア|tシャツ|アパレル|グッズ|コラボメニュー|ライト|ウェファー|ガシャポン|設定画集|キーホルダー|画集|書籍/i;
  const NON_ACTIONABLE_MEDIA_PATTERN = /kindle|漫画|マンガ|コミック|小説|文庫|画集|設定画集|サントラ|サウンドトラック|アルバム|主題歌|朗読劇|ライブ配信|ブロマイド|アニメ化|tvアニメ|映画化|舞台化|amazon限定|アパレル|ルームウェア|バッグ|ポーチ|チャーム|キャディバッグ|コントローラー|ゲーミングpc|steam machine|switch online|playstation plus|game pass|料金改定|値上げ/i;
  const WEAK_FALLBACK_TITLE_PATTERN = /^(もうすぐ始まる|まもなく|開催中|配信開始|発売開始|発売決定|予約開始|予約受付|体験版|デモ版|大型アップデート|最終アップデート|無料配布|セール|注目タイトル|新作ゲーム|話題作)$/i;
  const PROMOTIONAL_TITLE_PATTERN = /sale|セール|キャンペーン|summer sale|june sale|sale part|steam machine|playground|集英社100周年ut|diorama|ver\.?|version|パック/i;
  const LIMITED_FREE_PATTERN = /無料配布|期間限定無料|無料でもらえる|無料で入手|無料取得|無料配信中|0円配布|無料プレゼント/i;
  const FREE_TO_PLAY_PATTERN = /基本プレイ無料|基本無料|free-to-play|f2p|ストアページを公開|配信開始|事前登録|発表/i;
  const NEWS_EXCLUDE_PATTERN = /nintendo switch online|playstation plus|xbox game pass|値上げ|料金改定|周辺機器|コントローラー|ヘッドセット|キーボード|マウス|tvアニメ|アニメ|コミック|漫画|書籍|サントラ|サウンドトラック|グッズ|ポップアップ|カフェ/i;
  const KNOWN_GAME_TERMS = [
    ['Monster Hunter Wilds', /monster hunter wilds|モンスターハンターワイルズ|モンハンワイルズ/i],
    ['Monster Hunter Wilds', /\bモンハン\b/i],
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

  let dashboardState = null;

  init().catch((error) => {
    console.error('[game] failed to render', error);
    renderFailure();
  });

  async function init() {
    const [trendPayload, archivePayload, homeNewsPayload, eventPayload] = await Promise.all([
      fetchJsonWithCache({ endpoints: ['./data/trend-topics.json', 'data/trend-topics.json'] }),
      fetchJsonWithCache({ endpoints: ['./data/news-archive.json', 'data/news-archive.json'] }),
      fetchJsonWithCache({ endpoints: ['./data/home-news.json', 'data/home-news.json'] }),
      fetchJsonWithCache({ endpoints: ['./data/events.json', 'data/events.json'] }),
    ]);

    const currentTopics = Array.isArray(trendPayload?.items) ? trendPayload.items.map((item) => normalizeTopic(item)) : [];
    const archiveTopics = Array.isArray(archivePayload?.items) ? archivePayload.items.map((item) => normalizeTopic(item)) : [];
    const homeNewsTopics = Array.isArray(homeNewsPayload?.items)
      ? homeNewsPayload.items.map((item) => normalizeTopic(item)).filter((topic) => isGameTopic(topic) || isSteamRelevantTopic(topic))
      : [];
    const gameTopics = dedupeTopics([...currentTopics, ...archiveTopics, ...homeNewsTopics]).filter(isGameTopic);
    const events = Array.isArray(eventPayload?.items) ? eventPayload.items : [];

    dashboardState = buildDashboardState(gameTopics, events, {
      generatedAt: trendPayload?.generatedAt ?? homeNewsPayload?.generatedAt ?? archivePayload?.generatedAt ?? eventPayload?.generatedAt ?? null,
    });

    bindInteractions();
    renderDashboard();
  }

  function bindInteractions() {
    searchFormElement?.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = String(searchInputElement?.value || '').trim();
      if (!query) return;
      const matchedCard = findSearchMatch(query);
      if (matchedCard) {
        highlightSearchMatch(matchedCard);
        matchedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      window.open(buildGoogleNewsUrl(`${query} ゲーム`, { rangeDays: 7 }), '_blank', 'noreferrer');
    });

    heroStatsElement?.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-target]');
      if (!trigger) return;
      const target = document.querySelector(trigger.dataset.target);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function buildDashboardState(topics, events, meta) {
    const steamSales = buildSteamSales(topics);
    const freeGames = buildFreeGames(topics);
    const releasesToday = buildTodayReleases(topics);
    const majorUpdates = buildMajorUpdates(topics);
    const startingEvents = buildStartingEvents(events);
    const importantItems = buildImportantItems({ steamSales, freeGames, releasesToday, majorUpdates, startingEvents });
    const gameHubs = buildGameHubs(topics, {
      steamSales,
      freeGames,
      releasesToday,
      majorUpdates,
    });
    const excludedTopicIds = new Set([
      ...importantItems.map((item) => item.topicId).filter(Boolean),
      ...gameHubs.flatMap((item) => item.topicIds || []),
      ...steamSales.map((item) => item.topicId).filter(Boolean),
      ...freeGames.map((item) => item.topicId).filter(Boolean),
      ...releasesToday.map((item) => item.topicId).filter(Boolean),
      ...majorUpdates.map((item) => item.topicId).filter(Boolean),
    ]);
    const steamStories = buildSteamStories(topics, excludedTopicIds);
    steamStories.forEach((item) => {
      if (item.topicId) excludedTopicIds.add(item.topicId);
    });
    const newsItems = buildNewsFeed(topics, excludedTopicIds);

    return {
      generatedAt: meta.generatedAt,
      briefing: buildBriefing({ importantItems, gameHubs, freeGames, steamSales, releasesToday, majorUpdates }),
      importantItems,
      gameHubs,
      freeGames,
      steamSales,
      steamStories,
      releasesToday,
      majorUpdates,
      newsItems,
      totals: {
        endingSoonSaleCount: steamSales.filter((item) => item.endsAt && hoursUntil(item.endsAt) <= 24).length,
        freeCount: freeGames.length,
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
  }

  function renderHero() {
    const { briefing, generatedAt } = dashboardState;
    const visibleImportantCount = dashboardState.importantItems.slice(0, 4).length;
    const visibleHubCount = dashboardState.gameHubs.slice(0, 6).length;
    const visibleFreeCount = dashboardState.freeGames.slice(0, 4).length;
    const visibleSaleCount = dashboardState.steamSales.slice(0, 4).length;
    const visibleReleaseCount = dashboardState.releasesToday.slice(0, 4).length;
    const visibleUpdateCount = dashboardState.majorUpdates.slice(0, 4).length;
    heroBriefElement.innerHTML = briefing.length
      ? briefing.map((line) => `<li>${escapeHtml(line)}</li>`).join('')
      : '<li>今日は大きな動きが少ないため、無料配布とセールを優先表示しています。</li>';
    heroCommandElement.innerHTML = buildHeroCommandCards();

    const heroCards = [
      {
        label: '今日まず見ること',
        value: formatCountLabel(visibleImportantCount, '件', '静か'),
        description: '終了間近や本日発売など、先に確認すべき項目',
        target: '#important-section',
      },
      {
        label: '今動いているゲーム',
        value: formatCountLabel(visibleHubCount, '本', '少なめ'),
        description: '今日ゲーム側で動きがあったタイトルを整理',
        target: '#game-hub-section',
      },
    ];

    if (visibleFreeCount > 0) {
      heroCards.push({
        label: '無料配布',
        value: formatCountLabel(visibleFreeCount, '件'),
        description: '今受け取れる期間限定配布',
        target: '#free-section',
      });
    } else if (visibleReleaseCount > 0) {
      heroCards.push({
        label: '本日発売',
        value: formatCountLabel(visibleReleaseCount, '件'),
        description: '今日から遊べる新作を優先確認',
        target: '#important-section',
      });
    } else {
      heroCards.push({
        label: '無料配布',
        value: 'なし',
        description: '今日は信頼できる配布案件は見当たりません',
        target: '#free-section',
      });
    }

    if (visibleSaleCount > 0) {
      heroCards.push({
        label: '注目セール',
        value: formatCountLabel(visibleSaleCount, '件'),
        description: '今見る価値がある割引',
        target: '#sale-section',
      });
    } else if (visibleUpdateCount > 0) {
      heroCards.push({
        label: '大型更新',
        value: formatCountLabel(visibleUpdateCount, '件'),
        description: '今日のプレイ判断に効くアップデート',
        target: '#important-section',
      });
    } else {
      heroCards.push({
        label: '注目セール',
        value: 'なし',
        description: '今日は強く勧められる割引は少なめ',
        target: '#sale-section',
      });
    }

    heroCards.push({
      label: '最終更新',
      value: generatedAt ? formatAbsoluteDate(generatedAt) : '更新待ち',
      description: '最新データの反映時刻',
      target: '#important-section',
    });

    heroStatsElement.innerHTML = heroCards.map((card) =>
      renderHeroStat(card.label, card.value, card.description, card.target)
    ).join('');
  }

  function buildHeroCommandCards() {
    const important = dashboardState.importantItems[0];
    const free = dashboardState.freeGames[0];
    const sale = dashboardState.steamSales[0];
    const hub = dashboardState.gameHubs[0];

    const cards = [
      {
        label: '今すぐ確認',
        title: important ? important.title : '今日は緊急で見る案件は少なめ',
        text: important ? important.summary : '終了間近や本日発売が強い日はここに最優先項目を出します。',
      },
      {
        label: '受け取り / 購入',
        title: free ? `${free.title} を受け取る` : sale ? `${sale.title} のセールを見る` : '今日は無理に拾う案件は少なめ',
        text: free
          ? `${free.store} で配布中。${free.endsAtLabel ? `${free.endsAtLabel}まで。` : '期限は配布ページで確認。'}`
          : sale
            ? sale.summary
            : '無料配布や強い割引がない日は、ここは静かな表示に留めます。',
      },
      {
        label: '遊ぶ候補',
        title: hub ? hub.title : '今日は大きく動いたゲームが少なめ',
        text: hub ? hub.summary : '大型更新や発売が強いゲームが上段に来るようにしています。',
      },
    ];

    return cards.map((card) => `
      <article class="game-home-command-card">
        <strong>${escapeHtml(card.label)}</strong>
        <h3>${escapeHtml(card.title)}</h3>
        <p>${escapeHtml(card.text)}</p>
      </article>
    `).join('');
  }

  function renderHeroStat(label, value, description, target) {
    return `
      <button class="topic-meta-card game-home-stat" type="button" data-target="${escapeHtml(target)}">
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
      <article class="game-home-card game-important-card" data-game-search="${escapeHtml(searchIndexText(item.gameTitle, item.title, item.summary))}">
        ${renderSignalThumbnail(item.thumbnailUrl, item.gameTitle, item.icon)}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-badge">${escapeHtml(item.label)}</span>
            <span class="game-card-meta">${escapeHtml(item.meta)}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
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
      <article class="game-home-card game-hub-card" data-game-search="${escapeHtml(searchIndexText(item.title, item.summary, item.tags.join(' ')))}">
        ${renderSignalThumbnail(item.thumbnailUrl, item.title, '🎮')}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-meta">${escapeHtml(item.evidenceLabel)}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
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
      freeGameListElement.innerHTML = renderEmptyCard('現在、信頼できる無料配布案件はありません', '基本プレイ無料化ではなく、期間限定で取得できるものだけを残しています。');
      return;
    }
    freeGameListElement.innerHTML = items.map((item) => `
      <article class="game-home-card game-compact-card" data-game-search="${escapeHtml(searchIndexText(item.title, item.summary, item.store))}">
        ${renderSignalThumbnail(item.thumbnailUrl, item.title, '🎁')}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-badge">${escapeHtml(item.store)}</span>
            <span class="game-card-meta">${escapeHtml(item.endsAtLabel || '期限確認中')}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
          <p class="game-card-summary">${escapeHtml(item.summary)}</p>
          <div class="game-home-inline-facts">${renderFactPills([
            item.endsAtLabel ? `配布終了 ${item.endsAtLabel}` : '終了時刻確認中',
            item.store,
          ])}</div>
          <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">受け取る ↗</a>
        </div>
      </article>
    `).join('');
  }

  function renderSteamSales() {
    const items = dashboardState.steamSales.slice(0, 4);
    if (!items.length) {
      steamSaleListElement.innerHTML = renderEmptyCard('今出す価値があるセール案件はまだ少なめです', '割引率や最安値圏が確認できるゲームだけを残しています。');
      return;
    }
    steamSaleListElement.innerHTML = items.map((item) => `
      <article class="game-home-card game-compact-card" data-game-search="${escapeHtml(searchIndexText(item.title, item.summary, item.discount, item.price))}">
        ${renderSignalThumbnail(item.thumbnailUrl, item.title, '💸')}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-badge">${escapeHtml(item.priorityLabel)}</span>
            <span class="game-card-meta">${escapeHtml(item.discount || '割引率確認中')}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
          <p class="game-card-summary">${escapeHtml(item.summary)}</p>
          <div class="game-home-inline-facts">${renderFactPills([
            item.price ? `価格 ${item.price}` : '価格は記事内で確認',
            item.endsAtLabel ? `終了 ${item.endsAtLabel}` : '終了時刻確認中',
          ])}</div>
          <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">詳細を見る ↗</a>
        </div>
      </article>
    `).join('');
  }

  function renderSteamStories() {
    const items = dashboardState.steamStories.slice(0, 6);
    if (!items.length) {
      steamStoryListElement.innerHTML = renderEmptyCard('今拾う価値があるSteam記事は少なめです', '新作、体験版、早期アクセス、大型更新などSteamで見る意味がある話題だけを残しています。');
      return;
    }
    steamStoryListElement.innerHTML = items.map((item) => `
      <article class="game-home-card game-compact-card" data-game-search="${escapeHtml(searchIndexText(item.title, item.summary, item.label, item.gameTitle))}">
        ${renderSignalThumbnail(item.thumbnailUrl, item.gameTitle || item.title, '🖥')}
        <div class="game-home-card-body">
          <div class="game-card-top">
            <span class="game-card-badge">${escapeHtml(item.label)}</span>
            <span class="game-card-meta">${escapeHtml(item.sourceLabel)}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
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
    const items = dashboardState.newsItems.slice(0, 8);
    if (!items.length) {
      newsListElement.innerHTML = renderEmptyCard('補完用のニュースは現在ありません', 'このページでは、主役をゲームの動きに寄せているため、記事一覧は最小限にしています。');
      return;
    }
    newsListElement.innerHTML = items.map((item) => `
      <article class="game-news-row" data-game-search="${escapeHtml(searchIndexText(item.gameTitle, item.title, item.summary))}">
        <div class="game-news-row-main">
          <span class="game-news-row-game">${escapeHtml(item.gameTitle)}</span>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.summary)}</p>
        </div>
        <div class="game-news-row-side">
          <span class="game-card-meta">${escapeHtml(item.publishedLabel)}</span>
          <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceLabel)}で読む ↗</a>
        </div>
      </article>
    `).join('');
  }

  function buildBriefing({ importantItems, gameHubs, freeGames, steamSales, releasesToday, majorUpdates }) {
    const lines = [];
    if (importantItems[0]) lines.push(`最優先: ${importantItems[0].title}`);
    if (releasesToday.length) lines.push(`本日発売 ${releasesToday.length} 件`);
    if (majorUpdates.length) lines.push(`大型アップデート ${majorUpdates.length} 件`);
    if (freeGames.length) lines.push(`無料配布 ${freeGames.length} 件`);
    if (steamSales.some((item) => item.endsAt && hoursUntil(item.endsAt) <= 24)) lines.push('終了間近のセールあり');
    if (!lines.length && gameHubs.length) lines.push(`今日は ${gameHubs[0].title} 周辺の動きが強め`);
    return lines.slice(0, 4);
  }

  function buildSteamSales(topics) {
    const items = [];
    for (const topic of topics) {
      const haystack = [topic.title, topic.summary, topic.briefSummary, JSON.stringify(topic.sourceSignals || [])].join(' ');
      if (isNonGameProductTopic(topic)) continue;
      if (NON_ACTIONABLE_MEDIA_PATTERN.test(haystack)) continue;
      if (!/steam/i.test(haystack) || !/セール|割引|オフ|最安|sale/i.test(haystack)) continue;
      const discount = extractDiscount(haystack);
      if (!discount && !/過去最安|最安/i.test(haystack)) continue;
      if (discount && discount < 30) continue;
      const title = pickPrimaryGameTitle(topic, { actionableOnly: true });
      if (!title || !isPrimaryGameSubject(topic, title)) continue;
      const price = extractPrice(haystack);
      const endDate = extractRelevantDate(haystack, /まで|終了|終了日時|販売終了/i);
      const priority = [
        discount >= 90 ? 4 : 0,
        /過去最安|最安/i.test(haystack) ? 3 : 0,
        Number(topic.score ?? topic.hotScore ?? 0) >= 120 ? 2 : 0,
        endDate && hoursUntil(endDate) <= 24 ? 1 : 0,
      ].reduce((sum, value) => sum + value, 0);
      items.push({
        key: `${title}-${price}-${discount}`,
        topicId: topic.id || null,
        title,
        discount: discount ? `${discount}% OFF` : null,
        price: price ? `${price}円` : null,
        endsAt: endDate,
        endsAtLabel: endDate ? formatAbsoluteDate(endDate.toISOString()) : null,
        priority,
        priorityLabel: discount >= 90 ? '90%+ OFF' : /過去最安|最安/i.test(haystack) ? '最安値圏' : endDate && hoursUntil(endDate) <= 24 ? '終了間近' : '注目作',
        summary: summarizeSupportingText(topic, 'Steamセール関連ニュースから抽出'),
        thumbnailUrl: topic.thumbnailUrl || topic.sourceSignals?.find((signal) => signal.thumbnailUrl)?.thumbnailUrl || null,
        url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(title, { rangeDays: 7 }),
      });
    }
    return uniqueBy(items, (item) => item.key)
      .sort((a, b) => b.priority - a.priority || compareDates(a.endsAt, b.endsAt))
      .slice(0, 10);
  }

  function buildFreeGames(topics) {
    const items = [];
    for (const topic of topics) {
      const haystack = [topic.title, topic.summary, topic.briefSummary].join(' ');
      if (isNonGameProductTopic(topic)) continue;
      if (NON_ACTIONABLE_MEDIA_PATTERN.test(haystack)) continue;
      if (!LIMITED_FREE_PATTERN.test(haystack) || FREE_TO_PLAY_PATTERN.test(haystack)) continue;
      const store = inferStore(haystack);
      if (!store) continue;
      const primaryTitle = pickPrimaryGameTitle(topic, { actionableOnly: true });
      if (!primaryTitle || !isPrimaryGameSubject(topic, primaryTitle)) continue;
      const endDate = extractRelevantDate(haystack, /まで|終了|期限|配布/i);
      items.push({
        key: `${store}-${primaryTitle}`,
        topicId: topic.id || null,
        title: primaryTitle,
        store,
        endsAt: endDate,
        endsAtLabel: endDate ? formatAbsoluteDate(endDate.toISOString()) : null,
        summary: summarizeSupportingText(topic, '無料配布関連ニュースから抽出'),
        thumbnailUrl: topic.thumbnailUrl || topic.sourceSignals?.find((signal) => signal.thumbnailUrl)?.thumbnailUrl || null,
        url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(primaryTitle, { rangeDays: 7 }),
      });
    }
    return uniqueBy(items, (item) => item.key)
      .sort((a, b) => compareDates(a.endsAt, b.endsAt))
      .slice(0, 10);
  }

  function buildTodayReleases(topics) {
    const items = [];
    const now = new Date();
    for (const topic of topics) {
      const haystack = [topic.title, topic.summary, topic.briefSummary].join(' ');
      if (isNonGameProductTopic(topic) || NON_ACTIONABLE_MEDIA_PATTERN.test(haystack)) continue;
      if (!/発売|配信開始|リリース/i.test(haystack) || /予約受付|予約開始|事前登録/i.test(haystack)) continue;
      const title = pickPrimaryGameTitle(topic, { actionableOnly: true });
      if (!title || !isPrimaryGameSubject(topic, title)) continue;
      const releaseDate = extractRelevantDate(haystack);
      if (!releaseDate || daysBetween(now, releaseDate) !== 0) continue;
      items.push({
        key: `${title}-${releaseDate.toISOString()}`,
        topicId: topic.id || null,
        title,
        releaseDate,
        releaseDateLabel: formatAbsoluteDate(releaseDate.toISOString()),
        summary: summarizeSupportingText(topic, '本日発売タイトル'),
        thumbnailUrl: topic.thumbnailUrl || topic.sourceSignals?.find((signal) => signal.thumbnailUrl)?.thumbnailUrl || null,
        url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(title, { rangeDays: 7 }),
      });
    }
    return uniqueBy(items, (item) => item.key).sort((a, b) => compareDates(a.releaseDate, b.releaseDate));
  }

  function buildMajorUpdates(topics) {
    const items = [];
    const now = new Date();
    for (const topic of topics) {
      const haystack = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary].join(' ');
      if (isNonGameProductTopic(topic) || NON_ACTIONABLE_MEDIA_PATTERN.test(haystack)) continue;
      if (!/大型アップデート|アップデート配信|アップデート実装|シーズン開始|新章開幕|新エリア追加|新キャラ実装|新オペレーター実装|パッチノート|イベント開始/i.test(haystack)) continue;
      if (/pv公開|トレイラー公開|映像公開|発売日決定|発売決定|hotfix|軽微な修正|不具合修正|微調整/i.test(haystack)) continue;
      const title = pickPrimaryGameTitle(topic, { actionableOnly: true });
      if (!title || !isPrimaryGameSubject(topic, title)) continue;
      const timestamp = archiveTimestamp(topic);
      if (timestamp && daysBetween(now, new Date(timestamp)) > 0) continue;
      items.push({
        key: `${title}-${topic.id || topic.title}`,
        topicId: topic.id || null,
        title,
        publishedAt: timestamp ? new Date(timestamp) : null,
        publishedLabel: timestamp ? formatAbsoluteDate(new Date(timestamp).toISOString()) : formatTopicDisplayTime(topic),
        summary: summarizeSupportingText(topic, '大型アップデート情報'),
        thumbnailUrl: topic.thumbnailUrl || topic.sourceSignals?.find((signal) => signal.thumbnailUrl)?.thumbnailUrl || null,
        url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(title, { rangeDays: 7 }),
      });
    }
    return uniqueBy(items, (item) => item.key).sort((a, b) => compareDates(b.publishedAt, a.publishedAt));
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
        startLabel: formatAbsoluteDate(start.toISOString()),
        summary: event.description || event.category || '本日開始イベント',
        thumbnailUrl: event.thumbnailUrl || event.imageUrl || null,
        url: event.detailUrl || event.officialUrl || '#',
      });
    }
    return uniqueBy(items, (item) => item.key).sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  }

  function buildImportantItems({ steamSales, freeGames, releasesToday, majorUpdates, startingEvents }) {
    const items = [];

    for (const sale of steamSales) {
      if (!sale.endsAt || hoursUntil(sale.endsAt) > 24) continue;
      items.push({
        key: `sale-${sale.key}`,
        topicId: sale.topicId,
        label: 'ENDS TODAY',
        meta: sale.endsAtLabel || '本日終了',
        title: `${sale.title} のセール終了が近い`,
        gameTitle: sale.title,
        summary: sale.discount ? `${sale.discount}、${sale.price || '価格未取得'}。今日中に確認したい案件です。` : sale.summary,
        facts: [sale.price ? `価格 ${sale.price}` : null, sale.discount, 'Steam'],
        thumbnailUrl: sale.thumbnailUrl || null,
        url: sale.url,
        icon: '💸',
        cta: 'セールを見る ↗',
        sortScore: 5000 - hoursUntil(sale.endsAt),
      });
    }

    for (const giveaway of freeGames) {
      items.push({
        key: `free-${giveaway.key}`,
        topicId: giveaway.topicId,
        label: 'FREE',
        meta: giveaway.endsAtLabel || '期間限定',
        title: `${giveaway.title} を今すぐ受け取れる`,
        gameTitle: giveaway.title,
        summary: `${giveaway.store} で無料配布中です。${giveaway.endsAtLabel ? `${giveaway.endsAtLabel}まで。` : '期限は配布ページで確認してください。'}`,
        facts: [giveaway.store, giveaway.endsAtLabel ? `終了 ${giveaway.endsAtLabel}` : null],
        thumbnailUrl: giveaway.thumbnailUrl || null,
        url: giveaway.url,
        icon: '🎁',
        cta: '受け取る ↗',
        sortScore: giveaway.endsAt ? 4400 - hoursUntil(giveaway.endsAt) : 4100,
      });
    }

    for (const release of releasesToday) {
      items.push({
        key: `release-${release.key}`,
        topicId: release.topicId,
        label: 'TODAY',
        meta: release.releaseDateLabel,
        title: `${release.title} が本日発売`,
        gameTitle: release.title,
        summary: release.summary,
        facts: ['本日発売', release.releaseDateLabel],
        thumbnailUrl: release.thumbnailUrl || null,
        url: release.url,
        icon: '🕹️',
        cta: '発売情報を見る ↗',
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
        thumbnailUrl: update.thumbnailUrl || null,
        url: update.url,
        icon: '🛠️',
        cta: '更新内容を見る ↗',
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
        thumbnailUrl: event.thumbnailUrl || null,
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
      if (!isDiscoveryGameTopic(topic)) continue;
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
      .filter((topic) => !excludedTopicIds.has(topic.id))
      .filter(isUsefulNewsTopic)
      .map((topic) => {
        const gameTitle = pickPrimaryGameTitle(topic, { actionableOnly: true }) || 'ゲームニュース';
        const steamBonus = isSteamRelevantTopic(topic) ? 42 : 0;
        return {
          key: topic.id || topic.title,
          gameTitle,
          title: topic.title || gameTitle,
          summary: summarizeSupportingText(topic, gameTitle),
          publishedLabel: formatTopicDisplayTime(topic),
          sourceLabel: topic.sourceSignals?.[0]?.sourceName || '元記事',
          thumbnailUrl: topic.thumbnailUrl || topic.sourceSignals?.find((signal) => signal.thumbnailUrl)?.thumbnailUrl || null,
          url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(gameTitle, { rangeDays: 7 }),
          sortScore: Number(topic.score ?? topic.hotScore ?? 0) + steamBonus + ((archiveTimestamp(topic) || 0) / 100000000),
        };
      })
      .sort((a, b) => b.sortScore - a.sortScore)
      .slice(0, 12);
  }

  function buildSteamStories(topics, excludedTopicIds) {
    return topics
      .filter((topic) => !excludedTopicIds.has(topic.id))
      .filter((topic) => isSteamRelevantTopic(topic))
      .filter((topic) => isUsefulSteamTopic(topic))
      .map((topic) => {
        const gameTitle = pickPrimaryGameTitle(topic, { actionableOnly: true }) || 'Steamゲーム';
        const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary].filter(Boolean).join(' ');
        return {
          key: topic.id || topic.title,
          topicId: topic.id || null,
          gameTitle,
          title: topic.title || gameTitle,
          summary: summarizeSupportingText(topic, gameTitle),
          label: classifySteamStoryLabel(text),
          publishedLabel: formatTopicDisplayTime(topic),
          sourceLabel: topic.sourceSignals?.[0]?.sourceName || topic.sourceName || 'Steam記事',
          thumbnailUrl: topic.thumbnailUrl || topic.sourceSignals?.find((signal) => signal.thumbnailUrl)?.thumbnailUrl || null,
          url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(`${gameTitle} Steam`, { rangeDays: 7 }),
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
    const actionableCount = [extra.sale, extra.free, extra.release, extra.update].filter(Boolean).length;
    if (!bucket.bestTopic) return null;
    if (bucket.trigger.score < 2 && actionableCount === 0) return null;

    const tags = [];
    const facts = [];
    let sortScore = bucket.hotScore + bucket.articleCount * 8 + bucket.trigger.score * 60 + bucket.evidenceTypes.size * 20;
    let summary = summarizeGameTopic(bucket.bestTopic);
    let ctaLabel = '関連記事を見る';
    let url = bucket.bestTopic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(bucket.title, { rangeDays: 7 });

    if (extra.release) {
      tags.push('本日発売');
      facts.push(extra.release.releaseDateLabel);
      summary = `${bucket.title} が本日発売。${summarizeSupportingText(extra.release, summary)}`;
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
      tags.push('無料配布');
      facts.push(extra.free.store);
      if (!extra.release && !extra.update) summary = `${extra.free.store} で ${bucket.title} を無料配布中。${extra.free.endsAtLabel ? `${extra.free.endsAtLabel}まで。` : ''}`;
      ctaLabel = '受け取る';
      url = extra.free.url;
      sortScore += 240;
    }
    if (extra.sale) {
      tags.push(extra.sale.priorityLabel);
      facts.push(extra.sale.discount || null);
      facts.push(extra.sale.price || null);
      if (!extra.release && !extra.update && !extra.free) {
        summary = `${bucket.title} がセール中。${extra.sale.discount || '割引情報あり'}${extra.sale.price ? ` / ${extra.sale.price}` : ''}。`;
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
      topicIds: [...bucket.topicIds],
      title: bucket.title,
      summary: trimSummary(summary, 78),
      thumbnailUrl: bucket.bestTopic.thumbnailUrl || bucket.bestTopic.sourceSignals?.find((signal) => signal.thumbnailUrl)?.thumbnailUrl || null,
      tags: uniqueCompact(tags).slice(0, 3),
      facts: uniqueCompact(facts).slice(0, 4),
      evidenceLabel,
      ctaLabel,
      url,
      sortScore,
    };
  }

  function classifyGameMovement(topic) {
    const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary].filter(Boolean).join(' ');
    if (/本日発売|配信開始|リリース開始/i.test(text)) return { score: 6, label: '本日発売', reason: '今日遊べる状態になりました' };
    if (/大型アップデート|アップデート配信|新シーズン|新章|新エリア|新キャラ|新オペレーター|パッチノート|dlc/i.test(text)) {
      return { score: 5, label: '大型更新', reason: 'プレイ内容に直結する更新が入りました' };
    }
    if (/無料配布|期間限定無料|無料で入手/i.test(text)) return { score: 5, label: '無料配布', reason: '今すぐ受け取れる動きがあります' };
    if (/セール|割引|最安|90%オフ|50%オフ/i.test(text)) return { score: 4, label: 'セール', reason: '購入判断に直結する価格変化があります' };
    if (/発売日.*決定|発売決定|ストアページ公開|予約開始|予約受付/i.test(text)) return { score: 4, label: '発売準備', reason: '発売や予約に向けた動きがあります' };
    if (/万ダウンロード|万本|突破|達成|記録/i.test(text)) return { score: 3, label: '記録更新', reason: '大きな節目を迎えています' };
    if (/pv公開|トレイラー公開|映像公開|続報|詳細公開/i.test(text)) return { score: 2, label: '続報', reason: '新しい情報が公開されました' };
    return { score: 1, label: '話題化', reason: '新しい動きが確認されています' };
  }

  function collectEvidenceTypes(topic) {
    const evidence = new Set(['news']);
    if (STORE_SIGNAL_PATTERN.test(topicText(topic))) evidence.add('store');
    if (OFFICIAL_SIGNAL_PATTERN.test(topicText(topic))) evidence.add('official');
    if (Array.isArray(topic.socialLinks) && topic.socialLinks.length) evidence.add('social');
    return evidence;
  }

  function buildEvidenceLabel(evidenceSet) {
    const labels = [];
    if (evidenceSet.has('official')) labels.push('公式');
    if (evidenceSet.has('store')) labels.push('ストア');
    if (evidenceSet.has('social')) labels.push('SNS');
    if (!labels.length) labels.push('ニュース');
    return labels.join(' + ');
  }

  function isUsefulNewsTopic(topic) {
    const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary].filter(Boolean).join(' ');
    const gameTitle = pickPrimaryGameTitle(topic, { actionableOnly: true });
    if (!gameTitle) return false;
    if (!isDiscoveryGameTopic(topic)) return false;
    if (isNonGameProductTopic(topic) || NON_ACTIONABLE_MEDIA_PATTERN.test(text)) return false;
    if (NEWS_EXCLUDE_PATTERN.test(text)) return false;
    if (/無料配布|セール|大型アップデート|発売日.*決定|発売決定|予約開始|予約受付|ストアページ公開/i.test(text)) return false;
    if (/weekly|1週間を振り返る|キャリアクエスト|開発の裏側|インタビュー完全版|座談会/i.test(text)) return false;
    if (!isPrimaryGameSubject(topic, gameTitle)) return false;
    return true;
  }

  function isSteamRelevantTopic(topic) {
    const sourceTags = Array.isArray(topic.sourceSignals)
      ? topic.sourceSignals.flatMap((signal) => Array.isArray(signal.sourceTags) ? signal.sourceTags : [])
      : [];
    const text = [
      topic.title,
      topic.whatHappened,
      topic.summary,
      topic.briefSummary,
      ...(topic.relatedKeywords || []),
      ...sourceTags,
      topic.sourceName,
      ...(topic.sourceSignals || []).flatMap((signal) => [signal.sourceName, signal.title, signal.summary]),
    ].filter(Boolean).join(' ');
    return /\bsteam\b|steam deck|pcゲーム|早期アクセス/i.test(text);
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
    if (/早期アクセス/i.test(text)) return 'EARLY ACCESS';
    if (/体験版|デモ版/i.test(text)) return 'DEMO';
    if (/本日発売|発売|配信開始/i.test(text)) return 'NEW RELEASE';
    if (/大型アップデート|アップデート|パッチノート|新シーズン/i.test(text)) return 'UPDATE';
    if (/セール|割引|最安/i.test(text)) return 'SALE';
    if (/無料トライアル|無料配布/i.test(text)) return 'FREE';
    return 'STEAM';
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
    const text = [
      topic.title,
      topic.whatHappened,
      topic.summary,
      topic.briefSummary,
      ...(topic.relatedKeywords || []),
      ...(topic.sourceSignals || []).flatMap((signal) => [signal.title, signal.summary]),
    ].filter(Boolean).join(' ');
    const found = [];
    for (const [label, pattern] of KNOWN_GAME_TERMS) {
      if (pattern.test(text)) found.push(label);
    }
    found.push(...extractQuotedNames(text));
    const ranked = [...new Set(found.map(canonicalizeGameName).filter(isValidGameName))]
      .map((name) => ({ name, score: scoreGameNameCandidate(name, topic, text) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.name.length - a.name.length);
    return ranked.slice(0, 2).map((item) => item.name);
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
    return String(value ?? '')
      .replace(/^[『「]|[』」]$/g, '')
      .replace(/^【[^】]+】/u, '')
      .replace(/^[0-9０-９]+[%％]オフ/u, '')
      .replace(/^(?:大型|無料)?アップデート.*/u, '')
      .replace(/^(?:ゲーム|新作ゲーム|協力プレイ対応・|マルチ対応・)/u, '')
      .replace(/(?:体験版|デモ版|発売日|予約開始|予約受付|配信開始|セール開催中).*/u, '')
      .replace(/[，,。！!？?].*$/u, '')
      .replace(/\s*[:：]\s*(?:Call of the Wild)$/u, ': Call of the Wild')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function canonicalizeGameName(value) {
    const normalized = normalizeGameName(value);
    for (const [label, pattern] of KNOWN_GAME_TERMS) {
      if (pattern.test(normalized)) return label;
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
    const titles = [topic.title, ...(topic.sourceSignals || []).map((signal) => signal.title)].filter(Boolean);
    return titles.some((title) => isFocusedGameMention(String(title), name));
  }

  function isFocusedGameMention(text, name) {
    const source = String(text || '');
    const quotedPattern = new RegExp(`[『「]${escapeRegExp(name)}[』」]`, 'u');
    const directIndex = source.indexOf(name);
    const quotedMatch = source.match(quotedPattern);
    const focusIndex = quotedMatch?.index ?? directIndex;
    if (focusIndex < 0) return false;
    return focusIndex <= Math.floor(source.length * 0.45);
  }

  function hasStrongTitleEvidence(name, topic) {
    const isKnownAlias = KNOWN_GAME_TERMS.some(([label]) => label === name);
    if (isKnownAlias) return true;
    const title = String(topic.title || '');
    const quotedPattern = new RegExp(`[『「]${escapeRegExp(name)}[』」]`, 'u');
    if (title.includes(name) || quotedPattern.test(title)) return true;
    return (topic.sourceSignals || []).some((signal) => {
      const sourceTitle = String(signal.title || '');
      return sourceTitle.includes(name) || quotedPattern.test(sourceTitle);
    });
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
    const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary, ...(topic.relatedKeywords || [])]
      .filter(Boolean)
      .join(' ');
    return isMerchandiseTopic(topic) || NON_GAME_PRODUCT_PATTERN.test(text);
  }

  function isLikelyGameEvent(event) {
    const text = [event.title, event.description, event.category, event.venue, ...(event.tags || [])].filter(Boolean).join(' ');
    return /game|ゲーム|nintendo|switch|steam|playstation|xbox|eスポーツ|esports|pokemon|ポケモン|valorant|apex|street fighter|bitsummit/i.test(text);
  }

  function inferStore(text) {
    if (/epic games/i.test(text)) return 'Epic Games';
    if (/itch\.io/i.test(text)) return 'itch.io';
    if (/\bgog\b/i.test(text)) return 'GOG';
    if (/\bsteam\b/i.test(text)) return 'Steam';
    return null;
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
    const match = String(text ?? '').match(PERCENT_PATTERN);
    return match ? Number(match[1]) : null;
  }

  function extractPrice(text) {
    const prices = [...String(text ?? '').matchAll(PRICE_PATTERN)].map((match) => Number(match[1].replace(/,/g, '')));
    return prices.length ? Math.min(...prices).toLocaleString('ja-JP') : null;
  }

  function extractRelevantDate(text, hintPattern = null) {
    const source = String(text ?? '');
    const matches = [...source.matchAll(JAPANESE_DATE_PATTERN)];
    if (!matches.length) return null;
    const targetMatch = hintPattern
      ? matches.find((match) => hintPattern.test(source.slice(Math.max(0, match.index - 18), match.index + match[0].length + 18)))
      : matches[0];
    if (!targetMatch) return null;
    const date = buildDateFromParts(targetMatch[1], targetMatch[2], targetMatch[3], targetMatch[4]);
    return date && date < new Date('2025-01-01T00:00:00+09:00') ? null : date;
  }

  function buildDateFromParts(month, day, hour = '12', minute = '00') {
    const now = new Date();
    const year = now.getFullYear();
    const date = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 150) date.setFullYear(year + 1);
    return date;
  }

  function renderFailure() {
    const html = renderEmptyCard('ゲームページの読み込みに失敗しました', 'ローカルHTTPサーバーで開いているか確認してください。');
    if (heroBriefElement) heroBriefElement.innerHTML = '<li>ゲームデータの読み込みに失敗しました。</li>';
    if (heroStatsElement) heroStatsElement.innerHTML = html;
    if (importantListElement) importantListElement.innerHTML = html;
    if (hubListElement) hubListElement.innerHTML = html;
    if (steamSaleListElement) steamSaleListElement.innerHTML = html;
    if (freeGameListElement) freeGameListElement.innerHTML = html;
    if (newsListElement) newsListElement.innerHTML = html;
  }

  function findSearchMatch(query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return null;
    const cards = Array.from(document.querySelectorAll('[data-game-search]'));
    return cards.find((card) => String(card.dataset.gameSearch || '').toLowerCase().includes(normalizedQuery)) || null;
  }

  function highlightSearchMatch(element) {
    element.classList.add('game-search-match');
    window.setTimeout(() => element.classList.remove('game-search-match'), 2200);
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

  function renderSignalThumbnail(url, title, fallbackIcon = '🎮') {
    if (url) {
      return `
        <div class="game-card-thumb">
          <img src="${escapeHtml(url)}" alt="${escapeHtml(title)} のサムネイル" loading="lazy" />
        </div>
      `;
    }
    return `
      <div class="game-card-thumb game-card-thumb-fallback" aria-hidden="true">
        <span>${escapeHtml(fallbackIcon)}</span>
      </div>
    `;
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
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function hoursUntil(date) {
    if (!date) return Number.POSITIVE_INFINITY;
    return (date.getTime() - Date.now()) / (60 * 60 * 1000);
  }

  function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
})();
