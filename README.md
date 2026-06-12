# INTERNET NEWS

雑多なネットニュースを、カテゴリ別に見やすく整理して追える Web メディアの MVP です。

## Scope

- Yahoo!ニュース RSS / NHK RSS / カテゴリ別 Google News RSS から主要ニュースを取得
- 総合 / テック / 経済 / 政治 / エンタメ / 漫画 / 本 / スポーツ / ネットカルチャー / 2chまとめ系 / ネタ / 犯罪・事件 / アダルト系 / 国際 に分類
- トップで直近 24 時間の重要トピック、全件ページ、アーカイブで最大 14 日分を表示
- 画像を取得できる話題はサムネイルを表示し、取得できない話題はスコア表示に戻す

## Start

```bash
npm run dev
```

`http://localhost:8000` を開きます。

## Refresh data

```bash
npm run refresh
```

Yahoo!ニュース RSS / NHK RSS / カテゴリ別 Google News RSS をもとにニュースを再取得し、`data/trend-topics.json` と `data/trend-topics-archive.json` を更新します。

10 分未満ならスキップしたい場合は次を使います。

```bash
npm run refresh:stale
```

## Auto refresh

`.github/workflows/refresh-news.yml` で 10 分ごとに自動更新します。前回の `generatedAt` から 10 分未満なら `scripts/refresh-trend-topics-if-stale.mjs` がスキップし、差分が出たときだけ JSON をコミットします。
