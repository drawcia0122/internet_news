# News card information hierarchy

- status: active
- created: 2026-09-17
- last_verified: 2026-09-17
- source_task: C-007

## Decision

- 内部ranking scoreは選定・並び順のために保持し、値が飽和して記事差を伝えない場合はraw値を利用者向けUIの主情報にしない。表示は同一候補集合内の順位を使った少数の意味ラベルへ変換する。
- 「なぜ話題？」は現在注目されている契機、「なぜ重要？」は利用者・作品・業界・社会への影響だけを扱う。
- 媒体数、domain数、一次情報の有無はimportanceではなく「確認状況」として小さなmetadataへ分離する。
- 根拠のあるimportanceがない場合は欄を省略し、fallback文章を捏造しない。summary、why-hot、importanceが実質重複する場合も下位の説明を省略する。

## Reason

同じ意味の高得点や確認件数を重要性として表示しても、利用者の優先順位判断にはつながらない。内部rankingの意味と、利用者が読む説明の意味を分離することで、選定挙動を変えずにカードの理解可能性と情報密度を改善できる。

## Alternatives considered

- raw scoreをそのまま小さく表示する: scoreが99〜100へ飽和する実データでは記事差を説明できないため不採用。
- 固定閾値でラベル化する: score分布が飽和すると全件同一labelになるため不採用。
- importanceを必須表示する: 根拠のない一般文を生成するため不採用。安全に説明できない場合は省略する。

## Evidence

- `home-render-utils.js`: 相対label、説明の重複抑制、importanceとverificationの分離。
- `tests/card-information-hierarchy.test.mjs`: label分布、verification-only除外、正常importance維持、重複抑制。
- `data/trend-topics.json`, `data/trend-topics-archive.json`, `data/today-internet.json`: C-007時点の分布・表示内容検査元。data自体は変更しない。

