# Article metadata must remain scoped to article identity

- Status: active
- Created: 2026-08-20
- Last verified: 2026-08-20
- Source task: PR #14

## Lesson

title、summary、description、thumbnail、URL、sourceは同じ記事identityに属する必要がある。metadata fetch結果を配列index、直前の成功値、topic内の無条件なbest resultで別記事へ転用しない。URL / canonical URLを正規化したkeyが一致するarticleまたはsourceSignalにだけmetadataを適用する。

生成側を第一防御とし、archive merge・dedupe後もidentityを保つ。表示側では、title/contextと整合しないsummaryと、identityが異なる複数記事に完全一致するsummaryを非表示にする。整合を証明できない要約は、別記事の文章を表示するより空にする。

## Root cause pattern

複数candidate URLから取得したmetadataを単一のbest valueとして保持し、sourceSignalへ記事key確認なしで反映すると、並び替えや取得失敗を境に別記事のsummaryが混入する。cacheも同じidentity条件が必要。

## Evidence

- `news-summary-integrity.js`: `canonicalArticleUrl()`、identity keys、title alignment、collection sanitization
- `scripts/fetch-trend-topics.mjs`: `registerFetchedMetadata()`、`findFetchedMetadata()`、`sanitizeFetchedMetadata()`、archive merge / dedupe
- `shared-topic-utils.js`: client normalization前のsummary sanitization
- `tests/news-summary-integrity.test.mjs`: 6 regression cases
- Commit `14a40dc7`; PR #14; merge `4ba96d72`

## Reverification

最低限、無関係な重複summary、前記事からの継承、canonical URL一致、不一致URL拒否、並び替え、dedupe、正常summary維持を確認する。単純な主要語一致だけで正常summaryを大量に落とさない。
