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
  const rankingListElement = document.querySelector('#game-ranking-list');
  const wordListElement = document.querySelector('#game-word-list');
  const steamSaleListElement = document.querySelector('#steam-sale-list');
  const freeGameListElement = document.querySelector('#free-game-list');
  const eventListElement = document.querySelector('#game-event-list');
  const releaseListElement = document.querySelector('#release-list');
  const releaseTabsElement = document.querySelector('#release-tabs');
  const trendRangeTabsElement = document.querySelector('#trend-range-tabs');
  const trendChartGridElement = document.querySelector('#trend-chart-grid');

  const GAME_HINT_PATTERN = /ゲーム|switch|steam|ps5|xbox|nintendo|任天堂|playstation|pcゲーム|eスポーツ|esports|valorant|apex|pokemon|ポケモン|モンハン|mario|マリオ|gta|原神|スト6|street fighter|lol|league of legends/i;
  const INVALID_GAME_NAME_PATTERN = /^(ゲーム|セール|アップデート|デモ版|体験版|発売日|予約|配信|リリース|イベント|大会|無料配布|公式番組|最終アップデート|今週のすべり込みセール情報|steamos|switch2\/ios\/android版|switch 2|steam next fest|summer game fest|nintendo direct|state of play|valorant masters|ndc26)$/i;
  const QUOTED_TITLE_PATTERN = /[『「]([^『』「」]{2,42})[』」]/gu;
  const PERCENT_PATTERN = /(\d{1,3})\s*(?:％|%)\s*(?:オフ|OFF)/i;
  const PRICE_PATTERN = /([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*円/g;
  const JAPANESE_DATE_PATTERN = /(\d{1,2})月(\d{1,2})日(?:[^\d]{0,6}(\d{1,2})[:：](\d{2}))?/g;
  const KNOWN_GAME_TERMS = [
    ['Monster Hunter Wilds', /monster hunter wilds|モンスターハンターワイルズ|モンハンワイルズ/i],
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
  ];
  const KNOWN_WORD_TERMS = [
    ['Switch 2', /switch\s?2|switch2/i],
    ['Steam Next Fest', /steam next fest/i],
    ['Summer Game Fest', /summer game fest/i],
    ['Nintendo Direct', /nintendo direct/i],
    ['State of Play', /state of play/i],
    ['Game Pass', /game pass/i],
    ['VALORANT Masters', /valorant masters/i],
    ['EVO', /\bevo\b/i],
    ['Worlds', /\bworlds\b|世界大会/i],
    ['Steam', /\bsteam\b/i],
    ['Epic Games', /epic games/i],
    ['itch.io', /itch\.io/i],
    ['GOG', /\bgog\b/i],
    ['無料配布', /無料配布|0円|無料で取得/i],
    ['予約開始', /予約受付|予約開始|事前登録/i],
    ['大型アップデート', /大型アップデート|無料アップデート/i],
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
    renderRanking();
    renderRisingWords();
    renderSteamSales();
    renderFreeGames();
    renderEvents();
    renderReleaseCalendar();
    renderTrendCharts();
  }

  function buildDashboardState(topics, events, meta) {
    const dayKeys = buildRelativeDayKeys();
    const ranking = buildGameRanking(topics, dayKeys);
    const topGameNames = ranking.slice(0, 5).map((item) => item.name);

    const steamSales = buildSteamSales(topics);
    const freeGames = buildFreeGames(topics);
    const releaseCalendar = buildReleaseCalendar(topics);
    const eventRadar = buildEventRadar(topics, events);

    return {
      generatedAt: meta.generatedAt,
      topics,
      ranking,
      risingWords: buildRisingWords(topics, dayKeys),
      steamSales,
      freeGames,
      events: eventRadar,
      releases: releaseCalendar,
      trendSeries: buildTrendSeries(topics, topGameNames),
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

  function renderRanking() {
    const items = dashboardState.ranking.slice(0, 10);
    if (!items.length) {
      rankingListElement.innerHTML = renderEmptyCard('ランキング対象のゲームがまだ少ないです', 'ゲーム関連ニュースの蓄積が増えるとここに表示します。');
      return;
    }
    rankingListElement.innerHTML = items.map((item, index) => {
      const metrics = `${item.topicCount24h}話題 / ${item.articleCount24h}記事 / SNS ${item.socialCount24h}`;
      return `
        <article class="game-rank-item">
          <div class="game-rank-order">${index + 1}</div>
          <div class="game-rank-body">
            <div class="game-rank-head">
              <h3>${escapeHtml(item.name)}</h3>
              <span class="game-score">${item.score}</span>
            </div>
            <p class="game-rank-metrics">${escapeHtml(metrics)}</p>
          </div>
          <div class="game-rank-change ${escapeHtml(item.changeDirection)}">${escapeHtml(item.changeLabel)}</div>
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

  function renderRisingWords() {
    const items = dashboardState.risingWords.slice(0, 10);
    if (!items.length) {
      wordListElement.innerHTML = renderEmptyCard('急上昇ワードはまだ抽出できていません', '前日との差分が出るとここに表示します。');
      return;
    }
    wordListElement.innerHTML = items.map((item) => `
      <article class="game-word-item">
        <div>
          <strong>${escapeHtml(item.term)}</strong>
          <p>${escapeHtml(`${item.todayCount}件観測 / 前日比 +${item.delta}`)}</p>
        </div>
        <a class="game-mini-link" href="${escapeHtml(buildGoogleNewsUrl(item.term, { rangeDays: 7 }))}" target="_blank" rel="noreferrer">探す ↗</a>
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
    trendChartGridElement.innerHTML = charts.map((series) => renderTrendChart(series, trendRange)).join('');
  }

  function renderTrendChart(series, rangeDays) {
    const points = buildRangeSeries(series, rangeDays);
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

  function buildGameRanking(topics, dayKeys) {
    const todayKey = dayKeys.today;
    const yesterdayKey = dayKeys.yesterday;
    const aggregates = new Map();

    for (const topic of topics) {
      const names = extractGameNames(topic);
      if (!names.length) continue;
      const dayKey = dayKeyFromTopic(topic);
      for (const name of names) {
        const bucket = aggregates.get(name) || createGameAggregate(name);
        const articleCount = Math.max(1, Number(topic.posts ?? topic.sourceSignals?.length ?? 1));
        const socialCount = estimateSocialMentions(topic);
        const topicScore = Number(topic.score ?? topic.hotScore ?? 0);
        if (dayKey === todayKey) {
          bucket.topicCount24h += 1;
          bucket.articleCount24h += articleCount;
          bucket.socialCount24h += socialCount;
          bucket.score24h += topicScore + articleCount * 8 + socialCount * 6;
        }
        if (dayKey === yesterdayKey) {
          bucket.scoreYesterday += topicScore + articleCount * 8 + socialCount * 6;
        }
        bucket.totalScore += topicScore;
        aggregates.set(name, bucket);
      }
    }

    const todayRanked = [...aggregates.values()]
      .filter((item) => item.topicCount24h > 0)
      .map((item) => ({ ...item, score: Math.round(item.score24h) }))
      .sort((a, b) => b.score - a.score || b.articleCount24h - a.articleCount24h || a.name.localeCompare(b.name, 'ja'));

    const yesterdayRanked = [...aggregates.values()]
      .filter((item) => item.scoreYesterday > 0)
      .sort((a, b) => b.scoreYesterday - a.scoreYesterday || a.name.localeCompare(b.name, 'ja'));
    const yesterdayRanks = new Map(yesterdayRanked.map((item, index) => [item.name, index + 1]));

    return todayRanked.map((item, index) => {
      const currentRank = index + 1;
      const previousRank = yesterdayRanks.get(item.name);
      const change = previousRank ? previousRank - currentRank : null;
      return {
        ...item,
        changeLabel: previousRank == null ? 'NEW' : change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : '→',
        changeDirection: previousRank == null ? 'new' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
      };
    });
  }

  function buildRisingWords(topics, dayKeys) {
    const counts = new Map();
    for (const topic of topics) {
      const dayKey = dayKeyFromTopic(topic);
      if (dayKey !== dayKeys.today && dayKey !== dayKeys.yesterday) continue;
      for (const term of extractRisingTerms(topic)) {
        const bucket = counts.get(term) || { term, todayCount: 0, yesterdayCount: 0 };
        if (dayKey === dayKeys.today) bucket.todayCount += 1;
        if (dayKey === dayKeys.yesterday) bucket.yesterdayCount += 1;
        counts.set(term, bucket);
      }
    }
    return [...counts.values()]
      .map((item) => ({ ...item, delta: item.todayCount - item.yesterdayCount }))
      .filter((item) => item.todayCount > 0 && item.delta > 0)
      .sort((a, b) => b.delta - a.delta || b.todayCount - a.todayCount || a.term.localeCompare(b.term, 'ja'));
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
        title: '話題量ランキング / 急上昇ワード / トレンド推移',
        summary: `${topics.length}件のゲーム関連ニュースを集計し、24時間比較と日別推移を計算しています。`,
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

  function buildRangeSeries(series, rangeDays) {
    const labels = [];
    for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
      const key = relativeDayKey(offset);
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
    const text = [topic.title, topic.whatHappened, topic.summary, topic.briefSummary, ...(topic.relatedKeywords || [])].filter(Boolean).join(' ');
    const found = [];
    for (const [label, pattern] of KNOWN_GAME_TERMS) {
      if (pattern.test(text)) found.push(label);
    }
    found.push(...extractQuotedNames(text));
    return [...new Set(found.map(normalizeGameName).filter(isValidGameName))].slice(0, 3);
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
      .replace(/[，,。！!？?].*$/u, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isValidGameName(value) {
    const normalized = normalizeGameName(value);
    return normalized.length >= 2
      && normalized.length <= 36
      && !INVALID_GAME_NAME_PATTERN.test(normalized)
      && !/(conference|fest|festival|showcase|direct|masters|worlds|championship|cup|ndc\d+|state of play|game pass|switch 2|steam next fest)/i.test(normalized)
      && !/^(発売|配信|セール|無料配布|アップデート|デモ版|体験版|大型アップデート)/.test(normalized);
  }

  function extractRisingTerms(topic) {
    const text = [topic.title, topic.summary, topic.briefSummary, ...(topic.relatedKeywords || [])].filter(Boolean).join(' ');
    const terms = [];
    for (const [label, pattern] of KNOWN_WORD_TERMS) {
      if (pattern.test(text)) terms.push(label);
    }
    terms.push(...extractGameNames(topic));
    for (const keyword of topic.relatedKeywords || []) {
      const normalized = String(keyword ?? '').trim();
      if (!normalized || normalized.length < 2 || normalized.length > 28) continue;
      if (/^(ゲーム|エンタメ|ネットカルチャー|総合|一般|source|sources)$/i.test(normalized)) continue;
      if (/^[A-Z]{1,3}$/.test(normalized)) continue;
      if (!/[\s0-9:：・/+-]/.test(normalized) && normalized.length < 8) continue;
      if (/^[\u30a0-\u30ff]{2,7}$/.test(normalized)) continue;
      terms.push(normalized);
    }
    return [...new Set(terms)];
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
    rankingListElement.innerHTML = html;
    wordListElement.innerHTML = html;
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

  function createGameAggregate(name) {
    return {
      name,
      topicCount24h: 0,
      articleCount24h: 0,
      socialCount24h: 0,
      score24h: 0,
      scoreYesterday: 0,
      totalScore: 0,
    };
  }

  function buildRelativeDayKeys() {
    return {
      today: relativeDayKey(0),
      yesterday: relativeDayKey(1),
    };
  }

  function relativeDayKey(offset) {
    const now = new Date();
    const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    return formatDayKey(date);
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

  function isGameEvent(event) {
    const text = [event.title, event.category, event.description, event.venue, ...(event.tags || [])].filter(Boolean).join(' ');
    return /pokemon|ポケモン|game|ゲーム|nintendo|valorant|apex|league|lol|street fighter|ストリートファイター|esports|eスポーツ|bitsummit|scrap|脱出ゲーム/i.test(text);
  }
})();
