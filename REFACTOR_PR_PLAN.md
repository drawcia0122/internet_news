# 不要コード監査と削減 PR プラン

## 前提

- 基準は現行のローカル実装
- 既存機能の削除はしない
- 復旧済み導線、既存ページ、既存 URL は維持する
- 1 PR ごとに「見た目を壊さずに小さく進める」を優先する
- 2026-06-15 時点では、トップ再設計・ニュース一覧復旧・3分ニュース/タイムライン修正が混在しているため、削減は `未参照の関数` `表示未使用の JSON 項目` `孤立 CSS` から始める
- `personalScore` `adultHotScore` `収集元全体` `shared-topic-utils.js` の中核ロジックにはすぐ触らない

## 監査サマリー

### 安全に削れそうだったもの

- `app.js`
  - `selectMustReadNews`
  - `mustReadScore`
  - `isEligibleMustReadTopic`
  - `publicImportanceScore`
  - `hasOfficialNewsSignal`
  - `isGeneralImpactTopic`
  - `mustReadPenalty`
  - `renderBriefPoint`
  - `shouldLoadArchiveTopics`
- `lib/daily-brief.mjs`
  - `buildBackground`
  - `buildWhyRead`
  - `buildImpact`
  - `isUsefulSummary`
  - `buildAttentionSentence`
- `adult-trends.js`
  - `renderMagazineSummary`
- `scripts/fetch-trend-topics.mjs`
  - `synthesizeStoredBriefSummary`

### 保留候補

- `topic.js`
  - `collectSignalSummaries`
  - `squeezeSummary`
  - `isTooSimilarSummary`
  - `joinSummaryParts`
  - `buildWhyTrending`

理由:
- 現時点では未参照に見える
- ただし Topic 詳細で再利用予定だった可能性があるため、即削除しない

### 未使用 CSS 候補

- `styles.css`
  - `.brief-card*`
  - `.brief-points*`
  - `.brief-links*`
  - `.brief-related-links*`
  - `.brief-card-top`
  - `.brief-tone`

注意:
- `index.html` の初期プレースホルダに `brief-card brief-card-empty` がまだ残っている
- `app.js` の `recordPerfCount()` も `.brief-card` 件数を見ている
- そのため CSS を消す前に HTML / JS 側の残参照を落とす必要がある

### 重複が大きかったもの

- `news.js` と `trends.js` の一覧ページロジック
  - `fetchJson`
  - `saveTopicCache`
  - `readTopicCache`
  - `buildGoogleNewsUrl`
  - `isWithinRange`
  - `renderPagination`
  - 画像エラーハンドリング
- サムネイル / source URL 解決の優先順位
  - `app.js`
  - `news.js`
  - `trends.js`
  - `shared-topic-utils.js`
- 重複除外ロジック
  - `shared-topic-utils.js`
  - `scripts/fetch-trend-topics.mjs`
- `daily-brief.json` の出力契約
  - 生成項目が描画側より多い

### 危険なので後回しにしたもの

- `app.js` のホーム描画全体
- `topic.js` の詳細ページ描画
- `lib/trend-aggregator.mjs` の出力契約変更
- `shared-topic-utils.js` の重複除外・画像選定
- `thumbnailUrl` / `thumbnail` / `image` 系フィールドの強引な統合
- アダルト系 JSON の根本構造変更

## PR 分割

### PR0: Audit Freeze

目的:
- 監査結果と削減順序を固定し、危険な巻き込みを防ぐ

作業:
- このファイルに未使用候補・保留候補・危険領域を記録
- 「次に消すもの」と「今は触らないもの」を分離

確認:
- コード変更なし

状態:
- 今回実施

### PR1: Dead Home Brief Code

目的:
- 直近の 3分ニュース / タイムライン修正で孤立した旧ロジックだけを落とす

作業:
- `app.js` の旧 3分ニュース選定関数を削除
- `app.js` の `renderBriefPoint` を削除
- `app.js` の `shouldLoadArchiveTopics` を削除

確認:
- `node --check app.js`
- トップページで以下のみ確認
  - 3分ニュース 10 件
  - 自分向けニュースの内容が変わっていない
  - タイムラインが出る

リスク:
- 低い
- 3分ニュースの現在実装に未参照のものだけを対象にする

状態:
- 実施済み

### PR2: Daily Brief Contract Trim

目的:
- `daily-brief` 生成ロジックの未使用関数と未使用 JSON 項目を削る

作業:
- `lib/daily-brief.mjs` の未参照補助関数を削除
- `data/daily-brief.json` で現行描画が未使用の項目を確認
- 必要なら生成項目を縮小

現時点で表示が使っている項目:
- `title`
- `categoryLabel`
- `thumbnailUrl`
- `publishedAt`
- `publishedLabel`
- `thirtySecondSummary`
- `watchpoints`
- `primaryLink`

未使用候補:
- `relatedLinks`

確認:
- `node --check lib/daily-brief.mjs`
- `npm run refresh`
- トップの 3分ニュース / タイムライン確認

リスク:
- 低め
- JSON 契約に触るので再生成確認は必須

状態:
- 実施済み

### PR3: Dead Timeline CSS

目的:
- 新タイムライン UI に置き換わって不要になったカード系 CSS を落とす

作業:
- `index.html` の初期プレースホルダを `brief-timeline-item-empty` に寄せる
- `recordPerfCount()` の `.brief-card` 件数参照を調整
- `.brief-card*` など旧カード用 CSS を削除

確認:
- トップページのタイムライン見た目
- スマホ幅で崩れないこと
- `rg 'brief-card|brief-points|brief-links'` の残参照確認

リスク:
- 低め
- 見た目だけなので差分確認しやすい

状態:
- 実施済み

### PR4: Topic Detail Helpers Review

目的:
- `topic.js` の未使用補助関数を削るか保留するかを判断する

作業:
- `topic.js` の保留候補を再確認
- `rg` と画面確認で本当に未使用かを判定
- 使わないなら別 PR で削除

確認:
- `topic.html` の詳細表示が変わらないこと

リスク:
- 中
- 詳細ページは気づきにくい退行が出やすい

状態:
- 監査済み / 削除未実施

現在の候補:
- `collectSignalSummaries`
- `squeezeSummary`
- `isTooSimilarSummary`
- `joinSummaryParts`
- `buildWhyTrending`

メモ:
- `rg` 上は自己参照も含めて未使用
- ただし Topic 詳細ページは見落とし退行の検知が難しいため、削除は単独 PR に分離する

### PR4.5: Topic Detail Safe Delete

目的:
- `topic.js` の孤立 helper を単独で落とし、影響範囲を極小化する

作業:
- `collectSignalSummaries`
- `squeezeSummary`
- `isTooSimilarSummary`
- `joinSummaryParts`
- `buildWhyTrending`
  を削除

確認:
- `node --check topic.js`
- `topic.html` の表示確認
  - ヒーロー要約
  - 参照記事リスト
  - 外部リンク
  - カテゴリ表示

リスク:
- 中
- 詳細ページ専用なので、削除後は必ず実画面確認する

状態:
- 実施済み

### PR5: List Pages Shared Cleanup

目的:
- `news.js` / `trends.js` の重複ロジックを安全にさらに減らす

作業:
- 残る共通 helper を棚卸し
- 完全共通化ではなく 1 関数ずつ shared 化する
- 画像 URL 解決と source URL 解決は最後に回す

現時点の重複棚卸し:

そのまま共通化候補:
- `fetchJson`
- `saveTopicCache`
- `readTopicCache`
- `buildGoogleNewsUrl`
- `isWithinRange`
- `renderPagination`
- `renderInsightList`
- `updateSearchButton`
- 画像 `error` ハンドリング

仕様差があるため分けたままにする候補:
- `init`
- `ensureArchiveLoadedIfNeeded`
- `renderArchive` / `renderTrendIndex`
- `renderArchiveCard` / `renderTrendCard`

理由:
- `news.js` は `news-archive.json` を主データにしており、期間別件数表示と `rangeItemsCache` を持つ
- `trends.js` は `trend-topics.json` を主データにしており、話題一覧としてスコア順の性質が強い
- カード描画も `news.js` は画像・元記事URL・sourceLabel のフォールバック優先順を個別に持つ

安全な共通化順:
1. `buildGoogleNewsUrl`
2. `isWithinRange`
3. `fetchJson`
4. `saveTopicCache` / `readTopicCache`
5. `renderPagination`

後回し:
- サムネイル解決
- source URL 解決
- カードHTML生成
- 期間別件数キャッシュ

確認:
- `node --check news.js`
- `node --check trends.js`
- `news.html`
- `trends.html`

リスク:
- 中
- 一覧ページの機能が多いため、段階的にしか進めない

状態:
- 一部実施済み、追加整理は未実施

### PR6: Adult Contract Cleanup

目的:
- アダルト系 JSON / client の重複項目を段階削減する

作業:
- `adult-trends.json` / `adult-features.json` の使用項目を再棚卸し
- `payloadItems()` 互換を最後に外す
- `history` 系の必須項目は維持

確認:
- `adult-trends.html`
- `adult-topic.html`
- トップのアダルト欄

リスク:
- 中
- 詳細ページ、一覧、トップ導線にまたがる

状態:
- 一部実施済み、残タスクあり

## 超安全な実行順

1. `app.js` の旧 3分ニュース関数削除
2. `lib/daily-brief.mjs` の未使用補助関数削除
3. タイムライン旧 CSS 削除
4. `daily-brief.json` 未使用項目削減
5. `topic.js` 保留候補の再監査
6. `news.js` / `trends.js` の追加共通化

## 今はやらないこと

- `shared-topic-utils.js` の大規模改造
- `trend-aggregator.mjs` の出力契約変更
- `thumbnailUrl` / `thumbnail` / `image` 系の強引な統合
- `personalScore` / `adultHotScore` の設計変更
- 既存ページ導線の整理
