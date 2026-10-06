import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const NOW = '2026-10-06T04:00:00Z';
const SOURCE = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const TOPIC_UTILS = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const articles = JSON.parse(fs.readFileSync(new URL('./fixtures/game-action-articles.json', import.meta.url)));

function harness(now = NOW) {
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new NativeDate(now).getTime(); }
  }
  const elements = new Map();
  const node = () => ({
    innerHTML: '', listeners: {}, focusedTitleIndex: null,
    insertAdjacentHTML(position, html) { this.innerHTML += html; },
    querySelector() { return { addEventListener: (type, listener) => { this.listeners[type] = listener; }, focus: () => { this.focusedTitleIndex = 'more-button'; } }; },
    querySelectorAll() {
      return Array.from({ length: (this.innerHTML.match(/game-news-row-main/g) || []).length }, (_, index) => ({
        focus: () => { this.focusedTitleIndex = index; },
      }));
    },
  });
  const context = { console, URL, Intl, Date: FixedDate, document: {
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, node()); return elements.get(selector); },
    createElement() { return { set innerHTML(value) { this.value = value; }, get innerHTML() { return this.textContent ?? this.value; }, value: '' }; },
  } };
  context.window = context;
  context.HomeDataUtils = {};
  vm.createContext(context);
  vm.runInContext(TOPIC_UTILS, context);
  let script = SOURCE.replace(/  init\(\)\.catch\(\(error\) => \{[\s\S]*?\n  \}\);/, '');
  const names = [...script.matchAll(/^  (?:async )?function (\w+)\(/gm)].map((match) => match[1]);
  script = script.replace(/\}\)\(\);\s*$/, `Object.assign(window, { ${names.join(',')}, setState: (state) => { dashboardState = state; newsVisibleCount = 8; } });})();`);
  vm.runInContext(script, context);
  return { c: context, elements };
}

function topic(title, extra = {}) {
  return {
    id: title, title, categories: ['games'], publishedAt: '2026-10-06T02:00:00Z',
    sourceSignals: [{ title, url: 'https://example.com/article', publishedAt: '2026-10-06T02:00:00Z' }],
    ...extra,
  };
}
const state = (c, topics) => c.buildDashboardState(topics, [], { generatedAt: NOW });
const example = (suffix) => articles.find((article) => article.sourceUrl.includes(suffix));
const plain = (value) => JSON.parse(JSON.stringify(value));
const hasArticle = (dashboard, article) => dashboard.newsItems.some((item) => item.key === article.id)
  || dashboard.steamStories.some((item) => item.topicId === article.id);

test('actual roundup never lends Getting Over It’s 123 yen to Outlast Trials', () => {
  const { c } = harness();
  const article = example('471699');
  const dashboard = state(c, [article]);
  assert.equal(dashboard.steamSales.length, 0);
  assert.equal(dashboard.gameHubs.length, 0);
  assert.ok(hasArticle(dashboard, article));
  assert.equal((dashboard.steamStories[0] || dashboard.newsItems[0]).title, article.title);
});

test('actual ARC offer is upcoming trial, never Epic ownership or a fabricated deadline', () => {
  const { c, elements } = harness();
  const article = example('173117');
  const dashboard = state(c, [article]);
  const offer = dashboard.freeGames[0];
  assert.equal(offer.title, 'ARC Raiders');
  assert.equal(offer.offerType, 'trial');
  assert.equal(offer.status, 'upcoming');
  assert.equal(offer.startsAt.toISOString(), '2026-10-08T09:00:00.000Z');
  assert.equal(offer.endsAt, null, 'four days does not establish an exact expiry');
  assert.equal(offer.store, null, 'retail availability is not free-play eligibility');
  assert.equal(dashboard.importantItems.length, 0);
  c.setState(dashboard);
  c.renderFreeGames();
  c.renderHero();
  const markup = [...elements.values()].map((element) => element.innerHTML).join('');
  assert.match(markup, /開始予定/);
  assert.match(markup, /18:00 JST/);
  assert.doesNotMatch(markup, /今すぐ受け取|受け取る ↗|Epic Games で配布中/);
});

test('actual Cinnamon merchandise and ARC adaptation remain news, not release/update actions', () => {
  const { c } = harness();
  for (const suffix of ['188814', '173208']) {
    const article = example(suffix);
    const dashboard = state(c, [article]);
    assert.equal(dashboard.releasesToday.length, 0);
    assert.equal(dashboard.majorUpdates.length, 0);
    assert.equal(dashboard.gameHubs.length, 0);
    assert.ok(hasArticle(dashboard, article));
    assert.equal((dashboard.newsItems[0] || dashboard.steamStories[0]).title, article.title);
  }
});

test('offer types distinguish ownership, trial, membership and free-to-play', () => {
  const { c } = harness();
  const cases = [
    ['無料配布', 'ownership'], ['期間限定無料プレイ', 'trial'], ['無料トライアル', 'trial'],
    ['体験版配信', 'trial'], ['基本プレイ無料', 'free-to-play'],
    ['Prime Gamingで無料配布、会員向けSteamキー', 'subscription'],
    ['Game Pass加入者向け無料プレイ', 'subscription'],
    ['PlayStation Plus会員限定で無料配布', 'subscription'],
  ];
  for (const [claim, type] of cases) {
    const [offer] = c.buildFreeGames([topic(`『Example Quest』${claim}、10月6日から10月10日まで`)]);
    assert.equal(offer?.offerType, type, claim);
  }
  assert.equal(c.buildFreeGames([topic('『Example Quest』期間限定無料、詳細は後日')]).length, 0);
  assert.equal(c.buildFreeGames([topic('『Example Quest』有料体験版を発売')]).length, 0);
});

test('participating stores come from the trial claim, not unrelated retail availability', () => {
  const { c } = harness();
  const article = topic('『Example Quest』Steam・PS5・Xboxで無料プレイ、10月8日18:00から10月12日17:00まで', {
    briefSummary: '『Example Quest』はSteamとEpic Gamesストア向けに発売中です。',
  });
  const [offer] = c.buildFreeGames([article]);
  assert.equal(offer.store, 'Steam / PS5 / Xbox');
  assert.equal(offer.endsAt.toISOString(), '2026-10-12T08:00:00.000Z');
  assert.equal(offer.offerType, 'trial');
});

test('precise start/end boundaries are half-open and no ended offer is urgent', () => {
  const article = topic('『Example Quest』Steamで50%オフの500円、10月6日18:00から10月7日18:00まで', { publishedAt: '2026-10-05T02:00:00Z' });
  for (const [now, status, urgent] of [
    ['2026-10-06T08:59:59Z', 'upcoming', 0],
    ['2026-10-06T09:00:00Z', 'active', 1],
    ['2026-10-07T08:59:59Z', 'active', 1],
    ['2026-10-07T09:00:00Z', 'ended', 0],
    ['2026-10-08T09:00:00Z', 'ended', 0],
  ]) {
    const { c } = harness(now);
    const dashboard = state(c, [article]);
    assert.equal(dashboard.steamSales[0].status, status, now);
    assert.equal(dashboard.totals.endingSoonSaleCount, urgent, now);
    assert.equal(dashboard.importantItems.length, urgent, now);
  }
});

test('day-only dates display no invented noon and include the named final day in JST', () => {
  const article = topic('『Example Quest』Steam無料配布、10月5日から10月6日まで', { publishedAt: '2026-10-04T02:00:00Z' });
  const { c } = harness('2026-10-06T14:59:59Z');
  const offer = c.buildFreeGames([article])[0];
  assert.equal(offer.status, 'active');
  assert.equal(offer.endsAtLabel, '2026/10/6');
  assert.equal(offer.endsAt.toISOString(), '2026-10-06T15:00:00.000Z');
  assert.equal(harness('2026-10-06T15:00:00Z').c.buildFreeGames([article])[0].status, 'ended');
});

test('PM, AM, colon, kanji minutes and midnight are parsed without timezone dependence', () => {
  const { c } = harness();
  for (const [time, expected] of [
    ['午後6時', '09:00'], ['午前6時', '21:00'], ['午後12時', '03:00'],
    ['午前12時', '15:00'], ['午後6時30分', '09:30'], ['午後6時半', '09:30'], ['18：45', '09:45'],
  ]) {
    const date = c.parseJapaneseDates(`10月6日${time}まで`, NOW)[0].date;
    assert.equal(date.toISOString().slice(11, 16), expected, time);
  }
});

test('explicit/relative years and Dec-Jan ranges do not roll expired April into next year', () => {
  const { c } = harness();
  assert.equal(c.parseJapaneseDates('2027年10月6日発売', NOW)[0].year, 2027);
  for (const [prefix, year] of [['来年', 2027], ['再来年', 2028], ['今年', 2026], ['昨年', 2025], ['去年', 2025]]) {
    assert.equal(c.parseJapaneseDates(`${prefix}10月6日発売`, NOW)[0].year, year);
  }
  assert.equal(c.parseJapaneseDates('4月1日まで', NOW)[0].year, 2026);
  assert.equal(c.parseJapaneseDates('1月2日発売', '2026-12-30T02:00:00Z')[0].year, 2027);
  assert.equal(c.parseJapaneseDates('12月31日まで', '2027-01-02T02:00:00Z')[0].year, 2026);
  const period = c.extractActionPeriod('2026年12月31日18時から1月2日17時まで', '2026-10-01T02:00:00Z');
  assert.equal(period.startsAt.toISOString(), '2026-12-31T09:00:00.000Z');
  assert.equal(period.endsAt.toISOString(), '2027-01-02T08:00:00.000Z');
});

test('invalid dates, conflicting periods and unanchored years stay unknown', () => {
  const { c } = harness();
  for (const text of ['2026年9月31日', '2026年2月29日', '2026年13月1日', '10月6日25:00', '10月6日午後18時']) {
    assert.equal(c.parseJapaneseDates(text, NOW).length, 0, text);
  }
  assert.equal(c.parseJapaneseDates('10月6日発売', null).length, 0);
  assert.equal(c.extractActionPeriod('10月6日から10月5日まで', NOW).status, 'unknown');
  assert.equal(c.extractActionPeriod('10月6日から10月8日まで。10月7日から10月8日まで', NOW).status, 'unknown');
});

test('recent publication and a lone future deadline cannot establish current availability', () => {
  const { c } = harness();
  for (const title of ['『Example Quest』Steamで50%オフの500円', '『Example Quest』Steamで50%オフの500円、10月8日まで']) {
    const dashboard = state(c, [topic(title)]);
    assert.equal(dashboard.steamSales[0].status, 'unknown');
    assert.equal(dashboard.importantItems.length, 0);
  }
  assert.equal(c.buildSteamSales([topic('『Example Quest』Steamで50%オフ、10月6日から10月8日まで', { publishedAt: '2026-10-07T02:00:00Z' })]).length, 0);
});

test('dates for future release, announcement, preorder, demos and patches are not today’s game release', () => {
  const { c } = harness();
  for (const title of [
    '『Example Quest』Steam版2027年10月6日発売', '『Example Quest』Steam版来年10月6日発売',
    '『Example Quest』Steam版10月6日に発売日発表。発売は10月8日',
    '『Example Quest』Steam版10月6日発売を発表、発売日は10月8日',
    '『Example Quest』Steam版10月6日に予約開始。10月8日発売',
    '『Example Quest』Steam体験版10月6日配信開始',
    '『Example Quest』Steamアップデート10月6日配信開始',
    '『Example Quest』Steam版発売中。10月6日は開発者誕生日',
    '『Example Quest』Steam版10月6日発売予定だったが延期',
  ]) assert.equal(c.buildTodayReleases([topic(title)]).length, 0, title);
});

test('today’s later release time is explicitly scheduled, while relative today uses article date', () => {
  const { c } = harness();
  const later = topic('『Example Quest』Steam版10月6日午後6時発売');
  const dashboard = state(c, [later]);
  assert.equal(dashboard.releasesToday[0].status, 'upcoming');
  assert.match(dashboard.importantItems[0].title, /発売予定/);
  assert.equal(c.buildTodayReleases([topic('『Example Quest』Steam版は本日発売', { publishedAt: '2026-10-01T02:00:00Z' })]).length, 0);
  assert.equal(c.buildTodayReleases([topic('『Example Quest』Steam版は本日発売')]).length, 1);
});

test('update effective date, not publication, incidental mention or announcement, controls current update', () => {
  const { c } = harness();
  for (const article of [
    topic('『Example Quest』大型アップデート'),
    topic('『Example Quest』大型アップデート10月8日配信予定'),
    topic('『Example Quest』10月4日に大型アップデート配信、10月6日に詳細を発表'),
    topic('『Example Quest』大型アップデート。10月6日に発表、実装は10月8日予定'),
    topic('『Example Quest』大型アップデート10月6日配信予定だったが延期'),
    topic('『Example Quest』大型アップデートを本日配信', { publishedAt: '2026-10-01T02:00:00Z' }),
  ]) assert.equal(c.buildMajorUpdates([article]).length, 0, article.title);
  assert.equal(c.buildMajorUpdates([topic('『Example Quest』10月6日に大型アップデート配信')]).length, 1);
  assert.equal(c.buildMajorUpdates([topic('『Example Quest』大型アップデートを本日配信')]).length, 1);
});

test('prices and discounts require a single payable amount with unambiguous role', () => {
  const { c } = harness();
  assert.equal(c.extractPrice('50%オフの1,000円'), '1,000');
  assert.equal(c.extractPrice('無料配布0円'), '0');
  for (const text of ['通常価格2,000円', '参考価格2,000円', '定価2,000円', '500円引き', '500円分', '2,000円から1,000円へ', '500円または800円']) assert.equal(c.extractPrice(text), null, text);
  assert.equal(c.extractDiscount('最大90%オフ'), null);
  assert.equal(c.extractDiscount('50%オフ・別版90%オフ'), null);
  assert.equal(c.extractDiscount('150%オフ'), null);
  const dashboard = state(c, [topic('『Example Quest』Steamで50%オフ、通常価格2,000円、10月6日から10月8日まで')]);
  assert.equal(dashboard.steamSales[0].price, null);
});

test('a second game or same-game trial cannot donate its deadline to a sale', () => {
  const { c } = harness();
  for (const title of [
    '『Example Quest』Steamで50%オフの500円。『Other Quest』は100円、10月8日まで',
    '『Example Quest』Steamで50%オフ。『Example Quest』の無料トライアルは10月6日から10月8日まで',
  ]) assert.equal(c.buildSteamSales([topic(title)]).length, 0);
  const article = topic('『Example Quest』Steamで50%オフの500円', { summary: '『Example Quest』の無料トライアルは10月6日から10月8日まで。' });
  assert.equal(c.buildSteamSales([article])[0].status, 'unknown');
});

test('article identity rejects sibling claims, source URLs and meaningful-query mismatches', () => {
  const { c } = harness();
  const title = '『Example Quest』Steamで50%オフの500円';
  const original = topic(title, { sourceUrl: 'https://example.com/watch?v=ONE', sourceSignals: [
    { title, url: 'https://example.com/watch?v=TWO', summary: '『Example Quest』Steamで10月6日から10月8日までセール' },
  ] });
  assert.equal(c.buildSteamSales([original]).length, 0);
  const sibling = topic('『Example Quest』発売情報', { sourceSignals: [{ title: '『Other Quest』Steamで90%オフの123円', url: 'https://example.com/other' }], relatedKeywords: ['無料配布', 'Steam', '大型アップデート'] });
  assert.equal(c.buildFreeGames([sibling]).length, 0);
  assert.equal(c.buildSteamSales([sibling]).length, 0);
  const alias = topic(title, { sourceUrl: 'https://example.com/article?utm_source=test', sourceSignals: [{ title, url: 'https://example.com/article' }] });
  assert.equal(c.buildSteamSales([alias])[0].url, 'https://example.com/article');
});

test('game names preserve punctuation and never fall through to a quoted feature/opinion', () => {
  const { c } = harness();
  assert.equal(c.pickPrimaryGameTitle(topic('『Warhammer 40,000: Space Marine 2』Steamで50%オフ')), 'Warhammer 40,000: Space Marine 2');
  assert.equal(c.pickPrimaryGameTitle(topic('基本プレイ無料『NTE』に「遊園地」を実装')), null);
  assert.equal(c.pickPrimaryGameTitle(topic('『Mermade』体験版レポ/「説教おじさん」へのインタビュー')), null);
  assert.notEqual(c.canonicalizeGameName('モンハン'), 'Monster Hunter Wilds');
});

test('load-more retains all demoted article titles without excluding hidden capped actions', () => {
  const { c, elements } = harness();
  const topics = Array.from({ length: 30 }, (_, index) => topic(`ゲーム関連ニュース${index}`, { id: `news-${index}`, score: 100 - index }));
  const dashboard = state(c, topics);
  assert.equal(dashboard.newsItems.length, 30);
  c.setState(dashboard);
  c.renderNewsList();
  const element = elements.get('#news-list');
  assert.equal((element.innerHTML.match(/game-news-row-main/g) || []).length, 8);
  element.listeners.click();
  assert.equal((element.innerHTML.match(/game-news-row-main/g) || []).length, 16);
  assert.equal(element.focusedTitleIndex, 8, 'focus moves to the first newly revealed article');
  element.listeners.click();
  assert.equal(element.focusedTitleIndex, 16, 'repeated expansion advances focus to the next new article');
  element.listeners.click();
  assert.equal(element.focusedTitleIndex, 24, 'the final expansion preserves focus after removing the button');
  assert.equal((element.innerHTML.match(/game-news-row-main/g) || []).length, 30);
  assert.doesNotMatch(element.innerHTML, /data-game-more-news/);
  const offers = Array.from({ length: 16 }, (_, index) => topic(`『Example Quest ${index}』Steamで50%オフの500円`, { id: `offer-${index}` }));
  const full = state(c, offers);
  const visible = new Set([
    ...full.importantItems.slice(0, 4).map((item) => item.topicId),
    ...full.gameHubs.slice(0, 6).flatMap((item) => item.topicIds),
    ...full.steamSales.slice(0, 4).map((item) => item.topicId),
    ...full.steamStories.slice(0, 6).map((item) => item.topicId),
    ...full.newsItems.map((item) => item.key),
  ]);
  for (const offer of offers) assert.ok(visible.has(offer.id), offer.id);
});

test('same-title hubs do not mix a different article’s price/date/source', () => {
  const { c } = harness();
  const sale = topic('『Example Quest』Steamで50%オフの500円', { id: 'sale', score: 1 });
  const other = topic('『Example Quest』新映像公開', { id: 'other', score: 999, sourceSignals: [{ title: '『Example Quest』新映像公開', url: 'https://example.com/other' }] });
  const dashboard = state(c, [sale, other]);
  const hub = dashboard.gameHubs[0];
  assert.equal(hub.url, 'https://example.com/other');
  assert.doesNotMatch(JSON.stringify(hub), /500円/);
  assert.deepEqual(plain(hub.topicIds), ['other']);
});

test('JST day decisions remain stable under UTC, Tokyo and Los Angeles environments', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = timezone;
      const { c } = harness('2026-10-05T16:00:00Z');
      assert.equal(c.daysBetween(new Date('2026-10-05T16:00:00Z'), new Date('2026-10-06T02:00:00Z')), 0, timezone);
      assert.equal(c.formatActionDate(c.parseJapaneseDates('10月6日午後6時', NOW)[0]), '2026/10/6 18:00 JST', timezone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('article-local membership/trial restrictions downgrade an apparently unconditional headline', () => {
  const { c } = harness();
  const title = '『Example Quest』Steamで無料配布、10月6日から10月10日まで';
  for (const [summary, expected] of [
    ['『Example Quest』はPrime Gaming会員限定でSteamキーを無料提供する', 'subscription'],
    ['Prime Gaming会員限定でSteamキーを無料提供する', 'subscription'],
    ['『Example Quest』は製品版を期間限定で遊べる無料トライアル。期間終了後は購入が必要', 'trial'],
    ['製品版を期間限定で遊べる無料トライアル。期間終了後は購入が必要', 'trial'],
  ]) {
    const dashboard = state(c, [topic(title, { summary })]);
    assert.equal(dashboard.freeGames[0].offerType, expected, summary);
    assert.ok(dashboard.importantItems.every((item) => !/無料配布期間/.test(item.title)), summary);
  }
});

test('summary withdrawal and announcement-only update never create an active action', () => {
  const { c } = harness();
  const title = '『Example Quest』Steamで50%オフの500円、10月5日から10月7日まで';
  assert.equal(c.buildSteamSales([topic(title, { summary: '『Example Quest』のセールは中止されました' })]).length, 0);
  assert.equal(c.buildSteamSales([topic(title, { summary: 'セールは中止されました' })]).length, 0);
  assert.equal(c.buildMajorUpdates([topic('『Example Quest』Steamで10月6日大型アップデートの配信を発表。実装は10月8日')]).length, 0);
  for (const title of ['『星のカービィ』チョコエッグ第2弾が10月6日発売', '映画「8番出口」10月6日配信開始']) {
    assert.equal(c.buildTodayReleases([topic(title)]).length, 0, title);
    assert.ok(hasArticle(state(c, [topic(title)]), topic(title)), title);
  }
});

test('publication labels use JST rather than browser local day or archive capture time', () => {
  const { c } = harness();
  const article = topic('ゲーム関連ニュース', { publishedAt: '2026-10-05T16:00:00Z', capturedAt: NOW });
  assert.equal(c.buildNewsFeed([article], new Set())[0].publishedLabel, '10/6 01:00 JST');
});


test('ambiguous general quotes cannot turn a feature into a game label or image alt', () => {
  const { c, elements } = harness();
  const title = '「敵対要素」を完全排除したサバイバルシム「アンダー・キャノピーズ」，早期アクセス版を2026年10月23日にSteamで公開';
  const article = topic(title, { thumbnailUrl: 'https://example.com/image.jpg' });
  const dashboard = state(c, [article]);
  assert.equal(c.pickPrimaryGameTitle(article), null);
  assert.equal(dashboard.gameHubs.length, 0);
  assert.equal(dashboard.steamStories.length, 0);
  assert.equal(dashboard.newsItems[0].title, title);
  assert.equal(dashboard.newsItems[0].gameTitle, 'ゲームニュース');
  c.setState(dashboard);
  c.renderNewsList();
  assert.doesNotMatch(elements.get('#news-list').innerHTML, />敵対要素<|alt="敵対要素/);
  assert.equal(c.pickPrimaryGameTitle(topic('「敵対要素」を完全排除したサバイバルゲームがSteamで発売')), null);
  assert.equal(c.pickPrimaryGameTitle(topic('「Example Quest」Steamで50%オフ')), 'Example Quest');
  const priceHeadline = '財布が寂しくても大丈夫。「1000円未満」で買えるSteamおすすめゲーム5選';
  assert.equal(c.pickPrimaryGameTitle(topic(priceHeadline)), null);
  assert.equal(state(c, [topic(priceHeadline)]).newsItems[0].gameTitle, 'ゲームニュース');
  const [story] = c.buildSteamStories([topic('『Example Quest』Steam版の新情報')], new Set());
  assert.equal(story.gameTitle, 'Steam記事');
});


function officialOffer(overrides = {}) {
  const article = example('471699');
  return {
    id: 'steam:1304930', appId: 1304930, title: 'The Outlast Trials', edition: 'base-game', store: 'Steam',
    storeUrl: 'https://store.steampowered.com/app/1304930/?cc=jp&l=japanese',
    regularPrice: 4500, salePrice: 450, discountPercent: 90, currency: 'JPY', country: 'JP',
    checkedAt: '2026-10-06T03:00:00Z', freshUntil: '2026-10-06T09:00:00Z', priceValidUntil: '2026-10-07T03:00:00Z',
    articleUrls: [article.sourceUrl], priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=1304930&cc=jp&l=japanese' },
    status: 'verified', ...overrides,
  };
}

test('official per-app prices split a roundup without giving Outlast another game’s 123 yen', () => {
  const { c, elements } = harness();
  const article = example('471699');
  const getting = officialOffer({ appId: 240720, id: 'steam:240720', title: 'Getting Over It with Bennett Foddy', regularPrice: 820, salePrice: 123, discountPercent: 85,
    storeUrl: 'https://store.steampowered.com/app/240720/', priceSource: { kind: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=240720&cc=jp' } });
  const dashboard = c.buildDashboardState([article], [], { generatedAt: NOW, saleOffers: [officialOffer(), getting] });
  assert.equal(dashboard.steamSales.length, 2);
  assert.equal(dashboard.steamSales[0].title, 'The Outlast Trials');
  assert.equal(dashboard.steamSales[0].regularPrice, 4500);
  assert.equal(dashboard.steamSales[0].salePrice, 450);
  assert.equal(dashboard.steamSales[1].salePrice, 123);
  assert.equal(dashboard.steamSales[0].thumbnailUrl, null, 'roundup artwork never impersonates the specific game');
  c.setState(dashboard); c.renderSteamSales();
  const html = elements.get('#steam-sale-list').innerHTML;
  assert.match(html, /通常価格 4,500円、割引後 450円/);
  assert.match(html, /通常価格 820円、割引後 123円/);
  assert.match(html, /90% OFF/);
  assert.match(html, /2026\/10\/6 12:00 JST/);
  assert.match(html, /Steam日本ストア · PC版 · 本編 · 税込/);
  assert.doesNotMatch(html, /価格は記事内で確認/);
});

test('official offer identity and Japan currency are mandatory', () => {
  const { c } = harness();
  const topics = [example('471699')];
  for (const invalid of [
    { currency: 'USD' }, { country: 'US' }, { edition: 'deluxe' }, { appId: '1304930' },
    { priceSource: { url: 'https://store.steampowered.com/api/appdetails?appids=240720&cc=jp' } },
    { priceSource: { url: 'https://store.steampowered.com.evil.test/api/appdetails?appids=1304930&cc=jp' } },
    { storeUrl: 'https://store.steampowered.com/app/240720/' },
    { articleUrls: ['https://automaton-media.com/different-article'] }, { regularPrice: 8000 },
    { regularPrice: null }, { salePrice: 4500 }, { salePrice: 0 }, { discountPercent: 101 },
  ]) assert.equal(c.verifiedSaleCard(officialOffer(invalid), topics), null, JSON.stringify(invalid));
});

test('official price snapshots expire, retain their own checked timestamp and never become false urgency', () => {
  const topics = [example('471699')];
  const { c } = harness();
  for (const checkedAt of ['2026-10-06T04:00:01Z', '2026-10-05T04:00:00Z', 'invalid']) {
    assert.equal(c.verifiedSaleCard(officialOffer({ checkedAt }), topics), null, checkedAt);
  }
  const stale = c.verifiedSaleCard(officialOffer({ checkedAt: '2026-10-05T22:00:00Z', priceValidUntil: '2026-10-06T22:00:00Z', status: 'stale' }), topics);
  assert.equal(stale.status, 'unknown');
  assert.equal(stale.checkedAt, '2026-10-05T22:00:00Z');
  assert.match(c.renderSalePrice(stale), /前回の割引価格/);
  const ended = c.verifiedSaleCard(officialOffer({ endsAt: NOW }), topics);
  assert.equal(ended.status, 'ended');
  assert.match(c.renderSalePrice(ended), /前回の割引価格/);
  const futureTopic = { ...topics[0], publishedAt: '2026-10-07T04:00:00Z' };
  assert.equal(c.verifiedSaleCard(officialOffer(), [futureTopic]), null);
});

test('explicit roles support price pairs but rounded discounts never reconstruct original prices', () => {
  const { c } = harness();
  for (const text of ['通常価格2,000円 → 1,000円、50%オフ', '通常価格2,000円、セール価格1,000円、50%オフ', '通常価格2,000円→割引後1,000円、10月6日から10月8日まで']) {
    assert.deepEqual(plain(c.extractPricePair(text)), { regularPrice: 2000, salePrice: 1000 }, text);
  }
  assert.deepEqual(plain(c.extractPricePair('定価820円、特価123円、85%OFF')), { regularPrice: 820, salePrice: 123 });
  for (const text of ['85%OFFの123円', '通常価格2,000円、セール価格1,000円、80%OFF', '通常版の通常価格2,000円、デラックス版が特価1,000円', '本編の通常価格2,000円、DLC特価1,000円']) {
    assert.deepEqual(plain(c.extractPricePair(text)), { regularPrice: null, salePrice: null }, text);
  }
  const sale = c.buildSteamSales([topic('『Example Quest』Steamで85%オフの123円')])[0];
  assert.equal(sale.regularPrice, null);
  assert.equal(sale.salePrice, 123);
  assert.match(c.renderSalePrice(sale), /通常価格 未確認、割引後 123円/);
});
