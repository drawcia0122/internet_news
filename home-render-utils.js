(function attachHomeRenderUtils(global) {
  function buildTrendCardThumb(thumbnailUrl, { escapeHtml, isWeakThumbnailUrl } = {}) {
    if (!thumbnailUrl || isWeakThumbnailUrl?.(thumbnailUrl)) return '';
    return '<div class="trend-thumb-wrap"><img class="trend-thumb" src="' + escapeHtml(thumbnailUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>';
  }

  function renderTrendReasonList(trend, { escapeHtml, shortEventFromTitle, buildWhyHotLabel } = {}) {
    return '<dl class="trend-reason-list">' +
      '<div><dt>何が起きた？</dt><dd>' + escapeHtml(trend.whatHappened ?? shortEventFromTitle(trend.title)) + '</dd></div>' +
      '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(trend.whyHot ?? buildWhyHotLabel(trend)) + '</dd></div>' +
    '</dl>';
  }

  function buildTopicCardSummary(topic, { shortEventFromTitle, trimMetaText } = {}) {
    const summarySource = topic.summary || topic.briefSummary || topic.whatHappened || shortEventFromTitle(topic.title);
    const text = String(summarySource ?? '').replace(/\s+/g, ' ').trim();
    return trimMetaText(text || '最新の動きを整理しています。', 88);
  }

  function collectRelatedSignals(topic, limit = 3) {
    const signals = Array.isArray(topic.sourceSignals) ? topic.sourceSignals : [];
    return signals
      .filter((signal) => signal?.url)
      .slice(0, limit);
  }

  function renderTopicRelatedLink(signal, { escapeHtml, trimMetaText } = {}) {
    return '<a class="topic-related-link" href="' + escapeHtml(signal.url ?? '#') + '" target="_blank" rel="noreferrer">' +
      '<div><strong>' + escapeHtml(signal.sourceName ?? signal.source ?? 'Source') + '</strong><span>' + escapeHtml(trimMetaText(signal.title ?? '関連記事', 42)) + '</span></div>' +
    '</a>';
  }

  function canonicalReferenceKey(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) return '';
    try {
      const parsed = new URL(value);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'ref', 'src', 'from']
        .forEach((key) => parsed.searchParams.delete(key));
      parsed.hash = '';
      return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.replace(/\/$/, '').toLowerCase()}${parsed.search}`;
    } catch {
      return value.toLowerCase().replace(/^https?:\/\//, '').replace(/[#?].*$/, '').replace(/\/$/, '');
    }
  }

  function referenceTitleKey(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/[\s\u3000\p{P}\p{S}]+/gu, '');
  }

  function sourceLabelFromUrl(rawUrl) {
    try {
      const hostname = new URL(rawUrl).hostname.replace(/^www\./, '');
      if (hostname === 'news.google.com') return 'Google Newsで記事を見る';
      if (hostname === 'b.hatena.ne.jp') return 'はてなブックマーク人気';
      return hostname;
    } catch {
      return '元記事を見る';
    }
  }

  function selectRepresentativeSource(topic, { getPrimarySourceUrl, getPrimarySourceLabel } = {}) {
    const candidates = [
      topic?.primarySource,
      topic?.primaryLink,
      {
        url: topic?.canonicalUrl ?? topic?.sourceUrl ?? topic?.url ?? topic?.link,
        sourceName: topic?.sourceName ?? topic?.source,
        title: topic?.title,
      },
      ...(Array.isArray(topic?.sourceSignals) ? topic.sourceSignals : []),
      ...(Array.isArray(topic?.representativeArticles) ? topic.representativeArticles : []),
      {
        url: getPrimarySourceUrl?.(topic),
        sourceName: getPrimarySourceLabel?.(topic),
        title: topic?.title,
      },
    ];
    const seenUrls = new Set();
    const seenTitles = new Set();
    const uniqueSources = [];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const rawUrl = typeof candidate === 'string'
        ? candidate
        : candidate.canonicalUrl ?? candidate.url ?? candidate.href;
      const url = String(rawUrl ?? '').trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const title = typeof candidate === 'string' ? '' : candidate.title;
      const urlKey = canonicalReferenceKey(url);
      const titleKey = referenceTitleKey(title);
      if ((urlKey && seenUrls.has(urlKey)) || (titleKey && seenTitles.has(titleKey))) continue;
      if (urlKey) seenUrls.add(urlKey);
      if (titleKey) seenTitles.add(titleKey);

      const rawLabel = typeof candidate === 'string'
        ? ''
        : candidate.sourceName ?? candidate.source ?? candidate.label ?? candidate.publisher;
      const label = String(rawLabel ?? '').trim();
      uniqueSources.push({
        url,
        label: label && !/^(source|元記事を見る)$/i.test(label) ? label : sourceLabelFromUrl(url),
      });
    }
    return uniqueSources[0] ?? null;
  }

  function renderTopicClusterCard(topic, options = {}, deps = {}) {
    const {
      escapeHtml,
      getPrimarySourceUrl,
      getPrimarySourceLabel,
      categoryDisplayLabel,
      formatTopicDisplayTime,
      hotTopicScore,
      buildWhyHotLabel,
      buildImportantPoint,
      shortEventFromTitle,
      trimMetaText,
    } = deps;
    const sourceUrl = getPrimarySourceUrl(topic);
    const sourceLabel = getPrimarySourceLabel(topic);
    const representativeSource = selectRepresentativeSource(topic, { getPrimarySourceUrl, getPrimarySourceLabel });
    const thumbnail = topic.thumbnailUrl ? buildTrendCardThumb(topic.thumbnailUrl, deps) : '';
    const summary = buildTopicCardSummary(topic, { shortEventFromTitle, trimMetaText });
    const relatedSignals = collectRelatedSignals(topic, 3);
    const isCompact = Boolean(options.compact);
    const relatedHtml = relatedSignals.length
      ? '<div class="topic-related-strip"><div class="topic-related-head"><strong>参照記事</strong></div><div class="topic-related-row">' + relatedSignals.map((signal) => renderTopicRelatedLink(signal, { escapeHtml, trimMetaText })).join('') + '</div></div>'
      : '<div class="topic-related-strip topic-related-strip-empty"><strong>参照記事</strong><span>参照元の整理中です</span></div>';
    const scoreValue = options.scoreMode === 'hot'
      ? Math.round(hotTopicScore(topic))
      : options.scoreMode === 'buzz'
        ? Math.round(Number(topic.buzzScore ?? topic.hotScore ?? hotTopicScore(topic) ?? 0))
        : Math.round(Number(topic.personalScore ?? hotTopicScore(topic) ?? 0));
    const cardClasses = [
      'topic-cluster-card',
      'topic-cluster-shell',
      isCompact ? 'topic-cluster-card-compact topic-cluster-card-channel' : '',
      options.featured ? 'topic-cluster-card-featured' : '',
      topic.thumbnailUrl ? 'has-thumb' : 'trend-card-no-thumb',
    ].filter(Boolean).join(' ');

    if (options.featured) {
      return '<article class="must-read-card-shell">' +
          thumbnail +
          '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'TOPIC') + '</span><strong>' + escapeHtml(String(scoreValue)) + '</strong></div>' +
          '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(formatTopicDisplayTime(topic)) + '</time></div>' +
          '<h3>' + escapeHtml(topic.title ?? '話題') + '</h3>' +
          '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
          '<dl class="trend-reason-list">' +
            '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
            '<div><dt>なぜ重要？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
          '</dl>' +
          '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span></div>' +
          (representativeSource ? '<div class="trend-footer today-internet-reference"><span>参照元</span><a class="detail-link" href="' + escapeHtml(representativeSource.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(representativeSource.label) + ' ↗</a></div>' : '') +
        '</article>';
    }

    if (isCompact) {
      return '<article class="' + escapeHtml(cardClasses) + '">' +
        thumbnail +
        '<div class="topic-cluster-body topic-cluster-body-channel">' +
          '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'TOPIC') + '</span><strong>' + escapeHtml(String(scoreValue)) + '</strong></div>' +
          '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(formatTopicDisplayTime(topic)) + '</time></div>' +
          '<h3>' + escapeHtml(topic.title ?? '話題') + '</h3>' +
          '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
          '<dl class="trend-reason-list trend-reason-list-compact">' +
            '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
            '<div><dt>代表トピック</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
          '</dl>' +
          '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span></div>' +
          (sourceUrl ? '<div class="trend-footer"><span></span><a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a></div>' : '') +
        '</div>' +
      '</article>';
    }

    return '<article class="' + escapeHtml(cardClasses) + '">' +
      thumbnail +
      '<div class="topic-cluster-body">' +
        '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'TOPIC') + '</span><strong>' + escapeHtml(String(scoreValue)) + '</strong></div>' +
        '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(formatTopicDisplayTime(topic)) + '</time></div>' +
        '<h3>' + escapeHtml(topic.title ?? '話題') + '</h3>' +
        '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
        '<dl class="trend-reason-list">' +
          '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
          '<div><dt>なぜ重要？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
        '</dl>' +
        relatedHtml +
        '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span></div>' +
        (sourceUrl ? '<div class="trend-footer"><span></span><a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a></div>' : '') +
      '</div>' +
    '</article>';
  }

  function renderBriefCard(item, index, options = {}, deps = {}) {
    const { escapeHtml, formatBriefTimelineTime, sanitizeBriefSummaryText } = deps;
    const thumbnail = item.thumbnailUrl ? buildTrendCardThumb(item.thumbnailUrl, deps) : '';
    const sourceUrl = item.primaryLink?.url ?? '';
    const sourceLabel = item.primaryLink?.label ?? item.categoryLabel ?? '元記事';
    const summary = sanitizeBriefSummaryText(item.thirtySecondSummary ?? item.watchpoints ?? '重要ニュースを整理中です。');
    return '<article class="must-read-card-shell" style="animation-delay:' + (index * 60) + 'ms">' +
      thumbnail +
      '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'NEWS') + '</span><strong>' + escapeHtml(item.categoryLabel ?? 'その他') + '</strong></div>' +
      '<div class="trend-meta"><span>' + escapeHtml(item.categoryLabel ?? 'その他') + '</span><time>' + escapeHtml(item.publishedLabel ?? formatBriefTimelineTime(item.publishedAt)) + '</time></div>' +
      '<h3>' + escapeHtml(item.title ?? 'ニュース') + '</h3>' +
      '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
      '<div class="trend-footer"><span><strong>' + escapeHtml(sourceLabel) + '</strong></span>' + (sourceUrl ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">元記事を見る ↗</a>' : '<span class="detail-link">リンクなし</span>') + '</div>' +
    '</article>';
  }

  function renderPriorityCard(topic, index, options = {}, deps = {}) {
    const { escapeHtml, getPrimarySourceUrl, getPrimarySourceLabel, hotTopicScore, shortEventFromTitle, buildImportantPoint } = deps;
    const sourceUrl = getPrimarySourceUrl(topic);
    const sourceLabel = getPrimarySourceLabel(topic);
    const reasons = (topic.personalReasons ?? topic.hotReasons ?? []).slice(0, 3);
    const thumb = topic.thumbnailUrl ? buildTrendCardThumb(topic.thumbnailUrl, deps) : '';
    return '<article class="priority-card" style="animation-delay:' + (index * 55) + 'ms">' +
      thumb +
      '<div class="priority-card-top"><span>' + escapeHtml(options.badge) + '</span><strong>' + escapeHtml(String(Math.round(Number(topic.personalScore ?? hotTopicScore(topic) ?? 0)))) + '</strong></div>' +
      '<h3>' + escapeHtml(topic.title ?? 'ニュース') + '</h3>' +
      '<p>' + escapeHtml(topic.whatHappened ?? shortEventFromTitle(topic.title)) + '</p>' +
      '<dl class="trend-reason-list priority-reasons">' +
      '<div><dt>なぜ見る？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
      '</dl>' +
      '<div class="priority-chip-row">' + (sourceUrl ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a>' : '<span class="detail-link">リンクなし</span>') + '</div>' +
      '<div class="priority-chip-row">' + reasons.map((reason) => '<span>' + escapeHtml(reason) + '</span>').join('') + '</div>' +
      '</article>';
  }

  global.HomeRenderUtils = {
    buildTrendCardThumb,
    renderTrendReasonList,
    renderTopicClusterCard,
    renderBriefCard,
    renderPriorityCard,
  };
})(window);
