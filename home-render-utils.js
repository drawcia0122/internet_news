(function attachHomeRenderUtils(global) {
  function buildTrendCardThumb(thumbnailUrl, { escapeHtml, isWeakThumbnailUrl } = {}) {
    if (!thumbnailUrl || isWeakThumbnailUrl?.(thumbnailUrl)) return '';
    return '<div class="trend-thumb-wrap"><img class="trend-thumb" src="' + escapeHtml(thumbnailUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>';
  }

  function renderTrendReasonList(trend, { escapeHtml, shortEventFromTitle, buildWhyHotLabel } = {}) {
    const audience = Array.isArray(trend.targetAudience) && trend.targetAudience.length ? trend.targetAudience.slice(0, 3).join(' / ') : '関心のある人';
    return '<dl class="trend-reason-list">' +
      '<div><dt>何が起きた？</dt><dd>' + escapeHtml(trend.whatHappened ?? shortEventFromTitle(trend.title)) + '</dd></div>' +
      '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(trend.whyHot ?? buildWhyHotLabel(trend)) + '</dd></div>' +
      '<div><dt>誰に関係ある？</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
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

  function renderTopicClusterCard(topic, options = {}, deps = {}) {
    const {
      escapeHtml,
      getPrimarySourceUrl,
      getPrimarySourceLabel,
      categoryDisplayLabel,
      hotTopicScore,
      buildWhyHotLabel,
      buildImportantPoint,
      shortEventFromTitle,
      trimMetaText,
    } = deps;
    const href = './topic.html?id=' + encodeURIComponent(topic.id ?? '');
    const sourceUrl = getPrimarySourceUrl(topic);
    const sourceLabel = getPrimarySourceLabel(topic);
    const thumbnail = topic.thumbnailUrl ? buildTrendCardThumb(topic.thumbnailUrl, deps) : '';
    const audience = Array.isArray(topic.targetAudience) && topic.targetAudience.length ? topic.targetAudience.slice(0, 3).join(' / ') : '関連分野を追う人';
    const summary = buildTopicCardSummary(topic, { shortEventFromTitle, trimMetaText });
    const relatedSignals = collectRelatedSignals(topic, 3);
    const isCompact = Boolean(options.compact);
    const relatedHtml = relatedSignals.length
      ? '<div class="topic-related-strip"><div class="topic-related-head"><strong>参照記事</strong></div><div class="topic-related-row">' + relatedSignals.map((signal) => renderTopicRelatedLink(signal, { escapeHtml, trimMetaText })).join('') + '</div></div>'
      : '<div class="topic-related-strip topic-related-strip-empty"><strong>参照記事</strong><span>参照元の整理中です</span></div>';
    const scoreValue = options.scoreMode === 'hot'
      ? Math.round(hotTopicScore(topic))
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
          '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(topic.time ?? '直近') + '</time></div>' +
          '<h3>' + escapeHtml(topic.title ?? '話題') + '</h3>' +
          '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
          '<dl class="trend-reason-list">' +
            '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
            '<div><dt>なぜ重要？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
            '<div><dt>誰に関係ある？</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
          '</dl>' +
          relatedHtml +
          '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span><a class="detail-link" href="' + escapeHtml(href) + '">もっと見る →</a></div>' +
          (sourceUrl ? '<div class="trend-footer"><span></span><a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a></div>' : '') +
        '</article>';
    }

    if (isCompact) {
      return '<article class="' + escapeHtml(cardClasses) + '">' +
        thumbnail +
        '<div class="topic-cluster-body topic-cluster-body-channel">' +
          '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'TOPIC') + '</span><strong>' + escapeHtml(String(scoreValue)) + '</strong></div>' +
          '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(topic.time ?? '直近') + '</time></div>' +
          '<h3><a class="topic-card-primary-link" href="' + escapeHtml(href) + '">' + escapeHtml(topic.title ?? '話題') + '</a></h3>' +
          '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
          '<dl class="trend-reason-list trend-reason-list-compact">' +
            '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
            '<div><dt>代表トピック</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
          '</dl>' +
          '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span><a class="detail-link" href="' + escapeHtml(href) + '">もっと見る →</a></div>' +
          (sourceUrl ? '<div class="trend-footer"><span></span><a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a></div>' : '') +
        '</div>' +
      '</article>';
    }

    return '<article class="' + escapeHtml(cardClasses) + '">' +
      thumbnail +
      '<div class="topic-cluster-body">' +
        '<div class="topic-cluster-top"><span>' + escapeHtml(options.badge ?? 'TOPIC') + '</span><strong>' + escapeHtml(String(scoreValue)) + '</strong></div>' +
        '<div class="trend-meta"><span>' + escapeHtml(categoryDisplayLabel(topic)) + '</span><time>' + escapeHtml(topic.time ?? '直近') + '</time></div>' +
        '<h3><a class="topic-card-primary-link" href="' + escapeHtml(href) + '">' + escapeHtml(topic.title ?? '話題') + '</a></h3>' +
        '<p class="topic-cluster-summary">' + escapeHtml(summary) + '</p>' +
        '<dl class="trend-reason-list">' +
          '<div><dt>なぜ話題？</dt><dd>' + escapeHtml(topic.whyHot ?? buildWhyHotLabel(topic)) + '</dd></div>' +
          '<div><dt>なぜ重要？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
          '<div><dt>誰に関係ある？</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
        '</dl>' +
        relatedHtml +
        '<div class="trend-footer"><span><strong>' + escapeHtml(String(topic.posts ?? 1)) + '</strong> ' + escapeHtml(topic.metricLabel ?? 'source') + '</span><a class="detail-link" href="' + escapeHtml(href) + '">もっと見る →</a></div>' +
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
    const href = './topic.html?id=' + encodeURIComponent(topic.id ?? '');
    const sourceUrl = getPrimarySourceUrl(topic);
    const sourceLabel = getPrimarySourceLabel(topic);
    const reasons = (topic.personalReasons ?? topic.hotReasons ?? []).slice(0, 3);
    const audience = Array.isArray(topic.targetAudience) && topic.targetAudience.length ? topic.targetAudience.slice(0, 3).join(' / ') : '関心のある人';
    const thumb = topic.thumbnailUrl ? buildTrendCardThumb(topic.thumbnailUrl, deps) : '';
    return '<article class="priority-card" style="animation-delay:' + (index * 55) + 'ms">' +
      thumb +
      '<div class="priority-card-top"><span>' + escapeHtml(options.badge) + '</span><strong>' + escapeHtml(String(Math.round(Number(topic.personalScore ?? hotTopicScore(topic) ?? 0)))) + '</strong></div>' +
      '<h3><a class="topic-card-primary-link" href="' + escapeHtml(href) + '">' + escapeHtml(topic.title ?? 'ニュース') + '</a></h3>' +
      '<p>' + escapeHtml(topic.whatHappened ?? shortEventFromTitle(topic.title)) + '</p>' +
      '<dl class="trend-reason-list priority-reasons">' +
      '<div><dt>なぜ見る？</dt><dd>' + escapeHtml(topic.importantPoint ?? buildImportantPoint(topic)) + '</dd></div>' +
      '<div><dt>関係ある人</dt><dd>' + escapeHtml(audience) + '</dd></div>' +
      '</dl>' +
      '<div class="priority-chip-row">' + (sourceUrl ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(sourceLabel) + ' ↗</a>' : '<a class="detail-link" href="' + escapeHtml(href) + '">詳しく見る →</a>') + '</div>' +
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
