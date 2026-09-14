import assert from 'node:assert/strict';
import test from 'node:test';

import '../news-summary-integrity.js';
process.env.TREND_FETCH_SKIP_MAIN_FOR_TESTS = '1';
const {
  dedupeNearDuplicateItems,
  findFetchedMetadata,
  mergeArchiveItems,
  registerFetchedMetadata,
  sanitizeFetchedMetadata,
} = await import('../scripts/fetch-trend-topics.mjs');

const {
  canonicalArticleUrl,
  isInvalidArticleSummary,
  sanitizeArticleSummaryCollection,
  sanitizeArticleSummaryFields,
} = globalThis.NewsSummaryIntegrity;

const unrelatedSummary = 'イオンモールで働く妻から「そっちは大丈夫？」と連絡があり、館内の状況を確認したという。';
const noResultSummary = '「『ウマ娘』新育成シナリオが登場」に一致する記事は見つかりませんでした。';

function article(overrides = {}) {
  return {
    id: overrides.id ?? 'article-1',
    title: overrides.title ?? '『ウマ娘』新育成シナリオが登場',
    sourceUrl: overrides.sourceUrl ?? 'https://example.com/articles/uma-1',
    sourceSignals: overrides.sourceSignals ?? [{
      title: overrides.title ?? '『ウマ娘』新育成シナリオが登場',
      url: overrides.sourceUrl ?? 'https://example.com/articles/uma-1',
      canonicalUrl: overrides.canonicalUrl ?? overrides.sourceUrl ?? 'https://example.com/articles/uma-1',
      publishedAt: '2026-07-30T00:00:00.000Z',
    }],
    category: 'games',
    categories: ['games'],
    score: overrides.score ?? 10,
    capturedAt: '2026-07-30T00:00:00.000Z',
    summary: overrides.summary ?? '',
    briefSummary: overrides.briefSummary ?? '',
    ...overrides,
  };
}

test('unrelated duplicate summary is not shown on different articles', () => {
  const items = [
    article({ summary: unrelatedSummary }),
    article({
      id: 'article-2',
      title: '『シュタインズ・ゲート』メタルうーぱ発売',
      sourceUrl: 'https://example.net/news/metal-upa',
      summary: unrelatedSummary,
    }),
  ];

  const result = sanitizeArticleSummaryCollection(items);
  assert.deepEqual(result.map((item) => item.summary), ['', '']);
});

test('failed item never inherits the previous article summary', () => {
  const previous = article({
    id: 'article-a',
    sourceUrl: 'https://example.com/articles/a',
    summary: '『ウマ娘』に新育成シナリオが追加され、新要素が公開された。',
  });
  const failed = article({
    id: 'article-b',
    title: '『シュタインズ・ゲート』メタルうーぱ発売',
    sourceUrl: 'https://example.com/articles/b',
    summary: '',
  });

  const result = mergeArchiveItems([previous], [failed]);
  assert.equal(result.length, 2);
  assert.equal(result.find((item) => item.id === 'article-b')?.summary, '');
});

test('metadata lookup requires a matching canonical URL', () => {
  const metadataByArticleKey = new Map();
  const metadata = {
    responseUrl: 'https://example.com/articles/uma-1',
    summary: '『ウマ娘』に新育成シナリオが追加され、新要素が公開された。',
  };
  registerFetchedMetadata(metadataByArticleKey, 'https://www.example.com/articles/uma-1?utm_source=rss', metadata);

  assert.equal(
    findFetchedMetadata(metadataByArticleKey, ['https://example.com/articles/uma-1'])?.summary,
    metadata.summary,
  );
  assert.equal(findFetchedMetadata(metadataByArticleKey, ['https://example.com/articles/different']), null);
  assert.equal(
    canonicalArticleUrl('https://www.example.com/articles/uma-1?utm_source=rss'),
    'example.com/articles/uma-1',
  );
});

test('sorting does not break article and summary association', () => {
  const items = [
    article({
      id: 'article-uma',
      sourceUrl: 'https://example.com/articles/uma',
      summary: '『ウマ娘』に新育成シナリオが追加され、新要素が公開された。',
    }),
    article({
      id: 'article-steins',
      title: '『シュタインズ・ゲート』メタルうーぱ発売',
      sourceUrl: 'https://example.com/articles/steins',
      summary: '『STEINS;GATE』のメタルうーぱを再現した新商品が発売される。',
    }),
  ];

  const expected = new Map(items.map((item) => [canonicalArticleUrl(item.sourceUrl), item.summary]));
  const result = sanitizeArticleSummaryCollection([...items].reverse());
  for (const item of result) assert.equal(item.summary, expected.get(canonicalArticleUrl(item.sourceUrl)));
});

test('deduplication does not replace a topic with an unrelated summary', () => {
  const good = article({
    id: 'topic-good',
    sourceUrl: 'https://example.com/articles/uma-primary',
    score: 20,
    summary: '『ウマ娘』に新育成シナリオが追加され、新要素が公開された。',
  });
  const duplicate = article({
    id: 'topic-secondary',
    title: good.title,
    sourceUrl: 'https://example.net/news/uma-secondary',
    score: 10,
    summary: unrelatedSummary,
  });

  const result = dedupeNearDuplicateItems([good, duplicate]);
  assert.equal(result.length, 1);
  assert.equal(result[0].summary, good.summary);
});

test('valid title-aligned summary remains visible', () => {
  const valid = article({
    summary: '『ウマ娘 プリティーダービー』に新育成シナリオが追加され、育成ウマ娘の新要素が公開された。',
  });
  assert.equal(sanitizeArticleSummaryFields(valid).summary, valid.summary);
});

test('article-title no-result message is rejected', () => {
  assert.equal(isInvalidArticleSummary(noResultSummary), true);
  assert.equal(sanitizeArticleSummaryFields(article({ summary: noResultSummary })).summary, '');
});

test('Japanese search no-result messages are rejected', () => {
  for (const value of [
    '検索結果はありません。',
    '該当する記事はありません。',
    '指定されたページは見つかりませんでした。',
  ]) {
    assert.equal(isInvalidArticleSummary(value), true, value);
  }
});

test('HTTP status error summaries are rejected', () => {
  for (const value of ['404 Not Found', 'HTTP 403 Forbidden', '500 Internal Server Error', '503 Service Unavailable']) {
    assert.equal(isInvalidArticleSummary(value), true, value);
  }
});

test('English access error summaries are rejected', () => {
  for (const value of ['Access Denied', 'Forbidden', 'Not Found', 'Internal Server Error']) {
    assert.equal(isInvalidArticleSummary(value), true, value);
  }
});

test('bot challenge and JavaScript-required summaries are rejected', () => {
  for (const value of [
    'Just a moment. Checking your browser before accessing the site.',
    'Please verify you are human by completing the captcha.',
    'CAPTCHA required',
    'Please enable JavaScript and cookies to continue.',
    '現在JavaScriptが無効になっています。JavaScriptを有効にしてください。',
    'This site uses cookies.',
    'Cookieの使用に同意してください。',
  ]) {
    assert.equal(isInvalidArticleSummary(value), true, value);
  }
});

test('metadata generation does not retain invalid summary candidates', () => {
  assert.equal(sanitizeFetchedMetadata({ summary: noResultSummary }, article().title), null);
  assert.equal(sanitizeFetchedMetadata({ briefSummary: 'Access Denied' }, article().title), null);
});

test('valid Japanese and English summaries remain visible', () => {
  const japanese = article({
    summary: '『ウマ娘』の新育成シナリオが公開され、新キャラクターと育成要素の詳細が発表された。',
  });
  const english = article({
    title: 'Valheim reaches 300,000 concurrent Steam players',
    summary: 'Valheim reached 300,000 concurrent Steam players after its full release renewed interest in the survival game.',
  });
  assert.equal(sanitizeArticleSummaryFields(japanese).summary, japanese.summary);
  assert.equal(sanitizeArticleSummaryFields(english).summary, english.summary);
});

test('quoted no-result wording inside a real article summary is preserved', () => {
  const valid = article({
    title: 'ゲーム検索サービスで検索結果が消える障害',
    summary: 'ゲーム検索サービスで「検索結果はありません」と表示される障害が発生し、運営会社が復旧対応を進めている。',
  });
  assert.equal(isInvalidArticleSummary(valid.summary), false);
  assert.equal(sanitizeArticleSummaryFields(valid).summary, valid.summary);
});

test('invalid summaries do not return through archive merging', () => {
  const archived = article({ summary: noResultSummary, briefSummary: noResultSummary });
  const result = sanitizeArticleSummaryCollection(mergeArchiveItems([archived], []));
  assert.equal(result[0].summary, '');
  assert.equal(result[0].briefSummary, '');
});

test('cached invalid summaries are removed when normalized for display', () => {
  const cached = JSON.parse(JSON.stringify(article({
    summary: 'Access Denied',
    briefSummary: '404 Not Found',
    sourceSignals: [{
      title: '『ウマ娘』新育成シナリオが登場',
      url: 'https://example.com/articles/uma-1',
      summary: 'Please enable JavaScript and cookies to continue.',
      briefSummary: 'CAPTCHA required',
    }],
  })));
  const normalized = sanitizeArticleSummaryFields(cached);
  assert.equal(normalized.summary, '');
  assert.equal(normalized.briefSummary, '');
  assert.equal(normalized.sourceSignals[0].summary, '');
  assert.equal(normalized.sourceSignals[0].briefSummary, '');
});
