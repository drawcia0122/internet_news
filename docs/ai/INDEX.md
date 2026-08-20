# Memory index

詳細をここへ複製せず、TASKから必要な参照先へ到達するためのrouting tableとして使います。

| Topic | File | Keywords | Status | Last verified | Short description |
| --- | --- | --- | --- | --- | --- |
| Current project state | [`CURRENT_STATE.md`](CURRENT_STATE.md) | architecture, data flow, build, deploy, Classic, Next | active | 2026-08-20 | 現在の構成、主要フロー、制約、懸念点 |
| Memory operation | [`README.md`](README.md) | retrieval, status, stale, evidence, update | active | 2026-08-20 | memoryの選択的取得・成熟・更新規約 |
| Product and development rules | [`../00_COMPANY.md`](../00_COMPANY.md), [`../DEVELOPMENT_RULES.md`](../DEVELOPMENT_RULES.md) | scope, specification, safety, Classic, Next | active | 2026-08-20 | 既存の組織方針と開発規約（source of truth） |
| Classic / Next boundary | [`decisions/classic-next-boundary.md`](decisions/classic-next-boundary.md) | Classic, Next, shared data, root, next/ | active | 2026-08-20 | 同一repository内の製品境界と共有data |
| General news listing source | [`decisions/general-news-listing-source.md`](decisions/general-news-listing-source.md) | home-news, news.html, trends, archive, category | active | 2026-08-20 | Classicトップと全件ページの共通母集団 |
| Refresh stage order | [`decisions/sequential-refresh-stages.md`](decisions/sequential-refresh-stages.md) | refresh, stage, dynamic import, today-internet, thumbnail | active | 2026-08-20 | data生成stageを直列に保つ理由と順序 |
| RSS failure resilience | [`lessons/rss-resilience-and-fallback.md`](lessons/rss-resilience-and-fallback.md) | RSS, feed, timeout, retry, fallback, ERR_NO_RSS_ENTRIES | active | 2026-08-20 | 部分失敗、retry、全件失敗時の既存data保持 |
| Article and summary identity | [`lessons/article-summary-identity.md`](lessons/article-summary-identity.md) | canonical URL, metadata, summary, duplicate, archive, cache | active | 2026-08-20 | 別記事の要約混入を防ぐidentity規則 |
| Thumbnail quality | [`lessons/thumbnail-quality-pipeline.md`](lessons/thumbnail-quality-pipeline.md) | image, thumbnail, og:image, srcset, enclosure, metadata, repair | active | 2026-08-20 | 候補抽出、弱い画像の拒否、repairの境界 |
| Documentation drift | [`observations/documentation-drift.md`](observations/documentation-drift.md) | README, CONTEXT, stale docs, categories | needs-verification | 2026-08-20 | 一部概要docsと現行コードの不一致観測 |
| Deployment source of truth | [`../../README.md`](../../README.md), [`../../.github/workflows/deploy-pages.yml`](../../.github/workflows/deploy-pages.yml), [`../../.github/workflows/refresh-news.yml`](../../.github/workflows/refresh-news.yml) | GitHub Pages, schedule, auto commit, deploy | active | 2026-08-20 | deployment詳細は既存READMEとworkflowを直接参照 |
