export const RSS_FEEDS = [
  {
    source: "Yahoo!ニュース",
    sourceName: "Yahoo!ニュース",
    url: "https://news.yahoo.co.jp/rss/topics/top-picks.xml",
  },
  {
    source: "NHK RSS",
    sourceName: "NHK",
    url: "https://www3.nhk.or.jp/rss/news/cat0.xml",
  },
  {
    source: "Google News",
    sourceName: "Google News / テック",
    url: buildGoogleNewsRssUrl("テクノロジー OR AI OR 生成AI OR 半導体 OR OpenAI"),
    categoryHint: "tech",
  },
  {
    source: "Google News",
    sourceName: "Google News / 経済",
    url: buildGoogleNewsRssUrl("経済 OR 企業 OR 決算 OR 投資 OR 株"),
    categoryHint: "business",
  },
  {
    source: "Google News",
    sourceName: "Google News / 政治",
    url: buildGoogleNewsRssUrl("政治 OR 国会 OR 首相 OR 選挙 OR 与党 OR 野党"),
    categoryHint: "politics",
  },
  {
    source: "Google News",
    sourceName: "Google News / エンタメ",
    url: buildGoogleNewsRssUrl("エンタメ OR 映画 OR 音楽 OR 芸能 OR アニメ"),
    categoryHint: "entertainment",
  },
  {
    source: "Google News",
    sourceName: "Google News / ゲーム",
    url: buildGoogleNewsRssUrl("ゲーム OR 任天堂 OR PS5 OR Switch OR Steam OR eスポーツ"),
    categoryHint: "games",
  },
  {
    source: "Google News",
    sourceName: "Google News / 漫画",
    url: buildGoogleNewsRssUrl("漫画 OR マンガ OR コミック OR 週刊少年ジャンプ OR 単行本"),
    categoryHint: "manga",
  },
  {
    source: "Google News",
    sourceName: "Google News / 本",
    url: buildGoogleNewsRssUrl("本 OR 書籍 OR 文庫 OR 小説 OR 出版"),
    categoryHint: "books",
  },
  {
    source: "Google News",
    sourceName: "Google News / スポーツ",
    url: buildGoogleNewsRssUrl("スポーツ OR 野球 OR サッカー OR 試合 OR 大会"),
    categoryHint: "sports",
  },
  {
    source: "Google News",
    sourceName: "Google News / ネットカルチャー",
    url: buildGoogleNewsRssUrl("ネットカルチャー OR SNS OR バズ OR 炎上 OR 5ch OR 2ch"),
    categoryHint: "net-culture",
  },
  {
    source: "Google News",
    sourceName: "Google News / SNS話題",
    url: buildGoogleNewsRssUrl("X OR Twitter OR Bluesky OR Reddit OR SNSで話題 OR バズ投稿"),
    categoryHint: "sns",
  },
  {
    source: "Google News",
    sourceName: "Google News / 2chまとめ",
    url: buildGoogleNewsRssUrl("2ch OR 5ch OR なんJ OR まとめサイト OR まとめブログ OR オタコム OR はちま OR 痛いニュース OR 暇人速報 OR アルファルファモザイク"),
    categoryHint: "matome",
  },
  {
    source: "Google News",
    sourceName: "Google News / 犯罪・事件",
    url: buildGoogleNewsRssUrl("事件 OR 逮捕 OR 送検 OR 殺人 OR 強盗 OR 詐欺"),
    categoryHint: "crime",
  },
  {
    source: "Google News",
    sourceName: "Google News / アダルト",
    url: buildGoogleNewsRssUrl("グラビア OR セクシー女優 OR AV女優 OR アダルト"),
    categoryHint: "adult",
  },
  {
    source: "Google News",
    sourceName: "Google News / FANZA・DLsite",
    url: buildGoogleNewsRssUrl("FANZA OR DLsite OR DMM OR 同人 セール OR アダルト キャンペーン OR 割引"),
    categoryHint: "adult",
  },
  {
    source: "Google News",
    sourceName: "Google News / 国際",
    url: buildGoogleNewsRssUrl("国際 OR 海外 OR 外交 OR 戦況 OR 米国"),
    categoryHint: "world",
  },
];

function buildGoogleNewsRssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}
