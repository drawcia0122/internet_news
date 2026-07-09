# TODAY INTERNET Layer Design

## Goal

既存のニュース取得・カテゴリ分類・ニュース詳細・AI要約は変更しない。

今回追加するのは、その上位に載る「今日もっともネットで盛り上がっている出来事」を抽出するレイヤーである。

このレイヤーの出力は、トップページ最上部の「3分でわかる 今日のインターネット」で使う。

要件上の最優先事項は以下。

1. 既存取得ロジックは維持する
2. 同一出来事を媒体差分・速報/続報差分を吸収して1トピック化する
3. なぜ1位なのかを説明できる `Buzz Score` を持つ
4. 単なる本文要約ではなく「何が起きたか」「なぜ話題か」「ネット反応」を短時間で理解できる出力にする
5. API通信量とAIコストを制御する
6. 十分なシグナルがない場合でも既存データからフェイルセーフする

---

## Non-Goals

- 既存の RSS / Google News / Yahoo / NHK 取得処理の置換
- 既存カテゴリ設計の破壊的変更
- 既存 `trend-topics.json` や `daily-brief.json` の責務変更
- 既存 UI の全面刷新

---

## Proposed Architecture

既存:

`sources -> collectTrendTopics() -> trend-topics.json / trend-topics-archive.json -> daily-brief -> home render`

追加後:

`sources -> collectTrendTopics() -> trend-topics.json`

`trend-topics.json + trend-topics-archive.json + external buzz signals`

`-> topic normalization`

`-> same-topic clustering`

`-> buzz scoring`

`-> top topic selection`

`-> AI summary generation`

`-> data/today-internet.json`

`-> home top section render`

重要なのは、既存の取得パイプラインの下流に新レイヤーを追加すること。既存 JSON は入力として再利用し、元のニュース一覧やカテゴリ一覧はそのまま残す。

---

## Files To Add

実装担当者向けの推奨分割。

- `lib/topic-normalizer.mjs`
  - タイトル正規化、URL正規化、エンティティ抽出、署名生成
- `lib/topic-clusterer.mjs`
  - 同一ニュース判定、速報/続報マージ、クラスタ更新
- `lib/external-buzz-signals.mjs`
  - SNS / 検索トレンド / 任意外部指標の取得と正規化
- `lib/buzz-score.mjs`
  - Buzz Score 算出、説明要因生成
- `lib/today-internet-selector.mjs`
  - 候補生成、ランキング、1位採択、フェイルセーフ
- `lib/today-internet-summary.mjs`
  - AI入力整形、要約キャッシュ、再生成判定
- `scripts/build-today-internet.mjs`
  - 上記全体を束ねて `data/today-internet.json` を出力
- `data/today-internet.json`
  - 本番表示用キャッシュ
- `data/today-internet-history.json`
  - 過去の選出結果、スコア監査用

既存更新スクリプトへの接続:

- `scripts/refresh-data.mjs`
  - `import './build-today-internet.mjs'` を最後に追加

---

## Input Data

### 1. Existing Inputs

- `data/trend-topics.json`
  - 当日近辺の最新クラスタ
- `data/trend-topics-archive.json`
  - 勢い比較用の時系列母集団
- `data/daily-brief.json`
  - フェイルセーフ時の代替候補

### 2. New External Signals

少なくとも次の3系統を想定する。

1. `media coverage`
   - 既存 `sourceSignals.length`
   - 異なるドメイン数
   - 速報から続報への増加量
2. `search trend`
   - Google Trends 等の検索急上昇
   - 検索量絶対値より「直近比上昇率」を重視
3. `social buzz`
   - X / Bluesky / Reddit / YouTube / はてブ / Yahooコメント等の取得可能な範囲
   - 反応量より「短時間増分」と「ユニーク投稿者数」を重視

外部シグナルが一部欠落しても動くよう、各指標は欠損耐性を持たせる。

---

## Output Schema

`data/today-internet.json`

```json
{
  "generatedAt": "2026-07-02T10:30:00.000Z",
  "topicVersion": 1,
  "selectedTopic": {
    "topicId": "topic-20260702-abc123",
    "clusterId": "cluster-abc123",
    "title": "主要表示タイトル",
    "canonicalEventLabel": "出来事の正規ラベル",
    "category": "politics",
    "categories": ["politics", "general"],
    "thumbnailUrl": "https://...",
    "publishedAt": "2026-07-02T08:12:00.000Z",
    "lastUpdatedAt": "2026-07-02T10:28:00.000Z",
    "buzzScore": 88.4,
    "scoreBreakdown": {
      "coverage": 24.1,
      "search": 18.0,
      "social": 20.5,
      "velocity": 11.2,
      "freshness": 8.6,
      "authority": 4.0,
      "penalty": -3.0
    },
    "whyRanked": [
      "主要媒体8社で同一テーマを報道",
      "検索トレンドが直近3時間で急上昇",
      "SNS反応が1時間あたり平均の3.4倍"
    ],
    "clusterStats": {
      "articleCount": 15,
      "sourceCount": 8,
      "uniqueDomainCount": 7,
      "officialSourceCount": 2,
      "latestSourceCount1h": 5
    },
    "externalSignals": {
      "searchTrendScore": 71,
      "searchTrendDelta": 2.8,
      "socialMentionScore": 66,
      "socialVelocityScore": 74
    },
    "representativeArticles": [
      {
        "title": "...",
        "url": "...",
        "sourceName": "...",
        "publishedAt": "..."
      }
    ],
    "aiSummary": {
      "headline": "15秒でわかる見出し",
      "threeMinuteSummary": "本文",
      "whatHappened": "何が起きたか",
      "whyBuzzing": "なぜ話題か",
      "netReaction": "ネットの反応",
      "keyPoints": ["...", "...", "..."],
      "watchpoints": ["..."]
    }
  },
  "runnerUps": [],
  "fallbackUsed": false,
  "dataQuality": {
    "externalSignalsAvailable": {
      "search": true,
      "social": false
    },
    "confidence": 0.82
  }
}
```

---

## Processing Pipeline

## Step 1. Candidate Ingestion

入力は既存 `trend-topics.json.items` を主軸にする。

理由:

- 既に複数ソース統合済み
- サムネイルや sourceSignals が整っている
- 現行プロダクトとの一貫性が高い

ただし `trend-topics-archive.json` も使い、直近 24 時間と過去 7 日の比較母集団を作る。

候補集合:

- `current window`: 直近 24 時間
- `momentum window`: 直近 6 時間
- `baseline window`: 直近 7 日同カテゴリ中央値

---

## Step 2. Topic Normalization

タイトル差分と速報/続報差分を吸収するため、全記事と既存 topic に対して正規化特徴量を作る。

### 2-1. Text normalization

- 全角半角統一
- 記号除去
- 括弧内メディア名除去
- `速報`, `続報`, `判明`, `更新`, `会見`, `ライブ` などの接頭辞/接尾辞除去
- 数値の正規化
- 人名・組織名・地名の表記ゆれ吸収
  - 例: `X`, `旧Twitter`
  - 例: `グーグル`, `Google`

### 2-2. Event entity extraction

各記事から以下を抽出する。

- 人名
- 組織名
- 製品名
- 地名
- ハッシュタグ / 固有キーワード
- 数値事実
  - 得点、金額、死傷者数、発売日など

推奨:

- 日本語形態素解析 + ルールベース固有表現
- 後段で軽量 embedding を併用

### 2-3. Topic signature

同一性判定用に複数署名を作る。

- `lexical_signature`
  - 正規化タイトルから stopword 除去した token set
- `entity_signature`
  - 主要固有表現の組み合わせ
- `semantic_signature`
  - title + summary embedding
- `event_time_signature`
  - イベント発生日、試合日、会見時刻などが取れれば保持

---

## Step 3. Same-Topic Clustering

同じ出来事を1トピックに束ねる中核処理。

## 3-1. Cluster unit

クラスタは記事単位ではなく「出来事単位」。

例:

- `首相が法案修正を要請`
- `A社が新製品を発表`
- `代表戦で日本が勝利`

速報・続報・解説は同一イベントクラスタにぶら下げる。

## 3-2. Matching algorithm

2段階で行う。

### Stage A. Cheap candidate generation

各 topic / article に対して近傍候補を作る。

- 共有エンティティが2個以上
- 正規化タイトルの Jaccard 類似度 >= 0.35
- 同カテゴリかつ時間差 <= 48h
- 主要名詞 bigram の一致

これで全件比較を避ける。

### Stage B. Final merge decision

以下の加重合算で統合可否を判定。

```text
same_topic_score =
  0.30 * lexical_similarity
  + 0.30 * entity_overlap
  + 0.25 * embedding_similarity
  + 0.10 * time_proximity
  + 0.05 * category_consistency
```

判定基準:

- `>= 0.78` : 同一クラスタに統合
- `0.65 - 0.78` : 追加確認ルールへ
- `< 0.65` : 別トピック

### Stage C. Ambiguous resolver

曖昧域は追加ルールで決める。

- スポーツ:
  - チーム名一致 + 試合日一致なら統合
- 政治:
  - 人物名一致だけでは統合しない
  - 法案名 / 会見名 / 不祥事キーワードが一致した場合のみ統合
- 災害 / 事件:
  - 地名 + 事故/火災/地震などの事象語 + 日付が一致で統合
- 新製品:
  - 企業名 + 製品名 + 発表/発売イベント一致

## 3-3. Update chaining

速報と続報を別 topic にしないため、クラスタは増分更新する。

- 既存 `today-internet-history.json` の直近クラスタも参照
- 既存クラスタへの追記を優先
- ただし 72h 以上離れたものは原則新規クラスタ

---

## Step 4. External Buzz Signal Collection

## 4-1. Signal policy

重要なのは「絶対量」より「直近でどれだけ盛り上がっているか」。

よって各指標は原則以下の2軸で持つ。

- `level`: 現在値
- `velocity`: 増加速度

## 4-2. Search trend signals

候補トピックごとに検索クエリを生成する。

クエリ例:

- 正規化タイトル
- `主要エンティティ + 事象語`
- 別表記シノニム

取得値:

- `search_volume_index`
- `search_delta_1h`
- `search_delta_3h`
- `search_breakout_flag`

スコア化:

```text
search_score =
  0.45 * normalized(search_volume_index)
  + 0.35 * normalized(search_delta_1h)
  + 0.20 * breakout_bonus
```

## 4-3. Social signals

SNSは API 制約があるため、優先順位を決める。

優先:

1. 取得可能な公式 API
2. 検索結果ページの lightweight fetch
3. 自前保存済みトレンドデータ再利用

取得値:

- `mention_count`
- `unique_author_count`
- `repost_like_proxy`
- `mention_delta_30m`
- `mention_delta_1h`
- `link_share_count`
- `sentiment_variance`

注意:

- 感情極性自体は順位決定の主因にしない
- 炎上・不安・祝福のいずれでも「反応が集中している」ことを捉える

スコア化:

```text
social_score =
  0.30 * normalized(mention_count)
  + 0.25 * normalized(unique_author_count)
  + 0.30 * normalized(mention_delta_1h)
  + 0.15 * normalized(link_share_count)
```

## 4-4. Media coverage signals

既存データから取得可能。

- `article_count`
- `source_count`
- `unique_domain_count`
- `official_source_count`
- `major_source_count`
- `latest_source_count_1h`

スコア化:

```text
coverage_score =
  0.30 * normalized(source_count)
  + 0.20 * normalized(unique_domain_count)
  + 0.20 * normalized(article_count)
  + 0.20 * normalized(latest_source_count_1h)
  + 0.10 * normalized(official_source_count)
```

---

## Step 5. Buzz Score

## 5-1. Design principle

`Buzz Score` は説明可能である必要がある。

そのため単一ブラックボックスではなく、要因分解できる線形モデルを基本にする。

## 5-2. Formula

推奨初期式:

```text
buzz_score_raw =
  0.28 * coverage_score
  + 0.24 * social_score
  + 0.20 * search_score
  + 0.16 * velocity_score
  + 0.07 * freshness_score
  + 0.05 * authority_score
  - penalty_score
```

最終:

```text
buzz_score = clamp( round( buzz_score_raw * confidence_multiplier, 1 ), 0, 100 )
```

## 5-3. Velocity score

勢いは別軸で持つ。記事数が多くても伸びが止まっている話題は落とす。

```text
velocity_score =
  0.40 * normalized(article_growth_1h)
  + 0.35 * normalized(search_delta_1h)
  + 0.25 * normalized(social_delta_1h)
```

## 5-4. Freshness score

新鮮さは単純減衰ではなく、初動を強くしつつ長寿命話題を残す。

```text
age_hours = now - latest_cluster_update_at

freshness_score =
  12                    if age_hours <= 1
  10                    if age_hours <= 3
  8                     if age_hours <= 6
  6                     if age_hours <= 12
  4                     if age_hours <= 24
  2                     if age_hours <= 36
  0                     otherwise
```

## 5-5. Authority score

デマや低品質ソース偏重を防ぐ。

- 主要報道機関
- 公式発表
- 一次ソース

これらがある場合は加点。

## 5-6. Penalties

以下は減点対象。

- まとめサイトのみで増幅
- 同一ドメインに偏りすぎ
- タイトル釣りだが他媒体追随なし
- 検索とSNSが弱いのに記事数だけ多い
- 古い事件の焼き直し
- 風説リスクが高い未確認情報

```text
penalty_score =
  domain_concentration_penalty
  + low_confirmation_penalty
  + stale_topic_penalty
  + rumor_penalty
```

---

## Step 6. Winner Selection

全候補を Buzz Score 降順に並べるだけでは不十分。

「今日のインターネット」は以下の条件を満たす必要がある。

### Selection gates

1. `buzz_score >= 55`
2. `source_count >= 3` または `external_signals.search/social のどちらかが強い`
3. `latest update <= 12h`
4. `penalty_score < 閾値`
5. 同一カテゴリ連続独占を抑える場合は UI 側で 2位以下へ回す

### Tie breaker

同点近傍では以下順で比較。

1. `velocity_score`
2. `unique_domain_count`
3. `search_breakout_flag`
4. `latest_cluster_update_at`
5. `official_source_count`

---

## Step 7. AI Summary Generation

## 7-1. Summary goal

単なる記事要約ではなく、出来事理解に必要な文脈を短時間で伝える。

必須出力:

- `何が起きたか`
- `なぜ話題なのか`
- `ネットではどんな反応か`
- `知っておくべきポイント`

## 7-2. Input context for LLM

LLM には記事全文を丸投げしない。クラスタ要約を構造化して渡す。

入力:

- 代表記事 3-5 本
- sourceSignals の見出し一覧
- scoreBreakdown
- whyRanked
- social/search シグナル要約
- 時系列
  - 最初の報道時刻
  - 直近更新時刻
  - 1h での伸び

## 7-3. Prompt contract

出力 schema を固定する。

```json
{
  "headline": "15-30文字",
  "whatHappened": "80-140文字",
  "whyBuzzing": "80-140文字",
  "netReaction": "80-140文字",
  "keyPoints": ["40-80文字 x 3"],
  "watchpoints": ["40-80文字 x 2"],
  "threeMinuteSummary": "300-500文字"
}
```

## 7-4. Guardrails

- 未確認情報は断定しない
- SNS反応は「一部では」「X上では」など主語を限定
- 誇張表現を避ける
- 出典は代表記事群に限定
- 感想文ではなく briefing 形式にする

## 7-5. AI cost control

再生成条件を厳格にする。

再生成するのは以下のみ。

1. 1位トピックが入れ替わった
2. 1位は同じだが `buzz_score` 差分が閾値超え
3. 代表記事セットが大きく変わった
4. 最終生成から 90 分以上経過

それ以外は既存 summary を再利用。

---

## Refresh Policy

## 1. Recommended cadence

- ニュース取得: 既存どおり 30 分
- `today-internet` ランキング再計算: 15 分
- AI要約再生成: 条件付き

## 2. Split update strategy

### Cheap refresh

15 分ごと:

- 既存 topic の再クラスタリング差分確認
- 外部シグナルの再取得
- Buzz Score 再計算
- winner 判定のみ

### Expensive refresh

30 分ごとまたは winner 変更時:

- AI summary 更新
- 履歴保存

## 3. Rate limiting

- 外部シグナルは topic ごとではなく top N 候補に限定
- N は `12` を初期値推奨
- まず coverage score 上位だけに search/social を当てる

---

## Fail-Safe

サイトが空になることは避ける。

## Fallback order

1. `today-internet` の前回成功結果を再利用
2. 当日 `trend-topics.json` の最高 `hotScore` topic を採用
3. `daily-brief.json` 上位を topic card 形式に変換
4. それもない場合のみ既存 must-read の空表示

## Minimum output contract

最低でも以下は返す。

- タイトル
- 代表リンク
- 短い説明文
- 生成時刻
- fallback 使用フラグ

## Degraded mode rules

- search/social が片方欠落しても coverage + freshness で継続
- 両方欠落時は `confidence` を下げるが表示は継続
- クラスタリングに失敗した場合は既存 topic 単位でランキング

---

## Performance Design

ニュース数が数万件でも耐える設計にする。

## 1. Computation strategy

全件総当たり禁止。

### Use inverted indexes

- entity -> topic ids
- normalized token -> topic ids
- category + hour bucket -> topic ids

これでクラスタ候補を絞る。

## 2. Incremental clustering

毎回フル再計算ではなく差分更新。

- 新着 topic のみ既存クラスタへ照合
- 既存クラスタは rolling 72h 窓で保持
- 7日超の古いクラスタは履歴へ圧縮

## 3. Caching layers

- `topic normalization cache`
  - topic id 単位
- `embedding cache`
  - normalized title hash 単位
- `external signal cache`
  - query hash + 15分 TTL
- `summary cache`
  - clusterId + representativeArticles hash

## 4. Parallelism

- 外部シグナル取得は候補 topic ごとに並列
- concurrency 上限は 4-8
- AI 要約は winner 1件のみ

## 5. Storage optimization

- `today-internet-history.json` は全 raw signal を持たない
- 履歴には score summary と winner のみ保持
- 詳細監査が必要なら別 `debug` JSON を TTL 付きで出力

---

## Implementation Details

## 1. Normalized topic model

```js
{
  topicId,
  rawTopicIds: [],
  normalizedTitle,
  canonicalLabel,
  tokens: [],
  entities: {
    people: [],
    orgs: [],
    places: [],
    products: [],
    hashtags: []
  },
  category,
  publishedAt,
  lastUpdatedAt,
  representativeSignals: [],
  allSignals: []
}
```

## 2. Cluster model

```js
{
  clusterId,
  canonicalEventLabel,
  categories: [],
  topicIds: [],
  sourceSignals: [],
  firstSeenAt,
  lastSeenAt,
  articleCount,
  sourceCount,
  uniqueDomainCount,
  officialSourceCount,
  signatures: {
    lexical: [],
    entities: [],
    embedding: []
  }
}
```

## 3. Ranking model

```js
{
  clusterId,
  coverageScore,
  searchScore,
  socialScore,
  velocityScore,
  freshnessScore,
  authorityScore,
  penaltyScore,
  buzzScore,
  confidence,
  whyRanked: []
}
```

---

## Pseudocode

```js
export async function buildTodayInternet({ now = new Date() } = {}) {
  const current = await readJson("data/trend-topics.json");
  const archive = await readJson("data/trend-topics-archive.json");
  const previous = await readJsonSafe("data/today-internet.json");

  const normalizedTopics = normalizeTopics(current.items, archive.items, now);
  const clusters = clusterTopics(normalizedTopics, previous?.recentClusters ?? []);

  const preRanked = scoreCoverageAndFreshness(clusters, now)
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, 12);

  const enriched = await attachExternalBuzzSignals(preRanked, { ttlMinutes: 15 });
  const ranked = computeBuzzScores(enriched, now);
  const winner = selectWinner(ranked, previous);

  const summary = await getOrGenerateSummary(winner, previous);
  const payload = buildOutputPayload(winner, ranked, summary, previous, now);

  await writeJson("data/today-internet.json", payload);
  await appendHistory("data/today-internet-history.json", payload);

  return payload;
}
```

---

## UI Integration

既存 UI は壊さず、トップ最上段の must-read セクションに新データを優先供給する。

### Rendering rule

1. `data/today-internet.json.selectedTopic` があれば最優先表示
2. 2位以下は既存 `must-read` カードに流用可
3. 取得失敗時は既存 `renderMustReadNews(internetNews)` にフォールバック

### UI copy

- セクションタイトル: `3分でわかる 今日のインターネット`
- 補足ラベル: `もっとも話題`
- スコア表示: `Buzz 88`
- 理由表示: `主要8媒体 / 検索急上昇 / SNS反応拡大`

---

## Observability

運用で改善できるよう、最低限の監査ログを持つ。

### Metrics

- winner change rate
- external signal hit rate
- fallback usage rate
- summary regeneration rate
- cluster merge precision review count

### Debug output

`data/today-internet-debug.json`

- 候補上位20件
- score breakdown
- merge reasons
- penalty reasons

本番表示には使わないが、品質改善に必須。

---

## Quality Review Loop

この機能は最初から完全には当たらない。評価可能な状態で出す必要がある。

## Human review labels

日次で上位5件に対し人手評価を残す。

- `winner_correct`
- `cluster_correct`
- `summary_clear`
- `overranked`
- `underranked`

これにより重み調整を回せる。

## Misranking examples to watch

- 記事数は多いが誰も話していない官公庁リリース
- X だけで一時的に燃えた低信頼ネタ
- 地方ニュースだが全国報道でないもの
- 同一人物ニュースを過剰統合して別件を混ぜるケース

---

## Rollout Plan

### Phase 1

- coverage + freshness + existing sourceSignals のみで実装
- external signals は未接続でも動く
- フェイルセーフ込みで出荷可能状態にする

### Phase 2

- search trend 接続
- social signals 接続
- Buzz Score 重み調整

### Phase 3

- AI summary 最適化
- 説明理由の改善
- 履歴学習による重み再調整

---

## Concrete Initial Thresholds

初期値として以下を推奨。

- pre-ranking 対象数: `12`
- winner 採択最低 score: `55`
- source count 最低: `3`
- strong social/search 例外閾値: `70`
- cluster merge 閾値: `0.78`
- ambiguous merge 帯: `0.65-0.78`
- external signal TTL: `15分`
- summary TTL: `90分`
- recent cluster retention: `72時間`

---

## Why This Design Fits INTERNET NEWS

この設計は、既存の「ニュース取得サービス」を壊さずに、その上で「今日ネットで何が一番盛り上がっているか」を決める。

ポイントは3つある。

1. 既存 topic 群を再利用するので導入コストが低い
2. `Buzz Score` を分解可能にして、なぜ1位か説明できる
3. search / social / coverage / velocity を別軸で扱うため、単純な記事数ランキングにならない

結果として INTERNET NEWS は、ニュース一覧サイトではなく「今日のインターネットを短時間で理解するサービス」に進化できる。
