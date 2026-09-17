# Brand signal classification

- status: active
- created: 2026-09-17
- last_verified: 2026-09-17
- source_task: C-006
- evidence: `config/rss-feeds.mjs`, `lib/trend-aggregator.mjs`, `article-category-quality.js`, `home-topic-selection-utils.js`, `tests/cross-section-dedupe-category.test.mjs`

## Lesson

Feed単位の`sourceTags`は媒体の幅広い扱いを示すことがあり、個別記事のbrand evidenceとは限らない。たとえばゲーム媒体の`pokemon`タグをすべての記事に適用すると、デジモンや他作品に「ポケモン」理由が付く。

Brand判定は、記事とidentityが整合したtitle / summary / descriptionの明示的な正規別名、または公式sourceに限る。一般語の部分一致やfeed全体タグだけでbrandを付与しない。生成時に不整合tagを保存せず、表示正規化でも既存dataを防御する。

## Verification

正例のポケモン / Pokémon GO / ポケットモンスターと、負例のMELTY BLOOD / デジタルモンスター / デジモン / モンスターハンターをfixture化する。通常のgames / anime判定が維持されることも確認する。
