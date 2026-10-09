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

## Production

GitHub Pages で公開する前提です。

- 本番 URL: `https://drawcia0122.github.io/internet_news/`
- `main` へ push すると `.github/workflows/deploy-pages.yml` から自動で再公開されます
- GitHub 側で最初に `Settings > Pages > Source` を `GitHub Actions` にしておく必要があります

## Refresh data

```bash
npm run refresh
```

Yahoo!ニュース RSS / NHK RSS / カテゴリ別 Google News RSS をもとにニュースを再取得し、`data/trend-topics.json` と `data/trend-topics-archive.json` を更新します。

イベント用のソースレジストリを更新したい場合は次を使います。

```bash
npm run refresh:events
```

これは `data/events.json` の `sourceCandidates` を更新し、イベント取得元の候補を広げます。ニュース取得ロジックとは分離されています。

10 分未満ならスキップしたい場合は次を使います。

```bash
npm run refresh:stale
```

## スレまとめ

トップの「スレまとめ」は、ゲーム・アニメ・雑談・ネタのまとめ記事を公開RSSから集める独立コーナーです。`npm run refresh:matome` で個別に更新でき、通常の `npm run refresh` にも組み込まれています。取得失敗時は各サイトの直近データを最大7日保持します。取得元・分類・時刻の意味は [docs/matome-sources.md](docs/matome-sources.md) を参照してください。

## Auto refresh

`.github/workflows/refresh-news.yml` は毎時 `:07` と `:37`（UTC）に更新を予約しています。GitHub Actions の schedule は混雑時に遅延・欠落することがあるため、30 分ごとの更新を保証するものではありません。差分が出たときだけ JSON をコミットします。

公開時の main 更新競合は `scripts/publish-refresh-data.mjs` が最大 3 回まで非 force push で再試行します。上流変更が明示的に許可された文書・静的 HTML/CSS だけなら取り込み、生成処理・設定・依存関係・共有 JavaScript・data・未知のファイルを含む場合は古い生成物を公開せず停止します。その場合は最新 main から Refresh News Data を再実行してください。生成済み JSON の競合を自動解決しません。この保護は公開競合対策であり、schedule の遅延自体は解決しません。

両公開 workflow は同じ `github-pages` concurrency group で直列実行し、実行中の更新をキャンセルしません。`queue: max`（GitHub 上限 100 件）で待機中の更新が後続の push に置き換えられるのを防ぎ、実行開始時の最新 main を checkout します。GitHub のキュー上限や schedule の欠落に対する保証はありません。外部サービスや追加の認証情報は不要です。設定変更前から実行中の workflow には遡及しないため、初回反映時は既存実行の終了後に最新 main の公開を確認してください。
