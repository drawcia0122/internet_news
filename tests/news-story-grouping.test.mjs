import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const context = { URL, URLSearchParams, window: {}, document: { createElement() { return {
  textContent: '', get innerHTML() { return escape(this.textContent); },
  set innerHTML(value) { this.value = value.replaceAll('&amp;', '&').replaceAll('&quot;', '"'); },
}; } } };
vm.runInNewContext(fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8'), context);
const { groupNewsStories: group, prepareNewsListItems: prepare, renderStorySources, newsStoryArticleCount, formatNewsStoryCount, getNewsArticleSource } = context.window.TopicClientUtils;

function article(id, title = '任天堂が新作ゲームの追加コンテンツ配信日を正式発表', extra = {}) {
  return { id, title, sourceUrl: `https://media-${id}.example.com/news/${id}?utm_source=rss`, sourceName: `媒体${id}`,
    publishedAt: '2026-10-01T12:00:00Z', category: 'games', categories: ['games'],
    summary: `${id}の独自の記事要約です。`, thumbnailUrl: `https://media-${id}.example.com/image.jpg`, ...extra };
}
const movieA = 'ウメハラ選手に長期密着したドキュメンタリー映画「ReBEAST 〜ウメハラ、1/60秒に賭けた人生〜」，2027年1月29日に公開。ティザー予告も解禁';
const movieB = '伝説のプロゲーマー・梅原大吾が映画化！初の単独ドキュメンタリー「ReBEAST～ウメハラ、1/60秒に賭けた人生～」2027年1月29日より上映';

function staysSeparate(left, right) {
  assert.equal(group([article('a', left), article('b', right)]).length, 2, `${left}\n${right}`);
}

test('precise typographic headline matches retain every original article and source URL', () => {
  const left = article('a', '任天堂が「どうぶつの森」の新作ゲームを正式発表');
  const right = article('b', '【媒体b】任天堂が『どうぶつの森』の新作ゲームを正式発表した');
  const originals = JSON.stringify([left, right]);
  const result = group([left, right]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, left.id);
  assert.equal(result[0].summary, left.summary);
  assert.equal(result[0].thumbnailUrl, left.thumbnailUrl);
  assert.equal(result[0].sourceSignals, left.sourceSignals);
  assert.equal(result[0].storyArticles[0], left);
  assert.equal(result[0].storyArticles[1], right);
  assert.equal(JSON.stringify([left, right]), originals);
  assert.equal(newsStoryArticleCount(result), 2);
  assert.equal(newsStoryArticleCount(group(result)), 2);
  assert.equal(group(result).length, 1);
  assert.equal(formatNewsStoryCount(result), '1 話題・2記事');
  const html = renderStorySources(result[0]);
  assert.match(html, /<details[^>]*><summary>同じニュースの記事 2件（2媒体）<\/summary>/);
  assert.ok(html.includes(escape(left.sourceUrl)) && html.includes(escape(right.sourceUrl)));
  assert.match(html, /rel="noopener noreferrer"/);
});

test('a quoted work plus matching absolute release date/action supports genuinely different publisher headlines', () => {
  const result = group([article('a', movieA), article('b', movieB)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].storyArticles.length, 2);
  assert.equal(group([article('a', movieA, { publishedAt: null }), article('b', movieB, { publishedAt: null })]).length, 1);
});

test('franchise, product, sequel, action, date, numbers and people are not story evidence on their own', () => {
  const pairs = [
    ['『ポケットモンスター』新作ゲームの配信日を正式発表', '『ポケットモンスター』新作アニメの放送日を正式発表'],
    ['任天堂「Switch 2」国内販売価格を5万9980円に改定', '任天堂「Switch 2」国内販売価格を6万9980円に改定'],
    ['最新ゲーム「モンスターの冒険2」の大型アップデートを発表', '最新ゲーム「モンスターの冒険3」の大型アップデートを発表'],
    ['新作ゲームの発売日が10月2日に決定、予約受付開始', '新作ゲームの発売日が10月3日に決定、予約受付開始'],
    ['新作ゲームの発売日が10月2日に決定、予約受付開始', '新作ゲームの発売日が2月10日に決定、予約受付開始'],
    ['山田太郎さんが新作ゲームの映画で主演を務めると発表', '山田次郎さんが新作ゲームの映画で主演を務めると発表'],
    ['任天堂がソニーを買収する契約を正式に発表しました', 'ソニーが任天堂を買収する契約を正式に発表しました'],
    ['新作ゲーム「星の冒険ファンタジー」発売日を正式発表', '新作ゲーム「星の冒険ファンタジー」発売延期を正式発表'],
    ['任天堂が新作ゲームの追加コンテンツVer1.5を発表', '任天堂が新作ゲームの追加コンテンツVer15を発表'],
    ['新作ゲームの同時接続者数が1,500人を突破と正式発表', '新作ゲームの同時接続者数が1500人を突破と正式発表'],
    ['ディストピアRPG『Limbus Company』Steam同接15万人超え、記録更新迫る勢いに', 'ディストピアRPG『Limbus Company』Steam同接15万人超えで記録更新迫る勢い―見下ろし探索含む10章の（下）実装で。グッズがアニメイトで10月3日発売へ'],
  ];
  for (const pair of pairs) staysSeparate(...pair);
});

test('release rule refuses a different date, action, named role, work, or numeric fact', () => {
  staysSeparate(movieA, movieB.replace('29日', '30日'));
  staysSeparate(movieA, movieB.replace('上映', '配信'));
  staysSeparate(movieA, movieB.replace('ReBEAST', 'ReBEAST2'));
  staysSeparate(movieA, movieB + '、観客100人限定');
  const title = '監督・山田太郎の映画「星の冒険ファンタジー物語」が2027年1月29日に公開';
  staysSeparate(title, title.replace('山田太郎', '山田次郎'));
  const suffixRole = title.replace('監督・山田太郎', '山田太郎主演');
  staysSeparate(suffixRole, suffixRole.replace('山田太郎', '山田次郎'));
  staysSeparate(movieA, movieB.replace('上映', '再上映'));
  staysSeparate(movieA, movieB + '、観客1人限定');
});

test('missing publication dates do not borrow capture times except for the explicit absolute-release evidence', () => {
  const left = article('a', undefined, { publishedAt: null, capturedAt: '2026-10-01T12:00:00Z' });
  const right = article('b', undefined, { publishedAt: null, capturedAt: left.capturedAt });
  assert.equal(group([left, right]).length, 2);
  assert.equal(group([article('a', movieA.replace('2027年', ''), { publishedAt: null }), article('b', movieB.replace('2027年', ''), { publishedAt: null })]).length, 2);
  staysSeparate('今日のゲームニュースまとめと今週発売する新作一覧', '今日のゲームニュースまとめと今週発売する新作一覧');
});

test('complete-link clustering prevents temporal chains and missing-date bridges', () => {
  for (const order of [[0, 1, 2], [1, 0, 2], [2, 1, 0]]) {
    const articles = [0, 1, 2].map((index) => article(String(index), undefined, { publishedAt: new Date(Date.UTC(2026, 9, 1) + index * 18 * 3600000).toISOString() }));
    const result = group(order.map((index) => articles[index]));
    assert.equal(result.length, 2);
    assert.equal(newsStoryArticleCount(result), 3);
  }
  const articles = [article('a', movieA), article('b', movieB, { publishedAt: null }), article('c', movieA, { publishedAt: '2026-10-04T12:00:00Z' })];
  assert.equal(group(articles).length, 2);
});

test('complete-link evidence prevents a verbose headline from bridging different near matches', () => {
  const base = '映画「星空の冒険ファンタジー物語」が2027年1月29日に公開。';
  const left = '心温まる家族と仲間の冒険が描かれる田舎の小さな村から旅立つ少年少女たちの成長を見守る';
  const right = '巨大なロボットと宇宙戦争の物語が展開する都市の空を飛ぶ戦士が世界を救うため勇敢に戦う';
  const articles = [base + left, base + left + '。' + right, base + right].map((title, index) => article(String(index), title));
  assert.equal(group(articles.slice(0, 2)).length, 1);
  assert.equal(group(articles.slice(1)).length, 1);
  assert.equal(group([articles[0], articles[2]]).length, 2);
  assert.equal(group([articles[1], articles[0], articles[2]]).length, 2);
});

test('same-source repeated URLs do not inflate media/article counts; distinct source articles remain accessible', () => {
  const left = article('a');
  const trackerDuplicate = article('b', undefined, { sourceUrl: left.sourceUrl.replace('utm_source=rss', 'utm_source=other') });
  const repeatedPublisher = article('c', undefined, { sourceUrl: 'https://media-a.example.com/news/second' });
  const otherPublisher = article('d');
  const result = group([left, trackerDuplicate, repeatedPublisher, otherPublisher]);
  assert.equal(result.length, 1);
  assert.equal(newsStoryArticleCount(result), 3);
  assert.match(renderStorySources(result[0]), /3件（2媒体）/);
});

test('article dedupe ignores generated-ID/title/other-signal overlap and preserves case-sensitive paths and query IDs', () => {
  const left = article('same', undefined, { sourceUrl: 'https://publisher.example.com/news/A?id=1' });
  const right = article('same', undefined, { sourceUrl: 'https://publisher.example.com/news/a?id=2', sourceSignals: [{ url: left.sourceUrl }] });
  assert.equal(prepare([left, right]).length, 2);
  const loser = { ...right, summary: '別の記事の要約です。', thumbnailUrl: 'https://example.com/other.jpg' };
  assert.equal(prepare([left, loser])[0].summary, left.summary);
  assert.equal(prepare([left, loser])[0].thumbnailUrl, left.thumbnailUrl);
});

test('homepage/search URLs cannot replace exact article destinations or select unrelated grouped signals', () => {
  const root = article('a', undefined, { sourceUrl: 'https://publisher.example.com/?utm_source=rss' });
  assert.equal(getNewsArticleSource(root), null);
  const matching = { url: 'https://publisher.example.com/articles/correct', title: root.title, sourceName: '正しい媒体' };
  const unrelated = { url: 'https://publisher.example.com/articles/unrelated', title: 'まったく別の出来事について紹介するニュース' };
  const resolved = getNewsArticleSource({ ...root, sourceSignals: [unrelated, matching] });
  assert.equal(resolved.url, matching.url);
  assert.equal(resolved.label, matching.sourceName);
  assert.equal(getNewsArticleSource({ ...root, sourceSignals: [unrelated, { url: matching.url }] }), null);
  for (const url of ['https://publisher.example.com/', 'https://publisher.example.com/search?q=game', 'https://news.google.com/search?q=game', 'https://publisher.example.com/news', 'https://publisher.example.com/photo.pdf']) {
    assert.equal(getNewsArticleSource({ ...root, sourceUrl: url }), null);
  }
  assert.ok(getNewsArticleSource({ ...root, sourceUrl: 'https://publisher.example.com/?p=123' }));
});

test('unsafe URL schemes, credentials, malformed URLs and HTML never create active alternative links', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.example.com/a', 'https://trusted.example.com@evil.example.com/a', 'https://', 'https://example.com/\\evil', 'https://example.com/\nattack']) {
    assert.equal(getNewsArticleSource(article('bad', undefined, { sourceUrl: url })), null);
  }
  const left = article('a', 'ゲーム「<img src=x onerror=alert(1)>」の発売日を正式発表', { sourceName: '<script>alert(1)</script>' });
  const right = article('b', left.title);
  const html = renderStorySources(group([left, right])[0]);
  assert.ok(!html.includes('<script>') && !html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('large collections stay intact and grouping remains deterministic and non-mutating', () => {
  const items = Array.from({ length: 1500 }, (_, index) => article(String(index), `任天堂が第${index}回の新作ゲーム紹介番組を正式発表`));
  assert.equal(group(items).length, 1500);
  assert.equal(formatNewsStoryCount(group(items)), '1500 話題');
  assert.equal(JSON.stringify(group(items)), JSON.stringify(group(items)));
});
