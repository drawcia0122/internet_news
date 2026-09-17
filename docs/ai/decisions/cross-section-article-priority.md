# Cross-section article priority

- status: active
- created: 2026-09-17
- last_verified: 2026-09-17
- source_task: C-006
- evidence: `app.js`, `shared-topic-utils.js`, `home-topic-selection-utils.js`, `home-brief-utils.js`, `tests/cross-section-dedupe-category.test.mjs`

## Decision

Classicトップの同一記事は「今日のインターネット」、「今日の自分向けニュース」、「今日のニュース」の順に優先する。上位sectionで使ったarticle identityは下位sectionの候補から除外し、次候補を補充する。

Article identityはobjectや配列indexではなく、trackingを除いたcanonical/source URL、article ID、同一媒体・同一公開日の強いtitle一致を共通utilityで判定する。別媒体が同じ話題を扱う場合は、URL等の同一記事evidenceがなければ一律に除外しない。

## Reason

ID完全一致だけでは、同じ記事が異なる生成IDやtracking URLで再登場する。一方、titleだけの過剰dedupeは、別媒体の有用な報道を失う。

## Alternatives considered

- IDだけで除外: URL違いを見逃すため不採用。
- title類似だけで話題全体を1件化: 別記事を失うため不採用。
- 候補不足時に重複を戻す: sectionが空にならない限り行わず、次候補を優先。

## Verification

Canonical URL、tracking差分、別媒体同title、公開日が異なる同媒体同title、次候補補充をfixtureで回帰確認する。
