# RSS collection assumes partial and total external failure

- Status: active
- Created: 2026-08-20
- Last verified: 2026-08-20
- Source task: PR #3 and PR #4

## Lesson

RSS取得は外部環境依存で、local成功でもGitHub Actionsで全feedがtimeoutし得る。個別feed失敗は部分成功として扱い、全件失敗だけを識別可能な`ERR_NO_RSS_ENTRIES`にする。既存生成dataがある全件失敗では書き換えずwarning付きで正常終了し、初回で既存dataがない場合はfatalのままにする。

一時エラーだけretryし、恒久エラーを無駄に再試行しない。現在の設定は最大7並列、feed単位25秒、500ms / 1500ms backoffを含む最大3試行。timeout、network、HTTP 408 / 429 / 5xxはretry対象で、404とparse errorは対象外。

## Why it matters

空payloadを正常dataとして書くと本番を破壊する一方、外部障害だけで前回の有効なサイトまで停止させる必要はない。error code、診断分類、既存snapshot確認を分離することで両方を避ける。

## Evidence

- `lib/trend-aggregator.mjs`: constants、`fetchRssEntriesWithRetry()`、`classifyFetchError()`、`ERR_NO_RSS_ENTRIES`
- `scripts/fetch-trend-topics.mjs`: `isNoRssEntriesError()`、`hasPreviousGeneratedTrendData()`、warningして早期return
- `.github/workflows/refresh-news.yml`
- Commit `276bd61c` / PR #3 / merge `095c9669`
- Commit `d46556c1` / PR #4 / merge `db5707d3`

## Reverification

retry、timeout、並列数、fallback対象file、error codeを変更する場合は、成功、部分失敗、404非retry、一時エラーretry、全件失敗+既存data、全件失敗+dataなしをfixtureで確認する。実RSSによるdata再生成だけをtestにしない。
