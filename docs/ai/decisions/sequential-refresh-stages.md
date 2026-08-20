# Refresh stages run sequentially

- Status: active
- Created: 2026-08-20
- Last verified: 2026-08-20
- Source task: PR #7

## Decision

`scripts/refresh-data.mjs`は次の順を明示的に`await`する。

1. trend
2. events
3. adult
4. today-internet
5. thumbnail-repair

fatal errorはstage名を記録して再throwし、後続stageを実行しない。RSS全件失敗を既存data保持として正常終了する既存fallbackだけは、この直列pipelineを継続できる。

## Reason

side-effect static importsとtop-level実行に依存すると、依存moduleの評価が重なり、Today Internetがtrend書き込み前のJSONを読む可能性がある。明示的なdynamic importの直列awaitにより、`trend write complete -> Today Internet read`を保証する。

## Alternatives considered

- events / adultの並列化: 現時点では観測性と安全性を優先して採用しない。
- 各moduleの全面的なrun関数化: 変更範囲が大きいため、現在は順次dynamic importを採用。

## Evidence

- `scripts/refresh-data.mjs`: `runStage()`と5つのawait
- Commit `1c25c4ec`; PR #7; merge `c3f6c072`

## Verification

PR #7でstage順、1回実行、fatal時停止、RSS fallback後継続をcharacterizationし、本番ログでも順序を確認した。実装変更時は同じ性質を再検証する。
