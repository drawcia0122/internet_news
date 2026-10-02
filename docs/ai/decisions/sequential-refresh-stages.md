# Refresh stages run sequentially

- Status: active
- Created: 2026-08-20
- Last verified: 2026-10-02
- Source task: PR #7

## Decision

`scripts/refresh-data.mjs`は次の順を明示的に`await`する。

1. trend
2. events
3. adult
4. today-internet
5. thumbnail-repair

初期の規則ではfatal errorを再throwし、RSS全件失敗の既存fallbackだけ後続stageを継続した。2026-10-02の承認済み更新保護により、現在は下記のusable snapshot規則へ更新している。

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

## 2026-10-02: guarded fallback without changing stage order

- Matomeはthumbnail repairの後の最終stage。`runGuardedRefresh()`内で各stageを直列awaitする
- 各stageの例外や明らかに無効な生成結果は、同stageの完全な利用可能snapshotがあればgroup全体を復元しwarningで継続する。初回・不完全・無効なbaselineの場合は復元後に再throwし、後続stageを実行しない
- 根拠: 復元済みdataと異常statusを既存workflowでcommit/deployするには、利用可能なfallbackをfatal扱いしない必要がある。順序・既存のRSS全件失敗fallback・thumbnail consumer同期は維持する
- `checkedAt`は試行時刻であり、生成/取得の成功時刻ではない。復元したdataのtimestampを更新しない
- Evidence: `lib/refresh-health.mjs`, `scripts/refresh-data.mjs`, `tests/refresh-health.test.mjs`, `docs/refresh-health.md`
