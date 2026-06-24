(function gameDashboard() {
  const {
    archiveTimestamp,
    buildGoogleNewsUrl,
    dedupeTopics,
    escapeHtml,
    formatTopicDisplayTime,
    normalizeTopic,
    shortEventFromTitle,
    topicText,
  } = window.TopicClientUtils;
  const { fetchJsonWithCache } = window.HomeDataUtils;

  const heroStatsElement = document.querySelector('#game-hero-stats');
  const sourceGridElement = document.querySelector('#game-source-grid');
  const surgingGameListElement = document.querySelector('#surging-game-list');
  const steamSaleListElement = document.querySelector('#steam-sale-list');
  const freeGameListElement = document.querySelector('#free-game-list');
  const eventListElement = document.querySelector('#game-event-list');
  const releaseListElement = document.querySelector('#release-list');
  const releaseTabsElement = document.querySelector('#release-tabs');
  const trendRangeTabsElement = document.querySelector('#trend-range-tabs');
  const trendChartGridElement = document.querySelector('#trend-chart-grid');

  const GAME_HINT_PATTERN = /ゲーム|switch|steam|ps5|xbox|nintendo|任天堂|playstation|pcゲーム|eスポーツ|esports|valorant|apex|pokemon|ポケモン|モンハン|mario|マリオ|gta|原神|スト6|street fighter|lol|league of legends/i;
  const INVALID_GAME_NAME_PATTERN = /^(ゲーム|セール|アップデート|デモ版|体験版|発売日|予約|配信|リリース|イベント|大会|無料配布|公式番組|最終アップデート|今週のすべり込みセール情報|steamos|switch2\/ios\/android版|switch 2|steam next fest|summer game fest|nintendo direct|state of play|valorant masters|ndc26|steam|switch|ps5|xbox|dlc|コラボ|メンテ|ガチャ)$/i;
  const QUOTED_TITLE_PATTERN = /[『「]([^『』「」]{2,42})[』」]/gu;
  const PERCENT_PATTERN = /(\d{1,3})\s*(?:％|%)\s*(?:オフ|OFF)/i;
  const PRICE_PATTERN = /([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*円/g;
  const JAPANESE_DATE_PATTERN = /(\d{1,2})月(\d{1,2})日(?:[^\d]{0,6}(\d{1,2})[:：](\d{2}))?/g;
  const GENERIC_GAME_NAME_PATTERN = /steam|switch(?:\s?2)?|ps[45]|xbox|pc(?:\s*\/\s*steam)?|dlc|イベント|コラボ|メンテ|ガチャ|アップデート|大型アップデート|無料配布|セール|予約開始|予約受付|配信開始|発売予定|体験版|デモ版|festival|fest|showcase|direct|state of play|game pass|worlds|masters|championship|cup/i;
  const STORE_SIGNAL_PATTERN = /steam|eshop|playstation store|ps store|xbox store|app store|google play|store page|ストアページ|公式サイト|公式x|公式発表/i;
  const OFFICIAL_SIGNAL_PATTERN = /公式|official|メーカー|開発元|パブリッシャー/i;
  const STRONG_GAME_TOPIC_PATTERN = /steam|switch|ps5|xbox|pc|ios|android|ゲーム|アプリ|アップデート|dlc|セール|発売|配信|早期アクセス|体験版|デモ版|store|eスポーツ|大会/i;
  const NON_GAME_TOPIC_PATTERN = /フィギュア|ぬいぐるみ|グッズ|シール|一番くじ|ポップアップ|popup|カフェ|tvアニメ|アニメ化|映画化|舞台化|漫画|コミック|blu-ray|dvd|主題歌|コスメ|アパレル|カード|トレカ/i;
  const KNOWN_GAME_TERMS = [
    ['Monster Hunter Wilds', /monster hunter wilds|モンスターハンターワイルズ|モンハンワイルズ/i],
    ['Monster Hunter Wilds', /\bモンハン\b/i],
    ['Pokemon Champions', /pokemon champions|ポケモンチャンピオンズ/i],
    ['Mario Kart World', /mario kart world|マリオカートワールド/i],
    ['Street Fighter 6', /street fighter 6|ストリートファイター6|スト6/i],
    ['League of Legends', /\blol\b|league of legends/i],
    ['Apex Legends', /apex legends|\bapex\b/i],
    ['GTA6', /\bgta\s?6\b|grand theft auto vi/i],
    ['原神', /原神|genshin/i],
    ['ゼンレスゾーンゼロ', /ゼンレスゾーンゼロ|zenless zone zero/i],
    ['ドルフロ2', /ドルフロ2/i],
    ['シチズン・スリーパー', /シチズン・スリーパー|citizen sleeper/i],
    ['ROBOBEAT', /robobeat/i],
    ['World War Z', /world war z/i],
    ['theHunter: Call of the Wild', /thehunter:\s*call of the wild|thehunter call of the wild/i],
    ['ひぐらしのなく頃に', /ひぐらしのなく頃に/i],
  ];
  const EVENT_KEYWORD_PATTERN = /大会|トーナメント|予選|決勝|masters|cup|championship|worlds|world championship|festival|fest|showcase|direct|bitsummit|イベント/i;

  let releaseTab = 'week';
  let trendRange = 7;
  let dashboardState = null;

  init().catch((error) => {
    console.error('[game] failed to render', error);
    renderFailure();
  });

  async function init() {
    const [trendPayload, archivePayload, eventPayload] = await Promise.all([
      fetchJsonWithCache({ endpoints: ['./data/trend-topics.json', 'data/trend-topics.json'] }),
      fetchJsonWithCache({ endpoints: ['./data/news-archive.json', 'data/news-archive.json'] }),
      fetchJsonWithCache({ endpoints: ['./data/events.json', 'data/events.json'] }),
    ]);

    const currentTopics = Array.isArray(trendPayload?.items) ? trendPayload.items.map((item) => normalizeTopic(item)) : [];
    const archiveTopics = Array.isArray(archivePayload?.items) ? archivePayload.items.map((item) => normalizeTopic(item)) : [];
    const gameTopics = dedupeTopics([...currentTopics, ...archiveTopics]).filter(isGameTopic);
    const events = Array.isArray(eventPayload?.items) ? eventPayload.items : [];
    dashboardState = buildDashboardState(gameTopics, events, {
      generatedAt: trendPayload?.generatedAt ?? archivePayload?.generatedAt ?? eventPayload?.generatedAt ?? null,
    });

    bindInteractions();
    renderDashboard();
  }

  function bindInteractions() {
    releaseTabsElement?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-release-tab]');
      if (!button) return;
      releaseTab = button.dataset.releaseTab || 'week';
      updateTabState(releaseTabsElement, 'data-release-tab', releaseTab);
      renderReleaseCalendar();
    });

    trendRangeTabsElement?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-trend-range]');
      if (!button) return;
      trendRange = Number(button.dataset.trendRange || 7);
      updateTabState(trendRangeTabsElement, 'data-trend-range', String(trendRange));
      renderTrendCharts();
    });
  }

  function renderDashboard() {
    if (!dashboardState) return;
    renderHeroStats();
    renderSourceStatus();
    renderSurgingGames();
    renderSteamSales();
    renderFreeGames();
    renderEvents();
    renderReleaseCalendar();
    renderTrendCharts();
  }

  function buildDashboardState(topics, events, meta) {
    const anchorDate = determineObservationAnchor(topics, meta.generatedAt);
    const dayKeys = buildRelativeDayKeys(anchorDate);
    const surgingGames = buildSurgingGames(topics, dayKeys);
    const topGameNames = surgingGames.slice(0, 5).map((item) => item.name);

    const steamSales = buildSteamSales(topics);
    const freeGames = buildFreeGames(topics);
    const releaseCalendar = buildReleaseCalendar(topics);
    const eventRadar = buildEventRadar(topics, events);

    return {
      generatedAt: meta.generatedAt,
      topics,
      surgingGames,
      steamSales,
      freeGames,
      events: eventRadar,
      releases: releaseCalendar,
      trendSeries: buildTrendSeries(topics, topGameNames),
      anchorDate,
      sourceStatus: buildSourceStatus({ topics, events, steamSales, freeGames, eventRadar, releaseCalendar }),
      totals: {
        gameTopics24h: topics.filter((topic) => isInRelativeDay(topic, 0, dayKeys)).length,
        saleCount: steamSales.length,
        freeCount: freeGames.length,
        upcomingCount: releaseCalendar.all.length,
      },
    };
  }

  function renderHeroStats() {
    const { totals, generatedAt } = dashboardState;
    heroStatsElement.innerHTML = [
      renderHeroStat('観測トピック', `${totals.gameTopics24h}件`, '過去24時間のゲーム関連話題'),
      renderHeroStat('Steamセール', `${totals.saleCount}件`, '抽出できたSteam関連ディール'),
      renderHeroStat('無料配布', `${totals.freeCount}件`, '今日の無料取得対象'),
      renderHeroStat('発売予定', `${totals.upcomingCount}件`, generatedAt ? `最終更新 ${formatAbsoluteDate(generatedAt)}` : '発売・予約記事から集計'),
    ].join('');
  }

  function renderHeroStat(label, value, description) {
    return `
      <article class="topic-meta-card game-hero-card">
        <strong>${escapeHtml(label)}</strong>
        <span class="game-hero-value">${escapeHtml(value)}</span>
        <p class="topic-signal-summary">${escapeHtml(description)}</p>
      </article>
    `;
  }

  function renderSurgingGames() {
    const items = dashboardState.surgingGames.slice(0, 9);
    if (!items.length) {
      surgingGameListElement.innerHTML = renderEmptyCard('急上昇ゲームがまだ抽出できていません', '複数の補強シグナルを満たすゲームが見つかるとここに表示します。');
      return;
    }
    surgingGameListElement.innerHTML = items.map((item) => {
      const thumbnail = item.thumbnailUrl
        ? `<img src="${escapeHtml(item.thumbnailUrl)}" alt="${escapeHtml(item.name)} のサムネイル" loading="lazy" />`
        : '<div class="game-surging-thumb-fallback">🔥</div>';
      const surgeLabel = item.surgeRate != null ? `急上昇 +${item.surgeRate}%` : '急上昇中';
      return `
        <article class="game-signal-card game-surging-card">
          <div class="game-surging-thumb">
            ${thumbnail}
          </div>
          <div class="game-surging-body">
            <div class="game-card-top">
              <span class="game-card-badge">${escapeHtml(item.evidenceLabel)}</span>
              <span class="game-card-meta">${escapeHtml(surgeLabel)}</span>
            </div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="game-card-summary">${escapeHtml(item.summary)}</p>
            <dl class="game-fact-list">
              <div><dt>関連記事</dt><dd>${escapeHtml(`${item.articleCount}件`)}</dd></div>
              <div><dt>比較</dt><dd>${escapeHtml(`前日 ${item.yesterdayCount}件 / 直近平均 ${item.baselineLabel}件`)}</dd></div>
            </dl>
            <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">詳細を見る ↗</a>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderSourceStatus() {
    const items = dashboardState.sourceStatus;
    sourceGridElement.innerHTML = items.map((item) => `
      <article class="game-source-card game-source-card-${escapeHtml(item.statusClass)}">
        <div class="game-card-top">
          <span class="game-card-badge">${escapeHtml(item.statusLabel)}</span>
          <span class="game-card-meta">${escapeHtml(item.scope)}</span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="game-card-summary">${escapeHtml(item.summary)}</p>
        ${item.proposal ? `<p class="game-source-proposal"><strong>取得方法:</strong> ${escapeHtml(item.proposal)}</p>` : ''}
      </article>
    `).join('');
  }

  function renderSteamSales() {
    const items = dashboardState.steamSales.slice(0, 8);
    if (!items.length) {
      steamSaleListElement.innerHTML = renderEmptyCard('Steamセールはまだ抽出できていません', 'Steamを明示したセール記事が入るとここに表示します。');
      return;
    }
    steamSaleListElement.innerHTML = items.map((item) => `
      <article class="game-signal-card">
        <div class="game-card-top">
          <span class="game-card-badge">${escapeHtml(item.priorityLabel)}</span>
          <span class="game-card-meta">${escapeHtml(item.discount || '割引率不明')}</span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <dl class="game-fact-list">
          <div><dt>価格</dt><dd>${escapeHtml(item.price || '記事内で確認')}</dd></div>
          <div><dt>終了</dt><dd>${escapeHtml(item.endsAtLabel || '終了日時確認中')}</dd></div>
        </dl>
        <p class="game-card-summary">${escapeHtml(item.summary)}</p>
        <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">関連記事を見る ↗</a>
      </article>
    `).join('');
  }

  function renderFreeGames() {
    const items = dashboardState.freeGames.slice(0, 8);
    if (!items.length) {
      freeGameListElement.innerHTML = renderEmptyCard('今日の無料配布はまだ抽出できていません', 'Steam / Epic / GOG / itch.io の無料取得情報が入るとここに表示します。');
      return;
    }
    freeGameListElement.innerHTML = items.map((item) => `
      <article class="game-signal-card">
        <div class="game-card-top">
          <span class="game-card-badge">${escapeHtml(item.store)}</span>
          <span class="game-card-meta">無料</span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <dl class="game-fact-list">
          <div><dt>配布終了</dt><dd>${escapeHtml(item.endsAtLabel || '期限確認中')}</dd></div>
          <div><dt>ストア</dt><dd>${escapeHtml(item.store)}</dd></div>
        </dl>
        <p class="game-card-summary">${escapeHtml(item.summary)}</p>
        <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">関連記事を見る ↗</a>
      </article>
    `).join('');
  }

  function renderEvents() {
    const items = dashboardState.events.slice(0, 8);
    if (!items.length) {
      eventListElement.innerHTML = renderEmptyCard('ゲーム関連イベントはまだ抽出できていません', '大会やイベント情報が増えるとここに表示します。');
      return;
    }
    eventListElement.innerHTML = items.map((item) => `
      <article class="game-signal-card">
        <div class="game-card-top">
          <span class="game-card-badge">${escapeHtml(item.kind)}</span>
          <span class="game-card-meta">${escapeHtml(item.status)}</span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <dl class="game-fact-list">
          <div><dt>日程</dt><dd>${escapeHtml(item.dateLabel)}</dd></div>
          <div><dt>注目理由</dt><dd>${escapeHtml(item.priorityReason)}</dd></div>
        </dl>
        <p class="game-card-summary">${escapeHtml(item.summary)}</p>
        <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">詳細を見る ↗</a>
      </article>
    `).join('');
  }

  function renderReleaseCalendar() {
    const items = dashboardState.releases[releaseTab] ?? [];
    if (!items.length) {
      releaseListElement.innerHTML = renderEmptyCard('この条件の発売予定はまだ抽出できていません', '発売日や予約受付の記載がある記事が入るとここに表示します。');
      return;
    }
    releaseListElement.innerHTML = items.slice(0, 8).map((item) => `
      <article class="game-signal-card">
        <div class="game-card-top">
          <span class="game-card-badge">${escapeHtml(item.badge)}</span>
          <span class="game-card-meta">${escapeHtml(item.platformsLabel)}</span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <dl class="game-fact-list">
          <div><dt>発売日</dt><dd>${escapeHtml(item.releaseDateLabel)}</dd></div>
          <div><dt>プラットフォーム</dt><dd>${escapeHtml(item.platformsLabel)}</dd></div>
        </dl>
        <p class="game-card-summary">${escapeHtml(item.summary)}</p>
        <a class="game-card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">関連記事を見る ↗</a>
      </article>
    `).join('');
  }

  function renderTrendCharts() {
    const charts = dashboardState.trendSeries.slice(0, 5);
    if (!charts.length) {
      trendChartGridElement.innerHTML = renderEmptyCard('推移グラフの対象タイトルがまだ足りません', '複数日の観測データが増えるとここに表示します。');
      return;
    }
    trendChartGridElement.innerHTML = charts.map((series) => renderTrendChart(series, trendRange, dashboardState.anchorDate)).join('');
  }

  function renderTrendChart(series, rangeDays, anchorDate) {
    const points = buildRangeSeries(series, rangeDays, anchorDate);
    const maxValue = Math.max(1, ...points.map((point) => point.value));
    const width = 460;
    const height = 170;
    const left = 12;
    const right = width - 12;
    const top = 16;
    const bottom = height - 28;
    const step = points.length > 1 ? (right - left) / (points.length - 1) : 0;
    const coords = points.map((point, index) => {
      const x = left + step * index;
      const y = bottom - ((bottom - top) * (point.value / maxValue));
      return { ...point, x, y };
    });
    const path = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const area = `${path} L ${coords.at(-1).x.toFixed(2)} ${bottom} L ${coords[0].x.toFixed(2)} ${bottom} Z`;
    const labels = [coords[0], coords[Math.floor(coords.length / 2)], coords.at(-1)].filter(Boolean);
    const current = points.at(-1)?.value ?? 0;
    const prev = points.at(-2)?.value ?? 0;
    const trendDelta = current - prev;

    return `
      <article class="game-chart-card">
        <div class="game-chart-head">
          <div>
            <h3>${escapeHtml(series.name)}</h3>
            <p>${escapeHtml(`最新 ${current}件 / 前日比 ${trendDelta >= 0 ? '+' : ''}${trendDelta}`)}</p>
          </div>
          <span class="game-card-meta">${rangeDays}日</span>
        </div>
        <svg class="game-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(series.name)} の過去${rangeDays}日の話題推移">
          <defs>
            <linearGradient id="chart-fill-${escapeHtml(series.slug)}" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="rgba(33, 102, 255, 0.32)"></stop>
              <stop offset="100%" stop-color="rgba(33, 102, 255, 0.02)"></stop>
            </linearGradient>
          </defs>
          <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="game-chart-axis"></line>
          <path d="${area}" fill="url(#chart-fill-${escapeHtml(series.slug)})"></path>
          <path d="${path}" class="game-chart-line"></path>
          ${coords.map((point) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5" class="game-chart-dot"></circle>`).join('')}
          ${labels.map((point) => `<text x="${point.x.toFixed(2)}" y="${height - 8}" text-anchor="middle" class="game-chart-label">${escapeHtml(point.label.slice(5).replace('-', '/'))}</text>`).join('')}
        </svg>
      </article>
    `;
  }

  function buildSurgingGames(topics, dayKeys) {
    const buckets = new Map();
    const recentKeys = [dayKeys.today, dayKeys.yesterday, relativeDayKey(2), relativeDayKey(3), relativeDayKey(4)];

    for (const topic of topics) {
      if (!isDiscoveryGameTopic(topic)) continue;
      const names = extractGameNames(topic);
      if (!names.length) continue;
      const dayKey = dayKeyFromTopic(topic);
      const articleCount = Math.max(1, Number(topic.posts ?? topic.sourceSignals?.length ?? 1));
      const socialCount = estimateSocialMentions(topic);
      const socialLinksCount = Array.isArray(topic.socialLinks) ? topic.socialLinks.length : 0;
      const sourceNames = new Set((topic.sourceSignals || []).map((signal) => signal.sourceName).filter(Boolean));
      const evidenceTypes = new Set(['news']);
      if (socialLinksCount > 0 || /sns/i.test((topic.hotReasons || []).join(' '))) evidenceTypes.add('social');
      if (STORE_SIGNAL_PATTERN.test(topicText(topic))) evidenceTypes.add('store');
      if (OFFICIAL_SIGNAL_PATTERN.test(topicText(topic))) evidenceTypes.add('official');

      for (const name of names) {
        const bucket = buckets.get(name) || createSurgingGameAggregate(name);
        bucket.days.set(dayKey, (bucket.days.get(dayKey) || 0) + 1);
        bucket.articleDays.set(dayKey, (bucket.articleDays.get(dayKey) || 0) + articleCount);
        bucket.socialDays.set(dayKey, (bucket.socialDays.get(dayKey) || 0) + socialCount);
        sourceNames.forEach((sourceName) => bucket.sourceNames.add(sourceName));
        evidenceTypes.forEach((type) => bucket.evidenceTypes.add(type));
        bucket.totalScore += Number(topic.score ?? topic.hotScore ?? 0) + articleCount * 10 + socialCount * 6;

        const topicFit = scoreTopicFitness(topic, name);
        if (!bucket.primaryTopic || topicFit > bucket.primaryTopicScore) {
          bucket.primaryTopic = topic;
          bucket.primaryTopicScore = topicFit;
        }
        buckets.set(name, bucket);
      }
    }

    return [...buckets.values()]
      .map((bucket) => finalizeSurgingGame(bucket, recentKeys))
      .filter(Boolean)
      .sort((a, b) => b.sortScore - a.sortScore || b.articleCount - a.articleCount || a.name.localeCompare(b.name, 'ja'));
  }

  function buildSteamSales(topics) {
    const items = [];
    for (const topic of topics) {
      const haystack = [topic.title, topic.summary, topic.briefSummary, JSON.stringify(topic.sourceSignals || [])].join(' ');
      if (!/steam/i.test(haystack) || !/セール|割引|オフ|最安|sale/i.test(haystack)) continue;
      const title = extractGameNames(topic)[0] || shortEventFromTitle(topic.title);
      const discount = extractDiscount(haystack);
      const price = extractPrice(haystack);
      const endDate = extractRelevantDate(haystack, /まで|終了|終了日時|販売終了/i);
      const priority = [
        discount >= 90 ? 4 : 0,
        /過去最安|最安/i.test(haystack) ? 3 : 0,
        Number(topic.score ?? 0) >= 100 ? 2 : 0,
        endDate && hoursUntil(endDate) <= 24 ? 1 : 0,
      ].reduce((sum, value) => sum + value, 0);
      items.push({
        key: `${title}-${price}-${discount}`,
        title,
        discount: discount ? `${discount}% OFF` : null,
        price: price ? `${price}円` : null,
        endsAt: endDate,
        endsAtLabel: endDate ? formatAbsoluteDate(endDate.toISOString()) : null,
        priority,
        priorityLabel: discount >= 90 ? '90%+ OFF' : /過去最安|最安/i.test(haystack) ? '最安値圏' : hoursUntil(endDate) <= 24 ? '終了間近' : '注目作',
        summary: topic.briefSummary || topic.summary || 'Steamセール関連ニュースから抽出',
        url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(title, { rangeDays: 7 }),
      });
    }
    return uniqueBy(items, (item) => item.key).sort((a, b) => b.priority - a.priority || compareDates(a.endsAt, b.endsAt));
  }

  function buildFreeGames(topics) {
    const items = [];
    for (const topic of topics) {
      const haystack = [topic.title, topic.summary, topic.briefSummary].join(' ');
      if (!/無料|free|0円|無料化|無料配布/i.test(haystack)) continue;
      const store = inferStore(haystack);
      if (!store) continue;
      const names = extractQuotedNames(haystack).filter(isValidGameName);
      const candidateNames = names.length ? names : [extractGameNames(topic)[0] || shortEventFromTitle(topic.title)];
      const endDate = extractRelevantDate(haystack, /まで|終了|期限|配布/i);
      for (const name of candidateNames.slice(0, 2)) {
        items.push({
          key: `${store}-${name}`,
          title: name,
          store,
          endsAt: endDate,
          endsAtLabel: endDate ? formatAbsoluteDate(endDate.toISOString()) : null,
          summary: topic.briefSummary || topic.summary || '無料配布関連ニュースから抽出',
          url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(name, { rangeDays: 7 }),
        });
      }
    }
    return uniqueBy(items, (item) => item.key).sort((a, b) => compareDates(a.endsAt, b.endsAt));
  }

  function buildEventRadar(topics, rawEvents) {
    const results = [];
    const now = new Date();
    for (const event of rawEvents) {
      if (!isGameEvent(event)) continue;
      const start = safeDate(event.startDate);
      const end = safeDate(event.endDate);
      const ongoing = start && start <= now && (!end || end >= now);
      const withinWeek = start && daysBetween(now, start) <= 7 && daysBetween(now, start) >= 0;
      const endingSoon = end && daysBetween(now, end) <= 7 && daysBetween(now, end) >= 0;
      results.push({
        title: event.title,
        kind: 'イベント',
        status: ongoing ? '開催中' : withinWeek ? '今週' : '受付中',
        dateLabel: formatEventRange(start, end),
        priorityReason: endingSoon ? '終了が近い' : ongoing ? '現在開催中' : withinWeek ? '今週開催' : '日程確定',
        summary: event.description || event.category || event.venue || 'ゲーム関連イベント',
        url: event.detailUrl || event.officialUrl || '#',
        sortScore: (ongoing ? 100 : 0) + (endingSoon ? 90 : 0) + (withinWeek ? 70 : 0) - Math.max(0, daysBetween(now, start || end || now)),
      });
    }

    for (const topic of topics) {
      const haystack = topicText(topic);
      if (!EVENT_KEYWORD_PATTERN.test(haystack)) continue;
      const date = extractRelevantDate([topic.title, topic.summary, topic.briefSummary].join(' '));
      results.push({
        title: extractGameNames(topic)[0] || shortEventFromTitle(topic.title),
        kind: '大会',
        status: date && daysBetween(now, date) <= 7 && daysBetween(now, date) >= 0 ? '今週' : '話題化',
        dateLabel: date ? formatAbsoluteDate(date.toISOString()) : formatTopicDisplayTime(topic),
        priorityReason: date ? '日程が近い' : 'ニュース観測で急浮上',
        summary: topic.briefSummary || topic.summary || topic.title,
        url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(topic.title, { rangeDays: 7 }),
        sortScore: 40 - Math.max(0, daysBetween(now, date || now)),
      });
    }

    return uniqueBy(results, (item) => item.title).sort((a, b) => b.sortScore - a.sortScore);
  }

  function buildReleaseCalendar(topics) {
    const all = [];
    const now = new Date();
    for (const topic of topics) {
      const haystack = [topic.title, topic.summary, topic.briefSummary].join(' ');
      if (!/発売|配信開始|リリース|発売日|予約受付|予約開始|事前登録/i.test(haystack)) continue;
      const title = extractGameNames(topic)[0] || shortEventFromTitle(topic.title);
      const releaseDate = extractRelevantDate(haystack);
      const platforms = inferPlatforms(haystack);
      const reservation = /予約受付|予約開始|事前登録/i.test(haystack);
      all.push({
        key: `${title}-${releaseDate?.toISOString() || 'unknown'}`,
        title,
        releaseDate,
        releaseDateLabel: releaseDate ? formatAbsoluteDate(releaseDate.toISOString()) : '発売日確認中',
        platforms,
        platformsLabel: platforms.length ? platforms.join(' / ') : 'プラットフォーム確認中',
        badge: reservation ? '予約受付中' : releaseDate && daysBetween(now, releaseDate) <= 7 ? '今週発売' : '発売予定',
        summary: topic.briefSummary || topic.summary || topic.title,
        url: topic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(title, { rangeDays: 7 }),
        reservation,
      });
    }

    const deduped = uniqueBy(all, (item) => item.key).sort((a, b) => compareDates(a.releaseDate, b.releaseDate));
    return {
      all: deduped,
      week: deduped.filter((item) => item.releaseDate && daysBetween(now, item.releaseDate) >= 0 && daysBetween(now, item.releaseDate) <= 7),
      month: deduped.filter((item) => item.releaseDate && sameMonth(now, item.releaseDate) && item.releaseDate >= now),
      reserve: deduped.filter((item) => item.reservation),
    };
  }

  function buildTrendSeries(topics, names) {
    const dayBuckets = new Map();
    for (const topic of topics) {
      const dayKey = dayKeyFromTopic(topic);
      const topicNames = extractGameNames(topic);
      for (const name of topicNames) {
        const bucket = dayBuckets.get(name) || new Map();
        bucket.set(dayKey, (bucket.get(dayKey) || 0) + 1);
        dayBuckets.set(name, bucket);
      }
    }

    return names.map((name) => ({
      name,
      slug: slugify(name),
      days: dayBuckets.get(name) || new Map(),
    }));
  }

  function buildSourceStatus({ topics, events, steamSales, freeGames, eventRadar, releaseCalendar }) {
    const freeStores = new Set(freeGames.map((item) => item.store));
    const hasSteamNewsDeals = steamSales.length > 0;
    const hasDirectEventFeed = Array.isArray(events) && events.length > 0;
    const hasReleaseNews = releaseCalendar.all.length > 0;

    return [
      {
        statusLabel: '接続済み',
        statusClass: 'ok',
        scope: 'ニュース集計',
        title: '急上昇ゲーム / トレンド推移',
        summary: `${topics.length}件のゲーム関連ニュースから固有タイトルを抽出し、前日比較と日別推移を計算しています。`,
        proposal: '',
      },
      {
        statusLabel: hasDirectEventFeed ? '接続済み' : '未接続',
        statusClass: hasDirectEventFeed ? 'ok' : 'missing',
        scope: 'イベント',
        title: '大会・イベント',
        summary: hasDirectEventFeed
          ? `${eventRadar.length}件を表示中。既存の公式イベント収集データを利用していますが、eスポーツ大会専用APIまでは未接続です。`
          : '公式イベントソースが不足しているため、大会・イベント欄は成立していません。',
        proposal: 'start.gg、Liquipedia、VLR.gg、LoL Esports API など競技タイトル別の公式/準公式日程ソースを追加する。',
      },
      {
        statusLabel: hasSteamNewsDeals ? 'ニュース推定' : '未接続',
        statusClass: hasSteamNewsDeals ? 'derived' : 'missing',
        scope: 'Steam',
        title: 'Steamセール情報',
        summary: hasSteamNewsDeals
          ? `${steamSales.length}件をニュース記事から抽出しています。割引率や価格は記事文面ベースで、Steam直結データではありません。`
          : 'Steamセールの直接ソースが無いため、正確な価格監視はまだ実装されていません。',
        proposal: 'Steam Store Search API や Steam Specials ページの定期収集を追加し、過去最安値は SteamDB 連携または価格履歴DBを別途持つ。',
      },
      {
        statusLabel: freeStores.size >= 2 ? '一部接続' : '未接続',
        statusClass: freeStores.size >= 2 ? 'derived' : 'missing',
        scope: '無料配布',
        title: 'Steam / Epic / GOG / itch.io',
        summary: freeStores.size
          ? `現在は ${[...freeStores].join(' / ')} をニュース由来で捕捉しています。未検知ストアは空欄のままにしています。`
          : '無料配布のストア直結ソースが無いため、この欄はまだ成立していません。',
        proposal: 'Epic Games freeGamesPromotions、GOG frontpage promo、itch.io sale/free browse、Steam free-to-keep監視をストア別に追加する。',
      },
      {
        statusLabel: hasReleaseNews ? 'ニュース推定' : '未接続',
        statusClass: hasReleaseNews ? 'derived' : 'missing',
        scope: '発売予定',
        title: '発売カレンダー',
        summary: hasReleaseNews
          ? `${releaseCalendar.all.length}件を発売日入りニュースから抽出しています。公式ストアやメーカー発売表そのものはまだ読んでいません。`
          : '発売日データの直接ソースが無いため、ニュース記事なしでは成立しません。',
        proposal: 'Nintendo eShop新作一覧、Steam coming soon、PlayStation Store新着、各メーカー発売カレンダーを定期収集する。',
      },
    ];
  }

  function buildRangeSeries(series, rangeDays, anchorDate) {
    const labels = [];
    for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
      const key = relativeDayKey(offset, anchorDate);
      labels.push({
        label: key,
        value: series.days.get(key) || 0,
      });
    }
    return labels;
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

  function extractQuotedNames(text) {
    const values = [];
    for (const match of String(text ?? '').matchAll(QUOTED_TITLE_PATTERN)) {
      values.push(match[1]);
    }
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
      && !/フェス|チャプター|シーズン|episode|エピソード|パック|セット|エディション|シール|サウンドトラック|サントラ/i.test(normalized)
      && !/(conference|fest|festival|showcase|direct|masters|worlds|championship|cup|ndc\d+|state of play|game pass|switch 2|steam next fest)/i.test(normalized)
      && !/^(発売|配信|セール|無料配布|アップデート|デモ版|体験版|大型アップデート)/.test(normalized)
      && !/^[A-Z]{1,4}$/.test(normalized)
      && !/^[\u30a0-\u30ff]{2,5}$/.test(normalized)
      && !(englishWordCount === 1 && /^[A-Za-z]+$/.test(normalized) && !isKnownAlias)
      && !(/[\u3040-\u309f].*\s+[\u3040-\u309f]/u.test(normalized))
      && !(/^[\u3040-\u309fー]{3,}$/u.test(normalized) && !isKnownAlias);
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
    return isGameTopic(topic) && (!NON_GAME_TOPIC_PATTERN.test(text) || STRONG_GAME_TOPIC_PATTERN.test(text));
  }

  function inferStore(text) {
    if (/epic games/i.test(text)) return 'Epic Games';
    if (/itch\.io/i.test(text)) return 'itch.io';
    if (/\bgog\b/i.test(text)) return 'GOG';
    if (/\bsteam\b/i.test(text)) return 'Steam';
    return null;
  }

  function inferPlatforms(text) {
    const results = [];
    if (/switch\s?2/i.test(text)) results.push('Switch 2');
    if (/switch/i.test(text) && !results.includes('Switch 2')) results.push('Switch');
    if (/ps5|playstation 5/i.test(text)) results.push('PS5');
    if (/ps4|playstation 4/i.test(text)) results.push('PS4');
    if (/xbox/i.test(text)) results.push('Xbox');
    if (/steam|pc/i.test(text)) results.push('PC / Steam');
    if (/ios|iphone|ipad/i.test(text)) results.push('iOS');
    if (/android/i.test(text)) results.push('Android');
    return [...new Set(results)];
  }

  function estimateSocialMentions(topic) {
    const socialLinks = Array.isArray(topic.socialLinks) ? topic.socialLinks.length : 0;
    const buzz = Math.round(Number(topic.hotScore ?? 0) / 25);
    return Math.max(1, socialLinks + buzz);
  }

  function createSurgingGameAggregate(name) {
    return {
      name,
      days: new Map(),
      articleDays: new Map(),
      socialDays: new Map(),
      sourceNames: new Set(),
      evidenceTypes: new Set(),
      totalScore: 0,
      primaryTopic: null,
      primaryTopicScore: -1,
    };
  }

  function finalizeSurgingGame(bucket, recentKeys) {
    const [todayKey, yesterdayKey, ...baselineKeys] = recentKeys;
    const todayCount = bucket.days.get(todayKey) || 0;
    const yesterdayCount = bucket.days.get(yesterdayKey) || 0;
    const articleCount = bucket.articleDays.get(todayKey) || 0;
    const socialCount = bucket.socialDays.get(todayKey) || 0;
    const baselineCounts = baselineKeys.map((key) => bucket.days.get(key) || 0);
    const baselineAverage = baselineCounts.length
      ? baselineCounts.reduce((sum, value) => sum + value, 0) / baselineCounts.length
      : 0;
    const baselineFloor = Math.max(yesterdayCount, baselineAverage, 0.5);
    const surgeRate = todayCount > baselineFloor
      ? Math.round(((todayCount - baselineFloor) / baselineFloor) * 100)
      : null;
    const evidenceCount = bucket.evidenceTypes.size;
    const sourceCount = bucket.sourceNames.size;
    const primaryTopic = bucket.primaryTopic;

    if (!primaryTopic || todayCount === 0) return null;
    if (surgeRate == null || surgeRate <= 0) return null;
    if (articleCount < 1) return null;
    if (evidenceCount < 2 && sourceCount < 2) return null;

    return {
      name: bucket.name,
      summary: summarizeGameTopic(primaryTopic),
      thumbnailUrl: primaryTopic.thumbnailUrl || primaryTopic.sourceSignals?.find((signal) => signal.thumbnailUrl)?.thumbnailUrl || null,
      articleCount,
      yesterdayCount,
      baselineLabel: baselineAverage ? baselineAverage.toFixed(baselineAverage >= 10 ? 0 : 1) : '0',
      socialCount,
      surgeRate,
      evidenceLabel: buildEvidenceLabel(bucket),
      sortScore: surgeRate * 100 + articleCount * 18 + socialCount * 10 + sourceCount * 14 + bucket.totalScore,
      url: primaryTopic.sourceSignals?.[0]?.url || buildGoogleNewsUrl(bucket.name, { rangeDays: 7 }),
    };
  }

  function buildEvidenceLabel(bucket) {
    const labels = [];
    if (bucket.sourceNames.size >= 2) labels.push(`${bucket.sourceNames.size}媒体`);
    else labels.push('ニュース');
    if (bucket.evidenceTypes.has('social')) labels.push('SNS');
    if (bucket.evidenceTypes.has('store')) labels.push('ストア');
    if (bucket.evidenceTypes.has('official')) labels.push('公式');
    return labels.slice(0, 2).join(' + ');
  }

  function summarizeGameTopic(topic) {
    const summary = String(topic.briefSummary || topic.whatHappened || topic.summary || topic.title || '').replace(/\s+/g, ' ').trim();
    if (summary.length <= 52) return summary;
    return `${summary.slice(0, 52).trim()}…`;
  }

  function scoreTopicFitness(topic, gameName) {
    const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary].filter(Boolean).join(' ');
    const exactTitle = text.includes(gameName) ? 20 : 0;
    const hasThumbnail = topic.thumbnailUrl ? 6 : 0;
    const sourceCount = Math.max(1, Number(topic.posts ?? topic.sourceSignals?.length ?? 1)) * 5;
    const score = Number(topic.score ?? topic.hotScore ?? 0);
    return exactTitle + hasThumbnail + sourceCount + score;
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
    if (date.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 150) {
      date.setFullYear(year + 1);
    }
    return date;
  }

  function updateTabState(container, attrName, activeValue) {
    container?.querySelectorAll(`button[${attrName}]`).forEach((button) => {
      button.classList.toggle('active', button.getAttribute(attrName) === activeValue);
    });
  }

  function renderFailure() {
    const html = renderEmptyCard('ゲームページの読み込みに失敗しました', 'ローカルHTTPサーバーで開いているか確認してください。');
    heroStatsElement.innerHTML = html;
    sourceGridElement.innerHTML = html;
    surgingGameListElement.innerHTML = html;
    steamSaleListElement.innerHTML = html;
    freeGameListElement.innerHTML = html;
    eventListElement.innerHTML = html;
    releaseListElement.innerHTML = html;
    trendChartGridElement.innerHTML = html;
  }

  function renderEmptyCard(title, text) {
    return `
      <article class="game-empty-card">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
      </article>
    `;
  }

  function buildRelativeDayKeys(anchorDate) {
    return {
      today: relativeDayKey(0, anchorDate),
      yesterday: relativeDayKey(1, anchorDate),
    };
  }

  function relativeDayKey(offset, anchorDate = new Date()) {
    const date = new Date(anchorDate.getTime() - offset * 24 * 60 * 60 * 1000);
    return formatDayKey(date);
  }

  function determineObservationAnchor(topics, generatedAt) {
    const values = topics.map((topic) => archiveTimestamp(topic)).filter(Boolean);
    if (generatedAt) values.push(new Date(generatedAt).getTime());
    const latest = values.length ? Math.max(...values) : Date.now();
    return new Date(latest);
  }

  function dayKeyFromTopic(topic) {
    const time = archiveTimestamp(topic);
    return formatDayKey(new Date(time || Date.now()));
  }

  function formatDayKey(date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  }

  function isInRelativeDay(topic, offset, dayKeys) {
    const key = offset === 0 ? dayKeys.today : dayKeys.yesterday;
    return dayKeyFromTopic(topic) === key;
  }

  function slugify(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || 'chart';
  }

  function uniqueBy(items, selector) {
    const map = new Map();
    for (const item of items) {
      map.set(selector(item), item);
    }
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

  function formatEventRange(start, end) {
    if (start && end) return `${formatAbsoluteDate(start.toISOString())} - ${formatAbsoluteDate(end.toISOString())}`;
    if (start) return formatAbsoluteDate(start.toISOString());
    if (end) return `${formatAbsoluteDate(end.toISOString())}まで`;
    return '日程確認中';
  }

  function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isGameEvent(event) {
    const text = [event.title, event.category, event.description, event.venue, ...(event.tags || [])].filter(Boolean).join(' ');
    return /pokemon|ポケモン|game|ゲーム|nintendo|valorant|apex|league|lol|street fighter|ストリートファイター|esports|eスポーツ|bitsummit|scrap|脱出ゲーム/i.test(text);
  }
})();
