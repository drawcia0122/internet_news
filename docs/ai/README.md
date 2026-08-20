# Repository memory

このdirectoryは、Codexが過去に支払った非自明な調査・失敗・判断コストを再利用するための外部長期記憶です。製品仕様やコードのsource of truthを置き換えません。

## Retrieval

1. `CURRENT_STATE.md` で現在地を確認する。
2. `INDEX.md` のkeywordsから関連memoryを選ぶ。
3. 必要なら `rg -n '<keyword>' docs/ai` で検索する。
4. 関連memoryだけを読み、evidence先の現在のコード・tests・Git履歴で再検証する。

関連memoryがなければ、通常のrepository調査へ進みます。

## Memory types

- `observations/`: 一度だけの観測や未確定の仮説。確定仕様として使わない。
- `lessons/`: 再現性または十分な証拠がある、再利用可能な技術知見。
- `decisions/`: 今後の実装を拘束する設計判断と理由。
- `tasks/`: 将来の調査・判断コストを減らす場合だけ残す、TASKの最終到達点。

成熟順は `observation -> lesson -> decision`。すべてを昇格させる必要はありません。

## Metadata and stale handling

個別memoryは可能な範囲で次を持ちます。

- `status`: `active` / `superseded` / `deprecated` / `needs-verification`
- `created`
- `last_verified`
- `source_task`
- `evidence`

古いmemoryと現行実装が矛盾したら現行実装を調査します。後継decisionがある場合、旧memoryは削除せず `superseded_by` で誘導します。

## Update rule

TASK終了時に「次回知らなければ、同じ調査・失敗・判断を繰り返すか」を問います。YESの場合だけ、1 topic / 1 fileで圧縮して保存し、必要ならINDEXを更新します。raw log、会話履歴、一時的debug、単純な変更、既存docsのコピーは保存しません。
