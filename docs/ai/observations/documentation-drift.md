# Some overview documents lag behind current behavior

- Status: needs-verification
- Created: 2026-08-20
- Last verified: 2026-08-20
- Source task: repository memory initialization

## Observation

`README.md`、`CONTEXT.md`、rootの一部設計・移行メモには、現行コードと一致しないカテゴリ、期間、旧UIの記述が残る。例としてREADMEは2chまとめ系を独立カテゴリとして列挙する一方、PR #14後のClassic UIには専用tabがなく、記事は総合母集団へ残す。`CONTEXT.md`のカテゴリ・archive期間も現在の`news.html` / `news.js`と完全には一致しない。

## Handling

これは「既存docsは無効」というdecisionではない。製品・実装判断に使う箇所だけ、現行コード、tests、workflow、Git履歴と照合する。文書更新TASKで各source of truthを確定するまでは、概要文から仕様を推測しない。

## Evidence

- `README.md`, `CONTEXT.md`, `MIGRATION_PLAN.md`, `REFACTOR_PR_PLAN.md`
- `index.html`, `news.html`, `news.js`
- Commit `32761b52`, `4e7d1b10`; PR #14

## Promotion criteria

具体的なdocument ownershipと更新規約が合意・検証された場合、lessonまたはdecisionへ昇格する。それまでは`needs-verification`の観測として扱う。
