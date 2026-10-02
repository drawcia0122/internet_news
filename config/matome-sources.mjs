// Publisher-declared public feeds only. These items never enter the news ranking.
export const MATOME_SOURCES = Object.freeze([
  {
    id: 'gamehard',
    name: 'ゲーハー黙示録',
    siteUrl: 'https://aatyu.livedoor.blog/',
    feedUrl: 'https://aatyu.livedoor.blog/index.rdf',
    aboutUrl: 'https://aatyu.livedoor.blog/archives/1774393.html',
    defaultCategory: 'game',
  },
  {
    id: 'jumpmatome',
    name: 'ジャンプまとめ速報',
    siteUrl: 'https://jumpmatome2ch.biz/',
    feedUrl: 'https://jumpmatome2ch.biz/feed',
    aboutUrl: 'https://jumpmatome2ch.biz/archives/17',
    defaultCategory: 'anime',
  },
  {
    id: 'nwknews',
    name: '哲学ニュースnwk',
    siteUrl: 'https://nwknews.jp/',
    feedUrl: 'https://nwknews.jp/index.rdf',
    defaultCategory: 'chat',
    // Mixed publisher: admit discussion/humour categories, not its news feed.
    allowedCategory: /哲学|科学|自然|知識|雑学|食べ物|料理|生活|雑談|議論|吹いた|爆笑|コピペ|お笑い|おもしろ|ゲーム|アニメ|漫画/u,
  },
]);

export const MATOME_RETENTION_DAYS = 7;
export const MATOME_MAX_PER_SOURCE = 60;
