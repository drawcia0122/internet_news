# Classic and Next remain separated consumers of shared data

- Status: active
- Created: 2026-08-20
- Last verified: 2026-08-20
- Source task: repository initialization; Next PRs #11–#13

## Decision

Classicはrepository root、Nextは`next/`配下に置く。Nextの実装都合でClassicのUIやdata生成を暗黙に変更しない。両者は必要な生成済み`data/` JSONを共有し、Next固有の変換・fallback・表示判断はNext側loader / mapperに閉じ込める。

## Reason

Classicは本番稼働中で安定性が優先される。一方、Nextは異なる表示目的と段階的なload戦略を持つ。shared dataを境界にすると、収集基盤を再利用しながらUIの変更リスクを分離できる。

## Alternatives considered

- Next専用の収集・JSON生成: data sourceと運用を二重化するため採用しない。
- Classic utilityへのNext固有mapper混入: Classicの変更範囲を広げるため採用しない。

## Evidence

- `docs/DEVELOPMENT_RULES.md` section 6
- `next/data-loader.js`, `next/home-mapper.js`, `next/app.js`
- Classic consumers: `app.js`, `news.js`, `topic.js`, `game.js`
- PR #11 (`6b82f30f` merge), PR #12 (`13fd5f0f` merge), PR #13

## Verification

Nextのendpointが`../data/*.json`を参照し、Next固有のload / mappingが`next/`内にあることを確認した。
