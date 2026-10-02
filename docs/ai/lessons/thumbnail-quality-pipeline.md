# Thumbnail selection is a layered quality pipeline

- Status: active
- Created: 2026-08-20
- Last verified: 2026-10-02
- Source task: repository initialization from current implementation

## Lesson

RSSや記事HTMLの最初の画像文字列をそのままthumbnailにしない。候補はRSSの`media:content` / enclosure / inline imageと、記事HTMLのOpen Graph、Twitter Card、JSON-LD、`srcset`、lazy-load属性等から集め、絶対URL化と検証を通す。

favicon、logo、placeholder、極小画像、SVG、記事page URL、aggregator proxy、記事hostと不整合なaggregator画像は拒否する。欠損・弱い・低解像度・疑わしい画像だけをmetadata enrichment / repair対象にし、有効な既存画像を無条件に上書きしない。

## Why it matters

sourceごとにRSSとHTMLの画像表現が異なり、画像らしく見えるURLでもlogo、proxy、記事page、低解像度assetの場合がある。取得と品質判定を分離すると、source固有fallbackを追加しても共通の安全条件を保てる。

## Evidence

- `lib/trend-aggregator.mjs`: RSS image extractionと`pickThumbnailFromItem()`
- `lib/thumbnail-utils.mjs`: candidate extraction、`sanitizeThumbnailUrl()`、weak / mismatch / resolution判定
- `scripts/fetch-trend-topics.mjs`: metadata enrichment、coverage、限定repair
- `scripts/repair-thumbnails.mjs`: repair対象判定と適用

## Reverification

画像処理変更では、画像あり/なし、relative URL、`srcset`、OG/Twitter/JSON-LD、favicon/logo、proxy、低解像度、記事URL誤認、既存の正常画像維持をfixtureで確認する。外部siteの一時的な成功だけを根拠に一般化しない。


## Repair propagation and article identity (2026-10-02)

最終thumbnail repairはhome-news生成より後に実行される。修復済みの`news-archive.json`から同じIDかつ記事URL identityが一致する`home-news*.json`へthumbnail fieldsだけ同期する。次回refreshも、metadata取得前に前回news archiveの修復済み画像を引き継ぐ。記事順・時刻・カテゴリ・paginationを変えない。

はてな等のRSSでは本文画像URLのpathが記事URLより深い場合がある。URLの深さで本文中の全URLを順位付けすると画像を記事として保存するため、RSS link / Atom alternateを優先する。aggregator wrapperの解決は一意の同一title anchorだけを候補にする。

HTMLは属性順を問わずmetadataを読み、無効な先頭候補の後も試す。JSON-LDのarticle imageと本文container内のlazy/srcsetを使う。srcsetは実際に指定されている大きなvariantを選び、URLを推測で書き換えない。script内の無関係な画像やbase64 asset、関連記事を辿るrepairは利用しない。publisher取得失敗でも既存の利用可能画像は消さない。

回帰test: `tests/thumbnail-retrieval.test.mjs`、`tests/rss-thumbnail-ingestion.test.mjs`、`tests/thumbnail-display-fallback.test.mjs`。browserでは既存の実画像候補への有限fallback後に画像なしlayoutへ移る。外部proxyや無限retryは使わない。
