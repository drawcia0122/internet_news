# Codex repository guidance

作業開始時は次の順で確認する。

1. `docs/DEVELOPMENT_RULES.md` と `docs/00_COMPANY.md`
2. `docs/ai/CURRENT_STATE.md`
3. `docs/ai/INDEX.md`

TASKに関係する過去知識がありそうな場合だけ、`rg` で `docs/ai/` を検索し、該当memoryだけを読む。関係のないmemoryを念のために全件読まない。

- `active` decisionは原則尊重する。変更する場合は、旧decisionを無言で上書きせず、新しい根拠・検証・後継decisionを残す。
- `superseded`、`deprecated`、`needs-verification` は無条件に適用しない。
- memoryと実装が矛盾する場合は、現在のコード、tests、設定、Git履歴を確認する。memoryは補助でありsource of truthの代替ではない。
- 推測を確定事項として保存しない。会話履歴、作業実況、raw output、巨大なtest log、コードの大量転載は保存しない。
- TASK終了時は、将来同じ調査・失敗・判断を繰り返す可能性がある新規知識だけmemoryへ追加する。単純な変更やGit diffで十分な情報は保存しない。
- memoryを追加・更新したら、必要な場合だけ `docs/ai/INDEX.md` と `CURRENT_STATE.md` を更新する。

運用規約とmetadata形式は `docs/ai/README.md` を参照する。
