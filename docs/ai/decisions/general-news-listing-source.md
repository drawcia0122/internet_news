# Classic general news listings share one data population

- Status: active
- Created: 2026-08-20
- Last verified: 2026-08-20
- Source task: PR #14

## Decision

Classicトップの通常ニュースと`news.html`の全件ページは、`data/home-news.json`と連続する`data/home-news-page-*.json`を同じ順序で使う。`trend-topics.json`と`trend-topics-browse.json`を通常ニュース一覧の別母集団に戻さない。

trend dataはToday Internet、急上昇、ランキング、topic表示等の用途に残す。旧`trends.html`は`news.html`への互換転送として維持する。

## Reason

別々の母集団・重複排除・カテゴリ判定を持つと、トップと全件で内容や順序がずれる。共通生成payloadと`shared-topic-utils.js`により、同じ条件の表示を揃える。

## Alternatives considered

- 全件ページだけtrend archiveを読む: 同じ名称のニュース一覧が異なる結果になるため廃止。
- browser側で二つの母集団を都度統合: identityと順序の責務が表示側へ漏れるため採用しない。

## Evidence

- `scripts/fetch-trend-topics.mjs`: `buildHomeNewsPayloads()`と`home-news*.json`出力
- `app.js`: `home-news.json` / page endpoint
- `news.js`: `HOME_NEWS_ENDPOINT`, `loadCompleteHomeNews()`
- `shared-topic-utils.js`: 共通normalization / category / dedupe helpers
- `trends.html`: `news.html`への転送
- Commit `32761b52`; PR #14; merge `4ba96d72`

## Verification

PR #14の回帰確認でトップ20件と全件先頭20件の順序一致、カテゴリ・検索・期間・paginationを確認している。今後は現在の生成dataで再検証する。
