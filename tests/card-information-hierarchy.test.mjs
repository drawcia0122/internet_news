import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
await import('../home-render-utils.js');

const {
  buildTopicCardReasonRows,
  buildVerificationLabels,
  getPersonalPriorityLabel,
  isSubstantiallySameCopy,
  isVerificationOnlyText,
  renderPriorityCard,
  renderTopicClusterCard,
} = globalThis.HomeRenderUtils;

const renderDeps = {
  escapeHtml: (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  getPrimarySourceUrl: (topic) => topic.url ?? '',
  getPrimarySourceLabel: () => 'テスト媒体',
  categoryDisplayLabel: () => 'ゲーム',
  formatTopicDisplayTime: () => '1時間前',
  hotTopicScore: (topic) => Number(topic.hotScore ?? 0),
  buildWhyHotLabel: () => '新情報公開を受けて反応が増えています。',
  buildImportantPoint: () => '',
  shortEventFromTitle: (title) => title,
  trimMetaText: (value) => value,
  isWeakThumbnailUrl: () => false,
};

test('personal priority labels use relative rank without changing score order', () => {
  const scores = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
  const labels = scores.map((_, index) => getPersonalPriorityLabel(index, scores.length));
  assert.deepEqual(labels, [
    '最優先', '最優先',
    'おすすめ', 'おすすめ', 'おすすめ',
    '関連あり', '関連あり', '関連あり', '関連あり', '関連あり',
  ]);
  assert.equal(new Set(labels).size, 3);
  assert.deepEqual(scores, [...scores].sort((left, right) => right - left));
});

test('verification-only copy is excluded from importance', () => {
  const verification = '1媒体・1ドメインで確認されたトピックです。';
  assert.equal(isVerificationOnlyText(verification), true);
  assert.deepEqual(buildTopicCardReasonRows({
    summary: '新作ゲームの発売日が正式発表された。',
    whyHot: '発売開始を受けて反応が増えています。',
    importance: verification,
  }), [{ label: 'なぜ話題？', text: '発売開始を受けて反応が増えています。' }]);
});

test('coverage-only why-hot copy is treated as verification, not topical meaning', () => {
  assert.equal(isVerificationOnlyText('複数媒体で同じ話題が扱われています。'), true);
  assert.equal(isVerificationOnlyText('専門媒体や公式ソースが優先的に拾っています。'), true);
});

test('source counts are represented as compact verification metadata', () => {
  assert.deepEqual(buildVerificationLabels({
    clusterStats: { sourceCount: 3, uniqueDomainCount: 2, officialSourceCount: 1 },
  }), ['3媒体', '2ドメイン', '公式発表あり']);
});

test('meaningful importance remains visible and missing importance is not invented', () => {
  const rows = buildTopicCardReasonRows({
    summary: 'サービス料金が来月から改定される。',
    whyHot: '料金改定が正式発表されました。',
    importance: '利用料金が変わるため、継続利用の判断に影響します。',
  });
  assert.deepEqual(rows.map((row) => row.label), ['なぜ話題？', 'なぜ重要？']);
  assert.deepEqual(buildTopicCardReasonRows({
    summary: '新情報が公開された。',
    whyHot: '新情報が公開されました。',
    importance: '',
  }).map((row) => row.label), ['なぜ話題？']);
});

test('near-duplicate summary, why-hot and importance copy is not repeated', () => {
  const summary = '任天堂が新作ゲームの発売日と対応機種を正式に発表した。';
  const duplicate = '任天堂が新作ゲームの発売日と対応機種を正式発表しました。';
  assert.equal(isSubstantiallySameCopy(summary, duplicate), true);
  assert.deepEqual(buildTopicCardReasonRows({
    summary,
    whyHot: duplicate,
    importance: duplicate,
  }), []);
});

test('Today Internet card separates verification and omits verification-only importance', () => {
  const html = renderTopicClusterCard({
    title: '新作ゲームの発売日が決定',
    summary: '新作ゲームが来月発売されることが正式発表された。',
    whyHot: '発売日の正式発表を受けて反応が増えています。',
    importantPoint: '1媒体・1ドメインで確認されたトピックです。',
    clusterStats: { sourceCount: 1, uniqueDomainCount: 1, officialSourceCount: 0 },
    posts: '2',
    metricLabel: 'signals',
    url: 'https://example.com/article',
  }, { featured: true, badge: 'TODAY INTERNET', scoreMode: 'buzz' }, renderDeps);
  assert.match(html, /確認状況/);
  assert.match(html, /1媒体 · 1ドメイン/);
  assert.doesNotMatch(html, /なぜ重要？/);
  assert.doesNotMatch(html, /1媒体・1ドメインで確認されたトピック/);
});

test('Personal card shows a relative label instead of the saturated raw score', () => {
  const html = renderPriorityCard({
    title: '自分向けの新作ゲーム情報',
    whatHappened: '新作ゲームの詳しい内容が公開された。',
    importantPoint: '購入判断に影響する新情報です。',
    personalScore: 100,
    url: 'https://example.com/personal',
  }, 0, { badge: 'FOR YOU', totalCount: 10 }, renderDeps);
  assert.match(html, /最優先/);
  assert.doesNotMatch(html, />100</);
});
