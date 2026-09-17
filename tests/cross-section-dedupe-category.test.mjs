import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
globalThis.document = {
  createElement() {
    return {
      textContent: '',
      get innerHTML() { return this.textContent; },
      set innerHTML(value) { this.textContent = value; },
    };
  },
};

await import('../article-category-quality.js');
await import('../news-summary-integrity.js');
await import('../shared-topic-utils.js');
await import('../home-topic-selection-utils.js');
await import('../home-brief-utils.js');
const { collectTrendTopics } = await import('../lib/trend-aggregator.mjs');

const {
  articleIdentityKeys,
  createArticleIdentitySet,
  hasArticleIdentityOverlap,
} = globalThis.TopicClientUtils;
const {
  calculatePersonalFit,
  selectPersonalNews,
} = globalThis.HomeTopicSelectionUtils;
const { selectTodayNews } = globalThis.HomeBriefUtils;
const { hasPokemonBrandSignal } = globalThis.ArticleCategoryQuality;

function topic({ id, title, url, sourceName = '媒体', sourceTags = [], categories = ['games'] }) {
  return {
    id,
    title,
    summary: `${title}について正式な発表があり、詳しい内容が公開されました。`,
    category: categories[0],
    categories,
    categoryLabels: ['ゲーム'],
    personalScore: 80,
    score: 80,
    hotScore: 80,
    posts: '1',
    publishedAt: '2026-09-17T01:00:00Z',
    sourceSignals: [{ title, url, canonicalUrl: url, sourceName, sourceGroup: 'games', sourceTags }],
  };
}

test('canonical URL and tracking-only URL variants share article identity', () => {
  const original = topic({ id: 'upper', title: '任天堂が新作ゲームを正式発表', url: 'https://www.example.com/news/1/?utm_source=x#top' });
  const duplicate = topic({ id: 'lower', title: '任天堂が新作ゲームを正式発表', url: 'http://example.com/news/1?ref=home' });
  const identities = createArticleIdentitySet([original]);
  assert.equal(hasArticleIdentityOverlap(duplicate, identities), true);
});

test('same title on clearly different source URLs is not over-deduped', () => {
  const first = topic({ id: 'first', title: 'ゲーム大型アップデートの詳細を発表', url: 'https://media-a.example/articles/1' });
  const second = topic({ id: 'second', title: 'ゲーム大型アップデートの詳細を発表', url: 'https://media-b.example/articles/2' });
  assert.equal(hasArticleIdentityOverlap(second, createArticleIdentitySet([first])), false);
  assert.notDeepEqual(articleIdentityKeys(first), articleIdentityKeys(second));
});

test('same title on the same source but a different publication day remains distinct', () => {
  const first = topic({ id: 'first-day', title: 'ゲーム大型アップデートの詳細を発表', url: 'https://media.example/articles/1' });
  const second = {
    ...topic({ id: 'second-day', title: 'ゲーム大型アップデートの詳細を発表', url: 'https://media.example/articles/2' }),
    publishedAt: '2026-09-18T01:00:00Z',
  };
  assert.equal(hasArticleIdentityOverlap(second, createArticleIdentitySet([first])), false);
});

test('personal news excludes upper-section identity and replenishes from next candidate', () => {
  const upper = topic({ id: 'upper', title: '任天堂が新作ゲームを正式発表', url: 'https://example.com/news/1' });
  const duplicate = topic({ id: 'duplicate', title: '任天堂が新作ゲームを正式発表', url: 'https://example.com/news/1?utm_medium=rss' });
  const next = topic({ id: 'next', title: 'Steamで新作ゲームの配信日が決定', url: 'https://example.com/news/2' });
  const selected = selectPersonalNews([duplicate, next], {
    excludedArticleKeys: createArticleIdentitySet([upper]),
    limit: 1,
  });
  assert.deepEqual(selected.map((item) => item.id), ['next']);
});

test('today news respects identities already used by higher sections', () => {
  const excluded = {
    id: 'upper',
    title: '政府が新制度を正式発表',
    primaryLink: { url: 'https://example.com/politics/1' },
  };
  const duplicate = {
    id: 'lower',
    title: '政府が新制度を正式発表',
    categoryLabel: '政治',
    thirtySecondSummary: '政府が新しい制度を発表した。',
    primaryLink: { url: 'https://example.com/politics/1?from=top' },
  };
  const next = {
    id: 'next',
    title: '国際会議で新たな合意',
    categoryLabel: '国際',
    thirtySecondSummary: '各国が新たな合意を発表した。',
    primaryLink: { url: 'https://example.com/world/2' },
  };
  assert.deepEqual(selectTodayNews([duplicate, next], {
    excludedArticleKeys: createArticleIdentitySet([excluded]),
    limit: 1,
  }).map((item) => item.id), ['next']);
});

test('Pokémon classification requires article-level brand evidence', () => {
  const positives = [
    'ポケモン新作ゲームが発表',
    'Pokémon GOで新イベント開催',
    'ポケットモンスターの新グッズ',
  ];
  positives.forEach((title, index) => {
    assert.equal(hasPokemonBrandSignal(topic({ id: `positive-${index}`, title, url: `https://example.com/${index}` })), true);
  });

  const negatives = [
    'MELTY BLOODの新作ゲームが発表',
    'デジタルモンスターの新作情報',
    'デジモンの新作フィギュア',
    'モンスターハンターの大型更新',
  ];
  negatives.forEach((title, index) => {
    const item = topic({
      id: `negative-${index}`,
      title,
      url: `https://example.com/negative-${index}`,
      sourceTags: ['games', 'pokemon'],
    });
    assert.equal(hasPokemonBrandSignal(item), false);
    assert.equal(calculatePersonalFit(item).reasons.includes('ポケモン'), false);
    assert.equal(calculatePersonalFit(item).reasons.includes('ゲーム'), true);
  });
});

test('normal game and anime categories remain eligible', () => {
  const game = topic({ id: 'game', title: '任天堂が新作ゲームを発表', url: 'https://example.com/game' });
  const anime = topic({ id: 'anime', title: '新作アニメの放送日が決定', url: 'https://example.com/anime', categories: ['anime'] });
  assert.ok(calculatePersonalFit(game).score > 0);
  assert.ok(calculatePersonalFit(anime).score > 0);
});

test('RSS generation does not persist a broad Pokémon feed tag without article evidence', async () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title>デジタルモンスターの新作ゲームを正式発表</title>
    <link>https://example.com/digital-monster</link>
    <description>ゲームの発売日と対応機種が正式に発表された。</description>
    <pubDate>Thu, 17 Sep 2026 01:00:00 GMT</pubDate>
  </item></channel></rss>`;
  const result = await collectTrendTopics({
    fetchImpl: async () => new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
    feeds: [{
      id: 'broad-games-feed',
      source: 'ゲーム媒体',
      sourceName: 'ゲーム媒体',
      url: 'https://example.com/rss',
      categoryHints: ['games'],
      sourceGroup: 'games',
      sourceTags: ['games', 'pokemon'],
    }],
    now: new Date('2026-09-17T02:00:00Z'),
    retryDelaysMs: [],
  });
  assert.deepEqual(result.items[0].sourceSignals[0].sourceTags, ['games']);
  assert.equal(result.items[0].categories.includes('games'), true);
});
