# Current state

Last verified: 2026-08-20 at `origin/main` `0df05adf6409256dc3fff3c9072c340845752613`.

## Architecture

- 単一repositoryにClassicとNextがある。ClassicはrootのHTML/CSS/JavaScript、Nextは`next/`配下。
- bundlerを使わない静的サイトで、生成済みJSONをbrowserが読む。Node.jsのES modulesが収集・正規化・data生成を担う。
- RSS定義は`config/rss-feeds.mjs`、主要収集は`lib/trend-aggregator.mjs`、生成の中心は`scripts/fetch-trend-topics.mjs`。
- `scripts/refresh-data.mjs`がtrend、events、adult、Today Internet、thumbnail repairを順次実行する。
- Nextは`next/data-loader.js`と`next/home-mapper.js`を介して、Classicと同じ`data/` JSONの一部を読み、独自UIへ変換する。

## Important data flows

1. RSS feeds -> fetch / parse / retry -> topic aggregation。
2. metadata enrichment、article identity確認、dedupe、summary integrity、thumbnail検証。
3. `trend-topics*`、`news-archive.json`、`home-topics.json`、`home-news*.json`、`daily-brief.json`等を生成。
4. events / adult dataを生成後、最新trend dataからToday Internetを生成し、最後にthumbnail repair。
5. Classicトップと`news.html`の通常ニュースは`home-news.json`と`home-news-page-*.json`を共通母集団にする。trend dataはToday Internet、急上昇、ランキング等に残る。

## Constraints

- `docs/DEVELOPMENT_RULES.md`と`docs/00_COMPANY.md`を優先する。Classicは安定性を重視し、Nextは`next/`に分離する。
- 生成dataのschemaや時刻の意味、RSS fallback、stage順序を理由なく変更しない。data JSONを手作業で修復しない。
- article metadataはcanonical article identityが一致する対象にだけ適用する。
- 現行decisionを変える場合は、根拠・検証・後継memoryを残す。

## Build, test, and deployment

- `package.json`にbundled production buildはない。local serverは`npm run dev`、data生成は`npm run refresh`。
- repository内の自動testは`tests/news-summary-integrity.test.mjs`。変更したJS/MJSの`node --check`と`git diff --check`も使う。
- `main` pushで`.github/workflows/deploy-pages.yml`がGitHub Pagesへdeployする。
- `.github/workflows/refresh-news.yml`は毎時`:07`と`:37`にdataを更新し、差分がある場合だけ`data/`を自動commitしてPagesへdeployする。

## Recent major work

- PR #14でClassic通常ニュースの母集団統一、旧adult portal / matome専用tab撤去、Today Internet参照リンク整理、summary identity防御がmainへ入った。
- PR #11〜#13でNextの実data loader / mapperとTrending semantic coherenceが導入された。Nextは引き続きshared JSONのconsumerである。

## Active concerns

- README、`CONTEXT.md`、一部設計メモには現行UIやカテゴリと一致しない記述がある。製品判断時は現行コード・tests・Git履歴で確認する（`observations/documentation-drift.md`）。
- 外部RSS / HTML / image取得は部分障害が前提。既存fallbackとdiagnosticsを保持する。
- test coverageは限定的で、UIやdata pipeline変更では対象に応じたcharacterization / fixture / browser確認が必要。
