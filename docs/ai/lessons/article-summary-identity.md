# Article metadata must remain scoped to article identity

- Status: active
- Created: 2026-08-20
- Last verified: 2026-09-14
- Source task: PR #14; C-003

## Lesson

title、summary、description、thumbnail、URL、sourceは同じ記事identityに属する必要がある。metadata fetch結果を配列index、直前の成功値、topic内の無条件なbest resultで別記事へ転用しない。URL / canonical URLを正規化したkeyが一致するarticleまたはsourceSignalにだけmetadataを適用する。

生成側を第一防御とし、archive merge・dedupe後もidentityを保つ。表示側では、title/contextと整合しないsummaryと、identityが異なる複数記事に完全一致するsummaryを非表示にする。整合を証明できない要約は、別記事の文章を表示するより空にする。

取得先のno-result、HTTP error、access restriction、bot challenge等の画面文言もarticle summaryではない。error画面が検索対象titleを本文へ含むとtitle alignmentだけでは通過するため、`isInvalidArticleSummary()`で文全体が既知のerror shellかを先に判定し、生成・archive/cache normalization・表示の全経路で同じ判定を使う。記事本文内でerror文言を引用する正常summaryまで除外しない。

## Root cause pattern

複数candidate URLから取得したmetadataを単一のbest valueとして保持し、sourceSignalへ記事key確認なしで反映すると、並び替えや取得失敗を境に別記事のsummaryが混入する。cacheも同じidentity条件が必要。

## Evidence

- `news-summary-integrity.js`: `canonicalArticleUrl()`、identity keys、title alignment、collection sanitization
- `scripts/fetch-trend-topics.mjs`: `registerFetchedMetadata()`、`findFetchedMetadata()`、`sanitizeFetchedMetadata()`、archive merge / dedupe
- `shared-topic-utils.js`: client normalization前のsummary sanitization
- `tests/news-summary-integrity.test.mjs`: identity 6件とinvalid-summary経路を含む16 regression cases
- Commit `14a40dc7`; PR #14; merge `4ba96d72`

## Reverification

最低限、無関係な重複summary、前記事からの継承、canonical URL一致、不一致URL拒否、並び替え、dedupe、正常summary維持を確認する。単純な主要語一致だけで正常summaryを大量に落とさない。
