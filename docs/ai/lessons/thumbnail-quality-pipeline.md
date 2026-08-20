# Thumbnail selection is a layered quality pipeline

- Status: active
- Created: 2026-08-20
- Last verified: 2026-08-20
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
